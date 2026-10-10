#!/usr/bin/env bash
# Contrôle des contrats : forge test, puis slither bloquant sur gravité haute.
# Sans aucun .sol dans contracts/ (hors dépendances), réussit sans rien faire.
# Usage : scripts/check-contracts.sh [--detect]
#   --detect : sort en 0 s'il y a des sources à analyser, en 1 sinon.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

has_sources() {
  [ -d contracts ] || return 1
  [ -n "$(find contracts -type f -name '*.sol' \
    -not -path '*/lib/*' -not -path '*/node_modules/*' \
    -not -path '*/out/*' -not -path '*/cache/*' -print -quit)" ]
}

if [ "${1:-}" = "--detect" ]; then
  has_sources
  exit $?
fi

if ! has_sources; then
  echo "contrat : rien à analyser"
  exit 0
fi

for tool in forge slither; do
  if ! command -v "$tool" >/dev/null 2>&1; then
    echo "contrat : $tool introuvable, contrôle impossible" >&2
    exit 1
  fi
done

cd contracts
echo "==> forge test"
forge test
echo "==> slither (bloquant sur gravité haute)"
slither . --fail-high --filter-paths '(^|/)(lib|node_modules)/'
