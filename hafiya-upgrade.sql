CREATE TABLE IF NOT EXISTS app_notifications (
  id SERIAL PRIMARY KEY,
  tenant_id TEXT DEFAULT 'hafiya',
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  type TEXT DEFAULT 'info',
  is_read BOOLEAN DEFAULT false,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS sms_outbox (
  id SERIAL PRIMARY KEY,
  phone TEXT,
  message TEXT NOT NULL,
  status TEXT DEFAULT 'pending',
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS appointment_feedback (
  id SERIAL PRIMARY KEY,
  appointment_id INTEGER,
  patient_name TEXT,
  phone TEXT,
  rating INTEGER,
  comment TEXT,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS chat_messages (
  id SERIAL PRIMARY KEY,
  sender_id INTEGER,
  receiver_id INTEGER,
  message TEXT NOT NULL,
  is_read BOOLEAN DEFAULT false,
  created_at TIMESTAMP DEFAULT NOW()
);
