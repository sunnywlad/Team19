#!/usr/bin/env bash
# Contrôle des contrats : forge test, puis slither bloquant sur gravité haute.
# Le projet Foundry est à la racine du dépôt (foundry.toml, sources dans src/).
# Un projet Foundry sans aucune source est une erreur : le contrôle échoue
# plutôt que de passer sans rien avoir regardé.
# Usage : scripts/check-contracts.sh [--detect]
#   --detect : sort en 0 s'il y a un projet Foundry à contrôler, en 1 sinon.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

has_project() { [ -f foundry.toml ]; }
has_sources() {
  [ -d src ] && [ -n "$(find src -type f -name '*.sol' -print -quit)" ]
}

if [ "${1:-}" = "--detect" ]; then
  has_project
  exit $?
fi

if ! has_project; then
  echo "contrat : pas de projet Foundry (foundry.toml absent), rien à analyser"
  exit 0
fi
if ! has_sources; then
  echo "contrat : foundry.toml présent mais aucun .sol dans src/, contrôle impossible" >&2
  exit 1
fi
if [ ! -f lib/forge-std/src/Test.sol ]; then
  echo "contrat : lib/forge-std absent (git submodule update --init --recursive)" >&2
  exit 1
fi

for tool in forge slither; do
  if ! command -v "$tool" >/dev/null 2>&1; then
    echo "contrat : $tool introuvable, contrôle impossible" >&2
    exit 1
  fi
done

echo "==> forge test"
forge test
echo "==> slither (bloquant sur gravité haute)"
# Seuls src/ est jugé : dépendances, tests, scripts de déploiement et doublures
# des autres dossiers sont écartés.
slither . --fail-high \
  --filter-paths '(^|/)(lib|node_modules|test|script|offchain|relay)/'
