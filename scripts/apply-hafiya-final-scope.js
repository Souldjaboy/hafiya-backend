const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, '..', 'server.js');
let source = fs.readFileSync(filePath, 'utf8');

function replaceOnce(before, after, label) {
  if (!source.includes(before)) throw new Error(`Patch introuvable: ${label}`);
  source = source.replace(before, after);
}

replaceOnce(
`function canManageBusinessUsers(user) {
  const role = normalizeRole(user?.role);
  return (
    user?.is_super_admin === true ||
    role === "super_admin" ||
    role === "admin" ||
    role === "direction" ||
    role === "directeur"
  );
}`,
`function isHafiyaDirection(user) {
  const role = normalizeRole(user?.role);
  const tenantId = normalizeTenantId(user?.tenant_id);
  return tenantId === "hafiya" && (role === "direction" || role === "directeur");
}

function canManageBusinessUsers(user) {
  const role = normalizeRole(user?.role);
  return (
    user?.is_super_admin === true ||
    role === "super_admin" ||
    role === "admin" ||
    isHafiyaDirection(user)
  );
}`,
'gestion utilisateurs HAFIYA uniquement');

replaceOnce(
`function isReadOnlyRole(user) {
  const role = normalizeRole(user?.role);
  // La Direction HAFIYA est un rôle métier de gestion, pas un rôle lecture seule.
  return role === "client";
}`,
`function isReadOnlyRole(user) {
  const role = normalizeRole(user?.role);
  if (role === "client") return true;
  if (role === "direction" || role === "directeur") return !isHafiyaDirection(user);
  return false;
}`,
'lecture seule hors HAFIYA');

replaceOnce(
`    role === "admin" ||
    role === "direction" ||
    role === "directeur" ||
    role === "caissier" ||`,
`    role === "admin" ||
    isHafiyaDirection(user) ||
    role === "caissier" ||`,
'POS HAFIYA');

replaceOnce(
`    role === "super_admin" ||
    role === "admin" ||
    role === "direction" ||
    role === "directeur"
  );
}

function canViewAccounting`,
`    role === "super_admin" ||
    role === "admin" ||
    isHafiyaDirection(user)
  );
}

function canViewAccounting`,
'caisses HAFIYA');

replaceOnce(
`    role === "super_admin" ||
    role === "admin" ||
    role === "direction" ||
    role === "directeur" ||
    role === "comptable"
  );
}

function canApproveAccounting`,
`    role === "super_admin" ||
    role === "admin" ||
    isHafiyaDirection(user) ||
    role === "comptable"
  );
}

function canApproveAccounting`,
'comptabilite HAFIYA');

replaceOnce(
`    role === "super_admin" ||
    role === "admin" ||
    role === "direction" ||
    role === "directeur"
  );
}

function getEffectivePosPrice`,
`    role === "super_admin" ||
    role === "admin" ||
    isHafiyaDirection(user)
  );
}

function getEffectivePosPrice`,
'ajustement prix HAFIYA');

fs.writeFileSync(filePath, source);
console.log('HAFIYA tenant-scoped permissions patch applied.');
