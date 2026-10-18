#!/usr/bin/env bash
# make pitch : démo investisseurs en une commande. Serveur de fixtures en
# scénario « pitch » (Aubert Industrie, société fictive, 30 jours déjà joués)
# et dashboard en euros avec des libellés fictifs. Aucun service à démarrer.
# Refuse de démarrer si une variable branche des données réelles : un écran ne
# mélange jamais réel et fictif. Le proxy (vite.config.ts) refait ce contrôle.
# Compatible bash 3.2, comme scripts/.
set -euo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$DIR"

conflicts=""
for name in RELAY_API_URL RESPONSE_API_URL RELAY_HAS_VAULT; do
  if [ -n "${!name:-}" ]; then conflicts="$conflicts $name"; fi
done
if [ -n "$conflicts" ]; then
  echo "pitch : refusé,$conflicts défini dans l'environnement. Le pitch ne montre que des données fictives." >&2
  exit 2
fi

FIXTURES_PORT=8799
DASHBOARD_PORT=5174
for port in "$FIXTURES_PORT" "$DASHBOARD_PORT"; do
  if (exec 3<>"/dev/tcp/127.0.0.1/$port") 2>/dev/null; then
    echo "pitch : le port $port est déjà pris (un pitch tourne déjà ?)." >&2
    exit 1
  fi
done

if [ ! -f node_modules/.package-lock.json ] || [ package-lock.json -nt node_modules/.package-lock.json ]; then
  npm ci --ignore-scripts --no-fund --no-audit < /dev/null
fi
npm run --silent gen

FIXTURES_PORT="$FIXTURES_PORT" node --disable-warning=ExperimentalWarning fixtures/server.ts pitch &
fixtures=$!
trap 'kill "$fixtures" 2>/dev/null || true' EXIT INT TERM

echo
echo "  Démo · données fictives : Aubert Industrie, société fictive."
echo "  http://127.0.0.1:$DASHBOARD_PORT"
echo "  Ctrl+C pour arrêter."
echo
DASHBOARD_PITCH=1 npx vite --clearScreen false
