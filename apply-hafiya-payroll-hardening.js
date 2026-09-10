"use strict";

const fs = require("fs");
const path = "hafiya-attendance-payroll-v2-routes.js";
const original = fs.readFileSync(path,"utf8");
let s = original;

// Le serveur enlève /api avant le routage : les routes internes HAFIYA ne doivent pas le répéter.
s = s.replaceAll('"/api/hafiya/pointage-paie','"/hafiya/pointage-paie');

const oldSalary = `      const cid = companyId(req), uid = Number(req.params.userId);\n      const gross = Number(req.body?.gross_monthly || 0), inps = Number(req.body?.inps_employee || 0), amo = Number(req.body?.amo_employee || 0);\n      const other = Number(req.body?.other_fixed_deductions || 0);\n      const net = Number(req.body?.reference_net ?? Math.max(0, gross - inps - amo - other));\n      const r = await pool.query(\`INSERT INTO hafiya_salary_profiles\n        (company_id,user_id,gross_monthly,inps_employee,amo_employee,other_fixed_deductions,reference_net,daily_divisor_mode,custom_divisor,effective_from,updated_by)\n        SELECT $1,u.id,$3,$4,$5,$6,$7,$8,$9,$10,$11 FROM users u WHERE u.id=$2 AND u.company_id=$1\n        ON CONFLICT(company_id,user_id) DO UPDATE SET gross_monthly=EXCLUDED.gross_monthly,inps_employee=EXCLUDED.inps_employee,\n          amo_employee=EXCLUDED.amo_employee,other_fixed_deductions=EXCLUDED.other_fixed_deductions,reference_net=EXCLUDED.reference_net,\n          daily_divisor_mode=EXCLUDED.daily_divisor_mode,custom_divisor=EXCLUDED.custom_divisor,effective_from=EXCLUDED.effective_from,\n          updated_by=EXCLUDED.updated_by,updated_at=CURRENT_TIMESTAMP RETURNING *\`, [cid, uid, gross, inps, amo, other, net,\n          String(req.body?.daily_divisor_mode || "fixed_30"), req.body?.custom_divisor ? Number(req.body.custom_divisor) : null,\n          isoDate(req.body?.effective_from) || new Date().toISOString().slice(0,10), req.user.id]);`;

const newSalary = `      const cid = companyId(req), uid = Number(req.params.userId);\n      const gross = Number(req.body?.gross_monthly || 0);\n      const social = Number(req.body?.social_contributions_amount || 0);\n      const other = Number(req.body?.other_fixed_deductions || 0);\n      const net = Number(req.body?.reference_net ?? Math.max(0, gross - social - other));\n      const r = await pool.query(\`INSERT INTO hafiya_salary_profiles\n        (company_id,user_id,gross_monthly,social_contributions_amount,inps_employee,amo_employee,other_fixed_deductions,reference_net,daily_divisor_mode,custom_divisor,effective_from,updated_by)\n        SELECT $1,u.id,$3,$4,0,0,$5,$6,$7,$8,$9,$10 FROM users u WHERE u.id=$2 AND u.company_id=$1\n        ON CONFLICT(company_id,user_id) DO UPDATE SET gross_monthly=EXCLUDED.gross_monthly,\n          social_contributions_amount=EXCLUDED.social_contributions_amount,inps_employee=0,amo_employee=0,\n          other_fixed_deductions=EXCLUDED.other_fixed_deductions,reference_net=EXCLUDED.reference_net,\n          daily_divisor_mode=EXCLUDED.daily_divisor_mode,custom_divisor=EXCLUDED.custom_divisor,effective_from=EXCLUDED.effective_from,\n          updated_by=EXCLUDED.updated_by,updated_at=CURRENT_TIMESTAMP RETURNING *\`, [cid, uid, gross, social, other, net,\n          String(req.body?.daily_divisor_mode || "fixed_30"), req.body?.custom_divisor ? Number(req.body.custom_divisor) : null,\n          isoDate(req.body?.effective_from) || new Date().toISOString().slice(0,10), req.user.id]);`;

if (s.includes(oldSalary)) s = s.replace(oldSalary,newSalary);
else if (!s.includes("social_contributions_amount")) throw new Error("Bloc salaire attendu introuvable");

s = s.replace(
  `        const fixed=Number(p.inps_employee||0)+Number(p.amo_employee||0)+Number(p.other_fixed_deductions||0);`,
  `        const fixed=Number(p.social_contributions_amount||0)+Number(p.other_fixed_deductions||0);`
);

s = s.replace(
  `          expected,present,absenceDeduction,Number(p.inps_employee||0),Number(p.amo_employee||0),Number(p.other_fixed_deductions||0),`,
  `          expected,present,absenceDeduction,Number(p.social_contributions_amount||0),0,Number(p.other_fixed_deductions||0),`
);

// Ne jamais laisser une transaction ouverte sur les retours anticipés.
s = s.replace(
  `      if (run?.status && !["brouillon","draft"].includes(String(run.status).toLowerCase())) return res.status(409).json({ error: "Cette paie est déjà clôturée." });`,
  `      if (run?.status && !["brouillon","draft"].includes(String(run.status).toLowerCase())) { await client.query("ROLLBACK"); return res.status(409).json({ error: "Cette paie est déjà clôturée." }); }`
);
s = s.replace(
  `      if(!run) return res.status(404).json({error:"Paie introuvable."});`,
  `      if(!run) { await client.query("ROLLBACK"); return res.status(404).json({error:"Paie introuvable."}); }`
);
s = s.replace(
  `      if(!["brouillon","draft"].includes(String(run.status).toLowerCase())) return res.status(409).json({error:"Paie déjà clôturée."});`,
  `      if(!["brouillon","draft"].includes(String(run.status).toLowerCase())) { await client.query("ROLLBACK"); return res.status(409).json({error:"Paie déjà clôturée."}); }`
);
s = s.replace(
  `      if (!adv) return res.status(404).json({ error: "Avance introuvable." });`,
  `      if (!adv) { await client.query("ROLLBACK"); return res.status(404).json({ error: "Avance introuvable." }); }`
);

if (s !== original) {
  fs.writeFileSync(`${path}.before-payroll-hardening`,original);
  fs.writeFileSync(path,s);
  console.log("HAFIYA_PAYROLL_HARDENING=OK");
} else {
  console.log("HAFIYA_PAYROLL_HARDENING_DEJA_OK");
}
