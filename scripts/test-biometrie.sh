#!/usr/bin/env bash
# Biométrie + passkeys HAFIYA : avec clé, puis sans clé (serveur relancé).
set -uo pipefail
cd "$(dirname "$0")/.."
# WEBAUTHN_RP_NAME volontairement absent : la suite vérifie le nom par défaut (HAFIYA).
export BIOMETRIC_ALLOW_MOCK=1 WEBAUTHN_RP_ID=localhost WEBAUTHN_ORIGINS=http://localhost:3001
unset WEBAUTHN_RP_NAME
echo "═══ Phase 1 : avec BIOMETRIC_ENC_KEY"
BIOMETRIC_ENC_KEY="$(openssl rand -hex 32)" PHASE=avec_cle bash scripts/test-integration.sh tests/biometrie.test.js; c1=$?
echo "═══ Phase 2 : sans BIOMETRIC_ENC_KEY"
env -u BIOMETRIC_ENC_KEY -u BIOMETRIC_ENC_KEYS PHASE=sans_cle bash scripts/test-integration.sh tests/biometrie.test.js; c2=$?
exit $(( c1 || c2 ))
