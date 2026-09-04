const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

function normalizeMaliPhone(value) {
  const digits = String(value || "").replace(/\D/g, "");
  if (!digits) return "";
  if (digits.length === 8) return digits;
  if (digits.length === 11 && digits.startsWith("223")) return digits.slice(3);
  return digits;
}

function safeEqual(a, b) {
  const left = Buffer.from(String(a || ""));
  const right = Buffer.from(String(b || ""));
  if (left.length !== right.length) return false;
  return crypto.timingSafeEqual(left, right);
}

function downloadSecret() {
  return process.env.RESULT_DOWNLOAD_SECRET || process.env.JWT_SECRET || process.env.SECRET_KEY || "";
}

function createResultDownloadToken(caseId) {
  const secret = downloadSecret();
  if (!secret) return "";
  const payload = Buffer.from(JSON.stringify({ caseId: Number(caseId), exp: Date.now() + 10 * 60 * 1000 })).toString("base64url");
  const signature = crypto.createHmac("sha256", secret).update(payload).digest("base64url");
  return `${payload}.${signature}`;
}

function parseResultDownloadToken(token) {
  const secret = downloadSecret();
  if (!secret) return null;
  const [payload, signature] = String(token || "").split(".");
  if (!payload || !signature) return null;
  const expected = crypto.createHmac("sha256", secret).update(payload).digest("base64url");
  if (!safeEqual(signature, expected)) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    if (!Number.isInteger(Number(data.caseId)) || Number(data.exp || 0) < Date.now()) return null;
    return { caseId: Number(data.caseId) };
  } catch {
    return null;
  }
}

function resolveLaboratoryResultFile(fileUrl) {
  const raw = String(fileUrl || "").trim();
  if (!raw) return null;
  let pathname = raw;
  try {
    if (/^https?:\/\//i.test(raw)) pathname = new URL(raw).pathname;
  } catch {
    return null;
  }
  const marker = "/uploads/laboratory/";
  const index = pathname.indexOf(marker);
  if (index === -1) return null;
  const filename = path.basename(decodeURIComponent(pathname.slice(index + marker.length)));
  if (!filename || filename === "." || filename === "..") return null;
  const root = path.resolve(__dirname, "uploads", "laboratory");
  const absolute = path.resolve(root, filename);
  if (!absolute.startsWith(`${root}${path.sep}`)) return null;
  return absolute;
}

module.exports = function(app, pool, authenticateToken) {
  app.get("/api/notifications", authenticateToken, async (req, res) => {
    const r = await pool.query(
      "SELECT * FROM app_notifications ORDER BY created_at DESC LIMIT 50"
    );
    res.json(r.rows);
  });

  app.post("/api/notifications/:id/read", authenticateToken, async (req, res) => {
    await pool.query("UPDATE app_notifications SET is_read=true WHERE id=$1", [req.params.id]);
    res.json({ success: true });
  });

  app.post("/api/appointments/:id/confirm", authenticateToken, async (req, res) => {
    const id = req.params.id;

    await pool.query(`
      UPDATE appointments
      SET status='confirmé'
      WHERE id=$1
    `, [id]).catch(() => null);

    const appt = await pool.query("SELECT * FROM appointments WHERE id=$1", [id]).catch(() => ({ rows: [] }));
    const a = appt.rows[0] || {};

    const phone = a.phone || a.telephone || a.patient_phone || "";
    const patient = a.patient_name || a.fullname || "Patient";
    const date = a.requested_date || a.date_demande || a.date || "";
    const hour = a.requested_time || a.heure_demande || a.hour || "";

    await pool.query(`
      INSERT INTO sms_outbox(phone, message)
      VALUES($1, $2)
    `, [
      phone,
      `Bonjour ${patient}. Votre rendez-vous chez HAFIYA Laboratoire est confirmé pour le ${date} à ${hour}. Merci.`
    ]);

    await pool.query(`
      INSERT INTO app_notifications(title, message, type)
      VALUES('Rendez-vous confirmé', $1, 'appointment')
    `, [`Le rendez-vous de ${patient} a été confirmé.`]);

    res.json({ success: true });
  });

  app.post("/api/feedback", async (req, res) => {
    const { appointment_id, patient_name, phone, rating, comment } = req.body;

    await pool.query(`
      INSERT INTO appointment_feedback(appointment_id, patient_name, phone, rating, comment)
      VALUES($1,$2,$3,$4,$5)
    `, [appointment_id || null, patient_name || "", phone || "", rating || null, comment || ""]);

    res.json({ success: true, message: "Merci pour votre avis." });
  });

  app.get("/api/feedback", authenticateToken, async (req, res) => {
    const r = await pool.query("SELECT * FROM appointment_feedback ORDER BY created_at DESC");
    res.json(r.rows);
  });

  app.get("/api/chat/messages/:userId", authenticateToken, async (req, res) => {
    const me = req.user.id;
    const other = req.params.userId;

    const r = await pool.query(`
      SELECT *
      FROM chat_messages
      WHERE (sender_id=$1 AND receiver_id=$2)
         OR (sender_id=$2 AND receiver_id=$1)
      ORDER BY created_at ASC
    `, [me, other]);

    res.json(r.rows);
  });

  app.post("/api/chat/messages", authenticateToken, async (req, res) => {
    const sender = req.user.id;
    const { receiver_id, message } = req.body;

    const r = await pool.query(`
      INSERT INTO chat_messages(sender_id, receiver_id, message)
      VALUES($1,$2,$3)
      RETURNING *
    `, [sender, receiver_id, message]);

    res.json(r.rows[0]);
  });

  // Version renforcée du parcours public des résultats HAFIYA.
  // Le téléphone est normalisé et le chemin physique du fichier n'est jamais exposé au client.
  app.post("/laboratory/public/results/verify-v2", async (req, res) => {
    try {
      const resultCode = String(req.body?.result_code || "").trim();
      const verifier = String(req.body?.verifier || "").trim();
      if (!resultCode || !verifier) {
        return res.status(400).json({ error: "Code résultat et vérification obligatoires." });
      }

      const result = await pool.query(
        `SELECT c.id, c.company_id, c.case_number, c.result_code, c.status,
                c.result_summary, c.result_file_url, c.result_file_name,
                c.result_published, c.published_at, c.created_at,
                p.full_name AS patient_name, p.phone AS patient_phone, p.birth_date,
                ls.lab_name, ls.phone AS lab_phone, ls.email AS lab_email, ls.address AS lab_address
         FROM laboratory_cases c
         LEFT JOIN laboratory_patients p ON p.id=c.patient_id
         LEFT JOIN laboratory_settings ls ON ls.company_id=c.company_id
         WHERE c.result_code=$1 AND c.result_published=true
         LIMIT 1`,
        [resultCode]
      );
      const row = result.rows[0];
      const normalizedVerifier = normalizeMaliPhone(verifier);
      const normalizedPatientPhone = normalizeMaliPhone(row?.patient_phone);
      const birthVerifier = verifier.slice(0, 10).toLowerCase();
      const birthDate = String(row?.birth_date || "").slice(0, 10).toLowerCase();
      const accepted = Boolean(
        row &&
          ((normalizedVerifier && normalizedPatientPhone && normalizedVerifier === normalizedPatientPhone) ||
            (birthVerifier && birthDate && birthVerifier === birthDate))
      );

      await pool.query(
        `INSERT INTO laboratory_result_access_logs
         (company_id, case_id, result_code, verifier, success, ip_address, user_agent)
         VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [
          row?.company_id || null,
          row?.id || null,
          resultCode,
          normalizeMaliPhone(verifier) || "date",
          accepted,
          req?.headers?.["x-forwarded-for"] || req?.ip || "",
          req?.headers?.["user-agent"] || ""
        ]
      ).catch(() => null);

      if (!accepted) {
        return res.status(403).json({ error: "Code résultat ou vérification incorrect." });
      }

      const analyses = await pool.query(
        `SELECT id, analysis_id, analysis_name, result_value, result_notes
         FROM laboratory_case_analyses
         WHERE case_id=$1
         ORDER BY id ASC`,
        [row.id]
      );

      const downloadToken = row.result_file_url ? createResultDownloadToken(row.id) : "";
      const publicResult = {
        id: row.id,
        case_number: row.case_number,
        result_code: row.result_code,
        status: row.status,
        result_summary: row.result_summary,
        result_published: row.result_published,
        published_at: row.published_at,
        created_at: row.created_at,
        patient_name: row.patient_name,
        lab_name: row.lab_name,
        lab_phone: row.lab_phone,
        lab_email: row.lab_email,
        lab_address: row.lab_address,
        has_result_file: Boolean(row.result_file_url),
        result_file_name: row.result_file_name || "resultat-laboratoire"
      };

      return res.json({
        result: publicResult,
        analyses: analyses.rows,
        download_url: downloadToken ? `/laboratory/public/results/download/${encodeURIComponent(downloadToken)}` : ""
      });
    } catch (error) {
      console.error("ERREUR VERIFY LAB RESULT V2 :", error);
      return res.status(500).json({ error: "Erreur consultation résultat laboratoire" });
    }
  });

  app.get("/laboratory/public/results/download/:token", async (req, res) => {
    try {
      const parsed = parseResultDownloadToken(req.params.token);
      if (!parsed) return res.status(403).json({ error: "Lien résultat invalide ou expiré." });

      const result = await pool.query(
        `SELECT id, result_file_url, result_file_name
         FROM laboratory_cases
         WHERE id=$1 AND result_published=true
         LIMIT 1`,
        [parsed.caseId]
      );
      const row = result.rows[0];
      if (!row?.result_file_url) return res.status(404).json({ error: "Fichier résultat introuvable." });

      const absolute = resolveLaboratoryResultFile(row.result_file_url);
      if (!absolute || !fs.existsSync(absolute)) {
        return res.status(404).json({ error: "Fichier résultat introuvable." });
      }

      const downloadName = String(row.result_file_name || path.basename(absolute)).replace(/[\r\n"]/g, "");
      return res.download(absolute, downloadName || path.basename(absolute));
    } catch (error) {
      console.error("ERREUR DOWNLOAD LAB RESULT :", error);
      return res.status(500).json({ error: "Erreur téléchargement résultat laboratoire" });
    }
  });
};
