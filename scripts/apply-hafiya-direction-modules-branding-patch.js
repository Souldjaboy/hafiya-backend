const fs = require('fs');
const path = require('path');

const serverPath = path.join(__dirname, '..', 'server.js');
let source = fs.readFileSync(serverPath, 'utf8');

function replaceOnce(before, after, label) {
  if (!source.includes(before)) throw new Error(`Patch HAFIYA introuvable: ${label}`);
  source = source.replace(before, after);
}

replaceOnce(
`app.get("/modules", authenticateToken, async (req, res) => {
  try {
    if (!canAccessAdminSettings(req.user)) {
      return res.status(403).json({ error: "Accès refusé : réservé à l’administrateur" });
    }`,
`app.get("/modules", authenticateToken, async (req, res) => {
  try {
    if (!canManageBusinessUsers(req.user)) {
      return res.status(403).json({ error: "Accès lecture modules refusé." });
    }`,
'modules direction access'
);

replaceOnce(
'const badgeCode = `TRIANGLE-EMP-${user.id}`;',
'const badgeCode = `HAFIYA-EMP-${user.id}`;',
'HAFIYA employee badge prefix'
);

replaceOnce(
'const tempPassword = `Triangle-${crypto.randomBytes(4).toString("hex")}-2026`;',
'const tempPassword = `HAFIYA-${crypto.randomBytes(4).toString("hex")}-2026`;',
'HAFIYA temporary password prefix'
);

fs.writeFileSync(serverPath, source);
console.log('HAFIYA direction modules and branding patch applied.');
