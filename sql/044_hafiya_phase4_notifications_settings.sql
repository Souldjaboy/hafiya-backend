-- HAFIYA Phase 4 - laboratory notification settings and appointment decision metadata.
-- Idempotent and non-destructive.

ALTER TABLE laboratory_settings
  ADD COLUMN IF NOT EXISTS commercial_name TEXT DEFAULT '',
  ADD COLUMN IF NOT EXISTS slogan TEXT DEFAULT '',
  ADD COLUMN IF NOT EXISTS notification_email TEXT DEFAULT '',
  ADD COLUMN IF NOT EXISTS notification_phone TEXT DEFAULT '',
  ADD COLUMN IF NOT EXISTS country TEXT DEFAULT 'Mali',
  ADD COLUMN IF NOT EXISTS district TEXT DEFAULT '',
  ADD COLUMN IF NOT EXISTS location_hint TEXT DEFAULT '',
  ADD COLUMN IF NOT EXISTS latitude NUMERIC,
  ADD COLUMN IF NOT EXISTS longitude NUMERIC,
  ADD COLUMN IF NOT EXISTS website_url TEXT DEFAULT '',
  ADD COLUMN IF NOT EXISTS facebook_url TEXT DEFAULT '',
  ADD COLUMN IF NOT EXISTS instagram_url TEXT DEFAULT '',
  ADD COLUMN IF NOT EXISTS opening_days TEXT DEFAULT '',
  ADD COLUMN IF NOT EXISTS opening_time TEXT DEFAULT '',
  ADD COLUMN IF NOT EXISTS closing_time TEXT DEFAULT '',
  ADD COLUMN IF NOT EXISTS open_24h BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS appointment_message TEXT DEFAULT '',
  ADD COLUMN IF NOT EXISTS appointment_instructions TEXT DEFAULT '',
  ADD COLUMN IF NOT EXISTS practical_information TEXT DEFAULT '',
  ADD COLUMN IF NOT EXISTS internal_notifications_enabled BOOLEAN DEFAULT true,
  ADD COLUMN IF NOT EXISTS email_notifications_enabled BOOLEAN DEFAULT true,
  ADD COLUMN IF NOT EXISTS sms_notifications_enabled BOOLEAN DEFAULT true,
  ADD COLUMN IF NOT EXISTS push_notifications_enabled BOOLEAN DEFAULT true;

UPDATE laboratory_settings
SET notification_email = COALESCE(NULLIF(notification_email, ''), 'hafiyamali2025@gmail.com'),
    notification_phone = COALESCE(NULLIF(notification_phone, ''), '70717119'),
    country = COALESCE(NULLIF(country, ''), 'Mali');

ALTER TABLE laboratory_appointments
  ADD COLUMN IF NOT EXISTS patient_phone_normalized TEXT DEFAULT '',
  ADD COLUMN IF NOT EXISTS decision_by INTEGER,
  ADD COLUMN IF NOT EXISTS decision_at TIMESTAMP,
  ADD COLUMN IF NOT EXISTS notification_status JSONB DEFAULT '{}'::jsonb;

CREATE TABLE IF NOT EXISTS sms_outbox (
  id SERIAL PRIMARY KEY,
  phone TEXT NOT NULL,
  message TEXT NOT NULL,
  status TEXT DEFAULT 'pending',
  provider TEXT,
  error_message TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  sent_at TIMESTAMP
);
