#!/usr/bin/env bash
#
# deploy-all.sh <RPC>
#
# Déploiement de bout en bout de la pile Team19 (phases 1, 2, 3) sur un
# Subnet-EVM Avalanche, en une seule commande, idempotent.
#
# Prérequis :
#   - forge et cast (Foundry) dans le PATH ;
#   - jq (ou python3 en repli) pour lire les adresses des broadcasts ;
#   - un RPC Subnet-EVM accessible, passé en premier argument ;
#   - une clé admin, fournie par l'UNE de ces deux variables d'environnement :
#       ADMIN_PRIVATE_KEY   clé privée brute (0x...), OU
#       ADMIN_ACCOUNT       nom d'un keystore Foundry (passé en --account).
#     Aucune clé n'est jamais écrite dans un fichier ni affichée.
#
# Variables d'environnement optionnelles :
#   ADDR_1..ADDR_4   adresses de test (défaut : index 1-4 du mnemonic Foundry) ;
#   FEE, COMMIT_WINDOW, REVEAL_WINDOW, CONTEST_WINDOW, MIN_STAKE, LOCK_BPS,
#   STRIKE_LIMIT, EXCLUSION_REQUESTS, BONUS  : transmises telles quelles aux
#     scripts forge (le lot B s'en sert pour des fenêtres courtes) et
#     consignées dans le JSON de sortie.
#
# Le script est exécutable depuis n'importe quel dossier : il se replace à la
# racine du dépôt, calculée depuis son propre chemin.

set -euo pipefail

# --------------------------------------------------------------------------
# 0. Préparation : racine du dépôt, RPC, outils, clé admin
# --------------------------------------------------------------------------

# Racine du dépôt = parent du dossier script/ qui contient ce fichier.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

# Argument obligatoire : l'URL du RPC.
if [[ $# -lt 1 || -z "${1:-}" ]]; then
  echo "ERREUR : usage : $0 <RPC>" >&2
  exit 1
fi
RPC="$1"

# Outils requis.
for outil in forge cast; do
  if ! command -v "$outil" >/dev/null 2>&1; then
    echo "ERREUR : '$outil' introuvable dans le PATH." >&2
    exit 1
  fi
done

# Lecteur JSON : jq de préférence, python3 en repli.
if command -v jq >/dev/null 2>&1; then
  JSON_READER="jq"
elif command -v python3 >/dev/null 2>&1; then
  JSON_READER="python3"
else
  echo "ERREUR : ni jq ni python3 ne sont installés (lecture des broadcasts)." >&2
  exit 1
fi

# Clé admin : ADMIN_PRIVATE_KEY ou ADMIN_ACCOUNT, jamais les deux manquantes.
# On construit un tableau d'options passé à forge/cast ; la clé n'est jamais
# affichée (pas de set -x, pas d'echo).
ADMIN_PRIVATE_KEY="${ADMIN_PRIVATE_KEY:-}"
ADMIN_ACCOUNT="${ADMIN_ACCOUNT:-}"
declare -a SIGNER_OPTS
if [[ -n "$ADMIN_PRIVATE_KEY" ]]; then
  SIGNER_OPTS=(--private-key "$ADMIN_PRIVATE_KEY")
elif [[ -n "$ADMIN_ACCOUNT" ]]; then
  SIGNER_OPTS=(--account "$ADMIN_ACCOUNT")
else
  echo "ERREUR : fournissez ADMIN_PRIVATE_KEY (clé brute) OU ADMIN_ACCOUNT (keystore Foundry)." >&2
  exit 1
fi

# Adresse de l'admin, dérivée sans jamais afficher la clé.
if [[ -n "$ADMIN_PRIVATE_KEY" ]]; then
  ADMIN_ADDR="$(cast wallet address --private-key "$ADMIN_PRIVATE_KEY")"
else
  # cast wallet address --account peut demander le mot de passe du keystore.
  ADMIN_ADDR="$(cast wallet address --account "$ADMIN_ACCOUNT")"
fi

# --------------------------------------------------------------------------
# Précompilés Subnet-EVM (adresses figées).
# --------------------------------------------------------------------------
TX_ALLOW_LIST="0x0200000000000000000000000000000000000002"
NATIVE_MINTER="0x0200000000000000000000000000000000000001"

# Montant plancher frappé à chaque adresse de test : 1000 VETO.
MILLE_VETO="$(cast to-wei 1000 ether)"

# --------------------------------------------------------------------------
# Adresses de test : index 1-4 du mnemonic Foundry par défaut, surchargeables.
# Les adresses seules suffisent au déploiement (aucune clé de test requise).
# --------------------------------------------------------------------------
ADDR_1="${ADDR_1:-0x70997970C51812dc3A010C7d01b50e0d17dc79C8}"
ADDR_2="${ADDR_2:-0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC}"
ADDR_3="${ADDR_3:-0x90F79bf6EB2c4f870365E785982E1f101E93b906}"
ADDR_4="${ADDR_4:-0x15d34AAf54267DB7D7c367839AAf71A00a2C6A65}"
VERIFIERS=("$ADDR_1" "$ADDR_2" "$ADDR_3" "$ADDR_4")

# --------------------------------------------------------------------------
# Fenêtres et frais effectifs : valeurs d'environnement ou défauts des scripts
# forge. Consignés dans le JSON ; les scripts forge relisent ces mêmes
# variables (on les ré-exporte pour qu'elles leur parviennent à coup sûr).
# --------------------------------------------------------------------------
FEE="${FEE:-$(cast to-wei 3 ether)}"
COMMIT_WINDOW="${COMMIT_WINDOW:-180}"
REVEAL_WINDOW="${REVEAL_WINDOW:-60}"
CONTEST_WINDOW="${CONTEST_WINDOW:-600}"
MIN_STAKE="${MIN_STAKE:-$(cast to-wei 100 ether)}"
LOCK_BPS="${LOCK_BPS:-2000}"
STRIKE_LIMIT="${STRIKE_LIMIT:-3}"
EXCLUSION_REQUESTS="${EXCLUSION_REQUESTS:-10}"
BONUS="${BONUS:-$(cast to-wei 1 ether)}"
export FEE COMMIT_WINDOW REVEAL_WINDOW CONTEST_WINDOW MIN_STAKE LOCK_BPS \
  STRIKE_LIMIT EXCLUSION_REQUESTS BONUS

# Les scripts forge nomment le comité COMMITTEE_0..2 et les candidats
# CANDIDATE_1..4 ; on les aligne sur ADDR_1..4 pour cohérence bout en bout.
export COMMITTEE_0="$ADDR_1" COMMITTEE_1="$ADDR_2" COMMITTEE_2="$ADDR_3"
export CANDIDATE_1="$ADDR_1" CANDIDATE_2="$ADDR_2" CANDIDATE_3="$ADDR_3" CANDIDATE_4="$ADDR_4"

# --------------------------------------------------------------------------
# Options cast send communes. Subnet-EVM peut exiger des transactions legacy ;
# on détecte le besoin de --legacy une fois, au premier envoi.
# --------------------------------------------------------------------------
LEGACY_FLAG=""   # rempli à "--legacy" si nécessaire (voir detecter_legacy)

# Envoi d'une transaction signée par l'admin, avec --legacy si requis.
cast_send() {
  cast send "$@" --rpc-url "$RPC" "${SIGNER_OPTS[@]}" $LEGACY_FLAG >/dev/null
}

# Détecte si le RPC refuse les transactions typées EIP-1559 et bascule en legacy.
# Sonde inoffensive : estimation d'un transfert de 0 valeur de l'admin vers
# lui-même (adresse seule, aucune clé). Si le nœud rejette le type de
# transaction par défaut (dynamic fee), on force --legacy ; les erreurs sans
# rapport (ex. solde) laissent le mode par défaut.
detecter_legacy() {
  echo "  (sonde du mode de transaction : EIP-1559 vs legacy)"
  local sortie
  if sortie="$(cast estimate "$ADMIN_ADDR" --value 0 --from "$ADMIN_ADDR" --rpc-url "$RPC" 2>&1)"; then
    LEGACY_FLAG=""
    echo "  mode : EIP-1559 (type par défaut)"
  elif echo "$sortie" | grep -qiE "transaction type|dynamic fee|1559|not supported|unsupported"; then
    LEGACY_FLAG="--legacy"
    echo "  mode : legacy (--legacy, le nœud refuse l'EIP-1559)"
  else
    # L'échec ne porte pas sur le type de transaction : on garde le défaut.
    LEGACY_FLAG=""
    echo "  mode : EIP-1559 (type par défaut ; sonde non concluante, erreur hors sujet)"
  fi
}

# --------------------------------------------------------------------------
# 1. chainId
# --------------------------------------------------------------------------
echo "==> [1/9] Lecture du chainId"
CHAIN_ID="$(cast chain-id --rpc-url "$RPC")"
echo "    chainId = $CHAIN_ID"
echo "    admin   = $ADMIN_ADDR"
echo "    rpc     = $RPC"

detecter_legacy

# --------------------------------------------------------------------------
# 2. TxAllowList : chaque adresse de test doit avoir le rôle Enabled.
#    readAllowList(address) renvoie le rôle (0 = None, 1 = Enabled, 2 = Admin).
#    Si rôle 0, on appelle setEnabled(address) ; sinon on ne touche à rien.
# --------------------------------------------------------------------------
echo "==> [2/9] TxAllowList ($TX_ALLOW_LIST) : droit d'écriture des adresses 1-4"
for addr in "${VERIFIERS[@]}"; do
  role="$(cast call "$TX_ALLOW_LIST" "readAllowList(address)(uint256)" "$addr" --rpc-url "$RPC")"
  # cast peut renvoyer "0" ou "0 [0e0]" ; on garde le premier champ.
  role="${role%% *}"
  if [[ "$role" == "0" ]]; then
    echo "    $addr : rôle 0 -> setEnabled"
    cast_send "$TX_ALLOW_LIST" "setEnabled(address)" "$addr"
  else
    echo "    $addr : rôle $role (déjà autorisé), rien à faire"
  fi
done

# --------------------------------------------------------------------------
# 3. Native Minter : chaque adresse de test doit disposer d'au moins 1000 VETO.
#    Idempotent : on ne frappe que le complément manquant.
# --------------------------------------------------------------------------
echo "==> [3/9] Native Minter ($NATIVE_MINTER) : solde plancher 1000 VETO pour 1-4"
for addr in "${VERIFIERS[@]}"; do
  solde="$(cast balance "$addr" --rpc-url "$RPC")"
  # Comparaison en entiers 256 bits via python3 (bash ne gère pas ces grands nombres).
  # Affiche le complément manquant si solde < 1000 VETO, sinon une chaîne vide.
  manque="$(python3 -c "s=int('$solde'); c=int('$MILLE_VETO'); print(c-s if s<c else '')")"
  if [[ -n "$manque" ]]; then
    echo "    $addr : solde < 1000 VETO -> mint du complément"
    cast_send "$NATIVE_MINTER" "mintNativeCoin(address,uint256)" "$addr" "$manque"
  else
    echo "    $addr : solde >= 1000 VETO, rien à faire"
  fi
done

# --------------------------------------------------------------------------
# Lecteur d'adresse de contrat dans un broadcast run-latest.json.
#   lire_adresse <Script.s.sol> <ContractName>
# Renvoie l'adresse (CREATE) du contrat nommé, en minuscules.
# --------------------------------------------------------------------------
lire_adresse() {
  local script="$1" nom="$2"
  local fichier="broadcast/${script}/${CHAIN_ID}/run-latest.json"
  if [[ ! -f "$fichier" ]]; then
    echo "ERREUR : broadcast introuvable : $fichier" >&2
    return 1
  fi
  if [[ "$JSON_READER" == "jq" ]]; then
    jq -r --arg n "$nom" \
      'first(.transactions[] | select(.transactionType=="CREATE" and .contractName==$n) | .contractAddress)' \
      "$fichier"
  else
    python3 -c "
import json,sys
data=json.load(open('$fichier'))
for t in data['transactions']:
    if t.get('transactionType')=='CREATE' and t.get('contractName')=='$nom':
        print(t['contractAddress']); break
"
  fi
}

# Bloc courant, mémorisé comme bloc de départ avant tout déploiement de phase.
START_BLOCK="$(cast block-number --rpc-url "$RPC")"

# --------------------------------------------------------------------------
# 4. Phase 1 : VerificationMarket
# --------------------------------------------------------------------------
echo "==> [4/9] Phase 1 : DeployVerificationMarket"
forge script script/DeployVerificationMarket.s.sol \
  --rpc-url "$RPC" "${SIGNER_OPTS[@]}" --broadcast ${LEGACY_FLAG:+--legacy}
P1_MARKET="$(lire_adresse DeployVerificationMarket.s.sol VerificationMarket)"
echo "    VerificationMarket = $P1_MARKET"

# --------------------------------------------------------------------------
# 5. Phase 2 : Registry, Slashing, Rewards, StakedVerificationMarket
# --------------------------------------------------------------------------
echo "==> [5/9] Phase 2 : DeployPhase2"
forge script script/DeployPhase2.s.sol \
  --rpc-url "$RPC" "${SIGNER_OPTS[@]}" --broadcast ${LEGACY_FLAG:+--legacy}
P2_REGISTRY="$(lire_adresse DeployPhase2.s.sol VerifierRegistry)"
P2_SLASHING="$(lire_adresse DeployPhase2.s.sol Slashing)"
P2_REWARDS="$(lire_adresse DeployPhase2.s.sol Rewards)"
P2_MARKET="$(lire_adresse DeployPhase2.s.sol StakedVerificationMarket)"
echo "    VerifierRegistry         = $P2_REGISTRY"
echo "    Slashing                 = $P2_SLASHING"
echo "    Rewards                  = $P2_REWARDS"
echo "    StakedVerificationMarket = $P2_MARKET"

# --------------------------------------------------------------------------
# 6. Phase 3 : marché à comité tiré + ERC-8004. Optimiseur obligatoire :
#    sans lui, DrawnVerificationMarket dépasse 24 576 octets.
# --------------------------------------------------------------------------
echo "==> [6/9] Phase 3 : DeployPhase3 (--optimize --optimizer-runs 200)"
forge script script/DeployPhase3.s.sol --optimize --optimizer-runs 200 \
  --rpc-url "$RPC" "${SIGNER_OPTS[@]}" --broadcast ${LEGACY_FLAG:+--legacy}
P3_REGISTRY="$(lire_adresse DeployPhase3.s.sol VerifierRegistry)"
P3_SLASHING="$(lire_adresse DeployPhase3.s.sol Slashing)"
P3_REWARDS="$(lire_adresse DeployPhase3.s.sol Rewards)"
P3_MARKET="$(lire_adresse DeployPhase3.s.sol DrawnVerificationMarket)"
P3_IDENTITY="$(lire_adresse DeployPhase3.s.sol AgentIdentityRegistry)"
P3_REPUTATION="$(lire_adresse DeployPhase3.s.sol AgentReputationRegistry)"
P3_VALIDATION="$(lire_adresse DeployPhase3.s.sol AgentValidationRegistry)"
echo "    VerifierRegistry        = $P3_REGISTRY"
echo "    Slashing                = $P3_SLASHING"
echo "    Rewards                 = $P3_REWARDS"
echo "    DrawnVerificationMarket = $P3_MARKET"
echo "    AgentIdentityRegistry   = $P3_IDENTITY"
echo "    AgentReputationRegistry = $P3_REPUTATION"
echo "    AgentValidationRegistry = $P3_VALIDATION"

# --------------------------------------------------------------------------
# 7. Native Minter : chaque contrat Rewards (phase 2 et 3) doit être autorisé
#    à frapper (il verse le bonus en VETO). Même interface d'allow list que
#    la TxAllowList : readAllowList/setEnabled. Idempotent.
# --------------------------------------------------------------------------
echo "==> [7/9] Native Minter : autorisation de frappe des contrats Rewards"
for rewards in "$P2_REWARDS" "$P3_REWARDS"; do
  role="$(cast call "$NATIVE_MINTER" "readAllowList(address)(uint256)" "$rewards" --rpc-url "$RPC")"
  role="${role%% *}"
  if [[ "$role" == "0" ]]; then
    echo "    Rewards $rewards : rôle 0 -> setEnabled (minter)"
    cast_send "$NATIVE_MINTER" "setEnabled(address)" "$rewards"
  else
    echo "    Rewards $rewards : rôle $role (déjà autorisé), rien à faire"
  fi
done

# --------------------------------------------------------------------------
# 8. VetoDesk : guichet d'émission de VETO (opérateur = admin), autorisé à
#    frapper sur le Native Minter. Idempotent pour l'autorisation.
# --------------------------------------------------------------------------
echo "==> [8/9] VetoDesk : déploiement et autorisation de frappe"
DESK_JSON="$(forge create src/VetoDesk.sol:VetoDesk --json \
  --rpc-url "$RPC" "${SIGNER_OPTS[@]}" --broadcast ${LEGACY_FLAG:+--legacy})"
if [[ "$JSON_READER" == "jq" ]]; then
  VETO_DESK="$(jq -r .deployedTo <<<"$DESK_JSON")"
else
  VETO_DESK="$(python3 -c 'import json,sys; print(json.load(sys.stdin)["deployedTo"])' <<<"$DESK_JSON")"
fi
VETO_DESK="$(tr '[:upper:]' '[:lower:]' <<<"$VETO_DESK")"
if [[ ! "$VETO_DESK" =~ ^0x[0-9a-f]{40}$ ]]; then
  echo "ERREUR : adresse de VetoDesk illisible : $VETO_DESK" >&2
  exit 1
fi
echo "    VetoDesk = $VETO_DESK"
role="$(cast call "$NATIVE_MINTER" "readAllowList(address)(uint256)" "$VETO_DESK" --rpc-url "$RPC")"
role="${role%% *}"
if [[ "$role" == "0" ]]; then
  echo "    VetoDesk : rôle 0 -> setEnabled (minter)"
  cast_send "$NATIVE_MINTER" "setEnabled(address)" "$VETO_DESK"
else
  echo "    VetoDesk : rôle $role (déjà autorisé), rien à faire"
fi

# --------------------------------------------------------------------------
# 9. Écriture du JSON des adresses : horodaté + copie vers latest.json.
# --------------------------------------------------------------------------
echo "==> [9/9] Écriture des adresses dans deployments/"
mkdir -p deployments
STAMP="$(date -u +%Y%m%d-%H%M%S)"
OUT="deployments/${CHAIN_ID}-${STAMP}.json"

# On construit le JSON avec jq pour un échappement correct ; python3 en repli.
if [[ "$JSON_READER" == "jq" ]]; then
  jq -n \
    --arg chainId "$CHAIN_ID" \
    --arg rpc "$RPC" \
    --arg admin "$ADMIN_ADDR" \
    --arg startBlock "$START_BLOCK" \
    --arg timestamp "$STAMP" \
    --arg p1_market "$P1_MARKET" \
    --arg p2_registry "$P2_REGISTRY" --arg p2_slashing "$P2_SLASHING" \
    --arg p2_rewards "$P2_REWARDS" --arg p2_market "$P2_MARKET" \
    --arg veto_desk "$VETO_DESK" \
    --arg p3_registry "$P3_REGISTRY" --arg p3_slashing "$P3_SLASHING" \
    --arg p3_rewards "$P3_REWARDS" --arg p3_market "$P3_MARKET" \
    --arg p3_identity "$P3_IDENTITY" --arg p3_reputation "$P3_REPUTATION" \
    --arg p3_validation "$P3_VALIDATION" \
    --arg v1 "$ADDR_1" --arg v2 "$ADDR_2" --arg v3 "$ADDR_3" --arg v4 "$ADDR_4" \
    --arg fee "$FEE" --arg commit "$COMMIT_WINDOW" --arg reveal "$REVEAL_WINDOW" \
    --arg contest "$CONTEST_WINDOW" --arg minStake "$MIN_STAKE" --arg lockBps "$LOCK_BPS" \
    --arg strikeLimit "$STRIKE_LIMIT" --arg exclusion "$EXCLUSION_REQUESTS" --arg bonus "$BONUS" \
    '{
      chainId: ($chainId|tonumber),
      rpc: $rpc,
      admin: $admin,
      startBlock: ($startBlock|tonumber),
      timestamp: $timestamp,
      phase1: { VerificationMarket: $p1_market },
      phase2: {
        VerifierRegistry: $p2_registry,
        Slashing: $p2_slashing,
        Rewards: $p2_rewards,
        StakedVerificationMarket: $p2_market,
        VetoDesk: $veto_desk
      },
      phase3: {
        VerifierRegistry: $p3_registry,
        Slashing: $p3_slashing,
        Rewards: $p3_rewards,
        DrawnVerificationMarket: $p3_market,
        AgentIdentityRegistry: $p3_identity,
        AgentReputationRegistry: $p3_reputation,
        AgentValidationRegistry: $p3_validation
      },
      verifiers: { "1": $v1, "2": $v2, "3": $v3, "4": $v4 },
      params: {
        FEE: $fee,
        COMMIT_WINDOW: ($commit|tonumber),
        REVEAL_WINDOW: ($reveal|tonumber),
        CONTEST_WINDOW: ($contest|tonumber),
        MIN_STAKE: $minStake,
        LOCK_BPS: ($lockBps|tonumber),
        STRIKE_LIMIT: ($strikeLimit|tonumber),
        EXCLUSION_REQUESTS: ($exclusion|tonumber),
        BONUS: $bonus
      }
    }' > "$OUT"
else
  python3 - "$OUT" <<PYEOF
import json,sys
out=sys.argv[1]
data={
  "chainId": int("$CHAIN_ID"),
  "rpc": "$RPC",
  "admin": "$ADMIN_ADDR",
  "startBlock": int("$START_BLOCK"),
  "timestamp": "$STAMP",
  "phase1": {"VerificationMarket": "$P1_MARKET"},
  "phase2": {
    "VerifierRegistry": "$P2_REGISTRY",
    "Slashing": "$P2_SLASHING",
    "Rewards": "$P2_REWARDS",
    "StakedVerificationMarket": "$P2_MARKET",
    "VetoDesk": "$VETO_DESK"
  },
  "phase3": {
    "VerifierRegistry": "$P3_REGISTRY",
    "Slashing": "$P3_SLASHING",
    "Rewards": "$P3_REWARDS",
    "DrawnVerificationMarket": "$P3_MARKET",
    "AgentIdentityRegistry": "$P3_IDENTITY",
    "AgentReputationRegistry": "$P3_REPUTATION",
    "AgentValidationRegistry": "$P3_VALIDATION"
  },
  "verifiers": {"1": "$ADDR_1", "2": "$ADDR_2", "3": "$ADDR_3", "4": "$ADDR_4"},
  "params": {
    "FEE": "$FEE",
    "COMMIT_WINDOW": int("$COMMIT_WINDOW"),
    "REVEAL_WINDOW": int("$REVEAL_WINDOW"),
    "CONTEST_WINDOW": int("$CONTEST_WINDOW"),
    "MIN_STAKE": "$MIN_STAKE",
    "LOCK_BPS": int("$LOCK_BPS"),
    "STRIKE_LIMIT": int("$STRIKE_LIMIT"),
    "EXCLUSION_REQUESTS": int("$EXCLUSION_REQUESTS"),
    "BONUS": "$BONUS"
  }
}
json.dump(data, open(out,"w"), indent=2)
PYEOF
fi

cp "$OUT" deployments/latest.json
echo "    écrit : $OUT"
echo "    copié : deployments/latest.json"
echo "==> Déploiement terminé."
