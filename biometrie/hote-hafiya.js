"use strict";

/**
 * ADAPTATEUR HAFIYA du noyau biométrique.
 *
 * Ce que HAFIYA décide pour le noyau :
 *   • les droits : direction (admin, admin_entreprise, direction, directeur)
 *     = tout ; compte kiosque (kiosk_pointage) = vérifier et pointer ;
 *     sinon un droit EXPLICITE dans user_permissions (module_key =
 *     « biometrie.enroler »…) ; par défaut, rien ;
 *   • le personnel : un compte `users` actif de LA société qui n'est NI un
 *     patient / client (rôle customer), NI un compte kiosque, NI le
 *     super-admin. Les fiches patients du laboratoire ne sont jamais des
 *     sujets biométriques ;
 *   • le pointage : services/pointage-engine (même moteur que le kiosque).
 */

const { BiometrieError } = require("./core/erreurs");

const DIRECTION = new Set(["admin", "admin_entreprise", "direction", "directeur"]);
const NON_SUJETS = new Set(["customer", "client", "patient", "kiosk_pointage", "super_admin"]);
const DROITS_KIOSQUE = new Set(["pointage.biometrie", "biometrie.verifier"]);
const LECTURE = new Set(["biometrie.voir", "biometrie.audit"]);

function jetonBadge(valeur) {
  const brut = String(valeur || "").trim();
  try {
    const objet = JSON.parse(brut);
    if (objet && typeof objet === "object") return String(objet.badge_token || "").trim();
  } catch { /* texte brut */ }
  return brut.slice(0, 160);
}

module.exports = function creerHoteHafiya(d) {
  const { pool, authenticateToken, getEffectiveCompanyId, isSuperAdminUser, normalizeRole, pointageEngine,
    finaliserConnexionParId, logAudit } = d;

  async function verifierPersonnel(db, companyId, sujet) {
    if (!sujet || sujet.type !== "user") {
      throw new BiometrieError("HAFIYA : la biométrie vise un compte du personnel.", "SUJET_INVALIDE", 400);
    }
    const { rows } = await (db || pool).query(
      `SELECT id, fullname, role, COALESCE(is_active, TRUE) AS actif FROM users WHERE id = $1 AND company_id = $2`,
      [Number(sujet.userId), Number(companyId)]);
    const u = rows[0];
    if (!u) throw new BiometrieError("Personne introuvable dans cette entreprise.", "PERSONNE_INTROUVABLE", 404);
    if (NON_SUJETS.has(String(u.role || "").toLowerCase())) {
      throw new BiometrieError("Un compte patient, client ou kiosque ne peut pas recevoir de donnée biométrique.",
        "PAS_PERSONNEL", 403);
    }
    if (!u.actif) throw new BiometrieError("Compte désactivé.", "PERSONNE_INACTIVE", 403);
    return { type: "user", userId: u.id, employeeId: null, nom: u.fullname };
  }

  return {
    pool,
    authenticateToken,
    societe: (req) => getEffectiveCompanyId(req) || req.user?.company_id || null,
    tenant: () => "hafiya",
    estSuperAdmin: (req) => isSuperAdminUser(req.user),

    async autoriser(req, permission) {
      if (isSuperAdminUser(req.user)) return true;
      const role = normalizeRole(req.user?.role);
      if (DIRECTION.has(role)) return true;
      if (role === "kiosk_pointage") return DROITS_KIOSQUE.has(permission);
      const { rows } = await pool.query(
        `SELECT can_view, can_create, can_validate FROM user_permissions WHERE user_id = $1 AND module_key = $2 LIMIT 1`,
        [req.user.id, permission]);
      const p = rows[0];
      if (!p) return false;
      return LECTURE.has(permission) ? p.can_view === true : (p.can_create === true || p.can_validate === true);
    },

    async sujetDeLaRequete(req, source) {
      const type = String(source.subject_type || source.type || "user");
      if (type !== "user") throw new BiometrieError("HAFIYA : la biométrie vise un compte du personnel.", "SUJET_INVALIDE", 400);
      const id = Number(source.user_id || source.userId || req.user.id);
      if (!Number.isInteger(id) || id <= 0) throw new BiometrieError("Personne invalide.", "SUJET_INVALIDE", 400);
      return { type: "user", userId: id };
    },

    /** Badge HAFIYA (jeton aléatoire users.badge_qr_token) → personne de LA société. */
    async sujetDepuisBadge(companyId, badge) {
      const jeton = jetonBadge(badge);
      if (!jeton) return null;
      const { rows } = await pool.query(
        `SELECT id FROM users WHERE badge_qr_token = $1 AND company_id = $2 AND COALESCE(is_active, TRUE) = TRUE LIMIT 1`,
        [jeton, companyId]);
      return rows[0] ? { type: "user", userId: rows[0].id } : null;
    },

    verifierPersonnel,

    async listerPersonnel(companyId) {
      const { rows } = await pool.query(
        `SELECT id, fullname, role FROM users
          WHERE company_id = $1 AND COALESCE(is_active, TRUE) = TRUE
            AND lower(COALESCE(role, '')) NOT IN ('customer', 'client', 'patient', 'kiosk_pointage', 'super_admin')
          ORDER BY fullname LIMIT 1000`, [companyId]);
      return rows.map((u) => ({ type: "user", userId: u.id, employeeId: null, nom: u.fullname, role: u.role }));
    },

    async nomsSujets(companyId, sujets) {
      const ids = [...new Set(sujets.filter((s) => s.type === "user" && s.userId).map((s) => Number(s.userId)))];
      if (!ids.length) return new Map();
      const { rows } = await pool.query(`SELECT id, fullname FROM users WHERE company_id = $1 AND id = ANY($2)`, [companyId, ids]);
      return new Map(rows.map((u) => [`user:${u.id}`, u.fullname]));
    },

    async enregistrerPointage(o) {
      try {
        return await pointageEngine.enregistrerPointage(pool, {
          companyId: o.companyId, userId: o.sujet.userId, action: o.action, methode: o.methode,
          tenantId: "hafiya", deviceId: o.deviceId, site: o.siteId ? { id: o.siteId, name: "" } : null,
          confidence: o.confidence, createdBy: o.createdBy, metadata: o.metadata,
        });
      } catch (e) {
        if (e instanceof pointageEngine.PointageError) throw new BiometrieError(e.message, e.code, e.httpStatus);
        throw e;
      }
    },

    async utilisateurCourant(req) {
      const { rows } = await pool.query(`SELECT id, email, fullname, company_id FROM users WHERE id = $1`, [req.user.id]);
      if (!rows[0]) throw new BiometrieError("Compte introuvable.", "COMPTE_INTROUVABLE", 404);
      return rows[0];
    },

    finaliserConnexion: (req, res, userId, methode) => finaliserConnexionParId(req, res, userId, methode),

    async journalAudit(req, action, details) {
      try {
        await logAudit(req, action, "biometrie", req.user?.id || null, details || {});
      } catch (e) {
        console.error("audit biométrie :", e.message);
      }
    },
  };
};
