"use strict";

/**
 * HAFIYA — régression de la faille /attendance/scan (audit du 2026-10-02)
 * et kiosque : jeton de badge aléatoire, société imposée, réponse minimale,
 * anti-rebond, ancien code HAFIYA-EMP-<id> refusé pour pointer.
 */

const crypto = require("crypto");
const { q, appel, jeton, verifier, section, creerSociete, terminer } = require("./_outils");

const MODULES = { pointage: true, pointage_qr: true, badges: true };
const nouveauJeton = () => crypto.randomBytes(24).toString("hex");

async function employe(societe, role, nom) {
  const u = (await q(
    `INSERT INTO users (fullname, email, password, role, company_id, tenant_id, daily_rate, hourly_rate, badge_qr_token)
     VALUES ($1,$2,'$2b$12$HASHSECRETDETEST000000000000000000000000000000000000000',$3,$4,'hafiya',9999,1234,$5)
     RETURNING id, role, company_id`,
    [nom, `${nom.replace(/\W/g, "").toLowerCase()}-${societe.id}@essai.test`, role, societe.id, nouveauJeton()]))[0];
  await q(`UPDATE users SET badge_code = $1 WHERE id = $2`, [`HAFIYA-EMP-${u.id}`, u.id]);
  const jb = (await q(`SELECT badge_qr_token FROM users WHERE id = $1`, [u.id]))[0].badge_qr_token;
  return { ...u, token: jeton(u), badge: jb, code: `HAFIYA-EMP-${u.id}` };
}

const scan = (token, badge, action = "checkin", extra = {}) =>
  appel("POST", "/attendance/scan", token, { badge_code: badge, action_type: action, ...extra });
const kiosque = (token, corps) => appel("POST", "/hafiya/kiosk/scan", token, corps);

function fuite(corps) {
  const t = JSON.stringify(corps || {});
  if (t.includes("$2b$")) return "hash";
  return ["\"password\"", "\"daily_rate\"", "\"hourly_rate\"", "\"email\"", "\"badge_qr_token\""].filter((c) => t.includes(c)).join(",");
}

async function main() {
  const a = await creerSociete({ nom: "Labo A", modules: MODULES });
  const b = await creerSociete({ nom: "Labo B", modules: MODULES });
  const tech = await employe(a, "laborantin", "Mariam Tech");
  const collegue = await employe(a, "laborantin", "Ousmane Collegue");
  const tablette = await employe(a, "kiosk_pointage", "Tablette Accueil");
  const autreB = await employe(b, "laborantin", "Kadia Autre");
  const patient = await employe(a, "customer", "Patient Client");

  section("SANS AUTHENTIFICATION");
  {
    const r = await scan(null, tech.code);
    verifier("scan sans jeton : 401", r.status === 401 && !fuite(r.data), `statut ${r.status}`);
    const r2 = await appel("PUT", `/attendance/assign-user/${tech.id}`, null, { daily_rate: 1 });
    verifier("affectation sans jeton : 401 (publique avant)", r2.status === 401);
    verifier("… taux inchangé", Number((await q(`SELECT daily_rate FROM users WHERE id = $1`, [tech.id]))[0].daily_rate) === 9999);
  }

  section("CODES PRÉVISIBLES, AUTRES SOCIÉTÉS");
  {
    const r = await scan(a.token, tech.code);
    verifier("ancien code HAFIYA-EMP deviné : refusé (ancien format)", r.status === 409 && r.data?.code === "BADGE_OBSOLETE", JSON.stringify(r.data));
    const rb = await scan(a.token, autreB.badge);
    const inconnu = await scan(a.token, nouveauJeton());
    verifier("jeton d'une autre société = badge inconnu, même message", rb.status === 404 && rb.data?.error === inconnu.data?.error);
    verifier("aucun pointage écrit pour B", (await q(`SELECT count(*)::int AS n FROM attendance_history WHERE user_id = $1`, [autreB.id]))[0].n === 0);
  }

  section("SCAN VALIDE, RÉPONSE MINIMALE, POUR AUTRUI");
  {
    const r = await scan(tech.token, JSON.stringify({ badge_token: tech.badge }));
    verifier("le laborantin pointe pour lui-même : 200", r.status === 200 && r.data?.success === true, JSON.stringify(r.data));
    verifier("aucune donnée sensible renvoyée", !fuite(r.data), fuite(r.data));
    const autrui = await scan(tech.token, collegue.badge);
    verifier("pointer un collègue : 403", autrui.status === 403 && autrui.data?.code === "POINTAGE_POUR_AUTRUI");
    const t = await scan(tablette.token, collegue.badge);
    verifier("compte tablette : cantonné aux routes du kiosque (pare-feu de production)", t.status === 403
      && /limité au pointage/.test(t.data?.error || ""), JSON.stringify(t.data));
    const d = await scan(a.token, collegue.badge);
    verifier("direction : autorisée pour un collègue", d.status === 200, JSON.stringify(d.data));
    const sec = await employe(a, "secretaire", "Awa Secretariat");
    await q(`INSERT INTO user_permissions (user_id, module_key, can_view, can_validate) VALUES ($1, 'pointage_qr', TRUE, TRUE)`, [sec.id]);
    const s2 = await scan(sec.token, (await employe(a, "laborantin", "Issa Trois")).badge);
    verifier("droit explicite « Valider » sur pointage_qr : autorisé", s2.status === 200, JSON.stringify(s2.data));
    const p = await scan(a.token, patient.badge);
    verifier("un compte patient ne pointe jamais", p.status === 403 && p.data?.code === "PAS_PERSONNEL", JSON.stringify(p.data));
  }

  section("KIOSQUE (ROUTES PATCHÉES DE PRODUCTION)");
  {
    const k = await employe(a, "laborantin", "Bintou Kiosque");
    const ancien = await kiosque(tablette.token, { badge_code: JSON.stringify({ badge_code: k.code }) });
    verifier("QR ancien format au kiosque : refusé pour pointer", ancien.status === 409 && ancien.data?.code === "BADGE_OBSOLETE", JSON.stringify(ancien.data));
    const arr = await kiosque(tablette.token, { badge_code: JSON.stringify({ badge_token: k.badge, badge_code: k.code }) });
    verifier("1er scan : arrivée", arr.status === 200 && arr.data?.action === "ARRIVEE" && arr.data?.attendance?.check_in, JSON.stringify(arr.data).slice(0, 300));
    const vite = await kiosque(tablette.token, { badge_code: JSON.stringify({ badge_token: k.badge }) });
    verifier("double scan immédiat : déjà enregistré, PAS de départ", vite.status === 200 && vite.data?.statut === "deja_enregistre"
      && !vite.data?.attendance?.check_out, JSON.stringify(vite.data).slice(0, 300));
    await q(`UPDATE attendance_history SET created_at = created_at - interval '1 minute' WHERE user_id = $1`, [k.id]);
    const dep = await kiosque(tablette.token, { badge_code: JSON.stringify({ badge_token: k.badge }) });
    verifier("2e scan (plus tard) : départ", dep.status === 200 && dep.data?.action === "DEBAUCHE" && dep.data?.attendance?.check_out);
    const evs = await q(`SELECT method, created_by FROM attendance_history WHERE user_id = $1 ORDER BY id`, [k.id]);
    verifier("moteur commun : 2 événements QR, tablette tracée", evs.length === 2 && evs.every((e) => e.method === "QR" && e.created_by === tablette.id));
    const audit = (await q(`SELECT count(*)::int AS n FROM hafiya_kiosk_audit WHERE user_id = $1`, [k.id]))[0].n;
    verifier("journal du kiosque conservé", audit === 2);
    const autre = await kiosque(tablette.token, { badge_code: JSON.stringify({ badge_token: autreB.badge }) });
    verifier("badge d'une autre société au kiosque : inconnu", autre.status === 404);
    const ident = await appel("POST", "/hafiya/kiosk/identify", tablette.token, { badge_code: JSON.stringify({ badge_code: k.code }) });
    verifier("identifier (sans pointer) reste possible avec l'ancien QR", ident.status === 200, JSON.stringify(ident.data).slice(0, 200));
  }

  section("JETON DE BADGE : DIRECTION SEULEMENT");
  {
    const dir = await appel("GET", "/users", a.token);
    verifier("la direction reçoit le jeton du QR (impression des badges)", dir.status === 200
      && dir.data.some((u) => u.id === tech.id && u.badge_qr_token === tech.badge));
    const lab = await appel("GET", "/users", tech.token);
    verifier("un laborantin ne le reçoit pas", lab.status !== 200 || lab.data.every((u) => u.badge_qr_token === undefined), `statut ${lab.status}`);
  }

  section("MANUEL, AFFECTATION, JOURNAL, DÉBIT");
  {
    const m = await employe(a, "laborantin", "Fatou Manuel");
    const self = await appel("POST", "/attendance/check", m.token, { user_id: m.id, action_type: "ARRIVEE" });
    verifier("pointage manuel pour soi : 200", self.status === 200, JSON.stringify(self.data));
    const autre = await appel("POST", "/attendance/check", m.token, { user_id: collegue.id, action_type: "DEBAUCHE" });
    verifier("pointage manuel d'un collègue : 403", autre.status === 403);
    const aB = await appel("PUT", `/attendance/assign-user/${autreB.id}`, a.token, { daily_rate: 1 });
    verifier("direction A ne modifie pas un employé de B : 404", aB.status === 404);
    const journal = await q(`SELECT accepted, refusal_code, token_hint FROM attendance_scan_log WHERE company_id = $1`, [a.id]);
    verifier("refus journalisés, jeton jamais conservé", journal.some((l) => l.refusal_code === "BADGE_OBSOLETE") && journal.every((l) => l.token_hint.length <= 5));
    const salve = await Promise.all(Array.from({ length: 130 }, () => scan(collegue.token, nouveauJeton())));
    verifier("au-delà de 120 lectures / minute : 429", salve.some((x) => x.status === 429));
  }

  await terminer();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
