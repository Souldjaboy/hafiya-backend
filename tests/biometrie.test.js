"use strict";

/**
 * HAFIYA — biométrie du PERSONNEL et passkeys (simulateurs de test).
 * Spécificités : patients (rôle customer) jamais enrôlables — API ET base ;
 * tablette kiosque en « badge + visage » ; module fermé par défaut.
 */

const crypto = require("crypto");
const { q, appel, jeton, verifier, section, creerSociete, terminer, BASE } = require("./_outils");
const { AuthentificateurLogiciel } = require("./_webauthn");

const PHASE = process.env.PHASE || "avec_cle";
const MODULES = { biometrie: true, pointage: true, pointage_qr: true };
const visage = (identite, extra = {}) => ({ mock_identite: identite, variation: 0.4, ...extra });

async function personne(societe, role, nom) {
  const u = (await q(
    `INSERT INTO users (fullname, email, password, role, company_id, tenant_id, email_verified, phone_verified, badge_qr_token)
     VALUES ($1,$2,'x',$3,$4,'hafiya',TRUE,TRUE,$5) RETURNING id, role, company_id, badge_qr_token`,
    [nom, `${nom.replace(/\W/g, "").toLowerCase()}-${societe.id}@essai.test`, role, societe.id, crypto.randomBytes(24).toString("hex")]))[0];
  return { ...u, token: jeton(u), badge: u.badge_qr_token };
}

async function signer(appareil, secret, corps) {
  const brut = JSON.stringify(corps);
  const ts = String(Date.now());
  const r = await fetch(`${BASE}/biometrics/devices/events`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-tenant-id": "hafiya", "x-biometric-device": String(appareil),
      "x-biometric-timestamp": ts, "x-biometric-signature": crypto.createHmac("sha256", secret).update(`${ts}.`).update(brut).digest("hex") },
    body: brut,
  });
  return { status: r.status, data: await r.json().catch(() => null) };
}

async function main() {
  if (PHASE === "sans_cle") {
    const a = await creerSociete({ nom: "Labo sans clé", modules: MODULES });
    section("SANS BIOMETRIC_ENC_KEY");
    const r = await appel("PUT", "/biometrics/settings", a.token, { face_enabled: true, face_provider: "mock" });
    verifier("activer le visage sans clé : 503", r.status === 503 && r.data?.code === "CLE_BIOMETRIQUE_ABSENTE", JSON.stringify(r.data));
    const d = await appel("POST", "/biometrics/devices", a.token, { name: "K", device_type: "kiosque", serial: "S" });
    verifier("déclarer un appareil sans clé : 503", d.status === 503);
    return terminer();
  }

  const a = await creerSociete({ nom: "Labo A", modules: MODULES });
  const b = await creerSociete({ nom: "Labo B", modules: MODULES });
  const fermee = await creerSociete({ nom: "Labo sans biométrie", modules: { pointage: true } });
  const lab = await personne(a, "laborantin", "Mariam Labo");
  const tech = await personne(a, "laborantin", "Seydou Tech");
  const tablette = await personne(a, "kiosk_pointage", "Tablette Accueil");
  const patient = await personne(a, "customer", "Patient Externe");
  const autre = await personne(b, "laborantin", "Kadia B");

  section("MODULE ET DROITS");
  verifier("société sans module : 403 MODULE_DISABLED", (await appel("GET", "/biometrics/config", fermee.token)).data?.code === "MODULE_DISABLED");
  verifier("laborantin : profils refusés", (await appel("GET", "/biometrics/profiles", lab.token)).status === 403);
  const s = await appel("PUT", "/biometrics/settings", a.token, { face_enabled: true, face_provider: "mock", fingerprint_enabled: true, fingerprint_provider: "terminal" });
  verifier("direction : activation (simulateur visage, terminal empreinte)", s.status === 200, JSON.stringify(s.data));
  const dev = await appel("POST", "/biometrics/devices", a.token, { name: "Tablette accueil", device_type: "kiosque", serial: "TAB-1" });
  const appareil = { device_id: dev.data?.appareil?.id, device_key: dev.data?.secret };
  verifier("appareil déclaré, secret chiffré en base", dev.status === 201
    && (await q(`SELECT secret_encrypted FROM biometric_devices WHERE id = $1`, [appareil.device_id]))[0].secret_encrypted.startsWith("bv1."));

  section("PATIENTS : JAMAIS DE BIOMÉTRIE");
  {
    const c = await appel("POST", "/biometrics/consents", a.token, { subject: { user_id: patient.id }, accepte: true, method: "papier",
      paper_reference: "X", modalities: ["face"], purposes: ["pointage"] });
    verifier("consentement pour un patient : refusé", c.status === 403 && c.data?.code === "PAS_PERSONNEL", JSON.stringify(c.data));
    const e = await appel("POST", "/biometrics/enroll-face", a.token, { subject: { user_id: patient.id }, capture: visage("patient"), ...appareil });
    verifier("enrôlement d'un patient : refusé", e.status === 403 && e.data?.code === "PAS_PERSONNEL");
    const k = await appel("POST", "/biometrics/consents", a.token, { subject: { user_id: tablette.id }, accepte: true, method: "papier",
      paper_reference: "X", modalities: ["face"], purposes: ["pointage"] });
    verifier("le compte tablette n'est pas une personne : refusé", k.status === 403 && k.data?.code === "PAS_PERSONNEL");
    let base = false;
    try {
      await q(`INSERT INTO biometric_consents (company_id, subject_type, user_id, modalities, purposes, text_version, text_hash, method)
               VALUES ($1,'user',$2,'{face}','{pointage}','v1','h','ecran')`, [a.id, patient.id]);
    } catch (err) {
      base = /client ou patient/.test(err.message);
    }
    verifier("insertion SQL directe pour un patient : refusée par le déclencheur", base);
    const pp = (await appel("GET", "/biometrics/people", a.token)).data.personnes || [];
    verifier("la liste du personnel exclut patients et tablette", !pp.some((p) => [patient.id, tablette.id].includes(p.user_id)) && pp.some((p) => p.user_id === lab.id));
  }

  section("CONSENTEMENT, ENRÔLEMENT, VÉRIFICATION 1:1");
  {
    await appel("POST", "/biometrics/consents", lab.token, { accepte: true, modalities: ["face", "fingerprint"], purposes: ["pointage", "action_sensible"] });
    const e = await appel("POST", "/biometrics/enroll-face", a.token, { subject: { user_id: lab.id }, capture: visage("mariam"), ...appareil });
    verifier("visage enrôlé, aucun gabarit renvoyé", e.status === 201 && !JSON.stringify(e.data).includes("bv1."), JSON.stringify(e.data));
    const d = (await appel("POST", "/biometrics/challenges", a.token, { biometric_type: "face", purpose: "pointage", subject: { user_id: lab.id }, ...appareil })).data;
    const ok = await appel("POST", "/biometrics/verify-face", a.token, { subject: { user_id: lab.id }, capture: visage("mariam", { variation: 0.7 }), challenge: d, purpose: "pointage", ...appareil });
    verifier("bonne personne : vérifiée", ok.status === 200 && ok.data?.verified === true, JSON.stringify(ok.data));
    const rejeu = await appel("POST", "/biometrics/verify-face", a.token, { subject: { user_id: lab.id }, capture: visage("mariam"), challenge: d, purpose: "pointage", ...appareil });
    verifier("défi rejoué : refusé", rejeu.status === 409 && rejeu.data?.code === "DEFI_REJOUE");
    const d2 = (await appel("POST", "/biometrics/challenges", a.token, { biometric_type: "face", purpose: "pointage", subject: { user_id: lab.id }, ...appareil })).data;
    const ko = await appel("POST", "/biometrics/verify-face", a.token, { subject: { user_id: lab.id }, capture: visage("imposteur"), challenge: d2, purpose: "pointage", ...appareil });
    verifier("mauvaise identité : refusée", ko.status === 401 && ko.data?.verified === false);
    const inconnu = await appel("POST", "/biometrics/enroll-face", a.token, { subject: { user_id: lab.id }, capture: visage("mariam"), replace: true, device_id: appareil.device_id, device_key: "faux" });
    verifier("appareil inconnu (clé fausse) : refusé", inconnu.status === 403 && inconnu.data?.code === "APPAREIL_INCONNU");
  }

  section("TABLETTE : BADGE + VISAGE");
  {
    const d = (await appel("POST", "/biometrics/challenges", tablette.token, { biometric_type: "face", purpose: "pointage",
      badge: JSON.stringify({ badge_token: lab.badge }), ...appareil })).data;
    verifier("la tablette (pare-feu) obtient un défi lié au badge", d?.subject?.user_id === lab.id, JSON.stringify(d));
    const p = await appel("POST", "/biometrics/attendance", tablette.token, { badge: JSON.stringify({ badge_token: lab.badge }),
      action: "checkin", biometric_type: "face", capture: visage("mariam", { variation: 0.5 }), challenge: d, ...appareil });
    verifier("arrivée pointée par le visage", p.status === 200 && p.data?.success === true, JSON.stringify(p.data));
    const ev = (await q(`SELECT method, device_id, created_by FROM attendance_history WHERE user_id = $1 ORDER BY id DESC LIMIT 1`, [lab.id]))[0];
    verifier("événement VISAGE, tablette tracée", ev?.method === "VISAGE" && ev.device_id === appareil.device_id && ev.created_by === tablette.id);
    const autreProfil = await appel("POST", "/biometrics/enroll-face", tablette.token, { subject: { user_id: tech.id }, capture: visage("x"), ...appareil });
    verifier("la tablette ne peut pas enrôler", autreProfil.status === 403);
  }

  section("TERMINAL D'EMPREINTE SIGNÉ");
  {
    const t = await appel("POST", "/biometrics/devices", a.token, { name: "Terminal", device_type: "terminal_empreinte", serial: "ZK-9", provider: "zkteco" });
    await appel("POST", "/biometrics/consents", a.token, { subject: { user_id: tech.id }, accepte: true, method: "papier", paper_reference: "F-1", modalities: ["fingerprint"], purposes: ["pointage"] });
    const e = await appel("POST", "/biometrics/enroll-fingerprint", a.token, { subject: { user_id: tech.id }, finger_index: 1, external_reference: "T-5",
      device_id: t.data.appareil.id, device_key: t.data.secret });
    verifier("empreinte sur terminal : aucun gabarit serveur", e.status === 201 && e.data?.profil?.has_server_template === false, JSON.stringify(e.data));
    const ok = await signer(t.data.appareil.id, t.data.secret, { events: [{ ref: "h1", type: "fingerprint", reference: "T-5", resultat: "match", score: 0.95, action: "checkin" }] });
    verifier("événement signé : pointage EMPREINTE", ok.data?.resultats?.[0]?.pointage?.statut === "enregistre", JSON.stringify(ok.data));
    const rejeu = await signer(t.data.appareil.id, t.data.secret, { events: [{ ref: "h1", type: "fingerprint", reference: "T-5", resultat: "match", action: "checkin" }] });
    verifier("rejeu : doublon", rejeu.data?.resultats?.[0]?.statut === "doublon");
  }

  section("ISOLATION");
  {
    const e = await appel("POST", "/biometrics/enroll-face", a.token, { subject: { user_id: autre.id }, capture: visage("k"), ...appareil });
    verifier("direction A : personne de B introuvable", e.status === 404);
    await appel("PUT", "/biometrics/settings", b.token, { face_enabled: true, face_provider: "mock" });
    const bA = await appel("POST", "/biometrics/challenges", b.token, { biometric_type: "face", purpose: "pointage", subject: { user_id: autre.id }, ...appareil });
    verifier("direction B : appareil de A refusé", bA.status === 403 && bA.data?.code === "APPAREIL_INCONNU");
  }

  section("PASSKEYS ET VALIDATION RENFORCÉE");
  {
    await q(`UPDATE users SET verification_required = FALSE, account_status = 'active' WHERE id = $1`, [a.admin.id]);
    const cle = new AuthentificateurLogiciel({ origine: process.env.WEBAUTHN_ORIGINS.split(",")[0], rpId: process.env.WEBAUTHN_RP_ID });
    const o = await appel("POST", "/auth/passkeys/register/options", a.token, {});
    verifier("l'appareil affiche HAFIYA, pas le nom d'un autre produit", /HAFIYA/.test(o.data?.rp?.name || "")
      && !/MaliLink/i.test(o.data?.rp?.name || ""), JSON.stringify(o.data?.rp));
    const r = await appel("POST", "/auth/passkeys/register/verify", a.token, { response: cle.creer(o.data), name: "Téléphone Direction" });
    verifier("passkey enregistrée", r.status === 201, JSON.stringify(r.data));
    const lo = await appel("POST", "/auth/passkeys/login/options", null, {});
    const login = await appel("POST", "/auth/passkeys/login/verify", null, { response: cle.obtenir(lo.data) });
    verifier("connexion HAFIYA par passkey (mêmes contrôles que le mot de passe)", login.status === 200 && typeof login.data?.token === "string",
      JSON.stringify(login.data).slice(0, 300));
    const sans = await appel("PUT", "/biometrics/settings", a.token, { require_liveness: true });
    verifier("action sensible sans validation : 403 STEP_UP_REQUIS", sans.status === 403 && sans.data?.code === "STEP_UP_REQUIS");
    const so = await appel("POST", "/auth/step-up/options", a.token, { scope: "biometrie.parametres" });
    const sv = await appel("POST", "/auth/step-up/verify", a.token, { response: cle.obtenir(so.data), scope: "biometrie.parametres" });
    const avec = await appel("PUT", "/biometrics/settings", a.token, { require_liveness: true }, { "x-step-up-token": sv.data?.step_up_token });
    verifier("avec validation renforcée : 200", avec.status === 200);
  }

  section("RÉVOCATION");
  {
    const st = await appel("GET", "/biometrics/status", lab.token);
    const f = st.data.profils.find((p) => p.status === "actif" && p.biometric_type === "face");
    const r = await appel("POST", "/biometrics/revoke", lab.token, { profile_id: f.id });
    verifier("la personne révoque son visage : gabarit effacé", r.status === 200
      && (await q(`SELECT template_encrypted FROM biometric_profiles WHERE id = $1`, [f.id]))[0].template_encrypted === null);
  }

  await terminer();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
