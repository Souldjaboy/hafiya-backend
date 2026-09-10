"use strict";

const jwt = require("jsonwebtoken");

const ALLOWED_PREFIXES = [
  "/hafiya/kiosk/",
  "/auth/",
  "/login",
  "/me",
  "/health",
  "/uploads/"
];

module.exports = function hafiyaKioskFirewall(req, res, next) {
  try {
    const auth = String(req.headers?.authorization || "");
    const token = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
    if (!token) return next();

    const secret = process.env.JWT_SECRET || "triangle_wms_secret_key";
    const payload = jwt.verify(token, secret);
    const role = String(payload?.role || "").trim().toLowerCase();
    if (role !== "kiosk_pointage") return next();

    const tenant = String(req.tenant_id || payload?.tenant_id || "").trim().toLowerCase();
    if (tenant && tenant !== "hafiya") {
      return res.status(403).json({ error: "Compte kiosque réservé à HAFIYA." });
    }

    const path = String(req.path || req.url || "");
    if (ALLOWED_PREFIXES.some((prefix) => path === prefix || path.startsWith(prefix))) {
      return next();
    }

    return res.status(403).json({
      error: "Compte tablette limité au pointage et aux tâches HAFIYA."
    });
  } catch {
    return next();
  }
};
