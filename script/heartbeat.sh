#!/usr/bin/env bash
#
# heartbeat.sh [--prepare] <RPC> [intervalle en s, 5 par défaut]
#
# Battement de blocs pour la démo. Le L1 Subnet-EVM ne produit un bloc qu'à
# chaque transaction : sans trafic, block.timestamp reste figé et une demande
# peut rester bloquée en Commit, Reveal ou Contest. Ce script envoie, à chaque
# intervalle, une transaction neutre de 0 VETO de son adresse vers elle-même,
# et affiche le numéro du bloc produit. Arrêt propre par Ctrl-C.
#
# Adresse dédiée : index 9 du mnemonic de test public (Foundry/anvil). La clé
# est dérivée par cast à l'exécution, jamais écrite ni affichée. Les index 1 à
# 4 sont réservés aux services du marché : les partager provoquerait des
# collisions de nonce.
#
# --prepare : admet l'adresse sur la TxAllowList et la crédite en VETO, signé
# par la clé admin passée dans ADMIN_PRIVATE_KEY (comme deploy-all.sh). Sans
# --prepare, aucune clé admin n'est requise.

set -euo pipefail

usage() {
  echo "usage : $0 [--prepare] <RPC> [intervalle en s, 5 par défaut]" >&2
  exit 1
}

# --------------------------------------------------------------------------
# Arguments
# --------------------------------------------------------------------------
PREPARE=0
declare -a POSITIONNELS=()
for arg in "$@"; do
  case "$arg" in
    --prepare) PREPARE=1 ;;
    -h|--help) usage ;;
    -*) echo "ERREUR : option inconnue : $arg" >&2; usage ;;
    *) POSITIONNELS+=("$arg") ;;
  esac
done
if [[ ${#POSITIONNELS[@]} -lt 1 || ${#POSITIONNELS[@]} -gt 2 || -z "${POSITIONNELS[0]}" ]]; then
  usage
fi
RPC="${POSITIONNELS[0]}"
INTERVALLE="${POSITIONNELS[1]:-5}"
if [[ ! "$INTERVALLE" =~ ^[1-9][0-9]*$ ]]; then
  echo "ERREUR : l'intervalle doit être un entier positif de secondes (reçu : $INTERVALLE)" >&2
  exit 1
fi

if ! command -v cast >/dev/null 2>&1; then
  echo "ERREUR : 'cast' (Foundry) introuvable dans le PATH." >&2
  exit 1
fi

# --------------------------------------------------------------------------
# Constantes
# --------------------------------------------------------------------------
MNEMONIC="test test test test test test test test test test test junk"
INDEX=9
TX_ALLOW_LIST="0x0200000000000000000000000000000000000002"
NATIVE_MINTER="0x0200000000000000000000000000000000000001"
# Plancher de solde : chaque battement coûte une fraction de VETO en gaz.
PLANCHER="$(cast to-wei 100 ether)"

# Signataire du battement : cast dérive la clé lui-même depuis le mnemonic
# public, elle ne transite par aucune variable du script.
SIGNER_HB=(--mnemonic "$MNEMONIC" --mnemonic-index "$INDEX")
HB_ADDR="$(cast wallet address "${SIGNER_HB[@]}")"

# Premier champ d'une sortie cast ("0 [0e0]" -> "0").
premier_champ() { awk '{print $1; exit}'; }

# --------------------------------------------------------------------------
# RPC joignable ?
# --------------------------------------------------------------------------
if ! CHAIN_ID="$(cast chain-id --rpc-url "$RPC" 2>/dev/null)"; then
  echo "ERREUR : le RPC ne répond pas ($RPC)." >&2
  exit 1
fi
echo "chainId = $CHAIN_ID, adresse du battement = $HB_ADDR (index $INDEX)"

# --------------------------------------------------------------------------
# --prepare : admission et crédit, signés par l'admin
# --------------------------------------------------------------------------
if [[ "$PREPARE" -eq 1 ]]; then
  ADMIN_PRIVATE_KEY="${ADMIN_PRIVATE_KEY:-}"
  if [[ -z "$ADMIN_PRIVATE_KEY" ]]; then
    echo "ERREUR : --prepare exige ADMIN_PRIVATE_KEY (clé admin brute)." >&2
    exit 1
  fi
  # L'admin peut être utilisé en même temps par un autre script (nonce
  # disputé, « replacement transaction underpriced ») : trois essais espacés.
  admin_send() {
    local essai
    for essai in 1 2 3; do
      if cast send "$@" --rpc-url "$RPC" --private-key "$ADMIN_PRIVATE_KEY" >/dev/null; then
        return 0
      fi
      echo "prepare : envoi admin refusé (essai $essai/3), nouvel essai dans 3 s" >&2
      sleep 3
    done
    echo "ERREUR : l'envoi admin a échoué trois fois." >&2
    exit 1
  }

  role="$(cast call "$TX_ALLOW_LIST" "readAllowList(address)(uint256)" "$HB_ADDR" --rpc-url "$RPC" | premier_champ)"
  if [[ "$role" == "0" ]]; then
    echo "prepare : TxAllowList, rôle 0 -> setEnabled"
    admin_send "$TX_ALLOW_LIST" "setEnabled(address)" "$HB_ADDR"
  else
    echo "prepare : TxAllowList, rôle $role, rien à faire"
  fi

  solde="$(cast balance "$HB_ADDR" --rpc-url "$RPC")"
  manque="$(python3 -c "s=int('$solde'); c=int('$PLANCHER'); print(c-s if s<c else '')")"
  if [[ -n "$manque" ]]; then
    echo "prepare : solde < 100 VETO -> mint du complément"
    admin_send "$NATIVE_MINTER" "mintNativeCoin(address,uint256)" "$HB_ADDR" "$manque"
  else
    echo "prepare : solde >= 100 VETO, rien à faire"
  fi
fi

# --------------------------------------------------------------------------
# L'adresse doit être admise et approvisionnée
# --------------------------------------------------------------------------
role="$(cast call "$TX_ALLOW_LIST" "readAllowList(address)(uint256)" "$HB_ADDR" --rpc-url "$RPC" | premier_champ)"
if [[ "$role" == "0" ]]; then
  echo "ERREUR : $HB_ADDR n'est pas admise sur la TxAllowList. Lancez une fois : ADMIN_PRIVATE_KEY=… $0 --prepare <RPC>" >&2
  exit 1
fi
solde="$(cast balance "$HB_ADDR" --rpc-url "$RPC")"
if [[ "$solde" == "0" ]]; then
  echo "ERREUR : $HB_ADDR n'a aucun VETO pour payer le gaz. Lancez une fois : ADMIN_PRIVATE_KEY=… $0 --prepare <RPC>" >&2
  exit 1
fi

# --------------------------------------------------------------------------
# Boucle de battement
# --------------------------------------------------------------------------
PID_SOMMEIL=""
arreter() {
  [[ -n "$PID_SOMMEIL" ]] && kill "$PID_SOMMEIL" 2>/dev/null
  echo ""
  echo "battement arrêté ($BATTEMENTS battements envoyés)."
  exit 0
}
trap arreter INT TERM

BATTEMENTS=0
echo "battement toutes les ${INTERVALLE} s, Ctrl-C pour arrêter."
prochain=$SECONDS
while true; do
  # Envoi synchrone : on attend le reçu, donc jamais deux transactions en vol
  # sur le même nonce.
  if sortie="$(cast send "$HB_ADDR" --value 0 --rpc-url "$RPC" "${SIGNER_HB[@]}" --timeout 30 2>&1)"; then
    BATTEMENTS=$((BATTEMENTS + 1))
    bloc="$(awk '$1=="blockNumber" {print $2; exit}' <<<"$sortie")"
    echo "$(date +%H:%M:%S) battement $BATTEMENTS : bloc ${bloc:-?}"
  else
    # Erreur passagère (RPC, nonce, délai) : on l'affiche et on réessaie.
    echo "$(date +%H:%M:%S) erreur, nouvel essai au prochain battement : $(tail -n 1 <<<"$sortie")" >&2
  fi
  # Cadence fixe : l'envoi est décompté de l'intervalle.
  prochain=$((prochain + INTERVALLE))
  attente=$((prochain - SECONDS))
  if [[ "$attente" -gt 0 ]]; then
    # sleep en arrière-plan + wait : Ctrl-C est traité sans attendre la fin.
    sleep "$attente" &
    PID_SOMMEIL=$!
    wait "$PID_SOMMEIL" || true
    PID_SOMMEIL=""
  else
    prochain=$SECONDS
  fi
done
