BEGIN;

CREATE TABLE IF NOT EXISTS hafiya_staff_tasks (
  id BIGSERIAL PRIMARY KEY,
  company_id INTEGER NOT NULL,
  assigned_to INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  priority TEXT NOT NULL DEFAULT 'normale' CHECK (priority IN ('normale','haute','urgent')),
  due_date DATE NOT NULL,
  status TEXT NOT NULL DEFAULT 'a_faire' CHECK (status IN ('a_faire','en_cours','termine')),
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_hafiya_staff_tasks_company_date
  ON hafiya_staff_tasks(company_id, due_date, assigned_to);

CREATE TABLE IF NOT EXISTS hafiya_kiosk_audit (
  id BIGSERIAL PRIMARY KEY,
  company_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  badge_code TEXT NOT NULL,
  action_type TEXT NOT NULL,
  performed_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  device_info TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_hafiya_kiosk_audit_company_created
  ON hafiya_kiosk_audit(company_id, created_at DESC);

COMMIT;
