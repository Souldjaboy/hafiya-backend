"use strict";

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");

const runningRecordings = new Map();

function roleOf(user) {
  return String(user?.role || "").trim().toLowerCase();
}

function canView(user) {
  return user?.is_super_admin === true || ["super_admin", "admin", "admin_entreprise", "direction", "directeur"].includes(roleOf(user));
}

function canManage(user) {
  return canView(user);
}

function guard(req, res, manage = false) {
  const tenant = String(req?.tenant_id || req?.user?.tenant_id || "").toLowerCase();
  const allowed = manage ? canManage(req.user) : canView(req.user);
  if (tenant !== "hafiya" || !allowed) {
    res.status(403).json({ error: "Accès caméras HAFIYA réservé à la Direction." });
    return false;
  }
  return true;
}

function companyId(req) {
  return Number(req.user?.company_id || req.body?.company_id || req.query?.company_id || 0);
}

function getEncryptionKey() {
  const raw = String(process.env.HAFIYA_CAMERA_ENCRYPTION_KEY || "");
  if (!raw) throw new Error("HAFIYA_CAMERA_ENCRYPTION_KEY manquante dans le serveur.");
  return crypto.createHash("sha256").update(raw).digest();
}

function encryptSecret(value) {
  if (!value) return null;
  const key = getEncryptionKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(String(value), "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, encrypted]).toString("base64");
}

function decryptSecret(value) {
  if (!value) return "";
  const payload = Buffer.from(String(value), "base64");
  const iv = payload.subarray(0, 12);
  const tag = payload.subarray(12, 28);
  const encrypted = payload.subarray(28);
  const decipher = crypto.createDecipheriv("aes-256-gcm", getEncryptionKey(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString("utf8");
}

function safePublicCamera(row) {
  return {
    id: row.id,
    company_id: row.company_id,
    name: row.name,
    location: row.location,
    protocol: row.protocol,
    username_hint: row.username_hint,
    brand: row.brand,
    model: row.model,
    notes: row.notes,
    active: row.active,
    last_status: row.last_status,
    last_checked_at: row.last_checked_at,
    last_error: row.last_error,
    created_at: row.created_at,
    updated_at: row.updated_at,
    has_stream_url: Boolean(row.stream_url_encrypted),
    has_snapshot_url: Boolean(row.snapshot_url_encrypted)
  };
}

async function getCamera(pool, req, id) {
  const cid = companyId(req);
  const result = await pool.query(
    "SELECT * FROM hafiya_cameras WHERE id=$1 AND company_id=$2 AND active=true LIMIT 1",
    [id, cid]
  );
  return result.rows[0] || null;
}

function ffmpegArgsForInput(url) {
  const lower = String(url || "").toLowerCase();
  const args = [];
  if (lower.startsWith("rtsp://")) args.push("-rtsp_transport", "tcp");
  return args.concat(["-i", url]);
}

function spawnWithTimeout(command, args, timeoutMs = 12000) {
  return new Promise((resolve) => {
    const child = spawn(command, args, { stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
    }, timeoutMs);
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
      if (stderr.length > 4000) stderr = stderr.slice(-4000);
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      resolve({ ok: false, error: error.message || String(error) });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ ok: code === 0, code, error: stderr.trim() });
    });
  });
}

function sanitizeDuration(value) {
  const n = Number(value || 300);
  if (!Number.isFinite(n)) return 300;
  return Math.min(Math.max(Math.round(n), 10), 8 * 60 * 60);
}

module.exports = function registerHafiyaCameraRoutes(app, pool, authenticateToken) {
  const storageRoot = path.join(__dirname, "uploads", "hafiya-cameras");
  const recordingDir = path.join(storageRoot, "recordings");
  fs.mkdirSync(recordingDir, { recursive: true });

  app.get("/hafiya/cameras", authenticateToken, async (req, res) => {
    try {
      if (!guard(req, res)) return;
      const result = await pool.query(
        `SELECT * FROM hafiya_cameras
         WHERE company_id=$1 AND active=true
         ORDER BY location, name, id`,
        [companyId(req)]
      );
      res.json(result.rows.map(safePublicCamera));
    } catch (error) {
      console.error("HAFIYA CAMERAS LIST:", error);
      res.status(500).json({ error: "Erreur lecture caméras." });
    }
  });

  app.post("/hafiya/cameras", authenticateToken, async (req, res) => {
    try {
      if (!guard(req, res, true)) return;
      const name = String(req.body?.name || "").trim();
      const location = String(req.body?.location || "").trim();
      const streamUrl = String(req.body?.stream_url || "").trim();
      if (!name || !streamUrl) return res.status(400).json({ error: "Nom et URL du flux obligatoires." });
      if (!/^(rtsp|rtsps|http|https):\/\//i.test(streamUrl)) {
        return res.status(400).json({ error: "URL caméra invalide. RTSP/RTSPS/HTTP/HTTPS attendu." });
      }
      const result = await pool.query(
        `INSERT INTO hafiya_cameras
         (company_id,name,location,protocol,stream_url_encrypted,snapshot_url_encrypted,username_hint,brand,model,notes,created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
         RETURNING *`,
        [
          companyId(req),
          name,
          location,
          String(req.body?.protocol || "rtsp").toLowerCase(),
          encryptSecret(streamUrl),
          req.body?.snapshot_url ? encryptSecret(String(req.body.snapshot_url)) : null,
          String(req.body?.username_hint || ""),
          String(req.body?.brand || ""),
          String(req.body?.model || ""),
          String(req.body?.notes || ""),
          req.user?.id || null
        ]
      );
      await pool.query(
        `INSERT INTO hafiya_camera_events(company_id,camera_id,event_type,details,user_id)
         VALUES ($1,$2,'camera_created',$3::jsonb,$4)`,
        [companyId(req), result.rows[0].id, JSON.stringify({ name, location }), req.user?.id || null]
      );
      res.status(201).json(safePublicCamera(result.rows[0]));
    } catch (error) {
      console.error("HAFIYA CAMERA CREATE:", error);
      res.status(500).json({ error: error.message || "Erreur création caméra." });
    }
  });

  app.put("/hafiya/cameras/:id", authenticateToken, async (req, res) => {
    try {
      if (!guard(req, res, true)) return;
      const current = await getCamera(pool, req, req.params.id);
      if (!current) return res.status(404).json({ error: "Caméra introuvable." });
      const streamEncrypted = req.body?.stream_url
        ? encryptSecret(String(req.body.stream_url).trim())
        : current.stream_url_encrypted;
      const snapshotEncrypted = req.body?.snapshot_url !== undefined
        ? (req.body.snapshot_url ? encryptSecret(String(req.body.snapshot_url).trim()) : null)
        : current.snapshot_url_encrypted;
      const result = await pool.query(
        `UPDATE hafiya_cameras SET
          name=$1,location=$2,protocol=$3,stream_url_encrypted=$4,snapshot_url_encrypted=$5,
          username_hint=$6,brand=$7,model=$8,notes=$9,updated_at=NOW()
         WHERE id=$10 AND company_id=$11 RETURNING *`,
        [
          String(req.body?.name ?? current.name).trim(),
          String(req.body?.location ?? current.location).trim(),
          String(req.body?.protocol ?? current.protocol).toLowerCase(),
          streamEncrypted,
          snapshotEncrypted,
          String(req.body?.username_hint ?? current.username_hint),
          String(req.body?.brand ?? current.brand),
          String(req.body?.model ?? current.model),
          String(req.body?.notes ?? current.notes),
          current.id,
          companyId(req)
        ]
      );
      res.json(safePublicCamera(result.rows[0]));
    } catch (error) {
      console.error("HAFIYA CAMERA UPDATE:", error);
      res.status(500).json({ error: error.message || "Erreur modification caméra." });
    }
  });

  app.delete("/hafiya/cameras/:id", authenticateToken, async (req, res) => {
    try {
      if (!guard(req, res, true)) return;
      const result = await pool.query(
        `UPDATE hafiya_cameras SET active=false,updated_at=NOW()
         WHERE id=$1 AND company_id=$2 RETURNING id`,
        [req.params.id, companyId(req)]
      );
      if (!result.rows[0]) return res.status(404).json({ error: "Caméra introuvable." });
      res.json({ success: true, id: result.rows[0].id });
    } catch (error) {
      console.error("HAFIYA CAMERA DELETE:", error);
      res.status(500).json({ error: "Erreur suppression caméra." });
    }
  });

  app.post("/hafiya/cameras/:id/test", authenticateToken, async (req, res) => {
    try {
      if (!guard(req, res)) return;
      const camera = await getCamera(pool, req, req.params.id);
      if (!camera) return res.status(404).json({ error: "Caméra introuvable." });
      const url = decryptSecret(camera.stream_url_encrypted);
      const args = ffmpegArgsForInput(url).concat(["-t", "1", "-an", "-f", "null", "-"]);
      const result = await spawnWithTimeout("ffmpeg", ["-hide_banner", "-loglevel", "error", ...args], 15000);
      const status = result.ok ? "online" : "offline";
      await pool.query(
        `UPDATE hafiya_cameras SET last_status=$1,last_checked_at=NOW(),last_error=$2 WHERE id=$3 AND company_id=$4`,
        [status, result.ok ? null : String(result.error || "Connexion impossible").slice(0, 1000), camera.id, companyId(req)]
      );
      res.json({ ok: result.ok, status, error: result.ok ? null : result.error });
    } catch (error) {
      console.error("HAFIYA CAMERA TEST:", error);
      res.status(500).json({ error: error.message || "Erreur test caméra." });
    }
  });

  app.get("/hafiya/cameras/:id/snapshot.jpg", authenticateToken, async (req, res) => {
    try {
      if (!guard(req, res)) return;
      const camera = await getCamera(pool, req, req.params.id);
      if (!camera) return res.status(404).json({ error: "Caméra introuvable." });
      const url = decryptSecret(camera.snapshot_url_encrypted || camera.stream_url_encrypted);
      const args = ffmpegArgsForInput(url).concat(["-frames:v", "1", "-f", "image2pipe", "-vcodec", "mjpeg", "-"]);
      res.setHeader("Content-Type", "image/jpeg");
      res.setHeader("Cache-Control", "no-store");
      const child = spawn("ffmpeg", ["-hide_banner", "-loglevel", "error", ...args], { stdio: ["ignore", "pipe", "pipe"] });
      const timer = setTimeout(() => child.kill("SIGKILL"), 15000);
      child.stdout.pipe(res);
      child.on("close", () => clearTimeout(timer));
      child.on("error", (error) => {
        clearTimeout(timer);
        if (!res.headersSent) res.status(500).json({ error: error.message });
        else res.end();
      });
    } catch (error) {
      console.error("HAFIYA CAMERA SNAPSHOT:", error);
      res.status(500).json({ error: error.message || "Erreur capture caméra." });
    }
  });

  app.get("/hafiya/cameras/:id/live.mjpg", authenticateToken, async (req, res) => {
    try {
      if (!guard(req, res)) return;
      const camera = await getCamera(pool, req, req.params.id);
      if (!camera) return res.status(404).json({ error: "Caméra introuvable." });
      const url = decryptSecret(camera.stream_url_encrypted);
      const args = ffmpegArgsForInput(url).concat([
        "-an", "-vf", "fps=5,scale='min(1280,iw)':-2", "-q:v", "5",
        "-f", "mpjpeg", "-boundary_tag", "hafiyaframe", "-"
      ]);
      res.writeHead(200, {
        "Content-Type": "multipart/x-mixed-replace; boundary=hafiyaframe",
        "Cache-Control": "no-store, no-cache, must-revalidate",
        "Connection": "close"
      });
      const child = spawn("ffmpeg", ["-hide_banner", "-loglevel", "error", ...args], { stdio: ["ignore", "pipe", "pipe"] });
      child.stdout.pipe(res);
      const stop = () => {
        if (!child.killed) child.kill("SIGKILL");
      };
      req.on("close", stop);
      req.on("aborted", stop);
      child.on("error", stop);
    } catch (error) {
      console.error("HAFIYA CAMERA LIVE:", error);
      if (!res.headersSent) res.status(500).json({ error: error.message || "Erreur flux caméra." });
    }
  });

  app.post("/hafiya/cameras/:id/recordings/start", authenticateToken, async (req, res) => {
    try {
      if (!guard(req, res, true)) return;
      const camera = await getCamera(pool, req, req.params.id);
      if (!camera) return res.status(404).json({ error: "Caméra introuvable." });
      if (runningRecordings.has(String(camera.id))) {
        return res.status(409).json({ error: "Un enregistrement est déjà en cours pour cette caméra." });
      }
      const duration = sanitizeDuration(req.body?.duration_seconds);
      const fileName = `camera-${camera.id}-${Date.now()}.mp4`;
      const filePath = path.join(recordingDir, fileName);
      const created = await pool.query(
        `INSERT INTO hafiya_camera_recordings(company_id,camera_id,file_name,file_path,status,started_by,duration_seconds)
         VALUES ($1,$2,$3,$4,'recording',$5,$6) RETURNING *`,
        [companyId(req), camera.id, fileName, filePath, req.user?.id || null, duration]
      );
      const rec = created.rows[0];
      const url = decryptSecret(camera.stream_url_encrypted);
      const args = ffmpegArgsForInput(url).concat([
        "-t", String(duration), "-map", "0:v:0", "-map", "0:a?",
        "-c:v", "copy", "-c:a", "aac", "-movflags", "+faststart", "-y", filePath
      ]);
      const child = spawn("ffmpeg", ["-hide_banner", "-loglevel", "error", ...args], { stdio: ["ignore", "ignore", "pipe"] });
      runningRecordings.set(String(camera.id), { child, recordingId: rec.id, filePath });
      child.on("close", async (code) => {
        runningRecordings.delete(String(camera.id));
        let size = null;
        try { size = fs.existsSync(filePath) ? fs.statSync(filePath).size : null; } catch (_) {}
        await pool.query(
          `UPDATE hafiya_camera_recordings SET status=$1,stopped_at=NOW(),file_size_bytes=$2 WHERE id=$3`,
          [code === 0 ? "completed" : "stopped", size, rec.id]
        ).catch(() => {});
      });
      child.on("error", async (error) => {
        runningRecordings.delete(String(camera.id));
        await pool.query(
          `UPDATE hafiya_camera_recordings SET status='failed',stopped_at=NOW() WHERE id=$1`,
          [rec.id]
        ).catch(() => {});
        console.error("HAFIYA CAMERA RECORDING PROCESS:", error);
      });
      res.status(201).json({ ...rec, duration_seconds: duration });
    } catch (error) {
      console.error("HAFIYA CAMERA RECORD START:", error);
      res.status(500).json({ error: error.message || "Erreur démarrage enregistrement." });
    }
  });

  app.post("/hafiya/cameras/:id/recordings/stop", authenticateToken, async (req, res) => {
    try {
      if (!guard(req, res, true)) return;
      const camera = await getCamera(pool, req, req.params.id);
      if (!camera) return res.status(404).json({ error: "Caméra introuvable." });
      const running = runningRecordings.get(String(camera.id));
      if (!running) return res.status(404).json({ error: "Aucun enregistrement en cours." });
      running.child.kill("SIGINT");
      res.json({ success: true, recording_id: running.recordingId });
    } catch (error) {
      console.error("HAFIYA CAMERA RECORD STOP:", error);
      res.status(500).json({ error: "Erreur arrêt enregistrement." });
    }
  });

  app.get("/hafiya/cameras/:id/recordings", authenticateToken, async (req, res) => {
    try {
      if (!guard(req, res)) return;
      const camera = await getCamera(pool, req, req.params.id);
      if (!camera) return res.status(404).json({ error: "Caméra introuvable." });
      const result = await pool.query(
        `SELECT id,camera_id,file_name,status,started_at,stopped_at,duration_seconds,file_size_bytes
         FROM hafiya_camera_recordings
         WHERE company_id=$1 AND camera_id=$2
         ORDER BY id DESC LIMIT 100`,
        [companyId(req), camera.id]
      );
      res.json(result.rows);
    } catch (error) {
      console.error("HAFIYA CAMERA RECORD LIST:", error);
      res.status(500).json({ error: "Erreur lecture enregistrements." });
    }
  });

  app.get("/hafiya/camera-recordings/:recordingId/download", authenticateToken, async (req, res) => {
    try {
      if (!guard(req, res)) return;
      const result = await pool.query(
        `SELECT * FROM hafiya_camera_recordings WHERE id=$1 AND company_id=$2 LIMIT 1`,
        [req.params.recordingId, companyId(req)]
      );
      const row = result.rows[0];
      if (!row || !fs.existsSync(row.file_path)) return res.status(404).json({ error: "Enregistrement introuvable." });
      res.download(row.file_path, row.file_name);
    } catch (error) {
      console.error("HAFIYA CAMERA RECORD DOWNLOAD:", error);
      res.status(500).json({ error: "Erreur téléchargement enregistrement." });
    }
  });
};
