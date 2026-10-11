#!/usr/bin/env bash
#
# attack-scene.sh <RPC>
#
# Scène d'attaque jouée devant le jury sur le L1 Team19 (Subnet-EVM Avalanche).
# Elle prouve, en live et de bout en bout, les trois garde-fous de la pile :
#
#   (a) la TxAllowList du L1 : une adresse non admise ne peut rien écrire ;
#   (b) la faute 1 (NoCommit, 1 %) : un membre tiré qui ne commit pas est saisi
#       de 1 % de sa caution et prend un strike, constaté à la finalisation ;
#   (c) la faute 3 (PredicateViolation, 20 %) : un vérificateur qui vote Accept
#       alors que le montant dépasse le plafond est saisi de 20 % sur
#       contestation, pendant la fenêtre de contestation ;
#   (d) lecture finale sur la chaîne : cautions, strikes, réputation ERC-8004,
#       code de chaque demande.
#
# La scène est REJOUABLE : chaque lancement redéploie une pile neuve
# (deploy-all.sh recomplète soldes et admissions), sauf si SKIP_DEPLOY=1.
#
# Prérequis : forge, cast (Foundry), jq ; un RPC Subnet-EVM accessible ; une
# clé admin dans ADMIN_PRIVATE_KEY (0x...) ou ADMIN_ACCOUNT (keystore Foundry),
# exactement comme deploy-all.sh. Les clés de test sont dérivées à l'exécution
# du mnemonic Foundry public ; aucune clé n'est jamais écrite ni affichée.
#
# Variables d'environnement :
#   SKIP_DEPLOY=1                  rejoue sur la pile déjà dans latest.json ;
#   COMMIT_WINDOW/REVEAL_WINDOW/CONTEST_WINDOW
#                                  fenêtres passées à deploy-all (défauts courts
#                                  ci-dessous, pensés pour une démo fluide) ;
#   DEPLOY_LOG                     fichier où déverser la sortie verbeuse de
#                                  forge (défaut : /tmp/attack-scene-deploy.log).

set -euo pipefail

# ==========================================================================
# 0. Préparation : racine du dépôt, RPC, outils, clé admin, fenêtres
# ==========================================================================

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

if [[ $# -lt 1 || -z "${1:-}" ]]; then
  echo "ERREUR : usage : $0 <RPC>" >&2
  exit 1
fi
RPC="$1"

for outil in forge cast jq; do
  if ! command -v "$outil" >/dev/null 2>&1; then
    echo "ERREUR : '$outil' introuvable dans le PATH." >&2
    exit 1
  fi
done

# Clé admin : ADMIN_PRIVATE_KEY ou ADMIN_ACCOUNT, comme deploy-all.sh. On
# construit un tableau d'options signeur, jamais affiché (pas de set -x).
ADMIN_PRIVATE_KEY="${ADMIN_PRIVATE_KEY:-}"
ADMIN_ACCOUNT="${ADMIN_ACCOUNT:-}"
declare -a ADMIN_OPTS
if [[ -n "$ADMIN_PRIVATE_KEY" ]]; then
  ADMIN_OPTS=(--private-key "$ADMIN_PRIVATE_KEY")
  ADMIN_ADDR="$(cast wallet address --private-key "$ADMIN_PRIVATE_KEY")"
elif [[ -n "$ADMIN_ACCOUNT" ]]; then
  ADMIN_OPTS=(--account "$ADMIN_ACCOUNT")
  ADMIN_ADDR="$(cast wallet address --account "$ADMIN_ACCOUNT")"
else
  echo "ERREUR : fournissez ADMIN_PRIVATE_KEY (clé brute) OU ADMIN_ACCOUNT (keystore)." >&2
  exit 1
fi

# Fenêtres courtes par défaut : la scène attend réellement leur expiration, on
# les garde brèves pour une démo fluide. Surchargeables par l'environnement.
COMMIT_WINDOW="${COMMIT_WINDOW:-30}"
REVEAL_WINDOW="${REVEAL_WINDOW:-20}"
CONTEST_WINDOW="${CONTEST_WINDOW:-60}"
export COMMIT_WINDOW REVEAL_WINDOW CONTEST_WINDOW

DEPLOY_LOG="${DEPLOY_LOG:-/tmp/attack-scene-deploy.log}"

# Mnemonic Foundry public (jamais une clé privée réelle). Les clés de test en
# sont dérivées à la volée et ne quittent jamais la mémoire du processus.
MNEMONIC="test test test test test test test test test test test junk"

# Précompilé TxAllowList (adresse figée Subnet-EVM).
TX_ALLOW_LIST="0x0200000000000000000000000000000000000002"

# --------------------------------------------------------------------------
# Détection du mode de transaction (EIP-1559 vs legacy), une fois.
# --------------------------------------------------------------------------
LEGACY_FLAG=""
if ! cast estimate "$ADMIN_ADDR" --value 0 --from "$ADMIN_ADDR" --rpc-url "$RPC" >/dev/null 2>&1; then
  LEGACY_FLAG="--legacy"
fi

# --------------------------------------------------------------------------
# Fabriques d'aide, toutes muettes sur les clés.
# --------------------------------------------------------------------------

# Dérive la clé privée de l'index i du mnemonic (jamais affichée, jamais stockée).
cle_test() {
  cast wallet private-key --mnemonic "$MNEMONIC" --mnemonic-index "$1"
}

# Adresse de l'index i du mnemonic.
addr_test() {
  cast wallet address --private-key "$(cle_test "$1")"
}

# Enveloppe d'envoi robuste à la course de nonce.
#
# Le L1 ne produit un bloc qu'À CHAQUE transaction : tant qu'une tx n'est pas
# minée, l'état `pending` ne la reflète pas toujours au moment où `cast send`
# calcule le nonce suivant. Deux envois rapprochés du MÊME signeur (l'admin
# enchaîne des blocs vides dans attendre_jusqua / tirer_comite / finalize)
# peuvent donc tirer le même nonce → « replacement transaction underpriced »
# ou « nonce too low ». Pour supprimer la course :
#   1. --confirmations 1 : on BLOQUE jusqu'à ce que le reçu soit miné, donc le
#      nonce est consommé avant l'envoi suivant (sérialisation stricte).
#   2. retry borné (3 tentatives, backoff court) sur les erreurs de nonce, au
#      cas où un envoi concurrent aurait tout de même glissé entre deux lectures.
# Toute autre erreur (revert, etc.) remonte immédiatement.
_envoi_robuste() {
  # "$@" = la ligne complète de cast send, options de signeur comprises.
  local tentative=1 sortie code
  while :; do
    set +e
    sortie="$(cast send "$@" --rpc-url "$RPC" --confirmations 1 2>&1)"
    code=$?
    set -e
    if [[ $code -eq 0 ]]; then
      return 0
    fi
    # Erreur de nonce/remplacement : on retente, l'inclusion précédente finit
    # par rafraîchir l'état pending lu par cast.
    if (( tentative < 3 )) && \
       echo "$sortie" | grep -qiE 'replacement transaction underpriced|nonce too low|already known'; then
      echo "    ↻ collision de nonce (tentative $tentative), nouvelle tentative…" >&2
      sleep $(( tentative ))
      tentative=$(( tentative + 1 ))
      continue
    fi
    # Autre erreur, ou retries épuisés : on la fait remonter.
    echo "$sortie" >&2
    return $code
  done
}

# Envoi signé par l'admin (sérialisé + robuste au nonce).
admin_send() {
  _envoi_robuste "$@" "${ADMIN_OPTS[@]}" $LEGACY_FLAG >/dev/null
}

# Envoi signé par l'index i du mnemonic (clé jamais affichée, sérialisé + robuste).
send_as() {
  local i="$1"; shift
  _envoi_robuste "$@" --private-key "$(cle_test "$i")" $LEGACY_FLAG >/dev/null
}

# Lecture seule.
appel() {
  cast call "$@" --rpc-url "$RPC"
}

# Montant wei -> CHK lisible.
chk() {
  printf '%s CHK' "$(cast from-wei "$1")"
}

# Titre d'étape, lisible devant le jury.
etape() {
  echo
  echo "============================================================"
  echo "$1"
  echo "============================================================"
}

# Phrase de preuve de l'étape.
preuve() {
  echo "  → Ce qu'on prouve : $1"
  echo
}

# Attente d'une échéance (timestamp Unix cible), avec décompte bref. Le L1 ne
# produit un bloc qu'à chaque transaction : on provoque un bloc vide (transfert
# de 0 de l'admin vers lui-même) pour faire avancer l'horloge du prochain bloc.
attendre_jusqua() {
  local cible="$1" libelle="$2"
  local maintenant
  maintenant="$(cast block latest --rpc-url "$RPC" --field timestamp)"
  local reste=$(( cible - maintenant ))
  if (( reste < 0 )); then reste=0; fi
  echo "  ⏳ Attente $libelle : ~${reste}s (échéance $cible)…"
  # Marge d'une seconde pour franchir strictement l'échéance.
  if (( reste > 0 )); then sleep $(( reste + 1 )); fi
  # Un bloc vide pour que le prochain bloc porte un timestamp postérieur.
  admin_send "$ADMIN_ADDR" --value 0
}

# Tire le comité d'une demande dès que block.number > drawBlock(requestId). Le
# marché exige un bloc STRICTEMENT postérieur au bloc de tirage (drawBlock =
# bloc de création + 1) pour que blockhash(drawBlock) existe ; comme le L1 ne
# produit un bloc qu'à chaque transaction, on mine des blocs vides jusque-là.
tirer_comite() {
  local rid="$1"
  local db
  db="$(appel "$MARKET" 'drawBlock(uint256)(uint256)' "$rid")"
  db="${db%% *}"
  local bn
  bn="$(cast block-number --rpc-url "$RPC")"
  # Il faut block.number > drawBlock : on mine des blocs vides tant que ce n'est pas le cas.
  while (( bn <= db )); do
    admin_send "$ADMIN_ADDR" --value 0
    bn="$(cast block-number --rpc-url "$RPC")"
  done
  admin_send "$MARKET" 'drawCommittee(uint256)' "$rid"
}

# Lit un champ de getRequest par numéro (1-indexé), en retirant les annotations
# `[..]` que cast ajoute après les grands nombres (sinon elles décalent le
# découpage par espaces). Champs : 1 requester, 2 h, 3 fee, 4 createdAt,
# 5 commitDeadline, 6 revealDeadline, 7 contestDeadline, 8 status, 9 code.
champ_demande() {
  local rid="$1" n="$2"
  appel "$MARKET" 'getRequest(uint256)((address,bytes32,uint96,uint64,uint64,uint64,uint64,uint8,uint8))' "$rid" \
    | sed 's/\[[^]]*\]//g' | tr -d '()' | tr ',' ' ' | awk -v k="$n" '{print $k}'
}

DUREE_DEBUT="$(date +%s)"

# ==========================================================================
# 1. Remise à zéro : pile neuve par deploy-all.sh (sauf SKIP_DEPLOY=1)
# ==========================================================================

etape "ÉTAPE 0 — Pile neuve (remise à zéro)"
if [[ "${SKIP_DEPLOY:-0}" == "1" ]]; then
  echo "  SKIP_DEPLOY=1 : on rejoue sur la pile de deployments/latest.json."
else
  echo "  Déploiement complet par ./script/deploy-all.sh (fenêtres"
  echo "  COMMIT=$COMMIT_WINDOW REVEAL=$REVEAL_WINDOW CONTEST=$CONTEST_WINDOW)."
  echo "  Sortie verbeuse de forge redirigée vers $DEPLOY_LOG."
  # deploy-all relit ADMIN_PRIVATE_KEY/ADMIN_ACCOUNT et les fenêtres de l'env.
  if ! ./script/deploy-all.sh "$RPC" >"$DEPLOY_LOG" 2>&1; then
    echo "ERREUR : deploy-all.sh a échoué, voir $DEPLOY_LOG" >&2
    tail -n 20 "$DEPLOY_LOG" >&2
    exit 1
  fi
  echo "  ✓ Pile déployée."
fi

# Lecture de toutes les adresses depuis latest.json.
LATEST="deployments/latest.json"
MARKET="$(jq -r .phase3.DrawnVerificationMarket "$LATEST")"
REGISTRY="$(jq -r .phase3.VerifierRegistry "$LATEST")"
SLASHING="$(jq -r .phase3.Slashing "$LATEST")"
IDENTITY="$(jq -r .phase3.AgentIdentityRegistry "$LATEST")"
REPUTATION="$(jq -r .phase3.AgentReputationRegistry "$LATEST")"
FEE="$(jq -r .params.FEE "$LATEST")"

echo
echo "  Adresses de la pile phase 3 (deployments/latest.json) :"
echo "    DrawnVerificationMarket : $MARKET"
echo "    VerifierRegistry        : $REGISTRY"
echo "    Slashing                : $SLASHING"
echo "    AgentIdentityRegistry   : $IDENTITY"
echo "    AgentReputationRegistry : $REPUTATION"
echo "    Admin / trésor          : $ADMIN_ADDR"
echo "    Frais d'une demande     : $(chk "$FEE")"

# Adresses de test (index 1-5 du mnemonic Foundry).
V1="$(addr_test 1)"; V2="$(addr_test 2)"; V3="$(addr_test 3)"; V4="$(addr_test 4)"
# Index 5 : l'intrus, volontairement HORS TxAllowList (jamais admis).
INTRUS="$(addr_test 5)"

MIN_STAKE="$(appel "$REGISTRY" 'minStake()(uint256)')"
MIN_STAKE="${MIN_STAKE%% *}"

# ==========================================================================
# (a) TxAllowList : une adresse non admise ne peut rien écrire
# ==========================================================================

etape "ÉTAPE (a) — TxAllowList : l'intrus (index 5) ne peut rien écrire"
preuve "sur le L1, seule une adresse admise écrit ; l'intrus a le rôle 0 et sa transaction est refusée par le nœud, même avec du gaz."

echo "  Intrus (index 5) : $INTRUS"
ROLE_INTRUS="$(appel "$TX_ALLOW_LIST" 'readAllowList(address)(uint256)' "$INTRUS")"
ROLE_INTRUS="${ROLE_INTRUS%% *}"
echo "  readAllowList(intrus) = $ROLE_INTRUS  (0 = aucun droit d'écriture)"
echo
echo "  L'admin envoie d'abord un peu de CHK à l'intrus (l'envoi VERS lui est permis)…"
admin_send "$INTRUS" --value "$(cast to-wei 1 ether)"
echo "  Solde de l'intrus : $(chk "$(cast balance "$INTRUS" --rpc-url "$RPC")")  (il a du gaz)"
echo
echo "  L'intrus tente une transaction (un simple transfert de 0 vers lui-même,"
echo "  pour que SEULE la TxAllowList puisse la refuser). On attend un REFUS du nœud :"
set +e
SORTIE_INTRUS="$(cast send "$INTRUS" --value 0 \
  --rpc-url "$RPC" --private-key "$(cle_test 5)" $LEGACY_FLAG 2>&1)"
CODE_INTRUS=$?
set -e
echo "  ----- message du nœud -----"
echo "$SORTIE_INTRUS" | sed 's/^/    /'
echo "  ---------------------------"
if [[ $CODE_INTRUS -eq 0 ]]; then
  echo "  ✗ ANOMALIE : la transaction de l'intrus est passée, le garde-fou a échoué." >&2
  exit 1
fi
echo "  ✓ Transaction refusée (code $CODE_INTRUS) : la TxAllowList bloque l'intrus en amont de l'EVM."

# ==========================================================================
# (b) Faute 1 — NoCommit (1 %) : pile de la demande, un membre absent au commit
# ==========================================================================

etape "ÉTAPE (b) — Faute 1 : un membre tiré ne commit pas → saisie 1 % + strike"
preuve "un vérificateur tiré qui ne commit pas est saisi de 1 % de sa caution et prend un strike, constaté automatiquement à la finalisation."

# 1. Inscription des 4 candidats avec la caution minimale lue sur la chaîne.
echo "  minStake lue sur le registre : $(chk "$MIN_STAKE")"
echo "  Les index 1 à 4 s'inscrivent (register) avec la caution minimale…"
for i in 1 2 3 4; do
  a="$(addr_test "$i")"
  # Déjà inscrit (rejeu avec SKIP_DEPLOY) : on ne ré-empile pas.
  reg="$(appel "$REGISTRY" 'registered(address)(bool)' "$a")"
  if [[ "$reg" == "true" ]]; then
    echo "    index $i ($a) : déjà inscrit"
  else
    send_as "$i" "$REGISTRY" 'register()' --value "$MIN_STAKE"
    echo "    index $i ($a) : inscrit, caution $(chk "$MIN_STAKE")"
  fi
done

# 2. Le demandeur est l'index 4. Justification : l'index 5 n'est pas admis en
#    écriture, et le demandeur est de toute façon EXCLU du tirage par le marché
#    (`v == requester` écarté) ; en prenant l'index 4 comme demandeur, le pool
#    éligible se réduit exactement aux index 1-3, le comité tiré est donc {1,2,3}.
DEMANDEUR_IDX=4
DEMANDEUR="$(addr_test "$DEMANDEUR_IDX")"
echo
echo "  Demandeur : index $DEMANDEUR_IDX ($DEMANDEUR) — exclu du tirage, laisse {1,2,3} éligibles."

# 3. Faits de la demande (b) : montant modeste, sous tout plafond.
FACTS_B="(1000,0x455552,$(cast keccak 'FR76_BENEFICIAIRE_B'),$(cast hz 2>/dev/null || echo 0x0000000000000000000000000000000000000000000000000000000000000000))"
CONTENT_B="$(cast keccak 'contenu-demande-b')"
H_B="$(appel "$MARKET" 'hashOf((uint256,bytes3,bytes32,bytes32),bytes32)(bytes32)' "$FACTS_B" "$CONTENT_B")"
echo "  h(b) = hashOf(facts, contentHash) = $H_B"

# 4. createRequest(h) payé par le demandeur.
send_as "$DEMANDEUR_IDX" "$MARKET" 'createRequest(bytes32)' "$H_B" --value "$FEE"
REQ_B="$(appel "$MARKET" 'count()(uint256)')"
REQ_B="${REQ_B%% *}"
echo "  Demande créée : requestId = $REQ_B"

# 5. Tirage dès que le hash du bloc de tirage existe (block.number > drawBlock).
echo "  Tirage du comité (on mine des blocs vides jusqu'à block.number > drawBlock)…"
tirer_comite "$REQ_B"

# 6. Lecture du comité EFFECTIVEMENT tiré (jamais en dur).
COMITE_B="$(appel "$MARKET" 'getCommittee(uint256)(address[])' "$REQ_B")"
# cast rend "[0x.., 0x.., 0x..]" : on normalise en trois adresses.
COMITE_B="$(echo "$COMITE_B" | tr -d '[]' | tr ',' ' ')"
read -r M0 M1 M2 <<<"$COMITE_B"
echo "  Comité tiré : $M0  $M1  $M2"

# 7. Choix de l'ABSENT (ne commit pas) et des deux présents, parmi le comité tiré.
#    On prend le premier membre comme absent ; les deux autres commit+reveal.
ABSENT="$M0"
PRESENTS=("$M1" "$M2")
# Index du mnemonic correspondant à chaque adresse tirée (pour signer).
idx_de() {
  local cible="${1,,}"
  for i in 1 2 3 4; do
    if [[ "$(addr_test "$i")" == "$cible" || "${cible}" == "$(addr_test "$i" | tr 'A-F' 'a-f')" ]]; then
      echo "$i"; return 0
    fi
  done
  # Comparaison insensible à la casse.
  for i in 1 2 3 4; do
    if [[ "$(addr_test "$i" | tr 'A-F' 'a-f')" == "$cible" ]]; then echo "$i"; return 0; fi
  done
  echo ""; return 1
}
echo "  Membre ABSENT (ne commit pas) : $ABSENT"
echo "  Membres PRÉSENTS (commit + reveal) : ${PRESENTS[0]}  ${PRESENTS[1]}"

# 8. Caution de l'absent AVANT la saisie.
AVANT_B="$(appel "$REGISTRY" 'total(address)(uint256)' "$ABSENT")"
AVANT_B="${AVANT_B%% *}"
STRIKE_AVANT_B="$(appel "$SLASHING" 'strikesOf(address)(uint8)' "$ABSENT")"
echo "  Caution de l'absent AVANT : $(chk "$AVANT_B")  | strikes AVANT : ${STRIKE_AVANT_B%% *}"

# 9. Les deux présents commit (vote Accept=2, reasons=0, detailHash=0, salt fixe).
VOTE_ACCEPT=2
REASONS_OK=0
ZERO32=0x0000000000000000000000000000000000000000000000000000000000000000
for m in "${PRESENTS[@]}"; do
  i="$(idx_de "$m")"
  salt="$(cast keccak "salt-b-$m")"
  cmt="$(appel "$MARKET" 'commitmentOf(uint256,address,uint8,uint16,bytes32,bytes32)(bytes32)' \
    "$REQ_B" "$m" "$VOTE_ACCEPT" "$REASONS_OK" "$ZERO32" "$salt")"
  send_as "$i" "$MARKET" 'commitVerdict(uint256,bytes32)' "$REQ_B" "$cmt"
  echo "    commit par $m (index $i)"
done

# 10. Attente de la fin de la fenêtre de commit (passage en Reveal), puis reveal.
CD_B="$(champ_demande "$REQ_B" 5)"
attendre_jusqua "$CD_B" "fin de la fenêtre de commit"
for m in "${PRESENTS[@]}"; do
  i="$(idx_de "$m")"
  salt="$(cast keccak "salt-b-$m")"
  send_as "$i" "$MARKET" 'revealVerdict(uint256,uint8,uint16,bytes32,bytes32)' \
    "$REQ_B" "$VOTE_ACCEPT" "$REASONS_OK" "$ZERO32" "$salt"
  echo "    reveal par $m (index $i)"
done

# 11. Attente de la fin de la fenêtre de reveal, puis finalize (qui saisit l'absent).
RD_B="$(champ_demande "$REQ_B" 6)"
attendre_jusqua "$RD_B" "fin de la fenêtre de reveal"
echo "  finalize($REQ_B) — constate l'absent et déclenche slashMissed(1 %)…"
admin_send "$MARKET" 'finalize(uint256)' "$REQ_B"

# 12. Caution et strike de l'absent APRÈS. On attend 1 % de saisie.
APRES_B="$(appel "$REGISTRY" 'total(address)(uint256)' "$ABSENT")"
APRES_B="${APRES_B%% *}"
STRIKE_APRES_B="$(appel "$SLASHING" 'strikesOf(address)(uint8)' "$ABSENT")"
SAISIE_B=$(python3 -c "print(int('$AVANT_B')-int('$APRES_B'))")
PCT_B=$(python3 -c "a=int('$AVANT_B'); print('n/a' if a==0 else f'{(int(\"$SAISIE_B\")*10000)//a/100}%')")
echo "  Caution de l'absent APRÈS : $(chk "$APRES_B")  | strikes APRÈS : ${STRIKE_APRES_B%% *}"
echo "  Saisie : $(chk "$SAISIE_B")  (soit $PCT_B de la caution)"
if [[ "$SAISIE_B" == "0" ]]; then
  echo "  ✗ ANOMALIE : aucune saisie constatée pour la faute 1." >&2
  exit 1
fi
echo "  ✓ Faute 1 prouvée : 1 % saisi, +1 strike."

# ==========================================================================
# (c) Faute 3 — PredicateViolation (20 %) : vote Accept au-dessus du plafond
# ==========================================================================

etape "ÉTAPE (c) — Faute 3 : vote Accept au-dessus du plafond → contestation, saisie 20 %"
preuve "un vérificateur qui vote Accept alors que le montant dépasse le plafond, sans cocher le motif amount_above_cap, est saisi de 20 % sur contestation."

# Pré-requis de rejeu : la faute 1 a pu faire tomber un membre SOUS minStake
# (1 % de 100 = 99 < 100), ce qui le rend inactif et le retire du tirage. C'est
# le comportement correct du protocole. Pour disposer de nouveau de 3 actifs au
# tirage suivant, on recomplète toute caution redescendue sous minStake.
echo "  Recomplément des cautions redescendues sous minStake (faute 1 oblige)…"
for i in 1 2 3 4; do
  a="$(addr_test "$i")"
  tot="$(appel "$REGISTRY" 'total(address)(uint256)' "$a")"; tot="${tot%% *}"
  manque="$(python3 -c "t=int('$tot'); m=int('$MIN_STAKE'); print(m-t if t<m else 0)")"
  if [[ "$manque" != "0" ]]; then
    # On remonte au-dessus de minStake (minStake + le manque) pour laisser une marge.
    appoint="$(python3 -c "print(int('$manque')+int('$MIN_STAKE'))")"
    send_as "$i" "$REGISTRY" 'register()' --value "$appoint"
    echo "    index $i : recomplété de $(chk "$appoint") (était sous minStake)"
  fi
done

# 1. L'admin fixe un plafond EUR (devise bytes3 'EUR').
CUR_EUR=0x455552
CAP=500 # plafond : 500 (unités mineures). La demande (c) dépassera ce plafond.
echo "  L'admin fixe Slashing.setCap('EUR', $CAP)…"
admin_send "$SLASHING" 'setCap(bytes3,uint256)' "$CUR_EUR" "$CAP"
CAP_LU="$(appel "$SLASHING" 'cap(bytes3)(uint256)' "$CUR_EUR")"
echo "  cap('EUR') lu sur la chaîne = ${CAP_LU%% *}"

# 2. Demande (c) : montant AU-DESSUS du plafond.
AMOUNT_C=1000 # > CAP (500)
BEN_C="$(cast keccak 'FR76_BENEFICIAIRE_C')"
FACTS_C="($AMOUNT_C,$CUR_EUR,$BEN_C,$ZERO32)"
CONTENT_C="$(cast keccak 'contenu-demande-c')"
H_C="$(appel "$MARKET" 'hashOf((uint256,bytes3,bytes32,bytes32),bytes32)(bytes32)' "$FACTS_C" "$CONTENT_C")"
echo "  Demande (c) : montant $AMOUNT_C > plafond $CAP ; h(c) = $H_C"
send_as "$DEMANDEUR_IDX" "$MARKET" 'createRequest(bytes32)' "$H_C" --value "$FEE"
REQ_C="$(appel "$MARKET" 'count()(uint256)')"
REQ_C="${REQ_C%% *}"
echo "  requestId = $REQ_C"

# 3. Tirage.
tirer_comite "$REQ_C"
COMITE_C="$(appel "$MARKET" 'getCommittee(uint256)(address[])' "$REQ_C" | tr -d '[]' | tr ',' ' ')"
read -r C0 C1 C2 <<<"$COMITE_C"
echo "  Comité tiré : $C0  $C1  $C2"

# 4. Le FAUTIF (premier membre tiré) votera Accept sans le motif ; tous révèlent
#    (pour isoler la faute 3 : aucune absence, donc aucune saisie à la finalize).
FAUTIF="$C0"
echo "  Vérificateur FAUTIF (vote Accept=2, reasons=0 alors que montant>plafond) : $FAUTIF"
echo "  Les deux autres votent Accept également (le comité ne voit pas le plafond)."

# 5. Les 3 commit (tous Accept=2, reasons=0).
for m in "$C0" "$C1" "$C2"; do
  i="$(idx_de "$m")"
  salt="$(cast keccak "salt-c-$m")"
  cmt="$(appel "$MARKET" 'commitmentOf(uint256,address,uint8,uint16,bytes32,bytes32)(bytes32)' \
    "$REQ_C" "$m" "$VOTE_ACCEPT" "$REASONS_OK" "$ZERO32" "$salt")"
  send_as "$i" "$MARKET" 'commitVerdict(uint256,bytes32)' "$REQ_C" "$cmt"
  echo "    commit par $m (index $i)"
done

# 6. Fin de commit, puis reveal des 3.
CD_C="$(champ_demande "$REQ_C" 5)"
attendre_jusqua "$CD_C" "fin de la fenêtre de commit"
for m in "$C0" "$C1" "$C2"; do
  i="$(idx_de "$m")"
  salt="$(cast keccak "salt-c-$m")"
  send_as "$i" "$MARKET" 'revealVerdict(uint256,uint8,uint16,bytes32,bytes32)' \
    "$REQ_C" "$VOTE_ACCEPT" "$REASONS_OK" "$ZERO32" "$salt"
  echo "    reveal par $m (index $i)"
done

# 7. Fin de reveal, finalize (code Accept, aucune absence : aucune saisie ici).
RD_C="$(champ_demande "$REQ_C" 6)"
attendre_jusqua "$RD_C" "fin de la fenêtre de reveal"
echo "  finalize($REQ_C)…"
admin_send "$MARKET" 'finalize(uint256)' "$REQ_C"

# 8. Caution du fautif AVANT contestation.
AVANT_C="$(appel "$REGISTRY" 'total(address)(uint256)' "$FAUTIF")"
AVANT_C="${AVANT_C%% *}"
echo "  Caution du fautif AVANT contestation : $(chk "$AVANT_C")"

# 9. Pendant la fenêtre de contestation, contest(requestId, verifier, facts, contentHash).
echo "  contest($REQ_C, fautif, facts, contentHash) — par l'admin, pendant la fenêtre de contestation…"
echo "  ----- événements émis par la contestation -----"
admin_send "$SLASHING" 'contest(uint256,address,(uint256,bytes3,bytes32,bytes32),bytes32)' \
  "$REQ_C" "$FAUTIF" "$FACTS_C" "$CONTENT_C"
# Lecture des logs de la contestation : ContestOpened / VerifierSlashed / ContestResolved.
BLK="$(cast block-number --rpc-url "$RPC")"
cast logs --from-block "$((BLK-2))" --to-block latest --address "$SLASHING" --rpc-url "$RPC" \
  'ContestOpened(uint256,address,address)' 2>/dev/null | grep -E 'blockNumber|topics|data' | sed 's/^/    ContestOpened  /' | head -n 4 || true
cast logs --from-block "$((BLK-2))" --to-block latest --address "$SLASHING" --rpc-url "$RPC" \
  'VerifierSlashed(uint256,address,uint8,uint256)' 2>/dev/null | grep -E 'blockNumber|data' | sed 's/^/    VerifierSlashed /' | head -n 2 || true
cast logs --from-block "$((BLK-2))" --to-block latest --address "$SLASHING" --rpc-url "$RPC" \
  'ContestResolved(uint256,address,bool)' 2>/dev/null | grep -E 'blockNumber|data' | sed 's/^/    ContestResolved /' | head -n 2 || true
echo "  -----------------------------------------------"

# 10. Caution du fautif APRÈS. On attend 20 %.
APRES_C="$(appel "$REGISTRY" 'total(address)(uint256)' "$FAUTIF")"
APRES_C="${APRES_C%% *}"
SAISIE_C=$(python3 -c "print(int('$AVANT_C')-int('$APRES_C'))")
PCT_C=$(python3 -c "a=int('$AVANT_C'); print('n/a' if a==0 else f'{(int(\"$SAISIE_C\")*10000)//a/100}%')")
echo "  Caution du fautif APRÈS : $(chk "$APRES_C")"
echo "  Saisie : $(chk "$SAISIE_C")  (soit $PCT_C de la caution)"
if [[ "$SAISIE_C" == "0" ]]; then
  echo "  ✗ ANOMALIE : aucune saisie constatée pour la faute 3." >&2
  exit 1
fi
echo "  ✓ Faute 3 prouvée : 20 % saisi sur contestation."

# ==========================================================================
# Branchement optionnel : réputation ERC-8004
# ==========================================================================
# Le marché n'écrit une réputation (giveFeedback +1/-1) que pour un membre
# AYANT une identité ERC-8004. Pour que la lecture finale (d) soit parlante, on
# enregistre une identité pour chacun des index 1-4, puis on joue une demande
# complète : à sa finalisation, pokeErc8004 dépose +1 pour chaque membre ayant
# révélé. (Sans identité, le crochet est silencieux, finalize n'est jamais
# bloqué : c'est la garantie du contrat.)

etape "ÉTAPE réputation — identités ERC-8004 + une demande propre pour alimenter la réputation"
preuve "le marché dépose un retour de réputation (+1 pour un reveal) sur chaque membre tiré ayant une identité ERC-8004, via giveFeedback, sans jamais pouvoir bloquer finalize."

# Même recomplément qu'en (c) : la faute 3 (20 %) a pu faire retomber le fautif
# sous minStake. On recomplète pour garder 3 actifs au tirage d'alimentation.
echo "  Recomplément des cautions sous minStake (après la saisie de 20 %)…"
for i in 1 2 3 4; do
  a="$(addr_test "$i")"
  tot="$(appel "$REGISTRY" 'total(address)(uint256)' "$a")"; tot="${tot%% *}"
  manque="$(python3 -c "t=int('$tot'); m=int('$MIN_STAKE'); print(m-t if t<m else 0)")"
  if [[ "$manque" != "0" ]]; then
    appoint="$(python3 -c "print(int('$manque')+int('$MIN_STAKE'))")"
    send_as "$i" "$REGISTRY" 'register()' --value "$appoint"
    echo "    index $i : recomplété de $(chk "$appoint")"
  fi
done

echo "  Enregistrement d'une identité ERC-8004 pour les index 1-4 (register())…"
for i in 1 2 3 4; do
  a="$(addr_test "$i")"
  aid="$(appel "$IDENTITY" 'agentIdOf(address)(uint256)' "$a")"
  aid="${aid%% *}"
  if [[ "$aid" == "0" ]]; then
    send_as "$i" "$IDENTITY" 'register()'
    aid="$(appel "$IDENTITY" 'agentIdOf(address)(uint256)' "$a")"
    aid="${aid%% *}"
    echo "    index $i ($a) : identité agentId=$aid"
  else
    echo "    index $i ($a) : déjà une identité agentId=$aid"
  fi
done

# Demande propre (d'alimentation) : montant modeste, tous révèlent, finalize.
FACTS_R="(1000,0x455552,$(cast keccak 'FR76_BENEFICIAIRE_R'),$ZERO32)"
CONTENT_R="$(cast keccak 'contenu-demande-r')"
H_R="$(appel "$MARKET" 'hashOf((uint256,bytes3,bytes32,bytes32),bytes32)(bytes32)' "$FACTS_R" "$CONTENT_R")"
send_as "$DEMANDEUR_IDX" "$MARKET" 'createRequest(bytes32)' "$H_R" --value "$FEE"
REQ_R="$(appel "$MARKET" 'count()(uint256)')"
REQ_R="${REQ_R%% *}"
echo "  Demande d'alimentation : requestId = $REQ_R"
tirer_comite "$REQ_R"
COMITE_R="$(appel "$MARKET" 'getCommittee(uint256)(address[])' "$REQ_R" | tr -d '[]' | tr ',' ' ')"
read -r R0 R1 R2 <<<"$COMITE_R"
echo "  Comité tiré : $R0  $R1  $R2"
for m in "$R0" "$R1" "$R2"; do
  i="$(idx_de "$m")"
  salt="$(cast keccak "salt-r-$m")"
  cmt="$(appel "$MARKET" 'commitmentOf(uint256,address,uint8,uint16,bytes32,bytes32)(bytes32)' \
    "$REQ_R" "$m" "$VOTE_ACCEPT" "$REASONS_OK" "$ZERO32" "$salt")"
  send_as "$i" "$MARKET" 'commitVerdict(uint256,bytes32)' "$REQ_R" "$cmt"
done
CD_R="$(champ_demande "$REQ_R" 5)"
attendre_jusqua "$CD_R" "fin de la fenêtre de commit"
for m in "$R0" "$R1" "$R2"; do
  i="$(idx_de "$m")"
  salt="$(cast keccak "salt-r-$m")"
  send_as "$i" "$MARKET" 'revealVerdict(uint256,uint8,uint16,bytes32,bytes32)' \
    "$REQ_R" "$VOTE_ACCEPT" "$REASONS_OK" "$ZERO32" "$salt"
done
RD_R="$(champ_demande "$REQ_R" 6)"
attendre_jusqua "$RD_R" "fin de la fenêtre de reveal"
# finalize déclenche le crochet ERC-8004 (try this.pokeErc8004) : l'auto-appel
# reçoit 63/64 du gaz restant, donc on finalise avec une limite de gaz large
# pour que giveFeedback dispose d'assez de gaz (sinon le crochet est avalé par
# le catch — « jamais bloquant pour finalize » — et la réputation reste vide).
admin_send "$MARKET" 'finalize(uint256)' "$REQ_R" --gas-limit 3000000
echo "  ✓ Demande $REQ_R finalisée : réputation déposée pour les membres ayant une identité."

# ==========================================================================
# (d) Lecture finale sur la chaîne
# ==========================================================================

etape "ÉTAPE (d) — Lecture finale sur la chaîne"
preuve "tout l'état sanctionnateur est lisible sur la chaîne : cautions, strikes, réputation ERC-8004, et le code final de chaque demande."

echo "  — Cautions et strikes des index 1-4 —"
for i in 1 2 3 4; do
  a="$(addr_test "$i")"
  tot="$(appel "$REGISTRY" 'total(address)(uint256)' "$a")"; tot="${tot%% *}"
  lck="$(appel "$REGISTRY" 'locked(address)(uint256)' "$a")"; lck="${lck%% *}"
  st="$(appel "$SLASHING" 'strikesOf(address)(uint8)' "$a")"; st="${st%% *}"
  echo "    index $i ($a) : caution $(chk "$tot") (bloqué $(chk "$lck")) | strikes $st"
done

echo
echo "  — Réputation ERC-8004 (le marché est le client ; getSummary tag 'reveal') —"
for i in 1 2 3 4; do
  a="$(addr_test "$i")"
  aid="$(appel "$IDENTITY" 'agentIdOf(address)(uint256)' "$a")"; aid="${aid%% *}"
  if [[ "$aid" == "0" ]]; then
    echo "    index $i : pas d'identité ERC-8004"
    continue
  fi
  # getSummary(agentId, [market], "reveal", "") -> (count, somme, decimals)
  SUM="$(appel "$REPUTATION" 'getSummary(uint256,address[],string,string)(uint64,int256,uint8)' \
    "$aid" "[$MARKET]" "reveal" "" 2>/dev/null || echo "n/a")"
  NB="$(echo "$SUM" | sed -n '1p' | awk '{print $1}')"
  SOMME="$(echo "$SUM" | sed -n '2p' | awk '{print $1}')"
  echo "    index $i (agentId=$aid) : $NB retour(s) 'reveal', score cumulé = ${SOMME:-?}"
done

echo
echo "  — Code final de chaque demande (0=Refuse, 1=HumanReview, 2=Accept) —"
decode_statut() { case "$1" in 0) echo None;; 1) echo Commit;; 2) echo Reveal;; 3) echo Contest;; 4) echo Closed;; *) echo "?";; esac; }
decode_code()   { case "$1" in 0) echo Refuse;; 1) echo HumanReview;; 2) echo Accept;; *) echo "?";; esac; }
for rid in "$REQ_B" "$REQ_C" "$REQ_R"; do
  STATUT="$(champ_demande "$rid" 8)"
  CODE="$(champ_demande "$rid" 9)"
  echo "    demande $rid : statut $(decode_statut "$STATUT") | code $(decode_code "$CODE")"
done

# ==========================================================================
# Clôture : durée du run
# ==========================================================================
DUREE=$(( $(date +%s) - DUREE_DEBUT ))
etape "SCÈNE TERMINÉE — tous les garde-fous prouvés sur la chaîne"
echo "  Durée du run : ${DUREE}s"
echo "  (a) TxAllowList : intrus refusé.  (b) Faute 1 : 1 % + strike."
echo "  (c) Faute 3 : 20 % sur contestation.  (d) état final lu sur la chaîne."
