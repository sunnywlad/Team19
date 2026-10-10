#!/usr/bin/env bash
# e2e.sh — test bout en bout de la pile offchain contre le L1 local (Team19)
# Utilisation : bash offchain/e2e.sh [depuis la racine du dépôt]
# Variable optionnelle : E2E_AMOUNT (défaut 50000)
set -euo pipefail

# ─── 0. Répertoire de travail ────────────────────────────────────────────────
# Le script est dans offchain/ ; toutes les commandes node s'exécutent depuis là.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# ─── 1. Valeurs par défaut surchargeables ───────────────────────────────────
MARKET_ADDRESS="${MARKET_ADDRESS:-0x55a4edd8a2c051079b426e9fbdee285368824a89}"
RPC_URL="${RPC_URL:-http://127.0.0.1:9654/ext/bc/bM7X3ju78mCF3i2dKcF9LKvkFCiHmcxzpm71xzpUQKemrQqvW/rpc}"
CHAIN_ID="${CHAIN_ID:-191919}"
E2E_AMOUNT="${E2E_AMOUNT:-50000}"

# Trouver des ports libres (évite les conflits avec des instances précédentes)
find_free_port() {
  python3 -c "import socket; s=socket.socket(); s.bind(('127.0.0.1',0)); print(s.getsockname()[1]); s.close()"
}
CACHE_PORT=$(find_free_port)
GATEWAY_PORT=$(find_free_port)
echo "[e2e] Ports : cache=$CACHE_PORT gateway=$GATEWAY_PORT"

# ─── 2. Pré-checks ──────────────────────────────────────────────────────────
echo "[e2e] Vérification du RPC..."
if ! curl -sf -X POST -H "Content-Type: application/json" \
    --data '{"jsonrpc":"2.0","method":"eth_blockNumber","params":[],"id":1}' \
    "$RPC_URL" > /dev/null; then
  echo "[e2e] ERREUR : le RPC ne répond pas ($RPC_URL)" >&2
  exit 1
fi
echo "[e2e] RPC OK"

echo "[e2e] Vérification du contrat marché..."
MARKET_CODE=$(cast code "$MARKET_ADDRESS" --rpc-url "$RPC_URL" 2>/dev/null || echo "0x")
if [ "$MARKET_CODE" = "0x" ] || [ -z "$MARKET_CODE" ]; then
  echo "[e2e] ERREUR : aucun contrat à $MARKET_ADDRESS" >&2
  exit 1
fi
echo "[e2e] Contrat OK (${#MARKET_CODE} caractères de bytecode)"

# ─── 3. Dérivation des clés à l'exécution ───────────────────────────────────
# Jamais écrites sur disque ni affichées dans les journaux.
MNEMONIC="test test test test test test test test test test test junk"

VERIFIER_KEY_1=$(cast wallet private-key --mnemonic "$MNEMONIC" --mnemonic-index 1)
VERIFIER_KEY_2=$(cast wallet private-key --mnemonic "$MNEMONIC" --mnemonic-index 2)
VERIFIER_KEY_3=$(cast wallet private-key --mnemonic "$MNEMONIC" --mnemonic-index 3)
REQUESTER_KEY=$(cast wallet private-key --mnemonic "$MNEMONIC" --mnemonic-index 4)

# Adresse du demandeur (index 4) en minuscules
REQUESTER_ADDR=$(cast wallet address --mnemonic "$MNEMONIC" --mnemonic-index 4 | tr '[:upper:]' '[:lower:]')
echo "[e2e] Adresse demandeur : $REQUESTER_ADDR"

export VERIFIER_KEY_1 VERIFIER_KEY_2 VERIFIER_KEY_3 REQUESTER_KEY REQUESTER_ADDR

# ─── 4. Tokens aléatoires ────────────────────────────────────────────────────
CACHE_WRITE_TOKEN=$(openssl rand -hex 32)
GATEWAY_API_KEY=$(openssl rand -hex 32)
export CACHE_WRITE_TOKEN GATEWAY_API_KEYS="$GATEWAY_API_KEY"

# ─── 5. Dossier temporaire ───────────────────────────────────────────────────
TMP_DIR=$(mktemp -d /tmp/team19-e2e-XXXXXX)
INCIDENTS_LOG="$TMP_DIR/incidents.log"
CACHE_DATA_DIR="$TMP_DIR/cache"
V1_DATA_DIR="$TMP_DIR/verifier-1"
V2_DATA_DIR="$TMP_DIR/verifier-2"
V3_DATA_DIR="$TMP_DIR/verifier-3"
mkdir -p "$CACHE_DATA_DIR" "$V1_DATA_DIR" "$V2_DATA_DIR" "$V3_DATA_DIR"
echo "[e2e] Dossier temporaire : $TMP_DIR"

# ─── 6. Trap de nettoyage ────────────────────────────────────────────────────
# Sur succès : supprime le dossier temporaire.
# Sur échec  : conserve les journaux pour diagnostic (évite la perte lors d'un re-run).
PIDS=()
E2E_EXIT_CODE=0
cleanup() {
  echo "[e2e] Nettoyage (arrêt des services)..."
  for pid in "${PIDS[@]}"; do
    kill "$pid" 2>/dev/null || true
  done
  wait 2>/dev/null || true
  if [ "$E2E_EXIT_CODE" -eq 0 ]; then
    rm -rf "$TMP_DIR"
  else
    echo "[e2e] Journaux conservés dans $TMP_DIR (code=$E2E_EXIT_CODE)" >&2
  fi
}
trap cleanup EXIT

# ─── 7. Lancement du cache ───────────────────────────────────────────────────
echo "[e2e] Démarrage du cache (port $CACHE_PORT)..."
CACHE_PORT="$CACHE_PORT" \
CACHE_DATA_DIR="$CACHE_DATA_DIR" \
CACHE_WRITE_TOKEN="$CACHE_WRITE_TOKEN" \
MARKET_ADDRESS="$MARKET_ADDRESS" \
RPC_URL="$RPC_URL" \
CHAIN_ID="$CHAIN_ID" \
  node cache/server.ts > "$TMP_DIR/cache.log" 2>&1 &
PIDS+=($!)
echo "[e2e] Cache PID=$!"

# ─── 8. Lancement de la passerelle ───────────────────────────────────────────
echo "[e2e] Démarrage de la passerelle (port $GATEWAY_PORT)..."
GATEWAY_PORT="$GATEWAY_PORT" \
GATEWAY_API_KEYS="$GATEWAY_API_KEY" \
REQUESTER_KEY="$REQUESTER_KEY" \
CACHE_URL="http://127.0.0.1:$CACHE_PORT" \
CACHE_WRITE_TOKEN="$CACHE_WRITE_TOKEN" \
MARKET_ADDRESS="$MARKET_ADDRESS" \
RPC_URL="$RPC_URL" \
CHAIN_ID="$CHAIN_ID" \
INCIDENTS_LOG="$INCIDENTS_LOG" \
  node gateway/server.ts > "$TMP_DIR/gateway.log" 2>&1 &
PIDS+=($!)
echo "[e2e] Passerelle PID=$!"

# ─── 9. Lancement des 3 vérificateurs ────────────────────────────────────────
for i in 1 2 3; do
  VK_VAR="VERIFIER_KEY_$i"
  VDIR_VAR="V${i}_DATA_DIR"
  echo "[e2e] Démarrage vérificateur $i..."
  VERIFIER_KEY="${!VK_VAR}" \
  VERIFIER_DATA_DIR="${!VDIR_VAR}" \
  CACHE_URL="http://127.0.0.1:$CACHE_PORT" \
  MARKET_ADDRESS="$MARKET_ADDRESS" \
  RPC_URL="$RPC_URL" \
  CHAIN_ID="$CHAIN_ID" \
  INCIDENTS_LOG="$INCIDENTS_LOG" \
  EVALUATOR_CMD="node evaluator-stub/index.ts" \
    node verifier/service.ts > "$TMP_DIR/verifier-$i.log" 2>&1 &
  PIDS+=($!)
  echo "[e2e] Vérificateur $i PID=$!"
done

# ─── 10. Attente que les ports répondent ─────────────────────────────────────
wait_port() {
  local port="$1"
  local name="$2"
  local max=30
  local i=0
  # curl -s (silent) -o /dev/null : succès si le serveur répond, quelle que soit la réponse HTTP
  while ! curl -s -o /dev/null "http://127.0.0.1:$port/" 2>/dev/null; do
    i=$((i+1))
    if [ $i -ge $max ]; then
      echo "[e2e] ERREUR : $name (port $port) ne répond pas après ${max}s" >&2
      echo "[e2e] Dernières lignes du journal :" >&2
      tail -20 "$TMP_DIR/${name}.log" >&2
      E2E_EXIT_CODE=1
      exit 1
    fi
    sleep 1
  done
  echo "[e2e] $name prêt (port $port)"
}

wait_port "$CACHE_PORT" "cache"
wait_port "$GATEWAY_PORT" "gateway"

# ─── 11. Construction du payload ─────────────────────────────────────────────
SALT="0x$(openssl rand -hex 32)"
CREATED_AT=$(date +%s)

PAYLOAD=$(cat <<EOF
{
  "schemaVersion": 1,
  "requester": "$REQUESTER_ADDR",
  "agentId": "e2e-test",
  "prompt": "Payer la facture INV-E2E-001",
  "context": {},
  "plannedDecision": {
    "action": "pay",
    "amountMinor": "$E2E_AMOUNT",
    "currency": "EUR",
    "beneficiaryId": "FR7612345987650123456789014",
    "reference": "INV-E2E-001"
  },
  "createdAt": $CREATED_AT,
  "salt": "$SALT"
}
EOF
)

# ─── 12. POST /requests ───────────────────────────────────────────────────────
echo "[e2e] Envoi de POST /requests (montant=$E2E_AMOUNT)..."
HTTP_STATUS=0
RESP=$(curl -s -w "\n__HTTP_STATUS__%{http_code}" \
  -X POST \
  -H "Authorization: Bearer $GATEWAY_API_KEY" \
  -H "Content-Type: application/json" \
  -d "$PAYLOAD" \
  "http://127.0.0.1:$GATEWAY_PORT/requests")

HTTP_STATUS=$(echo "$RESP" | grep "__HTTP_STATUS__" | sed 's/__HTTP_STATUS__//')
RESP=$(echo "$RESP" | grep -v "__HTTP_STATUS__")

if [ "$HTTP_STATUS" != "200" ]; then
  echo "[e2e] ERREUR : POST /requests a retourné HTTP $HTTP_STATUS" >&2
  echo "[e2e] Corps : $RESP" >&2
  echo "[e2e] === Fin journal cache ===" >&2
  tail -40 "$TMP_DIR/cache.log" >&2
  echo "[e2e] === Fin journal passerelle ===" >&2
  tail -40 "$TMP_DIR/gateway.log" >&2
  E2E_EXIT_CODE=1
  exit 1
fi

echo "[e2e] Réponse : $RESP"

REQUEST_ID=$(echo "$RESP" | grep -o '"requestId":"[^"]*"' | cut -d'"' -f4)

if [ -z "$REQUEST_ID" ]; then
  echo "[e2e] ERREUR : impossible d'extraire requestId de la réponse" >&2
  echo "[e2e] Corps : $RESP" >&2
  E2E_EXIT_CODE=1
  exit 1
fi

echo "[e2e] requestId = $REQUEST_ID"

# Lire les deadlines depuis la réponse (en secondes Unix)
COMMIT_DEADLINE=$(echo "$RESP" | grep -o '"commitDeadline":"[^"]*"' | cut -d'"' -f4 || echo "0")
echo "[e2e] commitDeadline = $COMMIT_DEADLINE"

# ─── 13. Sondage jusqu'à Contest ─────────────────────────────────────────────
# Budget : fenêtre commit (180s) + fenêtre reveal (60s) + marge (240s) = 480s.
# Les vérificateurs gèrent eux-mêmes commit → reveal → finalize ; on sonde
# seulement le statut sans appeler finalize prématurément (cela provoquerait
# une finalisation avant que tous les vérificateurs n'aient révélé).
MAX_POLL=480
POLL_INTERVAL=5
ELAPSED=0
STATUS=""

echo "[e2e] Attente du statut Contest (max ${MAX_POLL}s, sondage toutes les ${POLL_INTERVAL}s)..."

while [ $ELAPSED -lt $MAX_POLL ]; do
  STATUS_RESP=$(curl -s \
    -H "Authorization: Bearer $GATEWAY_API_KEY" \
    "http://127.0.0.1:$GATEWAY_PORT/requests/$REQUEST_ID" || echo '{"status":"Error"}')

  STATUS=$(echo "$STATUS_RESP" | grep -o '"status":"[^"]*"' | head -1 | cut -d'"' -f4 || echo "Error")
  if [ -z "$STATUS" ]; then STATUS="Error"; fi

  # Afficher la progression toutes les 15 s
  if [ $((ELAPSED % 15)) -eq 0 ] || [ "$STATUS" = "Contest" ] || [ "$STATUS" = "Closed" ]; then
    echo "[e2e] t=${ELAPSED}s : statut=$STATUS"
  fi

  if [ "$STATUS" = "Contest" ] || [ "$STATUS" = "Closed" ]; then
    break
  fi

  sleep $POLL_INTERVAL
  ELAPSED=$((ELAPSED + POLL_INTERVAL))
done

if [ "$STATUS" != "Contest" ] && [ "$STATUS" != "Closed" ]; then
  echo "[e2e] ERREUR : statut Contest non atteint après ${MAX_POLL}s (dernier: $STATUS)" >&2
  echo "[e2e] === Fin journal cache ===" >&2
  tail -40 "$TMP_DIR/cache.log" >&2
  echo "[e2e] === Fin journal passerelle ===" >&2
  tail -40 "$TMP_DIR/gateway.log" >&2
  echo "[e2e] === Fin journal vérificateur 1 ===" >&2
  tail -40 "$TMP_DIR/verifier-1.log" >&2
  echo "[e2e] === Fin journal vérificateur 2 ===" >&2
  tail -40 "$TMP_DIR/verifier-2.log" >&2
  echo "[e2e] === Fin journal vérificateur 3 ===" >&2
  tail -40 "$TMP_DIR/verifier-3.log" >&2
  E2E_EXIT_CODE=1
  exit 1
fi

echo "[e2e] Statut Contest atteint."

# ─── 14. Lire code et VerdictRevealed ────────────────────────────────────────
VERDICTS_RESP=$(curl -s \
  -H "Authorization: Bearer $GATEWAY_API_KEY" \
  "http://127.0.0.1:$GATEWAY_PORT/requests/$REQUEST_ID/verdicts")

echo "[e2e] Verdicts : $VERDICTS_RESP"

# Compter les VerdictRevealed via cast logs
CAST_LOGS=$(cast logs \
  --rpc-url "$RPC_URL" \
  --address "$MARKET_ADDRESS" \
  --from-block 0 \
  "VerdictRevealed(uint256 indexed requestId, address indexed verifier, uint8 vote, uint16 reasons, bytes32 detailHash)" \
  2>/dev/null || echo "")

# Filtrer sur le requestId (en hex)
REQUEST_ID_HEX=$(printf "0x%064x" "$REQUEST_ID")
# grep -c retourne 0 sur stdout même quand il ne trouve rien, avec exit code 1.
# On ignore l'exit code et ne prend pas le || echo "0" pour éviter "0\n0".
VERDICT_COUNT=$(echo "$CAST_LOGS" | grep -c "$REQUEST_ID_HEX" 2>/dev/null) || VERDICT_COUNT=0

echo "[e2e] VerdictRevealed pour requestId=$REQUEST_ID : $VERDICT_COUNT"

# Lire le code depuis GET /requests/{id}
FINAL_RESP=$(curl -s \
  -H "Authorization: Bearer $GATEWAY_API_KEY" \
  "http://127.0.0.1:$GATEWAY_PORT/requests/$REQUEST_ID")

CODE_NAME=$(echo "$FINAL_RESP" | grep -o '"code":"[^"]*"' | head -1 | cut -d'"' -f4 || echo "unknown")
if [ -z "$CODE_NAME" ]; then CODE_NAME="unknown"; fi

# Convertir le nom en numéro
case "$CODE_NAME" in
  Refuse)      CODE_NUM=0 ;;
  HumanReview) CODE_NUM=1 ;;
  Accept)      CODE_NUM=2 ;;
  *)           CODE_NUM=99 ;;
esac

echo ""
echo "════════════════════════════════════════"
echo " requestId      : $REQUEST_ID"
echo " code           : $CODE_NUM ($CODE_NAME)"
echo " VerdictRevealed: $VERDICT_COUNT"
echo "════════════════════════════════════════"

# ─── 15. Vérification finale ──────────────────────────────────────────────────
FAIL=0

if [ "$CODE_NUM" = "99" ]; then
  echo "[e2e] ERREUR : code inconnu ($CODE_NAME)" >&2
  FAIL=1
fi

if [ "$VERDICT_COUNT" -lt 3 ]; then
  echo "[e2e] ERREUR : seulement $VERDICT_COUNT VerdictRevealed (3 attendus)" >&2
  FAIL=1
fi

if [ "$FAIL" -eq 1 ]; then
  echo "[e2e] === Fin journal cache ===" >&2
  tail -40 "$TMP_DIR/cache.log" >&2
  echo "[e2e] === Fin journal passerelle ===" >&2
  tail -40 "$TMP_DIR/gateway.log" >&2
  for v in 1 2 3; do
    echo "[e2e] === Fin journal vérificateur $v ===" >&2
    tail -40 "$TMP_DIR/verifier-$v.log" >&2
  done
  E2E_EXIT_CODE=1
  exit 1
fi

echo "[e2e] SUCCÈS : requestId=$REQUEST_ID code=$CODE_NUM VerdictRevealed=$VERDICT_COUNT"
E2E_EXIT_CODE=0
exit 0
