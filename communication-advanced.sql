ALTER TABLE chat_messages_v2 ADD COLUMN IF NOT EXISTS message_type TEXT DEFAULT 'text';
ALTER TABLE chat_messages_v2 ADD COLUMN IF NOT EXISTS media_url TEXT;
ALTER TABLE chat_messages_v2 ADD COLUMN IF NOT EXISTS media_mime TEXT;
ALTER TABLE chat_messages_v2 ADD COLUMN IF NOT EXISTS media_duration INTEGER;

CREATE TABLE IF NOT EXISTS communication_call_signals (
  id SERIAL PRIMARY KEY,
  conversation_id INTEGER,
  sender_id INTEGER,
  receiver_id INTEGER,
  signal_type TEXT NOT NULL,
  payload JSONB NOT NULL,
  created_at TIMESTAMP DEFAULT NOW()
);
