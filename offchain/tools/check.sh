#!/usr/bin/env bash
# Vérifie offchain/ : tests (node:test). Dépendances figées par
# offchain/package-lock.json, installées par « npm ci ». Les tests d'intégration
# lancent anvil et forge : pris dans le PATH, ou dans FORGE, ANVIL et CAST.
# Compatible bash 3.2, comme scripts/.
set -euo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$DIR"

for tool in node npm "${FORGE:-forge}" "${ANVIL:-anvil}" "${CAST:-cast}"; do
  if ! command -v "$tool" >/dev/null 2>&1; then
    echo "offchain : $tool introuvable, contrôle impossible" >&2
    exit 1
  fi
done

# Installation absente ou plus ancienne que le lockfile : réinstallation à
# l'identique, sans exécuter aucun script d'installation tiers.
if [ ! -f node_modules/.package-lock.json ] ||
  [ package-lock.json -nt node_modules/.package-lock.json ]; then
  npm ci --ignore-scripts --no-fund --no-audit < /dev/null
fi

echo "==> offchain : tests"
npm test --silent
