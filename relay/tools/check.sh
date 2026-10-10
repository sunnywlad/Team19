#!/usr/bin/env bash
# Vérifie relay/ : types, puis tests (node:test). Dépendances figées par
# relay/package-lock.json, installées par « npm ci ». Le test sur chaîne locale
# s'ignore de lui-même si anvil ou forge sont absents.
# Compatible bash 3.2, comme scripts/.
set -euo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$DIR"

for tool in node npm; do
  if ! command -v "$tool" >/dev/null 2>&1; then
    echo "relay : $tool introuvable, contrôle impossible" >&2
    exit 1
  fi
done

# Installation absente ou plus ancienne que le lockfile : réinstallation à
# l'identique, sans exécuter aucun script d'installation tiers.
if [ ! -f node_modules/.package-lock.json ] ||
  [ package-lock.json -nt node_modules/.package-lock.json ]; then
  npm ci --ignore-scripts --no-fund --no-audit < /dev/null
fi

echo "==> relay : types"
npm run --silent typecheck
echo "==> relay : tests"
npm test --silent
