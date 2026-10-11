#!/usr/bin/env bash
# Valide les exemples de specs/examples contre les schémas de specs/schemas.
# ajv est épinglé par specs/package-lock.json et installé par « npm ci ».
# Compatible bash 3.2, comme scripts/.
set -euo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$DIR"

for tool in node npm; do
  if ! command -v "$tool" >/dev/null 2>&1; then
    echo "specs : $tool introuvable, contrôle impossible" >&2
    exit 1
  fi
done

# Installation absente ou plus ancienne que le lockfile : on réinstalle à
# l'identique, sans exécuter aucun script d'installation tiers.
if [ ! -f node_modules/.package-lock.json ] ||
  [ package-lock.json -nt node_modules/.package-lock.json ]; then
  npm ci --ignore-scripts --no-fund --no-audit < /dev/null
fi

node tools/validate.js
