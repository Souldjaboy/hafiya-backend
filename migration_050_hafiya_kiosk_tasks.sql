BEGIN;

CREATE TABLE IF NOT EXISTS hafiya_kiosk_tasks (
  id BIGSERIAL PRIMARY KEY,
  company_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  task_date DATE NOT NULL DEFAULT CURRENT_DATE,
  priority TEXT NOT NULL DEFAULT 'normal' CHECK (priority IN ('low','normal','high','urgent')),
  status TEXT NOT NULL DEFAULT 'todo' CHECK (status IN ('todo','in_progress','done','cancelled')),
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  completed_at TIMESTAMPTZ,
  completed_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_hafiya_kiosk_tasks_company_date
  ON hafiya_kiosk_tasks(company_id, task_date);
CREATE INDEX IF NOT EXISTS idx_hafiya_kiosk_tasks_user_date
  ON hafiya_kiosk_tasks(user_id, task_date);

CREATE TABLE IF NOT EXISTS hafiya_kiosk_events (
  id BIGSERIAL PRIMARY KEY,
  company_id INTEGER NOT NULL,
  kiosk_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  employee_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  event_type TEXT NOT NULL,
  event_data JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_hafiya_kiosk_events_company_created
  ON hafiya_kiosk_events(company_id, created_at DESC);

COMMIT;
