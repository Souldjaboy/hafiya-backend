#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")"

echo "== HAFIYA KIOSK: syntax checks =="
node --check hafiya-kiosk-firewall.js
node --check hafiya-kiosk-routes.js
node --check hafiya-task-management-routes.js
node --check create-hafiya-kiosk-user.js
node --check apply-hafiya-kiosk-patch.js
node --check apply-hafiya-payroll-hardening.js

echo "== HAFIYA KIOSK: patch mounts/firewall =="
node apply-hafiya-kiosk-patch.js
node --check server.js
node --check hafiya-extra-routes.js

echo "== HAFIYA KIOSK: database schema =="
if [[ -z "${DATABASE_URL:-}" ]]; then
  echo "DATABASE_URL absent. Charge le .env avant ce script." >&2
  exit 1
fi
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f hafiya-kiosk-v1.sql

echo "== HAFIYA PAYROLL: combined INPS + AMO field =="
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f hafiya-payroll-contributions-v1.sql
node apply-hafiya-payroll-hardening.js
node --check hafiya-attendance-payroll-v2-routes.js

echo "HAFIYA_PREPARATION_OK"
echo "Aucun processus PM2 n'a été redémarré par ce script."
echo "Crée ensuite le compte kiosque avec KIOSK_PASSWORD défini de façon interactive."
