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
`function canAccessDirectionModule(user) {
  const role = normalizeRole(user?.role);
  return (
    canAccessAdminSettings(user) ||
    role === "directeur" ||
    role === "direction"
  );
}`,
`function canAccessDirectionModule(user) {
  const role = normalizeRole(user?.role);
  return (
    canAccessAdminSettings(user) ||
    role === "directeur" ||
    role === "direction"
  );
}

function canManageBusinessUsers(user) {
  const role = normalizeRole(user?.role);
  return (
    user?.is_super_admin === true ||
    role === "super_admin" ||
    role === "admin" ||
    role === "direction" ||
    role === "directeur"
  );
}

function isProtectedSystemPermission(moduleKey) {
  return ["super_admin", "system", "developer", "secrets", "integrations"].includes(
    String(moduleKey || "").trim().toLowerCase()
  );
}

function authorizeBusinessUserManagement(req, res, next) {
  if (!canManageBusinessUsers(req.user)) {
    return res.status(403).json({ error: "Accès gestion utilisateurs refusé." });
  }
  next();
}`,
'business user management helpers'
);

replaceOnce(
`app.get("/users/:id/permissions", authenticateToken, async (req, res) => {
  try {
    if (!canAccessAdminSettings(req.user)) {
      return res.status(403).json({ error: "Accès refusé : réservé à l’administrateur" });
    }

    const userResult = await pool.query("SELECT id, company_id FROM users WHERE id=$1", [req.params.id]);
    const targetUser = userResult.rows[0];`,
`app.get("/users/:id/permissions", authenticateToken, async (req, res) => {
  try {
    if (!canManageBusinessUsers(req.user)) {
      return res.status(403).json({ error: "Accès gestion permissions refusé." });
    }

    const userResult = await pool.query("SELECT id, company_id, role, is_super_admin FROM users WHERE id=$1", [req.params.id]);
    const targetUser = userResult.rows[0];`,
'GET user permissions direction access'
);

replaceOnce(
`    if (req.user.is_super_admin !== true && Number(targetUser.company_id) !== Number(req.user.company_id)) {
      return res.status(403).json({ error: "Accès refusé : utilisateur hors entreprise" });
    }

    const result = await pool.query(
      \`SELECT up.*, m.module_name, m.description`,
`    if (req.user.is_super_admin !== true && Number(targetUser.company_id) !== Number(req.user.company_id)) {
      return res.status(403).json({ error: "Accès refusé : utilisateur hors entreprise" });
    }
    if (!isSuperAdminUser(req.user) && isSuperAdminUser(targetUser)) {
      return res.status(403).json({ error: "Le compte Super Admin est protégé." });
    }

    const result = await pool.query(
      \`SELECT up.*, m.module_name, m.description`,
'GET permissions protect superadmin'
);

replaceOnce(
`app.put("/users/:id/permissions", authenticateToken, async (req, res) => {
  try {
    if (!canAccessAdminSettings(req.user)) {
      return res.status(403).json({ error: "Accès refusé : réservé à l’administrateur" });
    }

    const { permissions = [] } = req.body;
    const userResult = await pool.query("SELECT id, company_id FROM users WHERE id=$1", [req.params.id]);
    const targetUser = userResult.rows[0];`,
`app.put("/users/:id/permissions", authenticateToken, async (req, res) => {
  try {
    if (!canManageBusinessUsers(req.user)) {
      return res.status(403).json({ error: "Accès gestion permissions refusé." });
    }

    const { permissions = [] } = req.body;
    const userResult = await pool.query("SELECT id, company_id, role, is_super_admin FROM users WHERE id=$1", [req.params.id]);
    const targetUser = userResult.rows[0];`,
'PUT user permissions direction access'
);

replaceOnce(
`    if (req.user.is_super_admin !== true && Number(targetUser.company_id) !== Number(req.user.company_id)) {
      return res.status(403).json({ error: "Accès refusé : utilisateur hors entreprise" });
    }

    const saved = [];

    for (const permission of permissions) {`,
`    if (req.user.is_super_admin !== true && Number(targetUser.company_id) !== Number(req.user.company_id)) {
      return res.status(403).json({ error: "Accès refusé : utilisateur hors entreprise" });
    }
    if (!isSuperAdminUser(req.user) && isSuperAdminUser(targetUser)) {
      return res.status(403).json({ error: "Le compte Super Admin est protégé." });
    }
    if (!isSuperAdminUser(req.user) && Number(req.user.id) === Number(targetUser.id)) {
      return res.status(403).json({ error: "La Direction ne peut pas augmenter ses propres permissions système." });
    }

    const saved = [];

    for (const permission of permissions) {
      if (!isSuperAdminUser(req.user) && isProtectedSystemPermission(permission.module_key)) {
        return res.status(403).json({ error: "Permission système protégée." });
      }`,
'PUT permissions safe delegation'
);

replaceOnce(
`app.post(
  "/users",
  authenticateToken,
  authorizeRoles("admin", "super_admin"),`,
`app.post(
  "/users",
  authenticateToken,
  authorizeBusinessUserManagement,`,
'create user direction authorization'
);

replaceOnce(
`app.put(
  "/users/:id",
  authenticateToken,
  authorizeRoles("admin", "super_admin"),`,
`app.put(
  "/users/:id",
  authenticateToken,
  authorizeBusinessUserManagement,`,
'update user direction authorization'
);

replaceOnce(
`      const requestedRole = normalizeRole(role || "magasinier");

      if (requestedRole === "super_admin" && !isSuperAdmin) {`,
`      const requestedRole = normalizeRole(role || "magasinier");
      const targetBeforeUpdate = await pool.query("SELECT id, role, is_super_admin, company_id FROM users WHERE id=$1", [id]);
      const protectedTarget = targetBeforeUpdate.rows[0];
      if (protectedTarget && !isSuperAdmin && isSuperAdminUser(protectedTarget)) {
        return res.status(403).json({ error: "Le compte Super Admin est protégé." });
      }

      if (requestedRole === "super_admin" && !isSuperAdmin) {`,
'update user protect superadmin'
);

replaceOnce(
`app.post(
  "/users/:id/reset-password",
  authenticateToken,
  authorizeRoles("admin", "super_admin"),
  async (req, res) => {
    try {
      if (!canAccessAdminSettings(req.user)) {
        return res.status(403).json({ error: "Accès administrateur requis." });
      }

      const tempPassword`,
`app.post(
  "/users/:id/reset-password",
  authenticateToken,
  authorizeBusinessUserManagement,
  async (req, res) => {
    try {
      const targetResult = await pool.query("SELECT id, role, is_super_admin, company_id FROM users WHERE id=$1", [req.params.id]);
      const targetUser = targetResult.rows[0];
      if (!targetUser) return res.status(404).json({ error: "Utilisateur introuvable" });
      if (!isSuperAdminUser(req.user) && isSuperAdminUser(targetUser)) {
        return res.status(403).json({ error: "Le compte Super Admin est protégé." });
      }

      const tempPassword`,
'reset password direction authorization'
);

replaceOnce(
`app.delete(
  "/users/:id",
  authenticateToken,
  authorizeRoles("admin", "super_admin"),`,
`app.delete(
  "/users/:id",
  authenticateToken,
  authorizeBusinessUserManagement,`,
'delete user direction authorization'
);

replaceOnce(
`      if (Number(req.user.id) === Number(id)) {
        return res.status(400).json({
          error: "Vous ne pouvez pas supprimer votre propre compte."
        });
      }

      const values = [id];`,
`      if (Number(req.user.id) === Number(id)) {
        return res.status(400).json({
          error: "Vous ne pouvez pas supprimer votre propre compte."
        });
      }
      const targetBeforeDelete = await pool.query("SELECT id, role, is_super_admin, company_id FROM users WHERE id=$1", [id]);
      const protectedTarget = targetBeforeDelete.rows[0];
      if (protectedTarget && !isSuperAdminUser(req.user) && isSuperAdminUser(protectedTarget)) {
        return res.status(403).json({ error: "Le compte Super Admin est protégé." });
      }

      const values = [id];`,
'delete user protect superadmin'
);

fs.writeFileSync(serverPath, source);
console.log('HAFIYA safe direction user management patch applied.');
