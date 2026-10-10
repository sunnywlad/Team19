#!/usr/bin/env bash
# Contrôle des dépendances, activé par la présence de manifestes suivis par git.
#   - package.json sans lockfile                      -> échec
#   - package-lock.json : npm ci + npm audit --audit-level=high
#   - requirements*.txt : toute ligne doit être figée par « == », puis pip-audit
# Usage : scripts/check-deps.sh [--detect]
#   --detect : affiche « node=true|false » et « python=true|false » (pour la CI).
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

# Fichiers suivis ou nouveaux non ignorés, hors dépendances embarquées
# (contracts/lib, node_modules) : on n'audite que nos propres manifestes.
tracked() {
  git ls-files --cached --others --exclude-standard -- "$@" |
    grep -Ev '(^|/)node_modules/|^contracts/lib/' || true
}

mapfile -t packages < <(tracked ':(glob)**/package.json')
mapfile -t requirements < <(tracked ':(glob)**/requirements*.txt')
mapfile -t unaudited < <(tracked ':(glob)**/yarn.lock' ':(glob)**/pnpm-lock.yaml' \
  ':(glob)**/bun.lock' ':(glob)**/poetry.lock' ':(glob)**/uv.lock' \
  ':(glob)**/Pipfile.lock' ':(glob)**/Cargo.lock' ':(glob)**/go.sum')

has_file() { [ -n "$(tracked "$1")" ]; }

if [ "${1:-}" = "--detect" ]; then
  node=false
  python=false
  [ "${#packages[@]}" -gt 0 ] && node=true
  [ "${#requirements[@]}" -gt 0 ] && python=true
  echo "node=$node"
  echo "python=$python"
  exit 0
fi

failures=0
fail() {
  echo "ECHEC $*" >&2
  failures=$((failures + 1))
}
warn() {
  # Annotation visible dans l'interface GitHub, simple message en local.
  if [ -n "${GITHUB_ACTIONS:-}" ]; then echo "::warning::$*"; else echo "ATTENTION $*" >&2; fi
}

for lock in "${unaudited[@]}"; do
  # TODO : brancher un audit (osv-scanner) dès qu'une stack utilise ce format.
  warn "$lock : format de lockfile non audité par la CI"
done

for pkg in "${packages[@]}"; do
  dir="$(dirname "$pkg")"
  if has_file "$dir/package-lock.json" || has_file "$dir/npm-shrinkwrap.json"; then
    echo "==> $dir : npm ci + npm audit"
    # --ignore-scripts : aucun script d'installation tiers exécuté pour l'audit.
    if ! (cd "$dir" && npm ci --ignore-scripts --no-fund --no-audit); then
      fail "$dir : npm ci (lockfile désynchronisé de package.json ?)"
      continue
    fi
    (cd "$dir" && npm audit --audit-level=high) || fail "$dir : npm audit (gravité haute ou plus)"
  elif has_file "$dir/yarn.lock" || has_file "$dir/pnpm-lock.yaml" || has_file "$dir/bun.lock"; then
    : # Verrouillé, mais non audité : déjà signalé ci-dessus.
  else
    fail "$pkg : aucun lockfile versionné à côté (lancer npm install puis committer package-lock.json)"
  fi
done

for req in "${requirements[@]}"; do
  echo "==> $req : versions figées + pip-audit"
  pinned=true
  lineno=0
  while IFS= read -r line || [ -n "$line" ]; do
    lineno=$((lineno + 1))
    line="${line%%#*}"
    line="${line#"${line%%[![:space:]]*}"}"
    line="${line%"${line##*[![:space:]]}"}"
    case "$line" in
      "" | "\\") continue ;;
      --hash=* | --require-hashes | "-r "* | "-c "*) continue ;;
    esac
    case "$line" in
      *==*) ;;
      *)
        fail "$req:$lineno : ligne sans « == » : $line"
        pinned=false
        ;;
    esac
  done < "$req"
  [ "$pinned" = true ] || continue

  if ! command -v pip-audit >/dev/null 2>&1; then
    fail "$req : pip-audit introuvable, audit impossible"
    continue
  fi
  # pip-audit ne filtre pas par gravité : toute vulnérabilité connue bloque.
  pip-audit --requirement "$req" --progress-spinner off || fail "$req : pip-audit"
done

if [ "${#packages[@]}" -eq 0 ] && [ "${#requirements[@]}" -eq 0 ]; then
  echo "dépendances : rien à analyser"
fi

if [ "$failures" -ne 0 ]; then
  echo "dépendances : $failures contrôle(s) en échec" >&2
  exit 1
fi
echo "dépendances : OK"
