const fs = require('fs');
const path = require('path');

const serverPath = path.join(__dirname, '..', 'server.js');
let source = fs.readFileSync(serverPath, 'utf8');

function replaceOnce(before, after, label) {
  if (!source.includes(before)) {
    throw new Error(`Patch HAFIYA introuvable: ${label}`);
  }
  source = source.replace(before, after);
}

replaceOnce(
`function isReadOnlyRole(user) {
  const role = normalizeRole(user?.role);
  return role === "direction" || role === "client";
}`,
`function isReadOnlyRole(user) {
  const role = normalizeRole(user?.role);
  // La Direction HAFIYA est un rôle métier de gestion, pas un rôle lecture seule.
  return role === "client";
}`,
'isReadOnlyRole direction'
);

replaceOnce(
`function canUsePos(user) {
  const role = normalizeRole(user?.role);
  return (
    user?.is_super_admin === true ||
    role === "super_admin" ||
    role === "admin" ||
    role === "caissier" ||
    role === "vendeur"
  );
}`,
`function canUsePos(user) {
  const role = normalizeRole(user?.role);
  return (
    user?.is_super_admin === true ||
    role === "super_admin" ||
    role === "admin" ||
    role === "direction" ||
    role === "directeur" ||
    role === "caissier" ||
    role === "vendeur"
  );
}`,
'canUsePos direction'
);

replaceOnce(
`function canManageCaisses(user) {
  const role = normalizeRole(user?.role);
  return user?.is_super_admin === true || role === "super_admin" || role === "admin";
}`,
`function canManageCaisses(user) {
  const role = normalizeRole(user?.role);
  return (
    user?.is_super_admin === true ||
    role === "super_admin" ||
    role === "admin" ||
    role === "direction" ||
    role === "directeur"
  );
}`,
'canManageCaisses direction'
);

replaceOnce(
`function canManageAccounting(user) {
  const role = normalizeRole(user?.role);
  return (
    user?.is_super_admin === true ||
    role === "super_admin" ||
    role === "admin" ||
    role === "comptable"
  );
}`,
`function canManageAccounting(user) {
  const role = normalizeRole(user?.role);
  return (
    user?.is_super_admin === true ||
    role === "super_admin" ||
    role === "admin" ||
    role === "direction" ||
    role === "directeur" ||
    role === "comptable"
  );
}`,
'canManageAccounting direction'
);

replaceOnce(
`function canAdjustPosPrice(user) {
  const role = normalizeRole(user?.role);
  return user?.is_super_admin === true || role === "super_admin" || role === "admin";
}`,
`function canAdjustPosPrice(user) {
  const role = normalizeRole(user?.role);
  return (
    user?.is_super_admin === true ||
    role === "super_admin" ||
    role === "admin" ||
    role === "direction" ||
    role === "directeur"
  );
}`,
'canAdjustPosPrice direction'
);

fs.writeFileSync(serverPath, source);
console.log('HAFIYA direction permission patch applied.');
