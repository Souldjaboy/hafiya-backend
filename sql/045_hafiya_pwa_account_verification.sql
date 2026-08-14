-- HAFIYA - PWA install and account verification support.
-- Non-destructive and idempotent.

ALTER TABLE users ADD COLUMN IF NOT EXISTS email_verified BOOLEAN DEFAULT false;
ALTER TABLE users ADD COLUMN IF NOT EXISTS phone_verified BOOLEAN DEFAULT false;
ALTER TABLE users ADD COLUMN IF NOT EXISTS account_status VARCHAR(80) DEFAULT 'pending_verification';
ALTER TABLE users ADD COLUMN IF NOT EXISTS verification_required BOOLEAN DEFAULT false;
ALTER TABLE users ADD COLUMN IF NOT EXISTS verified_at TIMESTAMP;

CREATE TABLE IF NOT EXISTS verification_codes (
  id SERIAL PRIMARY KEY,
  company_id INTEGER,
  user_id INTEGER,
  target_type VARCHAR(20) NOT NULL,
  target_value TEXT NOT NULL,
  code_hash TEXT NOT NULL,
  token_hash TEXT DEFAULT '',
  expires_at TIMESTAMP NOT NULL,
  attempts INTEGER DEFAULT 0,
  used_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_verification_codes_user ON verification_codes(user_id);
CREATE INDEX IF NOT EXISTS idx_verification_codes_target ON verification_codes(target_type, target_value);
CREATE INDEX IF NOT EXISTS idx_verification_codes_active_user
  ON verification_codes(user_id, target_type, target_value)
  WHERE used_at IS NULL;

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

