"use strict";

require("dotenv").config();
const { Pool } = require("pg");
const bcrypt = require("bcryptjs");

(async () => {
  const password = String(process.env.KIOSK_PASSWORD || "");
  if (password.length < 10) {
    throw new Error("Définis KIOSK_PASSWORD avec au moins 10 caractères avant d'exécuter ce script.");
  }

  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  try {
    const companyId = Number(process.env.KIOSK_COMPANY_ID || 1);
    const email = String(process.env.KIOSK_EMAIL || "pointage@hafiya.local").toLowerCase();
    const fullname = String(process.env.KIOSK_NAME || "Tablette Pointage HAFIYA");
    const hash = await bcrypt.hash(password, 12);

    const result = await pool.query(
      `INSERT INTO users
       (fullname,email,password,role,company_id,is_super_admin,is_active,
        email_verified,phone_verified,account_status,invitation_status,verification_required)
       VALUES($1,$2,$3,'kiosk_pointage',$4,false,true,true,true,'active','active',false)
       ON CONFLICT(email) DO UPDATE SET
         fullname=EXCLUDED.fullname,
         password=EXCLUDED.password,
         role='kiosk_pointage',
         company_id=EXCLUDED.company_id,
         is_super_admin=false,
         is_active=true,
         account_status='active',
         invitation_status='active',
         verification_required=false
       RETURNING id,fullname,email,role,company_id,is_active`,
      [fullname,email,hash,companyId]
    );

    console.log("KIOSK_USER_OK", result.rows[0]);
  } finally {
    await pool.end();
  }
})().catch((error) => {
  console.error("KIOSK_USER_ERROR", error.message);
  process.exit(1);
});
