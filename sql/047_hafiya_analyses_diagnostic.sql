-- HAFIYA — diagnostic non destructif du catalogue d'analyses.
-- À exécuter en lecture seule avant toute décision d'activation/désactivation.

SELECT
  COUNT(*)::int AS total,
  COUNT(*) FILTER (WHERE is_available IS TRUE)::int AS actives,
  COUNT(*) FILTER (WHERE is_available IS NOT TRUE)::int AS inactives
FROM laboratory_analyses;

SELECT
  id,
  name,
  category,
  is_available,
  on_site_available,
  home_sampling_available,
  company_id
FROM laboratory_analyses
ORDER BY id ASC;
