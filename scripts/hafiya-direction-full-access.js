const fs = require('fs');
const path = 'server.js';
let s = fs.readFileSync(path, 'utf8');

function replaceOnce(oldText, newText, label) {
  if (!s.includes(oldText)) throw new Error(`Pattern not found: ${label}`);
  s = s.replace(oldText, newText);
}

replaceOnce(
`function isAdminUser(user) {
  const role = normalizeRole(user?.role);
  return (
    user?.is_super_admin === true || role === "admin" || role === "super_admin"
  );
}`,
`function isAdminUser(user) {
  const role = normalizeRole(user?.role);
  return (
    user?.is_super_admin === true ||
    role === "admin" ||
    role === "super_admin" ||
    isHafiyaDirection(user)
  );
}`,
'isAdminUser'
);

replaceOnce(
`function canAccessAdminSettings(user) {
  const role = normalizeRole(user?.role);
  return user?.is_super_admin === true || role === "super_admin" || role === "admin";
}`,
`function canAccessAdminSettings(user) {
  const role = normalizeRole(user?.role);
  return (
    user?.is_super_admin === true ||
    role === "super_admin" ||
    role === "admin" ||
    isHafiyaDirection(user)
  );
}`,
'canAccessAdminSettings'
);

replaceOnce(
`function canValidateStockMovement(user) {
  const role = normalizeRole(user?.role);
  return (
    user?.is_super_admin === true ||
    role === "admin" ||
    role === "super_admin" ||
    role === "chef_entrepot" ||`,
`function canValidateStockMovement(user) {
  const role = normalizeRole(user?.role);
  return (
    user?.is_super_admin === true ||
    role === "admin" ||
    role === "super_admin" ||
    isHafiyaDirection(user) ||
    role === "chef_entrepot" ||`,
'canValidateStockMovement'
);

replaceOnce(
`    if (req.user?.is_super_admin === true || allowed.includes(userRole)) {
      return next();
    }`,
`    if (
      req.user?.is_super_admin === true ||
      allowed.includes(userRole) ||
      (isHafiyaDirection(req.user) && allowed.includes("admin"))
    ) {
      return next();
    }`,
'authorizeRoles'
);

fs.writeFileSync(path, s);
console.log('HAFIYA Direction backend full business access patch applied.');
// Trigger workflow after workflow installation.
