"use strict";

const pointageEngine = require("./services/pointage-engine");

/* Badge lu au kiosque : le QR porte { badge_token } (jeton aléatoire,
   users.badge_qr_token). L'ancien { badge_code } (HAFIYA-EMP-<id>, devinable)
   identifie encore une personne pour AFFICHER ses tâches, mais ne vaut plus
   pointage. */
function lireBadge(corps) {
  const brut = String(corps?.badge_token || corps?.badge || corps?.badge_code || "").trim();
  if (!brut) return { jeton: "", code: "" };
  try {
    const objet = JSON.parse(brut);
    if (objet && typeof objet === "object") {
      return { jeton: String(objet.badge_token || "").trim(), code: String(objet.badge_code || "").trim() };
    }
  } catch { /* texte brut */ }
  return /^HAFIYA-EMP-/i.test(brut) ? { jeton: "", code: brut } : { jeton: brut, code: "" };
}

async function resoudreEmploye(db, cid, corps, { pourPointer }) {
  const { jeton, code } = lireBadge(corps);
  const colonnes = `id,fullname,role,badge_code,profile_image_url`;
  const filtre = `company_id=$1 AND COALESCE(is_active,true)=true
           AND LOWER(COALESCE(role,'')) NOT IN ('super_admin','kiosk_pointage','customer','client','patient')`;
  if (jeton) {
    const r = await db.query(`SELECT ${colonnes} FROM users WHERE ${filtre} AND badge_qr_token=$2 LIMIT 1`, [cid, jeton]);
    if (r.rows[0]) return { employe: r.rows[0] };
  }
  if (code) {
    const r = await db.query(`SELECT ${colonnes} FROM users WHERE ${filtre} AND badge_code=$2 LIMIT 1`, [cid, code]);
    if (r.rows[0]) return pourPointer ? { obsolete: true } : { employe: r.rows[0] };
  }
  return {};
}

function roleOf(user) {
  return String(user?.role || "").trim().toLowerCase();
}

function isHafiyaRequest(req) {
  const tenant = String(req?.tenant_id || req?.user?.tenant_id || "").trim().toLowerCase();
  return tenant === "hafiya";
}

function isKioskUser(user) {
  return roleOf(user) === "kiosk_pointage";
}

function isDirection(user) {
  return user?.is_super_admin === true || ["super_admin", "admin", "admin_entreprise", "direction", "directeur"].includes(roleOf(user));
}

function canUseKiosk(user) {
  return isKioskUser(user) || isDirection(user);
}

function companyId(req) {
  return Number(req.user?.company_id || 0);
}

function guardKiosk(req, res) {
  if (!isHafiyaRequest(req)) {
    res.status(403).json({ error: "Accès réservé à HAFIYA." });
    return false;
  }
  if (!canUseKiosk(req.user)) {
    res.status(403).json({ error: "Accès kiosque refusé." });
    return false;
  }
  if (!companyId(req)) {
    res.status(409).json({ error: "Société HAFIYA non résolue." });
    return false;
  }
  return true;
}

function guardDirection(req, res) {
  if (!isHafiyaRequest(req) || !isDirection(req.user) || !companyId(req)) {
    res.status(403).json({ error: "Accès Direction HAFIYA requis." });
    return false;
  }
  return true;
}

// Règle kiosque HAFIYA : 1er scan = début de travail, 2e scan = débauche.
// Les anciens champs de pause restent en base pour compatibilité/historique, mais
// ils ne participent plus à la progression automatique du kiosque.
function nextAttendanceAction(row) {
  if (!row?.check_in) return "ARRIVEE";
  if (!row?.check_out) return "DEBAUCHE";
  return "TERMINE";
}

function publicEmployee(row) {
  return {
    user_id: row.id || row.user_id,
    fullname: row.fullname,
    role: row.role,
    badge_code: row.badge_code,
    profile_image_url: row.profile_image_url || null
  };
}

module.exports = function registerHafiyaKioskRoutes(app, pool, authenticateToken) {
  app.get("/hafiya/kiosk/bootstrap", authenticateToken, async (req, res) => {
    try {
      if (!guardKiosk(req, res)) return;
      const cid = companyId(req);

      const users = await pool.query(
        `SELECT id, fullname, role, badge_code, profile_image_url
         FROM users
         WHERE company_id=$1
           AND COALESCE(is_active,true)=true
           AND LOWER(COALESCE(role,'')) NOT IN ('super_admin','kiosk_pointage')
         ORDER BY fullname`,
        [cid]
      );

      const attendance = await pool.query(
        `SELECT ar.user_id, ar.work_date, ar.check_in, ar.break_out, ar.break_in, ar.check_out,
                ar.status, ar.late_minutes, u.fullname, u.role, u.profile_image_url
         FROM attendance_records ar
         JOIN users u ON u.id=ar.user_id
         WHERE ar.company_id=$1 AND ar.work_date=CURRENT_DATE
           AND COALESCE(ar.is_cancelled,false)=false
         ORDER BY u.fullname`,
        [cid]
      );

      const rows = attendance.rows.map((r) => ({
        user_id: r.user_id,
        fullname: r.fullname,
        role: r.role,
        profile_image_url: r.profile_image_url || null,
        work_date: r.work_date,
        check_in: r.check_in,
        break_out: r.break_out,
        break_in: r.break_in,
        check_out: r.check_out,
        status: r.check_out ? "Terminé" : r.check_in ? (Number(r.late_minutes || 0) > 0 ? "En retard" : "Présent") : "Absent",
        late_minutes: Number(r.late_minutes || 0)
      }));

      const byUser = new Map(rows.map((r) => [Number(r.user_id), r]));
      const employees = users.rows.map((u) => ({
        ...publicEmployee(u),
        attendance: byUser.get(Number(u.id)) || null
      }));

      res.json({
        kiosk: true,
        employees,
        counters: {
          present: employees.filter((e) => ["Présent", "En retard"].includes(e.attendance?.status)).length,
          pause: 0,
          absent: employees.filter((e) => !e.attendance || e.attendance?.status === "Absent").length,
          finished: employees.filter((e) => e.attendance?.status === "Terminé").length
        },
        access: {
          salaries: false,
          payroll: false,
          accounting: false,
          patients: false,
          laboratory: false,
          documents: false,
          settings: false
        }
      });
    } catch (error) {
      console.error("HAFIYA KIOSK BOOTSTRAP:", error);
      res.status(500).json({ error: "Erreur chargement kiosque." });
    }
  });

  app.post("/hafiya/kiosk/identify", authenticateToken, async (req, res) => {
    try {
      if (!guardKiosk(req, res)) return;
      const cid = companyId(req);
      const lu = lireBadge(req.body);
      if (!lu.jeton && !lu.code) return res.status(400).json({ error: "Badge obligatoire." });
      const { employe: employee } = await resoudreEmploye(pool, cid, req.body, { pourPointer: false });
      if (!employee) return res.status(404).json({ error: "Badge inconnu pour HAFIYA." });

      const attendance = (await pool.query(
        `SELECT id,user_id,work_date,check_in,break_out,break_in,check_out,status,late_minutes
         FROM attendance_records
         WHERE company_id=$1 AND user_id=$2 AND work_date=CURRENT_DATE
           AND COALESCE(is_cancelled,false)=false
         LIMIT 1`,
        [cid, employee.id]
      )).rows[0] || null;

      const tasks = await pool.query(
        `SELECT id,assigned_to,title,description,priority,due_date,status,completed_at
         FROM hafiya_staff_tasks
         WHERE company_id=$1 AND assigned_to=$2 AND due_date=CURRENT_DATE
         ORDER BY CASE priority WHEN 'urgent' THEN 0 WHEN 'haute' THEN 1 ELSE 2 END,id`,
        [cid, employee.id]
      );

      res.json({
        employee: publicEmployee(employee),
        attendance,
        next_action: nextAttendanceAction(attendance),
        tasks: tasks.rows
      });
    } catch (error) {
      console.error("HAFIYA KIOSK IDENTIFY:", error);
      res.status(500).json({ error: "Erreur identification badge." });
    }
  });

  app.post("/hafiya/kiosk/scan", authenticateToken, async (req, res) => {
    const client = await pool.connect();
    try {
      if (!guardKiosk(req, res)) return;
      const cid = companyId(req);
      const lu = lireBadge(req.body);
      if (!lu.jeton && !lu.code) return res.status(400).json({ error: "Badge obligatoire." });
      const trouve = await resoudreEmploye(client, cid, req.body, { pourPointer: true });
      if (trouve.obsolete) {
        return res.status(409).json({ error: "Badge ancien format : réimprimez le badge (page Badges).", code: "BADGE_OBSOLETE" });
      }
      const employee = trouve.employe;
      if (!employee) return res.status(404).json({ error: "Badge inconnu pour HAFIYA." });

      /* Deux lectures à quelques secondes d'écart sont UN geste : sans cette
         garde, un double scan pointait l'arrivée puis le départ. */
      const recent = (await client.query(
        `SELECT 1 FROM attendance_history WHERE user_id=$1 AND company_id=$2
            AND created_at > CURRENT_TIMESTAMP - ($3 || ' seconds')::interval LIMIT 1`,
        [employee.id, cid, String(pointageEngine.ANTI_REBOND_SECONDES)])).rows[0];
      let attendance = (await client.query(
        `SELECT * FROM attendance_records WHERE user_id=$1 AND work_date=CURRENT_DATE LIMIT 1`, [employee.id])).rows[0] || null;
      let action = nextAttendanceAction(attendance || {});
      let statut = "deja_enregistre";
      if (!recent) {
        if (action === "TERMINE") {
          return res.status(409).json({ error: "La journée est déjà terminée pour cet employé." });
        }
        let r;
        try {
          r = await pointageEngine.enregistrerPointage(pool, {
            companyId: cid, userId: employee.id, action: action === "ARRIVEE" ? "checkin" : "checkout",
            methode: "QR", tenantId: "hafiya", createdBy: req.user.id,
            metadata: { source: "kiosk_badge", device_info: String(req.body?.device_info || "tablette HAFIYA").slice(0, 200) },
          });
        } catch (e) {
          if (e instanceof pointageEngine.PointageError) return res.status(e.httpStatus).json({ error: e.message, code: e.code });
          throw e;
        }
        statut = r.statut;
        attendance = (await client.query(
          `UPDATE attendance_records SET source='kiosk_badge' WHERE id=$1 RETURNING *`, [r.fiche.id])).rows[0];
        await client.query(
          `INSERT INTO hafiya_kiosk_audit(company_id,user_id,badge_code,action_type,performed_by,device_info)
           VALUES($1,$2,$3,$4,$5,$6)`,
          [cid, employee.id, employee.badge_code || "", action, req.user.id, String(req.body?.device_info || "tablette HAFIYA")]
        );
      } else {
        action = attendance?.check_out ? "DEBAUCHE" : "ARRIVEE";
      }

      const tasks = await pool.query(
        `SELECT id,assigned_to,title,description,priority,due_date,status,completed_at
         FROM hafiya_staff_tasks
         WHERE company_id=$1 AND assigned_to=$2 AND due_date=CURRENT_DATE
         ORDER BY CASE priority WHEN 'urgent' THEN 0 WHEN 'haute' THEN 1 ELSE 2 END,id`,
        [cid, employee.id]
      );

      res.json({
        success: true,
        statut,
        employee: publicEmployee(employee),
        action,
        attendance,
        next_action: nextAttendanceAction(attendance || {}),
        tasks: tasks.rows
      });
    } catch (error) {
      await client.query("ROLLBACK").catch(() => null);
      console.error("HAFIYA KIOSK SCAN:", error);
      res.status(500).json({ error: "Erreur pointage badge." });
    } finally {
      client.release();
    }
  });

  app.post("/hafiya/kiosk/manual", authenticateToken, async (req, res) => {
    try {
      if (!guardKiosk(req, res)) return;
      const cid = companyId(req);
      const uid = Number(req.body?.user_id || 0);
      if (!uid) return res.status(400).json({ error: "Employé obligatoire." });
      const employee = (await pool.query(
        `SELECT id,fullname,role,badge_code FROM users
         WHERE id=$1 AND company_id=$2 AND COALESCE(is_active,true)=true
           AND LOWER(COALESCE(role,'')) NOT IN ('super_admin','kiosk_pointage') LIMIT 1`,
        [uid, cid]
      )).rows[0];
      if (!employee) return res.status(404).json({ error: "Employé introuvable." });
      req.body.badge_code = employee.badge_code;
      return res.status(400).json({ error: "Pointage manuel réservé au mode sécurisé avec confirmation Direction. Utilisez le badge QR." });
    } catch (error) {
      console.error("HAFIYA KIOSK MANUAL:", error);
      res.status(500).json({ error: "Erreur pointage manuel." });
    }
  });

  app.get("/hafiya/kiosk/history", authenticateToken, async (req, res) => {
    try {
      if (!guardKiosk(req, res)) return;
      const cid = companyId(req);
      const days = Math.min(31, Math.max(1, Number(req.query?.days || 7)));
      const result = await pool.query(
        `SELECT ar.work_date,ar.check_in,ar.break_out,ar.break_in,ar.check_out,ar.status,
                u.fullname,u.role
         FROM attendance_records ar
         JOIN users u ON u.id=ar.user_id
         WHERE ar.company_id=$1 AND ar.work_date >= CURRENT_DATE - ($2::int - 1)
           AND LOWER(COALESCE(u.role,'')) NOT IN ('super_admin','kiosk_pointage')
         ORDER BY ar.work_date DESC,u.fullname`,
        [cid, days]
      );
      res.json(result.rows);
    } catch (error) {
      console.error("HAFIYA KIOSK HISTORY:", error);
      res.status(500).json({ error: "Erreur historique kiosque." });
    }
  });

  app.post("/hafiya/kiosk/tasks", authenticateToken, async (req, res) => {
    try {
      if (!guardDirection(req, res)) return;
      const cid = companyId(req);
      const assignedTo = Number(req.body?.assigned_to || 0);
      const title = String(req.body?.title || "").trim();
      const dueDate = String(req.body?.due_date || "").slice(0, 10);
      if (!assignedTo || !title || !/^\d{4}-\d{2}-\d{2}$/.test(dueDate)) {
        return res.status(400).json({ error: "Employé, tâche et date obligatoires." });
      }
      const target = await pool.query("SELECT id FROM users WHERE id=$1 AND company_id=$2", [assignedTo, cid]);
      if (!target.rows[0]) return res.status(404).json({ error: "Employé introuvable." });
      const result = await pool.query(
        `INSERT INTO hafiya_staff_tasks(company_id,assigned_to,title,description,priority,due_date,status,created_by)
         VALUES($1,$2,$3,$4,$5,$6,'a_faire',$7) RETURNING *`,
        [cid, assignedTo, title, String(req.body?.description || ""), String(req.body?.priority || "normale"), dueDate, req.user.id]
      );
      res.status(201).json(result.rows[0]);
    } catch (error) {
      console.error("HAFIYA CREATE TASK:", error);
      res.status(500).json({ error: "Erreur création tâche." });
    }
  });

  app.put("/hafiya/kiosk/tasks/:id/status", authenticateToken, async (req, res) => {
    try {
      if (!guardKiosk(req, res)) return;
      const cid = companyId(req);
      const lu = lireBadge(req.body);
      const badge = lu.jeton || lu.code;
      const status = String(req.body?.status || "").trim();
      if (!badge || !["a_faire", "en_cours", "termine"].includes(status)) {
        return res.status(400).json({ error: "Badge et statut valides obligatoires." });
      }
      const employee = (await pool.query(
        `SELECT id FROM users WHERE company_id=$1 AND (badge_qr_token=$2 OR badge_code=$2) AND COALESCE(is_active,true)=true LIMIT 1`,
        [cid, badge]
      )).rows[0];
      if (!employee) return res.status(404).json({ error: "Badge non reconnu." });
      const result = await pool.query(
        `UPDATE hafiya_staff_tasks
         SET status=$1,completed_at=CASE WHEN $1='termine' THEN CURRENT_TIMESTAMP ELSE NULL END,updated_at=CURRENT_TIMESTAMP
         WHERE id=$2 AND company_id=$3 AND assigned_to=$4 AND due_date=CURRENT_DATE
         RETURNING id,assigned_to,title,description,priority,due_date,status,completed_at`,
        [status, req.params.id, cid, employee.id]
      );
      if (!result.rows[0]) return res.status(404).json({ error: "Tâche introuvable pour cet employé aujourd'hui." });
      res.json(result.rows[0]);
    } catch (error) {
      console.error("HAFIYA TASK STATUS:", error);
      res.status(500).json({ error: "Erreur mise à jour tâche." });
    }
  });
};
