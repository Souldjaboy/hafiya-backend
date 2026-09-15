BEGIN;

CREATE TABLE IF NOT EXISTS hafiya_marketing_accounts (
  id BIGSERIAL PRIMARY KEY,
  company_id INTEGER NOT NULL,
  platform TEXT NOT NULL CHECK (platform IN ('facebook','instagram','tiktok','google_ads','youtube')),
  account_name TEXT NOT NULL DEFAULT '',
  external_account_id TEXT NOT NULL DEFAULT '',
  connection_status TEXT NOT NULL DEFAULT 'not_connected',
  permissions JSONB NOT NULL DEFAULT '[]'::jsonb,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_by INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(company_id, platform, external_account_id)
);

CREATE INDEX IF NOT EXISTS idx_hafiya_marketing_accounts_company
  ON hafiya_marketing_accounts(company_id, platform, id);

CREATE TABLE IF NOT EXISTS hafiya_marketing_posts (
  id BIGSERIAL PRIMARY KEY,
  company_id INTEGER NOT NULL,
  title TEXT NOT NULL DEFAULT '',
  content TEXT NOT NULL,
  media_url TEXT NOT NULL DEFAULT '',
  platforms JSONB NOT NULL DEFAULT '[]'::jsonb,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','scheduled','published','failed')),
  scheduled_at TIMESTAMPTZ,
  published_at TIMESTAMPTZ,
  external_refs JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_by INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_hafiya_marketing_posts_company
  ON hafiya_marketing_posts(company_id, status, scheduled_at, id DESC);

CREATE TABLE IF NOT EXISTS hafiya_marketing_campaigns (
  id BIGSERIAL PRIMARY KEY,
  company_id INTEGER NOT NULL,
  platform TEXT NOT NULL CHECK (platform IN ('facebook','instagram','tiktok','google_ads','youtube')),
  name TEXT NOT NULL,
  objective TEXT NOT NULL DEFAULT 'visibility',
  audience TEXT NOT NULL DEFAULT '',
  geography TEXT NOT NULL DEFAULT 'Bamako',
  daily_budget NUMERIC(14,2) NOT NULL DEFAULT 0,
  total_budget NUMERIC(14,2) NOT NULL DEFAULT 0,
  currency TEXT NOT NULL DEFAULT 'XOF',
  start_date DATE,
  end_date DATE,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','ready','active','paused','completed','failed')),
  external_campaign_id TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  created_by INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_hafiya_marketing_campaigns_company
  ON hafiya_marketing_campaigns(company_id, platform, status, id DESC);

CREATE TABLE IF NOT EXISTS hafiya_marketing_metrics (
  id BIGSERIAL PRIMARY KEY,
  company_id INTEGER NOT NULL,
  platform TEXT NOT NULL,
  metric_date DATE NOT NULL DEFAULT CURRENT_DATE,
  impressions BIGINT NOT NULL DEFAULT 0,
  reach BIGINT NOT NULL DEFAULT 0,
  views BIGINT NOT NULL DEFAULT 0,
  clicks BIGINT NOT NULL DEFAULT 0,
  messages BIGINT NOT NULL DEFAULT 0,
  calls BIGINT NOT NULL DEFAULT 0,
  conversions BIGINT NOT NULL DEFAULT 0,
  followers BIGINT NOT NULL DEFAULT 0,
  spend NUMERIC(14,2) NOT NULL DEFAULT 0,
  currency TEXT NOT NULL DEFAULT 'XOF',
  raw JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(company_id, platform, metric_date)
);

CREATE INDEX IF NOT EXISTS idx_hafiya_marketing_metrics_company
  ON hafiya_marketing_metrics(company_id, metric_date DESC, platform);

COMMIT;
