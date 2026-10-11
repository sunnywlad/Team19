#!/usr/bin/env bash
# Démarre l'explorateur VETO : tunnel, MongoDB, API, indexeur, front. Relançable sans risque.
# Option --rattrapage : réindexe tous les blocs (dix minutes), à faire si la chaîne a avancé pendant l'arrêt.
set -u
# RPC=<url> ./start.sh pour viser un autre tunnel (défaut : celui du portable de Wladimir, port 9670).
D="$(cd "$(dirname "$0")" && pwd)"
RPC="${RPC:-http://127.0.0.1:9670/ext/bc/RkJGt3ZenMaUz64EP1cUZeisftYMb9WaJdvYw54xfvkUccgke/rpc}"
[ -d "$HOME/.nvm/versions/node/v22.23.2/bin" ] && export PATH="$HOME/.nvm/versions/node/v22.23.2/bin:$PATH"

ecoute() { ss -ltn | grep -q "[:.]$1 "; }
attend() { for _ in $(seq 1 60); do ecoute "$1" && return 0; sleep 1; done; echo "ECHEC : rien n'écoute sur $1 ($2)"; exit 1; }
bloc() { curl -s -m 5 -X POST -H 'content-type: application/json' --data '{"jsonrpc":"2.0","id":1,"method":"eth_blockNumber","params":[]}' "$RPC" | grep -o '"result":"[^"]*"' | cut -d'"' -f4; }

[ -z "$(bloc)" ] && [ -f "$HOME/phaseF/fuji-tunnel.sh" ] && bash "$HOME/phaseF/fuji-tunnel.sh" >/dev/null
for _ in $(seq 1 20); do [ -n "$(bloc)" ] && break; sleep 1; done
[ -n "$(bloc)" ] || { echo "ECHEC : le RPC ne répond pas par le tunnel"; exit 1; }

sed -i "s|^RPC_URL=.*|RPC_URL=$RPC|" "$D/erol-explorer-backend/.env"
sed -i "s|^PUBLIC_RPC_URL=.*|PUBLIC_RPC_URL=$RPC|" "$D/codenekt-explorer-frontend/.env"
ecoute 27018 || { (cd "$D/mongo" && setsid nohup node start-mongo.mjs > mongo.log 2>&1 &); attend 27018 "MongoDB"; }
ecoute 3050  || { (cd "$D/erol-explorer-backend" && setsid nohup npm run start:api > "$D/api.log" 2>&1 &); attend 3050 "API"; }
pgrep -f "periphery/indexer/index.ts" >/dev/null || (cd "$D/erol-explorer-backend" && setsid nohup npm run start:indexer > "$D/indexer.log" 2>&1 &)
ecoute 5180  || { (cd "$D/codenekt-explorer-frontend" && setsid nohup npm run dev -- --port 5180 --host 0.0.0.0 > "$D/front.log" 2>&1 &); attend 5180 "front"; }
[ "${1:-}" = "--rattrapage" ] && (cd "$D/erol-explorer-backend" && setsid nohup npx ts-node backfill.ts > "$D/backfill.log" 2>&1 &)

B=$(bloc)
echo "chaîne : bloc $((16#${B#0x}))  |  transactions indexées : $(curl -s -m 20 http://127.0.0.1:5180/api/tx-count)"
echo "Explorateur : http://127.0.0.1:5180"
