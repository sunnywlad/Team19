#!/usr/bin/env bash
# Vérifie dashboard/ : lint de sécurité, types, tests (vitest), puis build et
# contrôle du bundle (aucun secret, aucune ressource externe, CSP en place).
# Dépendances figées par dashboard/package-lock.json, installées par « npm ci ».
# Compatible bash 3.2, comme scripts/.
set -euo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$DIR"

for tool in node npm; do
  if ! command -v "$tool" >/dev/null 2>&1; then
    echo "dashboard : $tool introuvable, contrôle impossible" >&2
    exit 1
  fi
done

# Installation absente ou plus ancienne que le lockfile : réinstallation à
# l'identique, sans exécuter aucun script d'installation tiers.
if [ ! -f node_modules/.package-lock.json ] ||
  [ package-lock.json -nt node_modules/.package-lock.json ]; then
  npm ci --ignore-scripts --no-fund --no-audit < /dev/null
fi

echo "==> dashboard : lint de sécurité"
npm run --silent lint
echo "==> dashboard : types"
npm run --silent typecheck
echo "==> dashboard : tests"
npm test --silent

# Build avec des valeurs témoins dans l'environnement du proxy : aucune ne doit
# se retrouver dans ce qui part au navigateur.
echo "==> dashboard : build et contrôle du bundle"
CANARY_TOKEN="temoin-jeton-ne-doit-pas-sortir"
CANARY_HOST="temoin-hote-interne.invalid"
CANARY_MODE="temoin-mode-du-coffre"
RESPONSE_API_TOKEN="$CANARY_TOKEN" RESPONSE_API_URL="http://$CANARY_HOST:9000" \
  RELAY_API_URL="http://$CANARY_HOST:8787" RELAY_VAULT_MODE="$CANARY_MODE" npm run --silent build > /dev/null

fail() {
  echo "ECHEC dashboard : $*" >&2
  exit 1
}
if grep -rqF -e "$CANARY_TOKEN" -e "$CANARY_HOST" -e "$CANARY_MODE" dist; then
  fail "une valeur d'environnement du proxy est dans le bundle"
fi
grep -q 'http-equiv="Content-Security-Policy"' dist/index.html || fail "CSP absente de dist/index.html"
if grep -q "unsafe-inline\|unsafe-eval" dist/index.html; then fail "CSP affaiblie"; fi
# Aucune ressource chargée ailleurs que sur l'origine de la page.
if grep -Eq '(src|href)="(https?:)?//' dist/index.html; then fail "ressource externe dans dist/index.html"; fi
if grep -rEq '@import|url\((["'"'"']?)(https?:)?//' dist/assets/*.css; then fail "ressource externe dans la feuille de style"; fi
if grep -rEq 'new Function\(|[^a-zA-Z_.]eval\(' dist/assets/*.js; then fail "évaluation de code dans le bundle"; fi
echo "dashboard : OK"
