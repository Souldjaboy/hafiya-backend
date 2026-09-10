"use strict";

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

function canManageTasks(user) {
  return isDirection(user);
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
  if (!isHafiyaRequest(req) || !isDirection(req.user)) {
    res.status(403).json({ error: "Accès Direction requis." });
    return false;
  }
  return true;
}

function nextAttendanceAction(row) {
  if (!row?.check_in) return "ARRIVEE";
  if (!row?.break_out) return "DEPART_PAUSE";
  if (!row?.break_in) return "RETOUR_PAUSE";
  if (!row?.check_out) return "DEBAUCHE";
  return "TERMINE";
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
           AND role <> 'super_admin'
         ORDER BY fullname`,
        [cid]
      );
      const attendance = await pool.query(
        `SELECT ar.user_id, ar.work_date, ar.check_in, ar.break_out, ar.break_in, ar.check_out,
                ar.status, ar.late_minutes, u.fullname, u.role, u.badge_code, u.profile_image_url
         FROM attendance_records ar
         JOIN users u ON u.id=ar.user_id
         WHERE ar.company_id=$1 AND ar.work_date=CURRENT_DATE
         ORDER BY u.fullname`,
        [cid]
      );
      const tasks = await pool.query(
        `SELECT t.id, t.assigned_to, t.title, t.description, t.priority, t.due_date,
                t.status, t.completed_at, u.fullname
         FROM hafiya_staff_tasks t
         LEFT JOIN users u ON u.id=t.assigned_to
         WHERE t.company_id=$1 AND t.due_date=CURRENT_DATE
         ORDER BY CASE t.priority WHEN 'urgent' THEN 0 WHEN 'haute' THEN 1 ELSE 2 END, t.id`,
        [cid]
      );
      res.json({
        kiosk: true,
        user: { id: req.user.id, role: req.user.role },
        employees: users.rows,
        attendance: attendance.rows,
        tasks: tasks.rows,
        access: { salaries: false, payroll: false, accounting: false, patients: false, laboratory: false }
      });
    } catch (error) {
      console.error("HAFIYA KIOSK BOOTSTRAP:", error);
      res.status(500).json({ error: "Erreur chargement kiosque." });
    }
  });

  app.post("/hafiya/kiosk/scan", authenticateToken, async (req, res) => {
    const client = await pool.connect();
    try {
      if (!guardKiosk(req, res)) return;
      const cid = companyId(req);
      const badge = String(req.body?.badge_code || "").trim();
      if (!badge) return res.status(400).json({ error: "Badge obligatoire." });

      const userResult = await client.query(
        `SELECT id, fullname, role, badge_code
         FROM users
         WHERE company_id=$1 AND badge_code=$2 AND COALESCE(is_active,true)=true
         LIMIT 1`,
        [cid, badge]
      );
      const employee = userResult.rows[0];
      if (!employee) return res.status(404).json({ error: "Badge inconnu pour HAFIYA." });
      if (roleOf(employee) === "super_admin") return res.status(403).json({ error: "Badge non autorisé sur le kiosque." });

      await client.query("BEGIN");
      let attendance = (await client.query(
        `SELECT * FROM attendance_records WHERE company_id=$1 AND user_id=$2 AND work_date=CURRENT_DATE FOR UPDATE`,
        [cid, employee.id]
      )).rows[0];

      if (!attendance) {
        attendance = (await client.query(
          `INSERT INTO attendance_records(user_id,company_id,work_date,status,source)
           VALUES($1,$2,CURRENT_DATE,'Absent','kiosk_badge') RETURNING *`,
          [employee.id, cid]
        )).rows[0];
      }

      const requested = String(req.body?.action_type || "AUTO").toUpperCase();
      const action = requested === "AUTO" ? nextAttendanceAction(attendance) : requested;
      if (action === "TERMINE") {
        await client.query("ROLLBACK");
        return res.status(409).json({ error: "La journée est déjà terminée pour cet employé." });
      }

      if (action === "ARRIVEE") {
        attendance = (await client.query(
          `UPDATE attendance_records SET check_in=CURRENT_TIMESTAMP,status='Présent',source='kiosk_badge',updated_at=CURRENT_TIMESTAMP
           WHERE id=$1 RETURNING *`, [attendance.id]
        )).rows[0];
      } else if (action === "DEPART_PAUSE") {
        if (!attendance.check_in || attendance.check_out) throw new Error("ETAT_POINTAGE_INVALIDE");
        attendance = (await client.query(
          `UPDATE attendance_records SET break_out=CURRENT_TIMESTAMP,status='En pause',source='kiosk_badge',updated_at=CURRENT_TIMESTAMP
           WHERE id=$1 RETURNING *`, [attendance.id]
        )).rows[0];
      } else if (action === "RETOUR_PAUSE") {
        if (!attendance.break_out || attendance.break_in || attendance.check_out) throw new Error("ETAT_POINTAGE_INVALIDE");
        attendance = (await client.query(
          `UPDATE attendance_records SET break_in=CURRENT_TIMESTAMP,status='Présent',source='kiosk_badge',updated_at=CURRENT_TIMESTAMP
           WHERE id=$1 RETURNING *`, [attendance.id]
        )).rows[0];
      } else if (action === "DEBAUCHE") {
        if (!attendance.check_in || attendance.check_out) throw new Error("ETAT_POINTAGE_INVALIDE");
        attendance = (await client.query(
          `UPDATE attendance_records SET check_out=CURRENT_TIMESTAMP,status='Terminé',source='kiosk_badge',updated_at=CURRENT_TIMESTAMP
           WHERE id=$1 RETURNING *`, [attendance.id]
        )).rows[0];
      } else {
        await client.query("ROLLBACK");
        return res.status(400).json({ error: "Action de pointage inconnue." });
      }

      await client.query(
        `INSERT INTO hafiya_kiosk_audit(company_id,user_id,badge_code,action_type,performed_by,device_info)
         VALUES($1,$2,$3,$4,$5,$6)`,
        [cid, employee.id, badge, action, req.user.id, String(req.body?.device_info || "tablette HAFIYA")]
      );
      await client.query("COMMIT");
      res.json({ success: true, employee, action, attendance, next_action: nextAttendanceAction(attendance) });
    } catch (error) {
      await client.query("ROLLBACK").catch(() => null);
      console.error("HAFIYA KIOSK SCAN:", error);
      res.status(500).json({ error: error?.message === "ETAT_POINTAGE_INVALIDE" ? "Ordre de pointage invalide." : "Erreur pointage badge." });
    } finally {
      client.release();
    }
  });

  app.get("/hafiya/kiosk/history", authenticateToken, async (req, res) => {
    try {
      if (!guardKiosk(req, res)) return;
      const cid = companyId(req);
      const days = Math.min(31, Math.max(1, Number(req.query?.days || 7)));
      const result = await pool.query(
        `SELECT ar.work_date, ar.check_in, ar.break_out, ar.break_in, ar.check_out, ar.status,
                u.fullname, u.role
         FROM attendance_records ar
         JOIN users u ON u.id=ar.user_id
         WHERE ar.company_id=$1 AND ar.work_date >= CURRENT_DATE - ($2::int - 1)
         ORDER BY ar.work_date DESC, u.fullname`,
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
      const dueDate = String(req.body?.due_date || "").slice(0,10);
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
      const status = String(req.body?.status || "").trim();
      if (!["a_faire", "en_cours", "termine"].includes(status)) return res.status(400).json({ error: "Statut invalide." });
      const result = await pool.query(
        `UPDATE hafiya_staff_tasks
         SET status=$1, completed_at=CASE WHEN $1='termine' THEN CURRENT_TIMESTAMP ELSE NULL END, updated_at=CURRENT_TIMESTAMP
         WHERE id=$2 AND company_id=$3 RETURNING id,assigned_to,title,status,completed_at`,
        [status, req.params.id, cid]
      );
      if (!result.rows[0]) return res.status(404).json({ error: "Tâche introuvable." });
      res.json(result.rows[0]);
    } catch (error) {
      console.error("HAFIYA TASK STATUS:", error);
      res.status(500).json({ error: "Erreur mise à jour tâche." });
    }
  });
};
