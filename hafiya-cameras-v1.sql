BEGIN;

CREATE TABLE IF NOT EXISTS hafiya_cameras (
  id BIGSERIAL PRIMARY KEY,
  company_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  location TEXT NOT NULL DEFAULT '',
  protocol TEXT NOT NULL DEFAULT 'rtsp',
  stream_url_encrypted TEXT NOT NULL,
  snapshot_url_encrypted TEXT,
  username_hint TEXT NOT NULL DEFAULT '',
  brand TEXT NOT NULL DEFAULT '',
  model TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  active BOOLEAN NOT NULL DEFAULT TRUE,
  last_status TEXT NOT NULL DEFAULT 'unknown',
  last_checked_at TIMESTAMPTZ,
  last_error TEXT,
  created_by INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_hafiya_cameras_company
  ON hafiya_cameras(company_id, active, id);

CREATE TABLE IF NOT EXISTS hafiya_camera_recordings (
  id BIGSERIAL PRIMARY KEY,
  company_id INTEGER NOT NULL,
  camera_id BIGINT NOT NULL REFERENCES hafiya_cameras(id) ON DELETE CASCADE,
  file_name TEXT NOT NULL,
  file_path TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'recording',
  started_by INTEGER,
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  stopped_at TIMESTAMPTZ,
  duration_seconds INTEGER,
  file_size_bytes BIGINT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_hafiya_camera_recordings_camera
  ON hafiya_camera_recordings(company_id, camera_id, started_at DESC);

CREATE TABLE IF NOT EXISTS hafiya_camera_events (
  id BIGSERIAL PRIMARY KEY,
  company_id INTEGER NOT NULL,
  camera_id BIGINT REFERENCES hafiya_cameras(id) ON DELETE SET NULL,
  event_type TEXT NOT NULL,
  details JSONB NOT NULL DEFAULT '{}'::jsonb,
  user_id INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_hafiya_camera_events_company
  ON hafiya_camera_events(company_id, created_at DESC);

COMMIT;
