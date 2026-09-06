"use strict";

function roleOf(user) {
  return String(user?.role || "").trim().toLowerCase();
}

function isManager(user) {
  const role = roleOf(user);
  return user?.is_super_admin === true || ["super_admin", "admin", "admin_entreprise", "direction", "directeur"].includes(role);
}

function companyId(req) {
  return Number(req.user?.company_id || 0);
}

function requiredManager(req, res) {
  if (!isManager(req.user)) {
    res.status(403).json({ error: "Accès refusé." });
    return false;
  }
  if (!companyId(req)) {
    res.status(409).json({ error: "Société HAFIYA non résolue." });
    return false;
  }
  return true;
}

function isoDate(value) {
  const s = String(value || "").slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : "";
}

function monthBounds(year, month) {
  const y = Number(year), m = Number(month);
  if (!Number.isInteger(y) || y < 2000 || y > 2200 || !Number.isInteger(m) || m < 1 || m > 12) return null;
  const start = `${y}-${String(m).padStart(2, "0")}-01`;
  const end = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
  return { y, m, start, end };
}

function paymentDateFor(settings, year, month) {
  const rule = String(settings?.payment_rule || "day_of_month");
  const day = Math.max(1, Math.min(31, Number(settings?.payment_day || 25)));
  if (rule === "last_day") return new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10);
  if (rule === "next_month_day") {
    const last = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
    return new Date(Date.UTC(year, month, Math.min(day, last))).toISOString().slice(0, 10);
  }
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return `${year}-${String(month).padStart(2, "0")}-${String(Math.min(day, last)).padStart(2, "0")}`;
}

async function one(pool, sql, params = []) {
  return (await pool.query(sql, params)).rows[0] || null;
}

module.exports = function registerHafiyaAttendancePayrollV2(app, pool, authenticateToken) {
  app.get("/api/hafiya/pointage-paie/bootstrap", authenticateToken, async (req, res) => {
    try {
      if (!requiredManager(req, res)) return;
      const cid = companyId(req);
      const [users, groups, assignments, salaries, settings, advances] = await Promise.all([
        pool.query(`SELECT id, fullname, email, phone, role, badge_code, is_active
                    FROM users WHERE company_id=$1 AND COALESCE(is_active,true)=true ORDER BY fullname`, [cid]),
        pool.query(`SELECT * FROM hafiya_work_groups WHERE company_id=$1 ORDER BY active DESC, start_time, name`, [cid]),
        pool.query(`SELECT a.*, g.name AS group_name, g.code AS group_code, u.fullname
                    FROM hafiya_work_group_assignments a
                    JOIN hafiya_work_groups g ON g.id=a.group_id AND g.company_id=a.company_id
                    JOIN users u ON u.id=a.user_id
                    WHERE a.company_id=$1 ORDER BY a.effective_from DESC, a.id DESC`, [cid]),
        pool.query(`SELECT sp.*, u.fullname, u.email, u.badge_code
                    FROM hafiya_salary_profiles sp JOIN users u ON u.id=sp.user_id
                    WHERE sp.company_id=$1 ORDER BY u.fullname`, [cid]),
        pool.query(`SELECT * FROM hafiya_payroll_settings WHERE company_id=$1 LIMIT 1`, [cid]),
        pool.query(`SELECT a.*, u.fullname
                    FROM hafiya_salary_advances a JOIN users u ON u.id=a.user_id
                    WHERE a.company_id=$1 ORDER BY a.created_at DESC`, [cid])
      ]);
      res.json({
        users: users.rows,
        groups: groups.rows,
        assignments: assignments.rows,
        salaries: salaries.rows,
        settings: settings.rows[0] || null,
        advances: advances.rows
      });
    } catch (error) {
      console.error("HAFIYA V2 BOOTSTRAP :", error);
      res.status(500).json({ error: "Erreur chargement pointage et paie." });
    }
  });

  app.post("/api/hafiya/pointage-paie/groups", authenticateToken, async (req, res) => {
    try {
      if (!requiredManager(req, res)) return;
      const cid = companyId(req);
      const name = String(req.body?.name || "").trim();
      const code = String(req.body?.code || name).trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
      const start = String(req.body?.start_time || "").slice(0, 5);
      const end = String(req.body?.end_time || "").slice(0, 5);
      if (!name || !code || !/^\d{2}:\d{2}$/.test(start) || !/^\d{2}:\d{2}$/.test(end)) {
        return res.status(400).json({ error: "Nom, heure de début et heure de fin obligatoires." });
      }
      const r = await pool.query(`INSERT INTO hafiya_work_groups(company_id,code,name,start_time,end_time,break_start,break_end,created_by)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`, [cid, code, name, start, end, req.body?.break_start || null, req.body?.break_end || null, req.user.id]);
      res.status(201).json(r.rows[0]);
    } catch (error) {
      if (error?.code === "23505") return res.status(409).json({ error: "Ce groupe existe déjà." });
      console.error("HAFIYA V2 CREATE GROUP :", error);
      res.status(500).json({ error: "Erreur création groupe." });
    }
  });

  app.put("/api/hafiya/pointage-paie/groups/:id", authenticateToken, async (req, res) => {
    try {
      if (!requiredManager(req, res)) return;
      const cid = companyId(req);
      const r = await pool.query(`UPDATE hafiya_work_groups SET
        name=COALESCE(NULLIF($1,''),name), start_time=COALESCE(NULLIF($2,'')::time,start_time),
        end_time=COALESCE(NULLIF($3,'')::time,end_time), break_start=NULLIF($4,'')::time,
        break_end=NULLIF($5,'')::time, active=$6, updated_at=CURRENT_TIMESTAMP
        WHERE id=$7 AND company_id=$8 RETURNING *`, [
          String(req.body?.name || ""), String(req.body?.start_time || ""), String(req.body?.end_time || ""),
          String(req.body?.break_start || ""), String(req.body?.break_end || ""), req.body?.active !== false,
          req.params.id, cid
        ]);
      if (!r.rows[0]) return res.status(404).json({ error: "Groupe introuvable." });
      res.json(r.rows[0]);
    } catch (error) {
      console.error("HAFIYA V2 UPDATE GROUP :", error);
      res.status(500).json({ error: "Erreur modification groupe." });
    }
  });

  app.post("/api/hafiya/pointage-paie/assignments", authenticateToken, async (req, res) => {
    const client = await pool.connect();
    try {
      if (!requiredManager(req, res)) return;
      const cid = companyId(req);
      const uid = Number(req.body?.user_id), gid = Number(req.body?.group_id);
      const effectiveFrom = isoDate(req.body?.effective_from) || new Date().toISOString().slice(0, 10);
      if (!uid || !gid) return res.status(400).json({ error: "Personnel et groupe obligatoires." });
      const valid = await one(client, `SELECT u.id FROM users u JOIN hafiya_work_groups g ON g.id=$2 AND g.company_id=$1
        WHERE u.id=$3 AND u.company_id=$1`, [cid, gid, uid]);
      if (!valid) return res.status(404).json({ error: "Personnel ou groupe introuvable pour HAFIYA." });
      await client.query("BEGIN");
      await client.query(`UPDATE hafiya_work_group_assignments SET effective_to=$1::date-1
        WHERE company_id=$2 AND user_id=$3 AND effective_from < $1::date
          AND (effective_to IS NULL OR effective_to >= $1::date)`, [effectiveFrom, cid, uid]);
      await client.query(`DELETE FROM hafiya_work_group_assignments WHERE company_id=$1 AND user_id=$2 AND effective_from=$3`, [cid, uid, effectiveFrom]);
      const r = await client.query(`INSERT INTO hafiya_work_group_assignments
        (company_id,user_id,group_id,effective_from,notes,created_by) VALUES($1,$2,$3,$4,$5,$6) RETURNING *`,
        [cid, uid, gid, effectiveFrom, String(req.body?.notes || ""), req.user.id]);
      await client.query("COMMIT");
      res.json(r.rows[0]);
    } catch (error) {
      await client.query("ROLLBACK").catch(() => null);
      console.error("HAFIYA V2 ASSIGN :", error);
      res.status(500).json({ error: "Erreur affectation au groupe." });
    } finally { client.release(); }
  });

  app.get("/api/hafiya/pointage-paie/attendance", authenticateToken, async (req, res) => {
    try {
      if (!requiredManager(req, res)) return;
      const cid = companyId(req);
      const from = isoDate(req.query.from) || new Date().toISOString().slice(0, 10);
      const to = isoDate(req.query.to) || from;
      const uid = Number(req.query.user_id || 0), gid = Number(req.query.group_id || 0);
      const params = [cid, from, to];
      let where = "ar.company_id=$1 AND ar.work_date BETWEEN $2 AND $3";
      if (uid) { params.push(uid); where += ` AND ar.user_id=$${params.length}`; }
      if (gid) { params.push(gid); where += ` AND ga.group_id=$${params.length}`; }
      const r = await pool.query(`SELECT ar.*, u.fullname, u.badge_code,
          g.id AS group_id, g.name AS group_name, g.start_time AS group_start_time, g.end_time AS group_end_time
        FROM attendance_records ar JOIN users u ON u.id=ar.user_id
        LEFT JOIN LATERAL (
          SELECT x.* FROM hafiya_work_group_assignments x
          WHERE x.company_id=ar.company_id AND x.user_id=ar.user_id AND x.effective_from<=ar.work_date
            AND (x.effective_to IS NULL OR x.effective_to>=ar.work_date)
          ORDER BY x.effective_from DESC, x.id DESC LIMIT 1
        ) ga ON true LEFT JOIN hafiya_work_groups g ON g.id=ga.group_id
        WHERE ${where} ORDER BY ar.work_date DESC, u.fullname`, params);
      res.json(r.rows);
    } catch (error) {
      console.error("HAFIYA V2 ATTENDANCE LIST :", error);
      res.status(500).json({ error: "Erreur lecture historique pointage." });
    }
  });

  app.post("/api/hafiya/pointage-paie/attendance/manual", authenticateToken, async (req, res) => {
    const client = await pool.connect();
    try {
      if (!requiredManager(req, res)) return;
      const cid = companyId(req), uid = Number(req.body?.user_id), date = isoDate(req.body?.work_date);
      if (!uid || !date) return res.status(400).json({ error: "Personnel et date obligatoires." });
      const user = await one(client, `SELECT id FROM users WHERE id=$1 AND company_id=$2`, [uid, cid]);
      if (!user) return res.status(404).json({ error: "Personnel introuvable." });
      await client.query("BEGIN");
      const before = await one(client, `SELECT * FROM attendance_records WHERE user_id=$1 AND work_date=$2`, [uid, date]);
      const checkIn = req.body?.check_in ? `${date} ${String(req.body.check_in).slice(0,5)}:00` : null;
      const checkOut = req.body?.check_out ? `${date} ${String(req.body.check_out).slice(0,5)}:00` : null;
      const r = await client.query(`INSERT INTO attendance_records
        (user_id,company_id,work_date,check_in,check_out,status,manual_status,notes,source,is_cancelled,corrected_by,correction_reason)
        VALUES($1,$2,$3,$4,$5,$6,$6,$7,'manual',false,$8,$9)
        ON CONFLICT(user_id,work_date) DO UPDATE SET company_id=EXCLUDED.company_id, check_in=EXCLUDED.check_in,
          check_out=EXCLUDED.check_out, status=EXCLUDED.status, manual_status=EXCLUDED.manual_status,
          notes=EXCLUDED.notes, source='manual', is_cancelled=false, corrected_by=EXCLUDED.corrected_by,
          correction_reason=EXCLUDED.correction_reason, updated_at=CURRENT_TIMESTAMP RETURNING *`,
        [uid, cid, date, checkIn, checkOut, String(req.body?.status || (checkIn ? "Présent" : "Absent")),
          String(req.body?.notes || ""), req.user.id, String(req.body?.reason || "Correction Direction")]);
      await client.query(`INSERT INTO hafiya_attendance_corrections
        (company_id,attendance_id,user_id,work_date,action,before_data,after_data,reason,changed_by)
        VALUES($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb,$8,$9)`, [cid, r.rows[0].id, uid, date,
          before ? "modify" : "create", JSON.stringify(before), JSON.stringify(r.rows[0]), String(req.body?.reason || "Correction Direction"), req.user.id]);
      await client.query("COMMIT");
      res.json(r.rows[0]);
    } catch (error) {
      await client.query("ROLLBACK").catch(() => null);
      console.error("HAFIYA V2 MANUAL ATTENDANCE :", error);
      res.status(500).json({ error: "Erreur correction pointage." });
    } finally { client.release(); }
  });

  app.post("/api/hafiya/pointage-paie/attendance/:id/cancel", authenticateToken, async (req, res) => {
    try {
      if (!requiredManager(req, res)) return;
      const cid = companyId(req);
      const before = await one(pool, `SELECT * FROM attendance_records WHERE id=$1 AND company_id=$2`, [req.params.id, cid]);
      if (!before) return res.status(404).json({ error: "Pointage introuvable." });
      const reason = String(req.body?.reason || "Annulation Direction");
      const r = await pool.query(`UPDATE attendance_records SET is_cancelled=true,cancelled_by=$1,cancelled_reason=$2,updated_at=CURRENT_TIMESTAMP
        WHERE id=$3 AND company_id=$4 RETURNING *`, [req.user.id, reason, req.params.id, cid]);
      await pool.query(`INSERT INTO hafiya_attendance_corrections(company_id,attendance_id,user_id,work_date,action,before_data,after_data,reason,changed_by)
        VALUES($1,$2,$3,$4,'cancel',$5::jsonb,$6::jsonb,$7,$8)`, [cid, before.id, before.user_id, before.work_date,
          JSON.stringify(before), JSON.stringify(r.rows[0]), reason, req.user.id]);
      res.json(r.rows[0]);
    } catch (error) { console.error("HAFIYA V2 CANCEL :", error); res.status(500).json({ error: "Erreur annulation pointage." }); }
  });

  app.post("/api/hafiya/pointage-paie/attendance/:id/restore", authenticateToken, async (req, res) => {
    try {
      if (!requiredManager(req, res)) return;
      const cid = companyId(req);
      const before = await one(pool, `SELECT * FROM attendance_records WHERE id=$1 AND company_id=$2`, [req.params.id, cid]);
      if (!before) return res.status(404).json({ error: "Pointage introuvable." });
      const r = await pool.query(`UPDATE attendance_records SET is_cancelled=false,cancelled_by=NULL,cancelled_reason='',updated_at=CURRENT_TIMESTAMP
        WHERE id=$1 AND company_id=$2 RETURNING *`, [req.params.id, cid]);
      await pool.query(`INSERT INTO hafiya_attendance_corrections(company_id,attendance_id,user_id,work_date,action,before_data,after_data,reason,changed_by)
        VALUES($1,$2,$3,$4,'restore',$5::jsonb,$6::jsonb,$7,$8)`, [cid, before.id, before.user_id, before.work_date,
          JSON.stringify(before), JSON.stringify(r.rows[0]), String(req.body?.reason || "Restauration Direction"), req.user.id]);
      res.json(r.rows[0]);
    } catch (error) { console.error("HAFIYA V2 RESTORE :", error); res.status(500).json({ error: "Erreur restauration pointage." }); }
  });

  app.get("/api/hafiya/pointage-paie/report", authenticateToken, async (req, res) => {
    try {
      if (!requiredManager(req, res)) return;
      const cid = companyId(req), from = isoDate(req.query.from), to = isoDate(req.query.to);
      if (!from || !to) return res.status(400).json({ error: "Période obligatoire." });
      const uid = Number(req.query.user_id || 0), gid = Number(req.query.group_id || 0);
      const params = [cid, from, to];
      let filter = "ar.company_id=$1 AND ar.work_date BETWEEN $2 AND $3";
      if (uid) { params.push(uid); filter += ` AND ar.user_id=$${params.length}`; }
      if (gid) { params.push(gid); filter += ` AND ga.group_id=$${params.length}`; }
      const r = await pool.query(`SELECT ar.id,ar.work_date,ar.check_in,ar.check_out,ar.status,ar.manual_status,ar.late_minutes,
          ar.overtime_minutes,ar.total_work_minutes,ar.is_cancelled,ar.notes,u.id AS user_id,u.fullname,u.badge_code,
          g.id AS group_id,g.name AS group_name,g.start_time AS expected_start,g.end_time AS expected_end
        FROM attendance_records ar JOIN users u ON u.id=ar.user_id
        LEFT JOIN LATERAL (SELECT x.* FROM hafiya_work_group_assignments x
          WHERE x.company_id=ar.company_id AND x.user_id=ar.user_id AND x.effective_from<=ar.work_date
            AND (x.effective_to IS NULL OR x.effective_to>=ar.work_date)
          ORDER BY x.effective_from DESC,x.id DESC LIMIT 1) ga ON true
        LEFT JOIN hafiya_work_groups g ON g.id=ga.group_id WHERE ${filter}
        ORDER BY ar.work_date,u.fullname`, params);
      const active = r.rows.filter(x => !x.is_cancelled);
      res.json({ period: { from, to }, rows: r.rows, summary: {
        records: r.rows.length, active_records: active.length,
        present_days: active.filter(x => x.check_in || /prés|present|termin/i.test(String(x.status || x.manual_status || ""))).length,
        absent_days: active.filter(x => !x.check_in && /abs/i.test(String(x.status || x.manual_status || ""))).length,
        late_minutes: active.reduce((s,x) => s + Number(x.late_minutes || 0), 0),
        overtime_minutes: active.reduce((s,x) => s + Number(x.overtime_minutes || 0), 0)
      }});
    } catch (error) { console.error("HAFIYA V2 REPORT :", error); res.status(500).json({ error: "Erreur génération historique." }); }
  });

  app.put("/api/hafiya/pointage-paie/salaries/:userId", authenticateToken, async (req, res) => {
    try {
      if (!requiredManager(req, res)) return;
      const cid = companyId(req), uid = Number(req.params.userId);
      const gross = Number(req.body?.gross_monthly || 0), inps = Number(req.body?.inps_employee || 0), amo = Number(req.body?.amo_employee || 0);
      const other = Number(req.body?.other_fixed_deductions || 0);
      const net = Number(req.body?.reference_net ?? Math.max(0, gross - inps - amo - other));
      const r = await pool.query(`INSERT INTO hafiya_salary_profiles
        (company_id,user_id,gross_monthly,inps_employee,amo_employee,other_fixed_deductions,reference_net,daily_divisor_mode,custom_divisor,effective_from,updated_by)
        SELECT $1,u.id,$3,$4,$5,$6,$7,$8,$9,$10,$11 FROM users u WHERE u.id=$2 AND u.company_id=$1
        ON CONFLICT(company_id,user_id) DO UPDATE SET gross_monthly=EXCLUDED.gross_monthly,inps_employee=EXCLUDED.inps_employee,
          amo_employee=EXCLUDED.amo_employee,other_fixed_deductions=EXCLUDED.other_fixed_deductions,reference_net=EXCLUDED.reference_net,
          daily_divisor_mode=EXCLUDED.daily_divisor_mode,custom_divisor=EXCLUDED.custom_divisor,effective_from=EXCLUDED.effective_from,
          updated_by=EXCLUDED.updated_by,updated_at=CURRENT_TIMESTAMP RETURNING *`, [cid, uid, gross, inps, amo, other, net,
          String(req.body?.daily_divisor_mode || "fixed_30"), req.body?.custom_divisor ? Number(req.body.custom_divisor) : null,
          isoDate(req.body?.effective_from) || new Date().toISOString().slice(0,10), req.user.id]);
      if (!r.rows[0]) return res.status(404).json({ error: "Personnel introuvable." });
      res.json(r.rows[0]);
    } catch (error) { console.error("HAFIYA V2 SALARY :", error); res.status(500).json({ error: "Erreur salaire." }); }
  });

  app.put("/api/hafiya/pointage-paie/settings", authenticateToken, async (req, res) => {
    try {
      if (!requiredManager(req, res)) return;
      const cid = companyId(req);
      const r = await pool.query(`INSERT INTO hafiya_payroll_settings
        (company_id,daily_divisor_mode,custom_divisor,payment_rule,payment_day,absence_deduction_enabled,lateness_deduction_enabled,overtime_enabled,updated_by)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)
        ON CONFLICT(company_id) DO UPDATE SET daily_divisor_mode=EXCLUDED.daily_divisor_mode,custom_divisor=EXCLUDED.custom_divisor,
          payment_rule=EXCLUDED.payment_rule,payment_day=EXCLUDED.payment_day,absence_deduction_enabled=EXCLUDED.absence_deduction_enabled,
          lateness_deduction_enabled=EXCLUDED.lateness_deduction_enabled,overtime_enabled=EXCLUDED.overtime_enabled,updated_by=EXCLUDED.updated_by,
          updated_at=CURRENT_TIMESTAMP RETURNING *`, [cid, String(req.body?.daily_divisor_mode || "fixed_30"), Number(req.body?.custom_divisor || 30),
          String(req.body?.payment_rule || "day_of_month"), Number(req.body?.payment_day || 25), req.body?.absence_deduction_enabled !== false,
          req.body?.lateness_deduction_enabled === true, req.body?.overtime_enabled === true, req.user.id]);
      res.json(r.rows[0]);
    } catch (error) { console.error("HAFIYA V2 SETTINGS :", error); res.status(500).json({ error: "Erreur paramètres paie." }); }
  });

  app.post("/api/hafiya/pointage-paie/advances", authenticateToken, async (req, res) => {
    try {
      if (!requiredManager(req, res)) return;
      const cid = companyId(req), uid = Number(req.body?.user_id), amount = Number(req.body?.principal_amount || 0);
      if (!uid || amount <= 0) return res.status(400).json({ error: "Personnel et montant valides obligatoires." });
      const valid = await one(pool, `SELECT id FROM users WHERE id=$1 AND company_id=$2`, [uid,cid]);
      if (!valid) return res.status(404).json({ error: "Personnel introuvable." });
      const r = await pool.query(`INSERT INTO hafiya_salary_advances
        (company_id,user_id,principal_amount,balance_amount,installment_amount,granted_at,first_deduction_month,notes,created_by)
        VALUES($1,$2,$3,$3,$4,$5,$6,$7,$8) RETURNING *`, [cid,uid,amount,Number(req.body?.installment_amount || amount),
          isoDate(req.body?.granted_at) || new Date().toISOString().slice(0,10), isoDate(req.body?.first_deduction_month) || null,
          String(req.body?.notes || ""),req.user.id]);
      res.status(201).json(r.rows[0]);
    } catch (error) { console.error("HAFIYA V2 ADVANCE :", error); res.status(500).json({ error: "Erreur avance sur salaire." }); }
  });

  app.post("/api/hafiya/pointage-paie/advances/:id/repay", authenticateToken, async (req, res) => {
    const client = await pool.connect();
    try {
      if (!requiredManager(req, res)) return;
      const cid = companyId(req), amount = Number(req.body?.amount || 0);
      if (amount <= 0) return res.status(400).json({ error: "Montant invalide." });
      await client.query("BEGIN");
      const adv = await one(client, `SELECT * FROM hafiya_salary_advances WHERE id=$1 AND company_id=$2 FOR UPDATE`, [req.params.id,cid]);
      if (!adv) return res.status(404).json({ error: "Avance introuvable." });
      const paid = Math.min(amount, Number(adv.balance_amount || 0));
      await client.query(`INSERT INTO hafiya_salary_advance_repayments(company_id,advance_id,user_id,amount,paid_at,payment_type,notes,created_by)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8)`, [cid,adv.id,adv.user_id,paid,isoDate(req.body?.paid_at) || new Date().toISOString().slice(0,10),
          String(req.body?.payment_type || "remboursement_direct"),String(req.body?.notes || ""),req.user.id]);
      const remaining = Math.max(0, Number(adv.balance_amount)-paid);
      const r = await client.query(`UPDATE hafiya_salary_advances SET balance_amount=$1,status=$2,updated_at=CURRENT_TIMESTAMP WHERE id=$3 RETURNING *`,
        [remaining,remaining<=0?"solde":"en_cours",adv.id]);
      await client.query("COMMIT"); res.json(r.rows[0]);
    } catch (error) { await client.query("ROLLBACK").catch(()=>null); console.error("HAFIYA V2 REPAY :", error); res.status(500).json({ error: "Erreur remboursement avance." }); }
    finally { client.release(); }
  });

  app.post("/api/hafiya/pointage-paie/payroll/prepare", authenticateToken, async (req, res) => {
    const client = await pool.connect();
    try {
      if (!requiredManager(req, res)) return;
      const cid = companyId(req), bounds = monthBounds(req.body?.year, req.body?.month);
      if (!bounds) return res.status(400).json({ error: "Mois invalide." });
      await client.query("BEGIN");
      const settings = await one(client, `SELECT * FROM hafiya_payroll_settings WHERE company_id=$1`, [cid]) || { daily_divisor_mode:"fixed_30",custom_divisor:30,payment_rule:"day_of_month",payment_day:25,absence_deduction_enabled:true };
      let run = await one(client, `SELECT * FROM payroll_runs WHERE company_id=$1 AND payroll_year=$2 AND payroll_month=$3 FOR UPDATE`, [cid,bounds.y,bounds.m]);
      if (run?.status && !["brouillon","draft"].includes(String(run.status).toLowerCase())) return res.status(409).json({ error: "Cette paie est déjà clôturée." });
      if (!run) {
        const number = `PAY-${cid}-${bounds.y}${String(bounds.m).padStart(2,"0")}`;
        run = (await client.query(`INSERT INTO payroll_runs(company_id,payroll_number,period_start,period_end,payroll_year,payroll_month,payment_date,status,created_by,settings_snapshot)
          VALUES($1,$2,$3,$4,$5,$6,$7,'brouillon',$8,$9::jsonb) RETURNING *`, [cid,number,bounds.start,bounds.end,bounds.y,bounds.m,paymentDateFor(settings,bounds.y,bounds.m),req.user.id,JSON.stringify(settings)])).rows[0];
      } else {
        await client.query(`DELETE FROM payroll_items WHERE payroll_run_id=$1 AND company_id=$2`, [run.id,cid]);
      }
      const profiles = (await client.query(`SELECT sp.*,u.fullname FROM hafiya_salary_profiles sp JOIN users u ON u.id=sp.user_id
        WHERE sp.company_id=$1 AND sp.active=true AND u.company_id=$1 AND COALESCE(u.is_active,true)=true ORDER BY u.fullname`, [cid])).rows;
      let totals = {gross:0,deductions:0,advances:0,net:0};
      for (const p of profiles) {
        let divisor = Number(settings.custom_divisor || 30);
        if (String(settings.daily_divisor_mode)==="working_days") {
          divisor = Number((await one(client, `SELECT COUNT(*)::int n FROM generate_series($1::date,$2::date,'1 day') d WHERE EXTRACT(ISODOW FROM d)<6`, [bounds.start,bounds.end]))?.n || 0);
        }
        if (String(p.daily_divisor_mode)==="custom" && Number(p.custom_divisor)>0) divisor=Number(p.custom_divisor);
        if (divisor<=0) divisor=30;
        const attendance = await one(client, `SELECT COUNT(*) FILTER(WHERE is_cancelled=false AND check_in IS NOT NULL)::int present,
          COALESCE(SUM(late_minutes) FILTER(WHERE is_cancelled=false),0)::int late,
          COALESCE(SUM(overtime_minutes) FILTER(WHERE is_cancelled=false),0)::int overtime,
          COALESCE(SUM(total_work_minutes) FILTER(WHERE is_cancelled=false),0)::int minutes
          FROM attendance_records WHERE company_id=$1 AND user_id=$2 AND work_date BETWEEN $3 AND $4`, [cid,p.user_id,bounds.start,bounds.end]);
        const present=Number(attendance?.present||0), expected=divisor, absent=Math.max(0,expected-present), daily=Number(p.gross_monthly||0)/divisor;
        const absenceDeduction=settings.absence_deduction_enabled===false?0:Math.round(absent*daily);
        const advance=await one(client, `SELECT * FROM hafiya_salary_advances WHERE company_id=$1 AND user_id=$2 AND status='en_cours'
          AND balance_amount>0 AND (first_deduction_month IS NULL OR first_deduction_month <= $3::date) ORDER BY granted_at,id LIMIT 1`, [cid,p.user_id,bounds.end]);
        const advDeduction=advance?Math.min(Number(advance.balance_amount),Number(advance.installment_amount||advance.balance_amount)):0;
        const fixed=Number(p.inps_employee||0)+Number(p.amo_employee||0)+Number(p.other_fixed_deductions||0);
        const deductions=Math.max(0,fixed+absenceDeduction);
        const net=Math.max(0,Math.round(Number(p.gross_monthly||0)-deductions-advDeduction));
        await client.query(`INSERT INTO payroll_items(company_id,payroll_run_id,user_id,employee_name,worked_hours,absences,late_minutes,overtime_minutes,
          gross_salary,deductions,advances,net_salary,expected_days,attendance_days,absence_deduction,inps_amount,amo_amount,other_deductions,details)
          VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19::jsonb)`, [cid,run.id,p.user_id,p.fullname,
          Number(attendance?.minutes||0)/60,Math.round(absent),Number(attendance?.late||0),Number(attendance?.overtime||0),Number(p.gross_monthly||0),deductions,advDeduction,net,
          expected,present,absenceDeduction,Number(p.inps_employee||0),Number(p.amo_employee||0),Number(p.other_fixed_deductions||0),
          JSON.stringify({divisor,daily_rate:daily,advance_id:advance?.id||null})]);
        totals.gross+=Number(p.gross_monthly||0); totals.deductions+=deductions; totals.advances+=advDeduction; totals.net+=net;
      }
      run=(await client.query(`UPDATE payroll_runs SET gross_amount=$1,deductions_amount=$2,advances_amount=$3,net_amount=$4,
        payment_date=$5,settings_snapshot=$6::jsonb,updated_at=CURRENT_TIMESTAMP WHERE id=$7 RETURNING *`, [totals.gross,totals.deductions,totals.advances,totals.net,paymentDateFor(settings,bounds.y,bounds.m),JSON.stringify(settings),run.id])).rows[0];
      const items=(await client.query(`SELECT * FROM payroll_items WHERE payroll_run_id=$1 ORDER BY employee_name`,[run.id])).rows;
      await client.query("COMMIT"); res.json({run,items});
    } catch (error) { await client.query("ROLLBACK").catch(()=>null); console.error("HAFIYA V2 PREPARE PAYROLL :", error); res.status(500).json({ error: "Erreur préparation paie." }); }
    finally { client.release(); }
  });

  app.post("/api/hafiya/pointage-paie/payroll/:id/close", authenticateToken, async (req, res) => {
    const client = await pool.connect();
    try {
      if (!requiredManager(req, res)) return;
      const cid=companyId(req);
      await client.query("BEGIN");
      const run=await one(client,`SELECT * FROM payroll_runs WHERE id=$1 AND company_id=$2 FOR UPDATE`,[req.params.id,cid]);
      if(!run) return res.status(404).json({error:"Paie introuvable."});
      if(!["brouillon","draft"].includes(String(run.status).toLowerCase())) return res.status(409).json({error:"Paie déjà clôturée."});
      const items=(await client.query(`SELECT * FROM payroll_items WHERE payroll_run_id=$1 AND company_id=$2`,[run.id,cid])).rows;
      for(const item of items){
        const advanceId=Number(item.details?.advance_id||0), amount=Number(item.advances||0);
        if(advanceId&&amount>0){
          const adv=await one(client,`SELECT * FROM hafiya_salary_advances WHERE id=$1 AND company_id=$2 FOR UPDATE`,[advanceId,cid]);
          if(adv&&Number(adv.balance_amount)>0){
            const paid=Math.min(amount,Number(adv.balance_amount));
            const exists=await one(client,`SELECT id FROM hafiya_salary_advance_repayments WHERE advance_id=$1 AND payroll_run_id=$2`,[adv.id,run.id]);
            if(!exists){
              await client.query(`INSERT INTO hafiya_salary_advance_repayments(company_id,advance_id,user_id,payroll_run_id,amount,paid_at,payment_type,created_by)
                VALUES($1,$2,$3,$4,$5,$6,'retenue_paie',$7)`,[cid,adv.id,item.user_id,run.id,paid,run.payment_date||run.period_end,req.user.id]);
              const rem=Math.max(0,Number(adv.balance_amount)-paid);
              await client.query(`UPDATE hafiya_salary_advances SET balance_amount=$1,status=$2,updated_at=CURRENT_TIMESTAMP WHERE id=$3`,[rem,rem<=0?"solde":"en_cours",adv.id]);
            }
          }
        }
      }
      const r=(await client.query(`UPDATE payroll_runs SET status='clôturé',closed_by=$1,closed_at=CURRENT_TIMESTAMP,accounting_status='ready',updated_at=CURRENT_TIMESTAMP
        WHERE id=$2 AND company_id=$3 RETURNING *`,[req.user.id,run.id,cid])).rows[0];
      await client.query("COMMIT"); res.json(r);
    }catch(error){await client.query("ROLLBACK").catch(()=>null);console.error("HAFIYA V2 CLOSE PAYROLL :",error);res.status(500).json({error:"Erreur clôture paie."});}
    finally{client.release();}
  });

  app.get("/api/hafiya/pointage-paie/payroll", authenticateToken, async (req,res)=>{
    try{
      if(!requiredManager(req,res))return;
      const cid=companyId(req), y=Number(req.query.year||0),m=Number(req.query.month||0);
      const params=[cid];let where="company_id=$1";
      if(y){params.push(y);where+=` AND payroll_year=$${params.length}`;} if(m){params.push(m);where+=` AND payroll_month=$${params.length}`;}
      const runs=(await pool.query(`SELECT * FROM payroll_runs WHERE ${where} ORDER BY period_start DESC,id DESC`,params)).rows;
      res.json(runs);
    }catch(error){console.error("HAFIYA V2 PAYROLL LIST :",error);res.status(500).json({error:"Erreur historique paie."});}
  });
};
