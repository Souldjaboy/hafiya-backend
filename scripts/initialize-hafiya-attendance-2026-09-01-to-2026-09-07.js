"use strict";

/**
 * Initialise administrativement le pointage HAFIYA du 01/09/2026 au 07/09/2026.
 * - cible uniquement les 5 personnes de la liste DAFFE fournie ;
 * - n'écrase JAMAIS un pointage réel déjà présent ;
 * - groupe Matin 08:00-17:00 par défaut si aucune affectation datée n'existe ;
 * - idempotent : le rejeu ne crée pas de doublon.
 *
 * Usage local/test uniquement tant qu'un déploiement n'est pas explicitement autorisé :
 *   DATABASE_URL=... node scripts/initialize-hafiya-attendance-2026-09-01-to-2026-09-07.js
 */
const { Pool } = require("pg");

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL manquant.");
  process.exit(1);
}

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const EMAILS = [
  "mamadou.doumbia@hafiagroupe.com",
  "lafia.soumare@hafiagroupe.com",
  "fatoumata.nientao@hafiagroupe.com",
  "mariam.sylla@hafiagroupe.com",
  "hafiyamali2025@gmail.com"
];

function dates() {
  const out = [];
  for (let d = new Date("2026-09-01T00:00:00Z"); d <= new Date("2026-09-07T00:00:00Z"); d.setUTCDate(d.getUTCDate() + 1)) {
    out.push(d.toISOString().slice(0, 10));
  }
  return out;
}

async function main() {
  const director = (await pool.query(`SELECT id,company_id FROM users WHERE lower(email)=lower($1) ORDER BY id DESC LIMIT 1`, ["hafiyamali2025@gmail.com"])).rows[0];
  if (!director?.company_id) throw new Error("Compte Direction HAFIYA introuvable.");
  const cid = Number(director.company_id);
  const users = (await pool.query(`SELECT id,fullname,email FROM users WHERE company_id=$1 AND lower(email)=ANY($2::text[]) ORDER BY fullname`, [cid, EMAILS])).rows;
  console.log(`HAFIYA company_id=${cid} — ${users.length}/${EMAILS.length} personnes trouvées.`);
  if (!users.length) throw new Error("Aucun membre de la liste DAFFE n'est rattaché à HAFIYA.");

  let created = 0, skipped = 0;
  for (const user of users) {
    for (const day of dates()) {
      const existing = (await pool.query(`SELECT id,source FROM attendance_records WHERE user_id=$1 AND work_date=$2 LIMIT 1`, [user.id, day])).rows[0];
      if (existing) {
        skipped += 1;
        console.log(`SKIP ${day} ${user.fullname} — pointage existant id=${existing.id} source=${existing.source || "ancien"}`);
        continue;
      }
      const group = (await pool.query(`SELECT g.* FROM hafiya_work_group_assignments a
        JOIN hafiya_work_groups g ON g.id=a.group_id
        WHERE a.company_id=$1 AND a.user_id=$2 AND a.effective_from<=$3::date
          AND (a.effective_to IS NULL OR a.effective_to>=$3::date)
        ORDER BY a.effective_from DESC,a.id DESC LIMIT 1`, [cid,user.id,day])).rows[0]
        || (await pool.query(`SELECT * FROM hafiya_work_groups WHERE company_id=$1 AND code='matin' LIMIT 1`, [cid])).rows[0];
      const start = String(group?.start_time || "08:00").slice(0,5);
      const end = String(group?.end_time || "17:00").slice(0,5);
      const inserted = (await pool.query(`INSERT INTO attendance_records
        (user_id,company_id,work_date,check_in,check_out,status,manual_status,notes,source,is_cancelled,corrected_by,correction_reason,total_work_minutes)
        VALUES($1,$2,$3,$3::date+$4::time,$3::date+$5::time,'Terminé','Terminé',$6,'administrative_initialization',false,$7,$8,
          GREATEST(0,EXTRACT(EPOCH FROM (($3::date+$5::time)-($3::date+$4::time)))/60)::int)
        RETURNING *`, [user.id,cid,day,start,end,`Initialisation administrative 01-07/09/2026 — ${group?.name || "Groupe Matin"}`,director.id,
          "Initialisation demandée par la Direction"])).rows[0];
      await pool.query(`INSERT INTO hafiya_attendance_corrections
        (company_id,attendance_id,user_id,work_date,action,before_data,after_data,reason,changed_by)
        VALUES($1,$2,$3,$4,'create',NULL,$5::jsonb,$6,$7)`, [cid,inserted.id,user.id,day,JSON.stringify(inserted),"Initialisation administrative demandée",director.id]);
      created += 1;
      console.log(`OK   ${day} ${user.fullname} ${start}-${end}`);
    }
  }
  console.log(`\nBILAN: ${created} pointage(s) créé(s), ${skipped} conservé(s) car déjà existants.`);
  await pool.end();
}

main().catch(async (e) => {
  console.error("ÉCHEC INITIALISATION HAFIYA:", e.message);
  await pool.end().catch(() => null);
  process.exit(1);
});
