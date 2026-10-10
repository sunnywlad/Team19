#!/usr/bin/env bash
# Analyse statique semgrep, informative (la CI ne bloque pas dessus).
# Les règles viennent du dépôt GitHub semgrep/semgrep-rules à un commit figé :
# aucun appel au registre semgrep.dev, aucune télémétrie (--metrics=off).
set -euo pipefail

SEMGREP_RULES_SHA="5a8a6beafb1a848591f44bdddcb51584474493c4" # branche release
RULESETS=(solidity javascript typescript python bash dockerfile yaml/github-actions generic/secrets)

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

if ! command -v semgrep >/dev/null 2>&1; then
  echo "semgrep : introuvable (pip install semgrep==<version de ci.yml>)" >&2
  exit 1
fi

RULES="$ROOT/.tools/semgrep-rules"
if [ "$(git -C "$RULES" rev-parse HEAD 2>/dev/null || true)" != "$SEMGREP_RULES_SHA" ]; then
  rm -rf "$RULES"
  mkdir -p "$RULES"
  git -C "$RULES" init --quiet
  git -C "$RULES" fetch --quiet --depth 1 \
    https://github.com/semgrep/semgrep-rules.git "$SEMGREP_RULES_SHA"
  git -C "$RULES" -c advice.detachedHead=false checkout --quiet FETCH_HEAD
fi

configs=()
for set in "${RULESETS[@]}"; do
  configs+=(--config "$RULES/$set")
done

semgrep scan --metrics=off --disable-version-check --error --quiet \
  --exclude .tools "${configs[@]}" .
