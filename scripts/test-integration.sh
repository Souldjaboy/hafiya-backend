#!/usr/bin/env bash
# Test d'intégration HAFIYA sur une base NEUVE et un vrai serveur.
#   scripts/test-integration.sh tests/pointage-securise.test.js
#
# HAFIYA n'a pas de lanceur de migrations : les fichiers SQL s'appliquent
# dans l'ordre (sql/*.sql puis *.sql à la racine), comme en production.
# Quelques fichiers échouent sur une base vierge pour des raisons propres à
# la production (rôle triangle_user, compte Direction attendu par son id) :
# ils sont appliqués en mode tolérant et listés.
#
# Le serveur tourne sur une COPIE temporaire du backend, à laquelle le patch
# kiosque de production (apply-hafiya-kiosk-patch.js) est appliqué : on teste
# exactement ce qui tournera sur le VPS, sans jamais modifier le dépôt.
set -uo pipefail
cd "$(dirname "$0")/.."
TEST="${1:?fichier de test attendu}"
export PATH="/Applications/Docker.app/Contents/Resources/bin:$PATH"
BASE_NOM="hafiya_$(basename "$TEST" .test.js | tr '-' '_')"
export PORT="${PORT:-5089}"
export JWT_SECRET="${JWT_SECRET:-secret-de-test-hafiya-2026}"
export DATABASE_URL="postgresql://postgres:malilink_test_password@127.0.0.1:5434/${BASE_NOM}"
export NODE_ENV=test
export TZ="${TZ:-Europe/Paris}"
docker exec malilink-postgres-test psql -U postgres -qc "DROP DATABASE IF EXISTS ${BASE_NOM};" >/dev/null 2>&1
docker exec malilink-postgres-test psql -U postgres -qc "CREATE DATABASE ${BASE_NOM};" >/dev/null
JOURNAL="/tmp/${BASE_NOM}-migrations.log"; : > "$JOURNAL"
for f in $(ls sql/*.sql | sort) $(ls *.sql | sort); do
  docker exec -i malilink-postgres-test psql -U postgres -d "$BASE_NOM" -v ON_ERROR_STOP=1 -q < "$f" >>"$JOURNAL" 2>&1 \
    || { docker exec -i malilink-postgres-test psql -U postgres -d "$BASE_NOM" -q < "$f" >>"$JOURNAL" 2>&1; echo "  (SQL toléré : $f)" >>"$JOURNAL"; }
done
COPIE="$(mktemp -d)/hafiya-backend"
mkdir -p "$COPIE" && rsync -a --exclude node_modules --exclude .git ./ "$COPIE/" && ln -s "$PWD/node_modules" "$COPIE/node_modules"
(cd "$COPIE" && node apply-hafiya-kiosk-patch.js >/dev/null)
(cd "$COPIE" && exec node server.js >"/tmp/${BASE_NOM}-serveur.log" 2>&1) &
SERVEUR=$!
trap 'kill $SERVEUR 2>/dev/null; rm -rf "$(dirname "$COPIE")"' EXIT
for _ in $(seq 1 60); do curl -s -o /dev/null "http://127.0.0.1:${PORT}/" && break; sleep 1; done
node "$TEST"
