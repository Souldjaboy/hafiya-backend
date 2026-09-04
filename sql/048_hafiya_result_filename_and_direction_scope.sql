-- HAFIYA — compatibilité nom de fichier résultat + nettoyage des permissions Direction
-- Migration idempotente et ciblée HAFIYA uniquement.

ALTER TABLE laboratory_cases
  ADD COLUMN IF NOT EXISTS result_file_name TEXT;

DO $$
DECLARE
  direction_user_id INTEGER;
  direction_matches INTEGER;
BEGIN
  SELECT COUNT(*), MIN(id)
  INTO direction_matches, direction_user_id
  FROM users
  WHERE id = 24
    AND company_id = 1
    AND LOWER(email) = LOWER('hafiyamali2025@gmail.com');

  IF direction_matches <> 1 OR direction_user_id IS NULL THEN
    RAISE EXCEPTION 'ARRÊT : compte Direction HAFIYA attendu non trouvé exactement.';
  END IF;

  -- Retirer les anciens droits hérités de modules qui ne concernent pas HAFIYA.
  DELETE FROM user_permissions
  WHERE user_id = direction_user_id
    AND module_key NOT IN (
      'dashboard','laboratoire','analyses','patients','rendez_vous','resultats','paiements',
      'documents','attendance','badges','communication','notifications','settings','users',
      'comptabilite','caisses','tresorerie','banques','salaires','reports','pos',
      'rapports','pointage','pointage_qr','parametres_pointage','utilisateurs','parametres',
      'activites','alertes','ai','assistant_ia'
    );

  -- Protection explicite des privilèges système.
  DELETE FROM user_permissions
  WHERE user_id = direction_user_id
    AND LOWER(module_key) IN ('super_admin','system','developer','secrets','integrations');
END $$;
