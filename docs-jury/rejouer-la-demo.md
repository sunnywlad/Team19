# Rejouer la démo

## Prérequis

- Foundry (`forge` et `cast`) dans le PATH.
- `jq` pour lire les adresses des déploiements.
- Le L1 lancé et son RPC accessible.
- Une clé admin, fournie par `ADMIN_PRIVATE_KEY` (clé brute) ou `ADMIN_ACCOUNT`
  (keystore Foundry). Aucune clé n'est jamais écrite dans un fichier ni affichée.

Les adresses de test sont dérivées à l'exécution du mnemonic de test public de
Foundry. Elles ne servent qu'à la démo.

## Déployer une pile neuve

```
ADMIN_PRIVATE_KEY=… ./script/deploy-all.sh <RPC>
```

Ce script est idempotent et redéploie une pile complète à chaque appel.

- Il admet les adresses de test sur la TxAllowList et leur frappe un plancher de
  CHK, sans refrapper si le solde suffit.
- Il déploie les phases 1, 2 et 3, puis câble les contrats entre eux.
- Il autorise les deux contrats `Rewards` à frapper sur le Native Minter.
- Il écrit les adresses dans `deployments/<chainId>-<horodatage UTC>.json` et en
  copie dans `deployments/latest.json`.

Les fenêtres et les frais se règlent par les variables `FEE`, `COMMIT_WINDOW`,
`REVEAL_WINDOW`, `CONTEST_WINDOW`, `MIN_STAKE`, `LOCK_BPS`, `STRIKE_LIMIT`,
`EXCLUSION_REQUESTS` et `BONUS`. Elles sont consignées dans le JSON de sortie.

## Jouer la scène d'attaque

```
ADMIN_PRIVATE_KEY=… ./script/attack-scene.sh <RPC>
```

Par défaut, la scène redéploie d'abord une pile neuve par `deploy-all.sh`. Avec
`SKIP_DEPLOY=1`, elle rejoue sur la pile de `latest.json`. Durée indicative :
environ 4 minutes, dépendante des fenêtres.

Elle prouve quatre choses, en live et sur la chaîne.

| Étape | Ce qu'elle montre |
|---|---|
| (a) | TxAllowList : une adresse non admise ne peut rien écrire, même avec du gaz. |
| (b) | Faute 1 : un membre tiré qui ne commit pas est saisi de 1 % et prend un strike, constaté à la finalisation. |
| (c) | Faute 3 : un vote Accept au-dessus du plafond est saisi de 20 % sur contestation. |
| (d) | Lecture finale sur la chaîne : cautions, strikes, réputation ERC-8004, code de chaque demande. |

Les fenêtres courtes de la scène se règlent par `COMMIT_WINDOW`, `REVEAL_WINDOW`
et `CONTEST_WINDOW` (défauts 30 s, 20 s, 60 s).

## Lancer les tests

```
forge test
```

La suite compte 253 tests, tous au vert. Cette commande ne touche pas la chaîne :
elle s'exécute dans l'EVM local de Foundry.
