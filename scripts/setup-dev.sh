#!/usr/bin/env bash
# Prépare le poste de dev : gitleaks épinglé, pre-commit, hooks git activés.
# Idempotent : peut être relancé sans effet de bord.
set -euo pipefail

PRE_COMMIT_VERSION="4.6.2"

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

echo "==> gitleaks $(scripts/gitleaks.sh version)"

if command -v pre-commit >/dev/null 2>&1; then
  PRE_COMMIT="pre-commit"
else
  # Pas de pre-commit sur le poste : venv local, version figée.
  VENV="$ROOT/.tools/venv"
  if [ ! -x "$VENV/bin/pre-commit" ]; then
    python3 -m venv "$VENV"
    "$VENV/bin/python" -m pip install --quiet --disable-pip-version-check \
      "pre-commit==${PRE_COMMIT_VERSION}"
  fi
  PRE_COMMIT="$VENV/bin/pre-commit"
fi
echo "==> $("$PRE_COMMIT" --version)"

"$PRE_COMMIT" install --install-hooks

echo "==> Hooks actifs. Vérification complète : make check"
