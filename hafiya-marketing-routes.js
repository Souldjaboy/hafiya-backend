"use strict";

function roleOf(user) {
  return String(user?.role || "").trim().toLowerCase();
}

function canUseMarketing(user) {
  return user?.is_super_admin === true || ["super_admin", "admin", "admin_entreprise", "direction", "directeur"].includes(roleOf(user));
}

function guard(req, res) {
  const tenant = String(req?.tenant_id || req?.user?.tenant_id || "").toLowerCase();
  if (tenant !== "hafiya" || !canUseMarketing(req.user)) {
    res.status(403).json({ error: "Accès marketing HAFIYA réservé à la Direction." });
    return false;
  }
  return true;
}

function companyId(req) {
  return Number(req.user?.company_id || req.body?.company_id || req.query?.company_id || 0);
}

function normalizePlatforms(value) {
  const allowed = new Set(["facebook", "instagram", "tiktok", "google_ads", "youtube"]);
  const source = Array.isArray(value) ? value : [];
  return source.map((v) => String(v).trim().toLowerCase()).filter((v) => allowed.has(v));
}

function normalizePlatform(value) {
  const platform = String(value || "").trim().toLowerCase();
  const allowed = new Set(["facebook", "instagram", "tiktok", "google_ads", "youtube"]);
  return allowed.has(platform) ? platform : "";
}

module.exports = function registerHafiyaMarketingRoutes(app, pool, authenticateToken) {
  app.get("/hafiya/marketing/summary", authenticateToken, async (req, res) => {
    try {
      if (!guard(req, res)) return;
      const cid = companyId(req);
      const [accounts, posts, campaigns, metrics] = await Promise.all([
        pool.query(`SELECT platform, connection_status, account_name FROM hafiya_marketing_accounts WHERE company_id=$1 ORDER BY platform,id`, [cid]),
        pool.query(`SELECT COUNT(*)::int AS total, COUNT(*) FILTER (WHERE status='scheduled')::int AS scheduled, COUNT(*) FILTER (WHERE status='published')::int AS published FROM hafiya_marketing_posts WHERE company_id=$1`, [cid]),
        pool.query(`SELECT COUNT(*)::int AS total, COALESCE(SUM(total_budget),0)::numeric AS budget, COUNT(*) FILTER (WHERE status='active')::int AS active FROM hafiya_marketing_campaigns WHERE company_id=$1`, [cid]),
        pool.query(`SELECT COALESCE(SUM(impressions),0)::bigint AS impressions, COALESCE(SUM(reach),0)::bigint AS reach, COALESCE(SUM(views),0)::bigint AS views, COALESCE(SUM(clicks),0)::bigint AS clicks, COALESCE(SUM(messages),0)::bigint AS messages, COALESCE(SUM(calls),0)::bigint AS calls, COALESCE(SUM(conversions),0)::bigint AS conversions, COALESCE(SUM(spend),0)::numeric AS spend FROM hafiya_marketing_metrics WHERE company_id=$1 AND metric_date >= CURRENT_DATE - INTERVAL '30 days'`, [cid])
      ]);
      res.json({
        accounts: accounts.rows,
        posts: posts.rows[0] || {},
        campaigns: campaigns.rows[0] || {},
        metrics: metrics.rows[0] || {}
      });
    } catch (error) {
      console.error("HAFIYA MARKETING SUMMARY:", error);
      res.status(500).json({ error: "Erreur tableau de bord marketing." });
    }
  });

  app.get("/hafiya/marketing/accounts", authenticateToken, async (req, res) => {
    try {
      if (!guard(req, res)) return;
      const result = await pool.query(`SELECT id,platform,account_name,external_account_id,connection_status,permissions,metadata,created_at,updated_at FROM hafiya_marketing_accounts WHERE company_id=$1 ORDER BY platform,id`, [companyId(req)]);
      res.json(result.rows);
    } catch (error) {
      console.error("HAFIYA MARKETING ACCOUNTS:", error);
      res.status(500).json({ error: "Erreur lecture comptes marketing." });
    }
  });

  app.post("/hafiya/marketing/accounts", authenticateToken, async (req, res) => {
    try {
      if (!guard(req, res)) return;
      const platform = normalizePlatform(req.body?.platform);
      if (!platform) return res.status(400).json({ error: "Plateforme invalide." });
      const accountName = String(req.body?.account_name || "").trim();
      const externalId = String(req.body?.external_account_id || "").trim();
      const status = String(req.body?.connection_status || "not_connected").trim().toLowerCase();
      const result = await pool.query(
        `INSERT INTO hafiya_marketing_accounts(company_id,platform,account_name,external_account_id,connection_status,permissions,metadata,created_by)
         VALUES($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb,$8)
         ON CONFLICT(company_id,platform,external_account_id) DO UPDATE SET account_name=EXCLUDED.account_name, connection_status=EXCLUDED.connection_status, permissions=EXCLUDED.permissions, metadata=EXCLUDED.metadata, updated_at=NOW()
         RETURNING id,platform,account_name,external_account_id,connection_status,permissions,metadata,created_at,updated_at`,
        [companyId(req), platform, accountName, externalId, status, JSON.stringify(req.body?.permissions || []), JSON.stringify(req.body?.metadata || {}), req.user?.id || null]
      );
      res.status(201).json(result.rows[0]);
    } catch (error) {
      console.error("HAFIYA MARKETING ACCOUNT SAVE:", error);
      res.status(500).json({ error: "Erreur enregistrement compte marketing." });
    }
  });

  app.get("/hafiya/marketing/posts", authenticateToken, async (req, res) => {
    try {
      if (!guard(req, res)) return;
      const result = await pool.query(`SELECT * FROM hafiya_marketing_posts WHERE company_id=$1 ORDER BY COALESCE(scheduled_at,created_at) DESC,id DESC LIMIT 200`, [companyId(req)]);
      res.json(result.rows);
    } catch (error) {
      console.error("HAFIYA MARKETING POSTS:", error);
      res.status(500).json({ error: "Erreur lecture publications." });
    }
  });

  app.post("/hafiya/marketing/posts", authenticateToken, async (req, res) => {
    try {
      if (!guard(req, res)) return;
      const content = String(req.body?.content || "").trim();
      const platforms = normalizePlatforms(req.body?.platforms);
      if (!content) return res.status(400).json({ error: "Le texte de la publication est obligatoire." });
      if (!platforms.length) return res.status(400).json({ error: "Choisissez au moins une plateforme." });
      const status = req.body?.scheduled_at ? "scheduled" : "draft";
      const result = await pool.query(
        `INSERT INTO hafiya_marketing_posts(company_id,title,content,media_url,platforms,status,scheduled_at,created_by)
         VALUES($1,$2,$3,$4,$5::jsonb,$6,$7,$8) RETURNING *`,
        [companyId(req), String(req.body?.title || "").trim(), content, String(req.body?.media_url || "").trim(), JSON.stringify(platforms), status, req.body?.scheduled_at || null, req.user?.id || null]
      );
      res.status(201).json(result.rows[0]);
    } catch (error) {
      console.error("HAFIYA MARKETING POST CREATE:", error);
      res.status(500).json({ error: "Erreur création publication." });
    }
  });

  app.put("/hafiya/marketing/posts/:id/status", authenticateToken, async (req, res) => {
    try {
      if (!guard(req, res)) return;
      const status = String(req.body?.status || "").trim().toLowerCase();
      if (!["draft","scheduled","published","failed"].includes(status)) return res.status(400).json({ error: "Statut invalide." });
      const result = await pool.query(`UPDATE hafiya_marketing_posts SET status=$1,published_at=CASE WHEN $1='published' THEN NOW() ELSE published_at END,updated_at=NOW() WHERE id=$2 AND company_id=$3 RETURNING *`, [status, req.params.id, companyId(req)]);
      if (!result.rows[0]) return res.status(404).json({ error: "Publication introuvable." });
      res.json(result.rows[0]);
    } catch (error) {
      console.error("HAFIYA MARKETING POST STATUS:", error);
      res.status(500).json({ error: "Erreur mise à jour publication." });
    }
  });

  app.get("/hafiya/marketing/campaigns", authenticateToken, async (req, res) => {
    try {
      if (!guard(req, res)) return;
      const result = await pool.query(`SELECT * FROM hafiya_marketing_campaigns WHERE company_id=$1 ORDER BY id DESC LIMIT 200`, [companyId(req)]);
      res.json(result.rows);
    } catch (error) {
      console.error("HAFIYA MARKETING CAMPAIGNS:", error);
      res.status(500).json({ error: "Erreur lecture campagnes." });
    }
  });

  app.post("/hafiya/marketing/campaigns", authenticateToken, async (req, res) => {
    try {
      if (!guard(req, res)) return;
      const platform = normalizePlatform(req.body?.platform);
      const name = String(req.body?.name || "").trim();
      if (!platform || !name) return res.status(400).json({ error: "Plateforme et nom de campagne obligatoires." });
      const result = await pool.query(
        `INSERT INTO hafiya_marketing_campaigns(company_id,platform,name,objective,audience,geography,daily_budget,total_budget,currency,start_date,end_date,status,notes,created_by)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'draft',$12,$13) RETURNING *`,
        [companyId(req), platform, name, String(req.body?.objective || "visibility"), String(req.body?.audience || ""), String(req.body?.geography || "Bamako"), Number(req.body?.daily_budget || 0), Number(req.body?.total_budget || 0), String(req.body?.currency || "XOF"), req.body?.start_date || null, req.body?.end_date || null, String(req.body?.notes || ""), req.user?.id || null]
      );
      res.status(201).json(result.rows[0]);
    } catch (error) {
      console.error("HAFIYA MARKETING CAMPAIGN CREATE:", error);
      res.status(500).json({ error: "Erreur création campagne." });
    }
  });

  app.put("/hafiya/marketing/campaigns/:id/status", authenticateToken, async (req, res) => {
    try {
      if (!guard(req, res)) return;
      const status = String(req.body?.status || "").trim().toLowerCase();
      if (!["draft","ready","active","paused","completed","failed"].includes(status)) return res.status(400).json({ error: "Statut invalide." });
      const result = await pool.query(`UPDATE hafiya_marketing_campaigns SET status=$1,updated_at=NOW() WHERE id=$2 AND company_id=$3 RETURNING *`, [status, req.params.id, companyId(req)]);
      if (!result.rows[0]) return res.status(404).json({ error: "Campagne introuvable." });
      res.json(result.rows[0]);
    } catch (error) {
      console.error("HAFIYA MARKETING CAMPAIGN STATUS:", error);
      res.status(500).json({ error: "Erreur mise à jour campagne." });
    }
  });

  app.get("/hafiya/marketing/metrics", authenticateToken, async (req, res) => {
    try {
      if (!guard(req, res)) return;
      const result = await pool.query(`SELECT * FROM hafiya_marketing_metrics WHERE company_id=$1 ORDER BY metric_date DESC,platform LIMIT 400`, [companyId(req)]);
      res.json(result.rows);
    } catch (error) {
      console.error("HAFIYA MARKETING METRICS:", error);
      res.status(500).json({ error: "Erreur lecture statistiques marketing." });
    }
  });

  app.post("/hafiya/marketing/metrics", authenticateToken, async (req, res) => {
    try {
      if (!guard(req, res)) return;
      const platform = normalizePlatform(req.body?.platform);
      if (!platform) return res.status(400).json({ error: "Plateforme invalide." });
      const values = ["impressions","reach","views","clicks","messages","calls","conversions","followers","spend"].map((key) => Number(req.body?.[key] || 0));
      const result = await pool.query(
        `INSERT INTO hafiya_marketing_metrics(company_id,platform,metric_date,impressions,reach,views,clicks,messages,calls,conversions,followers,spend,currency,raw)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14::jsonb)
         ON CONFLICT(company_id,platform,metric_date) DO UPDATE SET impressions=EXCLUDED.impressions,reach=EXCLUDED.reach,views=EXCLUDED.views,clicks=EXCLUDED.clicks,messages=EXCLUDED.messages,calls=EXCLUDED.calls,conversions=EXCLUDED.conversions,followers=EXCLUDED.followers,spend=EXCLUDED.spend,currency=EXCLUDED.currency,raw=EXCLUDED.raw,updated_at=NOW()
         RETURNING *`,
        [companyId(req), platform, req.body?.metric_date || new Date().toISOString().slice(0,10), ...values, String(req.body?.currency || "XOF"), JSON.stringify(req.body?.raw || {})]
      );
      res.status(201).json(result.rows[0]);
    } catch (error) {
      console.error("HAFIYA MARKETING METRICS SAVE:", error);
      res.status(500).json({ error: "Erreur enregistrement statistiques." });
    }
  });
};
