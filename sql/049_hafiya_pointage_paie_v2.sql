-- HAFIYA — Pointage & paie V2
-- Migration additive et idempotente. Elle ne supprime aucun ancien pointage.

BEGIN;

-- Groupes de travail modifiables (ex. matin / soir).
CREATE TABLE IF NOT EXISTS hafiya_work_groups (
  id SERIAL PRIMARY KEY,
  company_id INTEGER NOT NULL,
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  start_time TIME NOT NULL,
  end_time TIME NOT NULL,
  break_start TIME,
  break_end TIME,
  active BOOLEAN NOT NULL DEFAULT true,
  created_by INTEGER,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(company_id, code)
);

-- Affectations datées : changer un salarié de groupe n'altère pas son historique.
CREATE TABLE IF NOT EXISTS hafiya_work_group_assignments (
  id SERIAL PRIMARY KEY,
  company_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  group_id INTEGER NOT NULL REFERENCES hafiya_work_groups(id),
  effective_from DATE NOT NULL,
  effective_to DATE,
  notes TEXT DEFAULT '',
  created_by INTEGER,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  CHECK (effective_to IS NULL OR effective_to >= effective_from)
);
CREATE INDEX IF NOT EXISTS idx_hafiya_group_assign_user_dates
  ON hafiya_work_group_assignments(company_id, user_id, effective_from, effective_to);
CREATE INDEX IF NOT EXISTS idx_hafiya_group_assign_group_dates
  ON hafiya_work_group_assignments(company_id, group_id, effective_from, effective_to);

-- Profil salarial : montants issus de la fiche personnel, modifiables par la Direction.
CREATE TABLE IF NOT EXISTS hafiya_salary_profiles (
  id SERIAL PRIMARY KEY,
  company_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  gross_monthly NUMERIC(14,2) NOT NULL DEFAULT 0,
  inps_employee NUMERIC(14,2) NOT NULL DEFAULT 0,
  amo_employee NUMERIC(14,2) NOT NULL DEFAULT 0,
  other_fixed_deductions NUMERIC(14,2) NOT NULL DEFAULT 0,
  reference_net NUMERIC(14,2) NOT NULL DEFAULT 0,
  daily_divisor_mode TEXT NOT NULL DEFAULT 'fixed_30',
  custom_divisor NUMERIC(8,2),
  effective_from DATE NOT NULL DEFAULT CURRENT_DATE,
  active BOOLEAN NOT NULL DEFAULT true,
  updated_by INTEGER,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(company_id, user_id)
);

-- Paramètres société : méthode de calcul et date de paiement sont modifiables.
CREATE TABLE IF NOT EXISTS hafiya_payroll_settings (
  id SERIAL PRIMARY KEY,
  company_id INTEGER NOT NULL UNIQUE,
  daily_divisor_mode TEXT NOT NULL DEFAULT 'fixed_30',
  custom_divisor NUMERIC(8,2) DEFAULT 30,
  payment_rule TEXT NOT NULL DEFAULT 'day_of_month',
  payment_day INTEGER DEFAULT 25,
  absence_deduction_enabled BOOLEAN NOT NULL DEFAULT true,
  lateness_deduction_enabled BOOLEAN NOT NULL DEFAULT false,
  overtime_enabled BOOLEAN NOT NULL DEFAULT false,
  currency TEXT NOT NULL DEFAULT 'FCFA',
  updated_by INTEGER,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  CHECK (payment_day IS NULL OR payment_day BETWEEN 1 AND 31)
);

CREATE TABLE IF NOT EXISTS hafiya_salary_advances (
  id SERIAL PRIMARY KEY,
  company_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  principal_amount NUMERIC(14,2) NOT NULL,
  balance_amount NUMERIC(14,2) NOT NULL,
  installment_amount NUMERIC(14,2) NOT NULL DEFAULT 0,
  granted_at DATE NOT NULL DEFAULT CURRENT_DATE,
  first_deduction_month DATE,
  status TEXT NOT NULL DEFAULT 'en_cours',
  notes TEXT DEFAULT '',
  created_by INTEGER,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  CHECK (principal_amount >= 0),
  CHECK (balance_amount >= 0)
);
CREATE INDEX IF NOT EXISTS idx_hafiya_advances_employee
  ON hafiya_salary_advances(company_id, user_id, status);

CREATE TABLE IF NOT EXISTS hafiya_salary_advance_repayments (
  id SERIAL PRIMARY KEY,
  company_id INTEGER NOT NULL,
  advance_id INTEGER NOT NULL REFERENCES hafiya_salary_advances(id),
  user_id INTEGER NOT NULL,
  payroll_run_id INTEGER,
  amount NUMERIC(14,2) NOT NULL,
  paid_at DATE NOT NULL DEFAULT CURRENT_DATE,
  payment_type TEXT NOT NULL DEFAULT 'retenue_paie',
  notes TEXT DEFAULT '',
  created_by INTEGER,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  CHECK (amount > 0)
);

-- Audit complet des corrections manuelles de pointage.
CREATE TABLE IF NOT EXISTS hafiya_attendance_corrections (
  id SERIAL PRIMARY KEY,
  company_id INTEGER NOT NULL,
  attendance_id INTEGER,
  user_id INTEGER NOT NULL,
  work_date DATE NOT NULL,
  action TEXT NOT NULL,
  before_data JSONB,
  after_data JSONB,
  reason TEXT NOT NULL DEFAULT '',
  changed_by INTEGER,
  changed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_hafiya_attendance_corrections_user_date
  ON hafiya_attendance_corrections(company_id, user_id, work_date);

-- Les anciennes lignes restent en place ; ces colonnes permettent au V2 de les annuler/restaurer proprement.
ALTER TABLE attendance_records ADD COLUMN IF NOT EXISTS is_cancelled BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE attendance_records ADD COLUMN IF NOT EXISTS cancelled_by INTEGER;
ALTER TABLE attendance_records ADD COLUMN IF NOT EXISTS cancelled_reason TEXT DEFAULT '';
ALTER TABLE attendance_records ADD COLUMN IF NOT EXISTS source TEXT DEFAULT 'pointage';
ALTER TABLE attendance_records ADD COLUMN IF NOT EXISTS manual_status TEXT;
ALTER TABLE attendance_records ADD COLUMN IF NOT EXISTS company_id INTEGER;

-- Complète company_id sur l'historique existant, sans toucher aux heures ni statuts.
UPDATE attendance_records ar
SET company_id = u.company_id
FROM users u
WHERE ar.user_id=u.id AND ar.company_id IS NULL;
CREATE INDEX IF NOT EXISTS idx_attendance_records_company_date_v2
  ON attendance_records(company_id, work_date, user_id);

-- Les tables de paie existaient déjà : on les enrichit au lieu d'en créer un deuxième moteur parallèle.
ALTER TABLE payroll_runs ADD COLUMN IF NOT EXISTS payroll_year INTEGER;
ALTER TABLE payroll_runs ADD COLUMN IF NOT EXISTS payroll_month INTEGER;
ALTER TABLE payroll_runs ADD COLUMN IF NOT EXISTS payment_date DATE;
ALTER TABLE payroll_runs ADD COLUMN IF NOT EXISTS closed_by INTEGER;
ALTER TABLE payroll_runs ADD COLUMN IF NOT EXISTS closed_at TIMESTAMP;
ALTER TABLE payroll_runs ADD COLUMN IF NOT EXISTS accounting_status TEXT DEFAULT 'pending';
ALTER TABLE payroll_runs ADD COLUMN IF NOT EXISTS settings_snapshot JSONB DEFAULT '{}'::jsonb;

ALTER TABLE payroll_items ADD COLUMN IF NOT EXISTS expected_days NUMERIC(8,2) DEFAULT 0;
ALTER TABLE payroll_items ADD COLUMN IF NOT EXISTS attendance_days NUMERIC(8,2) DEFAULT 0;
ALTER TABLE payroll_items ADD COLUMN IF NOT EXISTS absence_deduction NUMERIC(14,2) DEFAULT 0;
ALTER TABLE payroll_items ADD COLUMN IF NOT EXISTS inps_amount NUMERIC(14,2) DEFAULT 0;
ALTER TABLE payroll_items ADD COLUMN IF NOT EXISTS amo_amount NUMERIC(14,2) DEFAULT 0;
ALTER TABLE payroll_items ADD COLUMN IF NOT EXISTS bonuses NUMERIC(14,2) DEFAULT 0;
ALTER TABLE payroll_items ADD COLUMN IF NOT EXISTS other_deductions NUMERIC(14,2) DEFAULT 0;
ALTER TABLE payroll_items ADD COLUMN IF NOT EXISTS details JSONB DEFAULT '{}'::jsonb;

-- Empêche deux préparations du même mois pour la même société.
CREATE UNIQUE INDEX IF NOT EXISTS ux_hafiya_payroll_run_company_month
  ON payroll_runs(company_id, payroll_year, payroll_month)
  WHERE payroll_year IS NOT NULL AND payroll_month IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS ux_hafiya_payroll_item_run_user
  ON payroll_items(payroll_run_id, user_id)
  WHERE payroll_run_id IS NOT NULL AND user_id IS NOT NULL;

-- Société HAFIYA déduite du compte de la directrice : aucune constante company_id fragile.
DO $$
DECLARE
  cid INTEGER;
BEGIN
  SELECT company_id INTO cid
  FROM users
  WHERE lower(email)=lower('hafiyamali2025@gmail.com')
  ORDER BY id DESC LIMIT 1;

  IF cid IS NULL THEN
    RAISE NOTICE 'HAFIYA V2 : société de Fatoumata Coulibaly non trouvée, seeds différés.';
    RETURN;
  END IF;

  INSERT INTO hafiya_work_groups(company_id, code, name, start_time, end_time)
  VALUES
    (cid, 'matin', 'Groupe Matin', '08:00', '17:00'),
    (cid, 'soir', 'Groupe Soir', '17:00', '23:00')
  ON CONFLICT(company_id, code) DO NOTHING;

  INSERT INTO hafiya_payroll_settings(company_id, daily_divisor_mode, custom_divisor, payment_rule, payment_day)
  VALUES(cid, 'fixed_30', 30, 'day_of_month', 25)
  ON CONFLICT(company_id) DO NOTHING;

  -- Import initial de la liste fournie. ON CONFLICT protège toute modification ultérieure faite dans l'interface.
  INSERT INTO hafiya_salary_profiles
    (company_id, user_id, gross_monthly, inps_employee, amo_employee, reference_net, effective_from)
  SELECT cid, u.id, x.gross, x.inps, x.amo, x.net, DATE '2026-09-01'
  FROM (VALUES
    ('mamadou.doumbia@hafiagroupe.com', 150000::numeric, 5325::numeric, 5970::numeric, 132705::numeric),
    ('lafia.soumare@hafiagroupe.com', 150000::numeric, 5325::numeric, 5970::numeric, 132705::numeric),
    ('fatoumata.nientao@hafiagroupe.com', 150000::numeric, 5325::numeric, 5970::numeric, 132705::numeric),
    ('mariam.sylla@hafiagroupe.com', 100000::numeric, 3550::numeric, 3980::numeric, 88470::numeric),
    ('hafiyamali2025@gmail.com', 500000::numeric, 17750::numeric, 19900::numeric, 418700::numeric)
  ) AS x(email, gross, inps, amo, net)
  JOIN users u ON lower(u.email)=lower(x.email) AND u.company_id=cid
  ON CONFLICT(company_id, user_id) DO NOTHING;
END $$;

COMMIT;
