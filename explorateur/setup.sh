#!/usr/bin/env bash
# Installe l'explorateur VETO : clone les deux dépôts de yassirboudda à un commit figé,
# applique nos correctifs (patches/), écrit les .env, installe les dépendances. Relançable.
# SKIP_INSTALL=1 pour ne faire que le clonage et les correctifs.
set -euo pipefail
D="$(cd "$(dirname "$0")" && pwd)"
RPC="${RPC:-http://127.0.0.1:9670/ext/bc/RkJGt3ZenMaUz64EP1cUZeisftYMb9WaJdvYw54xfvkUccgke/rpc}"

clone() { # dossier, commit
  if [ ! -d "$D/$1/.git" ]; then
    git clone -q "https://github.com/yassirboudda/$1.git" "$D/$1"
    git -C "$D/$1" checkout -q "$2"
    git -C "$D/$1" apply "$D/patches/$1.patch"
    echo "$1 : cloné à ${2:0:7}, correctifs appliqués"
  else
    echo "$1 : déjà présent, laissé tel quel"
  fi
}
clone erol-explorer-backend f90149bfff89bec8949530bc99193dd4d4601bdd
clone codenekt-explorer-frontend c70427b15bdca052b5de2b12f1fbd33a5f9e02b1

cat > "$D/erol-explorer-backend/.env" <<ENV
PORT=3050
DB_STRING=mongodb://127.0.0.1:27018
DB_NAME=veto_explorer
RPC_URL=$RPC
ENV
cat > "$D/codenekt-explorer-frontend/.env" <<ENV
PUBLIC_RPC_URL=$RPC
PUBLIC_GAS_UNIT=Gwei
PUBLIC_NATIVE_SYMBOL=VETO
EXPLORER_API_URL=http://127.0.0.1:3050
DB_STRING=mongodb://127.0.0.1:27018
DB_NAME=veto_explorer
NATIVE_SYMBOL=VETO
ENV

[ "${SKIP_INSTALL:-0}" = "1" ] && { echo "Installation des dépendances sautée."; exit 0; }
(cd "$D/erol-explorer-backend" && npm ci --no-fund --no-audit)
(cd "$D/codenekt-explorer-frontend" && npm ci --no-fund --no-audit)
(cd "$D/mongo" && npm install --no-fund --no-audit mongodb-memory-server@11.3.0)
echo "Prêt. Première indexation : ./start.sh --rattrapage"
