"use strict";

const fs = require("fs");

function patchFile(path, transform) {
  const original = fs.readFileSync(path, "utf8");
  const next = transform(original);
  if (next === original) {
    console.log(`${path}: déjà à jour`);
    return;
  }
  fs.writeFileSync(`${path}.before-kiosk-v1`, original);
  fs.writeFileSync(path, next);
  console.log(`${path}: PATCH_OK`);
}

patchFile("server.js", (s) => {
  if (s.includes('require("./hafiya-kiosk-firewall")')) return s;
  const anchor = "app.use(requireTenant);";
  if (!s.includes(anchor)) throw new Error("server.js: ancre requireTenant introuvable");
  return s.replace(anchor, `${anchor}\n\n// Compte tablette HAFIYA : bloque tout accès hors kiosque.\napp.use(require(\"./hafiya-kiosk-firewall\"));`);
});

patchFile("hafiya-extra-routes.js", (s) => {
  if (s.includes('require("./hafiya-kiosk-routes")')) return s;
  const anchor = '  require("./hafiya-attendance-payroll-v2-routes")(app, pool, authenticateToken);';
  if (!s.includes(anchor)) throw new Error("hafiya-extra-routes.js: ancre V2 introuvable");
  return s.replace(anchor, `  require(\"./hafiya-kiosk-routes\")(app, pool, authenticateToken);\n${anchor}`);
});

console.log("HAFIYA_KIOSK_PATCH=OK");
