const fs = require('fs');
const path = require('path');

function mustReplace(source, before, after, label) {
  if (!source.includes(before)) throw new Error(`Patch introuvable: ${label}`);
  return source.replace(before, after);
}

const serverPath = path.join(__dirname, '..', 'server.js');
let server = fs.readFileSync(serverPath, 'utf8');

// Remove the obsolete public verifier entirely. The hardened verifier lives in hafiya-extra-routes.js.
const legacyStart = server.indexOf('app.post("/laboratory/public/results/verify", async (req, res) => {');
const legacyEndMarker = '\n\napp.get("/marketplace/cart"';
const legacyEnd = legacyStart >= 0 ? server.indexOf(legacyEndMarker, legacyStart) : -1;
if (legacyStart < 0 || legacyEnd < 0) throw new Error('Ancien verifier public HAFIYA introuvable.');
server = server.slice(0, legacyStart) + '// HAFIYA public result verification is mounted by hafiya-extra-routes.js.' + server.slice(legacyEnd);

server = server.replaceAll(
  'SMTP non configuré. Configurez SMTP dans .env.',
  'L’envoi par email n’est pas disponible pour le moment.'
);

// Keep HAFIYA-only modules hidden from non-HAFIYA tenants in the generic permissions catalogue.
const modulesQueryBefore = `    const result = await pool.query(\n      \`SELECT module_key, module_name, description, is_active\n       FROM modules\n       WHERE is_active=true\n       ORDER BY module_name ASC\`\n    );`;
const modulesQueryAfter = `    const hafiyaOnlyModules = [\n      "laboratoire", "analyses", "patients", "rendez_vous", "resultats", "paiements",\n      "badges", "communication", "notifications", "comptabilite", "caisses", "tresorerie",\n      "banques", "salaires"\n    ];\n    const result = req.tenant_id === "hafiya"\n      ? await pool.query(\n          \`SELECT module_key, module_name, description, is_active\n           FROM modules\n           WHERE is_active=true\n           ORDER BY module_name ASC\`\n        )\n      : await pool.query(\n          \`SELECT module_key, module_name, description, is_active\n           FROM modules\n           WHERE is_active=true AND NOT (module_key = ANY($1::text[]))\n           ORDER BY module_name ASC\`,\n          [hafiyaOnlyModules]\n        );`;
server = mustReplace(server, modulesQueryBefore, modulesQueryAfter, 'catalogue modules tenant');

fs.writeFileSync(serverPath, server);

const extraPath = path.join(__dirname, '..', 'hafiya-extra-routes.js');
let extra = fs.readFileSync(extraPath, 'utf8');
extra = mustReplace(
  extra,
  'app.post("/laboratory/public/results/verify-v2", async (req, res) => {',
  'app.post("/laboratory/public/results/verify", async (req, res) => {',
  'route verifier securisee'
);
fs.writeFileSync(extraPath, extra);

const migrationPath = path.join(__dirname, '..', 'sql', '046_hafiya_direction_business_permissions.sql');
let migration = fs.readFileSync(migrationPath, 'utf8');
migration = mustReplace(
  migration,
  `DECLARE\n  direction_user_id INTEGER;\nBEGIN\n  SELECT id INTO direction_user_id\n  FROM users\n  WHERE LOWER(email) = LOWER('hafiyamali2025@gmail.com')\n  ORDER BY id ASC\n  LIMIT 1;\n\n  IF direction_user_id IS NULL THEN\n    RAISE EXCEPTION 'Compte Direction HAFIYA introuvable: hafiyamali2025@gmail.com';\n  END IF;`,
  `DECLARE\n  direction_user_id INTEGER;\n  direction_matches INTEGER;\nBEGIN\n  SELECT COUNT(*), MIN(id)\n  INTO direction_matches, direction_user_id\n  FROM users\n  WHERE id = 24\n    AND company_id = 1\n    AND LOWER(email) = LOWER('hafiyamali2025@gmail.com');\n\n  IF direction_matches <> 1 OR direction_user_id IS NULL THEN\n    RAISE EXCEPTION 'ARRÊT : compte Direction HAFIYA attendu non trouvé exactement (id=24, company_id=1, email=hafiyamali2025@gmail.com).';\n  END IF;`,
  'identite Direction exacte'
);

migration = migration.replace(
  /ON CONFLICT \(module_key\) DO UPDATE SET\n    module_name = EXCLUDED\.module_name,\n    description = EXCLUDED\.description,\n    is_active = true,\n    updated_at = CURRENT_TIMESTAMP;/,
  'ON CONFLICT (module_key) DO NOTHING;'
);
if (!migration.includes('ON CONFLICT (module_key) DO NOTHING;')) {
  throw new Error('Protection modules globaux non appliquee.');
}
fs.writeFileSync(migrationPath, migration);

console.log('Final HAFIYA security hotfix applied.');
