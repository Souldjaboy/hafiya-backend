-- HAFIYA — permissions métier complètes pour la Direction
-- Non destructif. Ne donne jamais le statut super_admin.

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
    RAISE EXCEPTION 'ARRÊT : compte Direction HAFIYA attendu non trouvé exactement (id=24, company_id=1, email=hafiyamali2025@gmail.com).';
  END IF;

  UPDATE users
  SET role = 'direction',
      is_super_admin = false,
      is_active = true,
      email_verified = true,
      phone_verified = CASE WHEN COALESCE(phone, '') <> '' THEN true ELSE phone_verified END,
      account_status = CASE WHEN account_status IS NULL OR account_status <> 'active' THEN 'active' ELSE account_status END,
      invitation_status = CASE WHEN invitation_status IS NULL OR invitation_status <> 'accepted' THEN 'accepted' ELSE invitation_status END,
      verification_required = false,
      updated_at = CURRENT_TIMESTAMP
  WHERE id = direction_user_id;

  INSERT INTO modules (module_key, module_name, description, is_active)
  VALUES
    ('dashboard', 'Tableau de bord', 'Vue globale HAFIYA', true),
    ('laboratoire', 'Laboratoire', 'Gestion générale du laboratoire', true),
    ('analyses', 'Analyses', 'Catalogue et gestion des analyses', true),
    ('patients', 'Patients', 'Gestion des patients', true),
    ('rendez_vous', 'Rendez-vous', 'Gestion des rendez-vous laboratoire', true),
    ('resultats', 'Résultats', 'Publication et gestion des résultats', true),
    ('paiements', 'Paiements', 'Paiements laboratoire', true),
    ('documents', 'Documents', 'Documents laboratoire', true),
    ('attendance', 'Pointage', 'Pointage et groupes horaires', true),
    ('badges', 'Badges', 'Badges du personnel', true),
    ('communication', 'Communication', 'Conversations privées et groupes', true),
    ('notifications', 'Notifications', 'Notifications internes', true),
    ('settings', 'Paramètres', 'Paramètres métier HAFIYA', true),
    ('users', 'Utilisateurs', 'Utilisateurs et permissions', true),
    ('comptabilite', 'Comptabilité', 'Comptabilité HAFIYA', true),
    ('caisses', 'Caisses', 'Caisses et mouvements', true),
    ('tresorerie', 'Trésorerie', 'Trésorerie HAFIYA', true),
    ('banques', 'Banques', 'Comptes et mouvements bancaires', true),
    ('salaires', 'Salaires', 'Gestion des salaires', true),
    ('reports', 'Rapports', 'Rapports et exports', true),
    ('pos', 'Caisse / POS', 'Encaissements et caisse', true)
  ON CONFLICT (module_key) DO NOTHING;

  INSERT INTO user_permissions
    (user_id, module_key, can_view, can_create, can_edit, can_delete, can_validate, updated_by, updated_at)
  SELECT
    direction_user_id,
    m.module_key,
    true,
    true,
    true,
    true,
    true,
    direction_user_id,
    CURRENT_TIMESTAMP
  FROM modules m
  WHERE m.module_key IN (
    'dashboard','laboratoire','analyses','patients','rendez_vous','resultats','paiements',
    'documents','attendance','badges','communication','notifications','settings','users',
    'comptabilite','caisses','tresorerie','banques','salaires','reports','pos'
  )
  ON CONFLICT (user_id, module_key) DO UPDATE SET
    can_view = true,
    can_create = true,
    can_edit = true,
    can_delete = true,
    can_validate = true,
    updated_by = EXCLUDED.updated_by,
    updated_at = CURRENT_TIMESTAMP;

  -- Protection explicite : aucun privilège système super_admin.
  DELETE FROM user_permissions
  WHERE user_id = direction_user_id
    AND LOWER(module_key) IN ('super_admin','system','developer','secrets','integrations');
END $$;

CREATE INDEX IF NOT EXISTS idx_user_permissions_hafiya_direction
  ON user_permissions(user_id, module_key);
