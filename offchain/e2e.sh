#!/usr/bin/env bash
# e2e.sh — test bout en bout de la pile offchain contre le L1 local (Team19)
# Utilisation : bash offchain/e2e.sh [depuis la racine du dépôt]
# Variables optionnelles :
#   ADDRESSES_FILE     fichier de déploiement (défaut deployments/latest-local.json)
#   MARKET_ADDRESS     surcharge le marché ; sans REGISTRY_ADDRESS, conserve phase 1
#   REGISTRY_ADDRESS   surcharge le registre de phase 3
#   E2E_AMOUNT          montant de la demande (défaut 50000)
#   E2E_REQUESTS        nombre de cycles série (défaut 1)
#   E2E_EXPECT_CLOSED   0 (défaut) ou 1. À 1, après les contrôles code et
#                       VerdictRevealed, attend le statut Closed (close envoyé
#                       par les vérificateurs après contestDeadline), lu par
#                       cast call getRequest, pendant au plus contestWindow+60 s.
set -euo pipefail

# ─── 0. Répertoire de travail ────────────────────────────────────────────────
# Le script est dans offchain/ ; toutes les commandes node s'exécutent depuis là.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$SCRIPT_DIR"

# ─── 1. Valeurs par défaut surchargeables ───────────────────────────────────
ADDRESSES_FILE="${ADDRESSES_FILE:-$REPO_ROOT/deployments/latest-local.json}"
if [[ "$ADDRESSES_FILE" != /* ]]; then
  ADDRESSES_FILE="$REPO_ROOT/$ADDRESSES_FILE"
fi
if [ -z "${MARKET_ADDRESS:-}" ]; then
  if [ ! -f "$ADDRESSES_FILE" ]; then
    echo "[e2e] ERREUR : fichier d'adresses absent ($ADDRESSES_FILE)" >&2
    exit 1
  fi
  MARKET_ADDRESS=$(node -e "const d=require(process.argv[1]); process.stdout.write(d.phase3.DrawnVerificationMarket || '')" "$ADDRESSES_FILE")
  if [ -z "${REGISTRY_ADDRESS:-}" ]; then
    REGISTRY_ADDRESS=$(node -e "const d=require(process.argv[1]); process.stdout.write(d.phase3.VerifierRegistry || '')" "$ADDRESSES_FILE")
  fi
fi
REGISTRY_ADDRESS="${REGISTRY_ADDRESS:-}"
if [ -z "$MARKET_ADDRESS" ]; then
  echo "[e2e] ERREUR : DrawnVerificationMarket introuvable dans $ADDRESSES_FILE" >&2
  exit 1
fi
RPC_URL="${RPC_URL:-http://127.0.0.1:9654/ext/bc/bM7X3ju78mCF3i2dKcF9LKvkFCiHmcxzpm71xzpUQKemrQqvW/rpc}"
CHAIN_ID="${CHAIN_ID:-191919}"
E2E_AMOUNT="${E2E_AMOUNT:-50000}"
E2E_REQUESTS="${E2E_REQUESTS:-1}"
E2E_EXPECT_CLOSED="${E2E_EXPECT_CLOSED:-0}"
case "$E2E_REQUESTS" in
  ''|*[!0-9]*|0)
    echo "[e2e] ERREUR : E2E_REQUESTS doit être un entier positif" >&2
    exit 1 ;;
esac
export MARKET_ADDRESS REGISTRY_ADDRESS

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
if [ -n "$REGISTRY_ADDRESS" ]; then
  REGISTRY_CODE=$(cast code "$REGISTRY_ADDRESS" --rpc-url "$RPC_URL" 2>/dev/null || echo "0x")
  if [ "$REGISTRY_CODE" = "0x" ] || [ -z "$REGISTRY_CODE" ]; then
    echo "[e2e] ERREUR : aucun contrat registre à $REGISTRY_ADDRESS" >&2
    exit 1
  fi
  echo "[e2e] Registre OK ($REGISTRY_ADDRESS)"
fi

# Fenêtres lues sur la chaîne (variables publiques immuables du marché).
# cast peut suffixer un nombre d'une notation [1e18] : on ne garde que le 1er champ.
read_window() {
  cast call "$MARKET_ADDRESS" "$1()(uint64)" --rpc-url "$RPC_URL" 2>/dev/null | awk '{print $1; exit}' || true
}
COMMIT_WINDOW=$(read_window commitWindow)
REVEAL_WINDOW=$(read_window revealWindow)
CONTEST_WINDOW=$(read_window contestWindow)
for w in "$COMMIT_WINDOW" "$REVEAL_WINDOW" "$CONTEST_WINDOW"; do
  case "$w" in
    ''|*[!0-9]*)
      echo "[e2e] ERREUR : lecture des fenêtres du marché impossible" >&2
      exit 1 ;;
  esac
done
echo "[e2e] Fenêtres : commit=${COMMIT_WINDOW}s reveal=${REVEAL_WINDOW}s contest=${CONTEST_WINDOW}s"
EVALUATOR_TIMEOUT_MS=$((COMMIT_WINDOW * 1000 / 2))
export EVALUATOR_TIMEOUT_MS
echo "[e2e] EVALUATOR_TIMEOUT_MS=$EVALUATOR_TIMEOUT_MS (moitié de la fenêtre commit)"

# ─── 3. Dérivation des clés à l'exécution ───────────────────────────────────
# Jamais écrites sur disque ni affichées dans les journaux.
MNEMONIC="test test test test test test test test test test test junk"

VERIFIER_KEY_1=$(cast wallet private-key --mnemonic "$MNEMONIC" --mnemonic-index 1)
VERIFIER_KEY_2=$(cast wallet private-key --mnemonic "$MNEMONIC" --mnemonic-index 2)
VERIFIER_KEY_3=$(cast wallet private-key --mnemonic "$MNEMONIC" --mnemonic-index 3)
REQUESTER_KEY=$(cast wallet private-key --mnemonic "$MNEMONIC" --mnemonic-index 4)

# Adresse du demandeur (index 4) en minuscules
REQUESTER_ADDR=$(cast wallet address --mnemonic "$MNEMONIC" --mnemonic-index 4 | tr '[:upper:]' '[:lower:]')
VERIFIER_ADDR_1=$(cast wallet address --mnemonic "$MNEMONIC" --mnemonic-index 1 | tr '[:upper:]' '[:lower:]')
VERIFIER_ADDR_2=$(cast wallet address --mnemonic "$MNEMONIC" --mnemonic-index 2 | tr '[:upper:]' '[:lower:]')
VERIFIER_ADDR_3=$(cast wallet address --mnemonic "$MNEMONIC" --mnemonic-index 3 | tr '[:upper:]' '[:lower:]')
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
  REGISTRY_ADDRESS="$REGISTRY_ADDRESS" \
  RPC_URL="$RPC_URL" \
  CHAIN_ID="$CHAIN_ID" \
  INCIDENTS_LOG="$INCIDENTS_LOG" \
  EVALUATOR_CMD="node evaluator-stub/index.ts" \
    node verifier/service.ts > "$TMP_DIR/verifier-$i.log" 2>&1 &
  PIDS+=($!)
  echo "[e2e] Vérificateur $i PID=$!"
done

# Phase 3 : les trois services doivent être admis, inscrits et actifs avant
# qu'une demande puisse tirer exactement ce comité.
if [ -n "$REGISTRY_ADDRESS" ]; then
  wait_verifier_active() {
    local address="$1"
    local label="$2"
    local elapsed=0
    while [ "$elapsed" -lt 60 ]; do
      local active
      active=$(cast call "$REGISTRY_ADDRESS" "isActive(address)(bool)" "$address" --rpc-url "$RPC_URL" 2>/dev/null | awk '{print $1; exit}' || true)
      if [ "$active" = "true" ]; then
        echo "[e2e] Vérificateur $label actif au registre"
        return 0
      fi
      sleep 1
      elapsed=$((elapsed + 1))
    done
    echo "[e2e] ERREUR : le vérificateur $label ($address) n'est pas actif après 60 s" >&2
    tail -30 "$TMP_DIR/verifier-$label.log" >&2
    E2E_EXIT_CODE=1
    exit 1
  }
  wait_verifier_active "$VERIFIER_ADDR_1" 1
  wait_verifier_active "$VERIFIER_ADDR_2" 2
  wait_verifier_active "$VERIFIER_ADDR_3" 3
fi

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

# ─── 11. Cycles de demande ───────────────────────────────────────────────────
for ((CYCLE = 1; CYCLE <= E2E_REQUESTS; CYCLE++)); do
echo "[e2e] Cycle $CYCLE/$E2E_REQUESTS"

# Construction du payload
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

if [ -n "$REGISTRY_ADDRESS" ]; then
  DRAW_LOGS=$(cast logs \
    --rpc-url "$RPC_URL" \
    --address "$MARKET_ADDRESS" \
    --from-block 0 \
    "CommitteeDrawn(uint256 indexed requestId, address[] committee)" \
    "$REQUEST_ID" \
    2>/dev/null || echo "")
  DRAW_COUNT=$(echo "$DRAW_LOGS" | grep -c '^- address:' 2>/dev/null) || DRAW_COUNT=0
  if [ "$DRAW_COUNT" -ne 1 ]; then
    echo "[e2e] ERREUR : $DRAW_COUNT CommitteeDrawn pour requestId=$REQUEST_ID (1 attendu)" >&2
    E2E_EXIT_CODE=1
    exit 1
  fi
  echo "[e2e] CommitteeDrawn pour requestId=$REQUEST_ID : $DRAW_COUNT"
fi

# Lire les deadlines depuis la réponse (en secondes Unix)
COMMIT_DEADLINE=$(echo "$RESP" | grep -o '"commitDeadline":"[^"]*"' | cut -d'"' -f4 || echo "0")
echo "[e2e] commitDeadline = $COMMIT_DEADLINE"

# ─── 13. Sondage jusqu'à Contest ─────────────────────────────────────────────
# Budget : fenêtre commit + fenêtre reveal (lues sur la chaîne) + marge de 120s.
# Les vérificateurs gèrent eux-mêmes commit → reveal → finalize ; on sonde
# seulement le statut sans appeler finalize prématurément (cela provoquerait
# une finalisation avant que tous les vérificateurs n'aient révélé).
MAX_POLL=$((COMMIT_WINDOW + REVEAL_WINDOW + 120))
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
  "$REQUEST_ID" \
  2>/dev/null || echo "")

# Le filtre sur le topic indexé requestId est fait côté nœud (argument après la
# signature). On compte les journaux (une ligne "- address:" chacun), pas le
# contenu : le champ data d'une autre demande pouvait ressembler à un requestId.
# grep -c écrit 0 sur stdout même sans correspondance, avec exit code 1 : on
# ignore l'exit code sans ajouter de "|| echo 0" (sinon "0\n0").
VERDICT_COUNT=$(echo "$CAST_LOGS" | grep -c '^- address:' 2>/dev/null) || VERDICT_COUNT=0

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

# ─── 14b. Statut final (seulement si E2E_EXPECT_CLOSED=1) ────────────────────
# Lecture qui fait foi : cast call getRequest, tuple décodé, champ status (8e).
# eth_call ne produit aucun bloc ; seuls Contest et Closed sont stockés.
FINAL_STATUS_LINE=""
CLOSE_FAIL=0
if [ "$E2E_EXPECT_CLOSED" = "1" ]; then
  read_chain_status() {
    cast call "$MARKET_ADDRESS" \
      "getRequest(uint256)((address,bytes32,uint96,uint64,uint64,uint64,uint64,uint8,uint8))" \
      "$REQUEST_ID" --rpc-url "$RPC_URL" 2>/dev/null \
      | tr -d '()' | cut -d, -f8 | awk '{print $1; exit}' || true
  }
  CLOSE_MAX=$((CONTEST_WINDOW + 60))
  CLOSE_ELAPSED=0
  CHAIN_STATUS=""
  echo "[e2e] Attente du statut Closed (max ${CLOSE_MAX}s, sondage toutes les ${POLL_INTERVAL}s)..."
  while true; do
    CHAIN_STATUS=$(read_chain_status)
    if [ $((CLOSE_ELAPSED % 15)) -eq 0 ]; then
      echo "[e2e] t=${CLOSE_ELAPSED}s : status chaîne=${CHAIN_STATUS:-?}"
    fi
    if [ "$CHAIN_STATUS" = "4" ]; then break; fi
    if [ $CLOSE_ELAPSED -ge $CLOSE_MAX ]; then break; fi
    sleep $POLL_INTERVAL
    CLOSE_ELAPSED=$((CLOSE_ELAPSED + POLL_INTERVAL))
  done
  if [ "$CHAIN_STATUS" = "4" ]; then
    echo "[e2e] Preuve de close : getRequest($REQUEST_ID).status = 4 (Closed), lu par cast call"
    FINAL_STATUS_LINE="4 (Closed)"
  else
    echo "[e2e] ERREUR : statut Closed non atteint après ${CLOSE_MAX}s (dernier: ${CHAIN_STATUS:-?})" >&2
    FINAL_STATUS_LINE="${CHAIN_STATUS:-?} (Closed attendu)"
    CLOSE_FAIL=1
  fi
fi

echo ""
echo "════════════════════════════════════════"
echo " requestId      : $REQUEST_ID"
echo " code           : $CODE_NUM ($CODE_NAME)"
echo " VerdictRevealed: $VERDICT_COUNT"
if [ "$E2E_EXPECT_CLOSED" = "1" ]; then
  echo " statut final   : $FINAL_STATUS_LINE"
fi
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

if [ "$CLOSE_FAIL" -eq 1 ]; then
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

echo "[e2e] Cycle $CYCLE réussi : requestId=$REQUEST_ID code=$CODE_NUM VerdictRevealed=$VERDICT_COUNT"
done

if [ -n "$REGISTRY_ADDRESS" ] && [ "$E2E_EXPECT_CLOSED" = "1" ]; then
  STAKE_FAIL=0
  for i in 1 2 3; do
    VK_ADDR_VAR="VERIFIER_ADDR_$i"
    VERIFIER_ADDR="${!VK_ADDR_VAR}"
    STAKE_OUTPUT=$(cast call "$REGISTRY_ADDRESS" "stakeOf(address)(uint256,uint256)" "$VERIFIER_ADDR" --rpc-url "$RPC_URL" 2>/dev/null || true)
    STAKE_VALUES=$(echo "$STAKE_OUTPUT" | sed -E 's/\[[^]]+\]//g' | awk 'NF { for (i=1; i<=NF; i++) if ($i ~ /^[0-9]+$/) print $i }' | head -2)
    TOTAL_STAKE=$(echo "$STAKE_VALUES" | sed -n '1p')
    LOCKED_STAKE=$(echo "$STAKE_VALUES" | sed -n '2p')
    if [ -z "$TOTAL_STAKE" ] || [ -z "$LOCKED_STAKE" ]; then
      echo "[e2e] ERREUR : lecture stakeOf impossible pour $VERIFIER_ADDR" >&2
      STAKE_FAIL=1
      continue
    fi
    echo "[e2e] stakeOf vérificateur $i : total=$TOTAL_STAKE locked=$LOCKED_STAKE"
    if [ "$LOCKED_STAKE" != "0" ]; then STAKE_FAIL=1; fi
  done
  if [ "$STAKE_FAIL" -ne 0 ]; then
    echo "[e2e] ERREUR : part de caution encore bloquée après Closed" >&2
    E2E_EXIT_CODE=1
    exit 1
  fi
fi

E2E_EXIT_CODE=0
exit 0
