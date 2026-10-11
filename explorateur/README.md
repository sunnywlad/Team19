# Explorateur de blocs VETO

Explorateur de blocs du L1 privé VETO (chainId 191919), séparé de la webapp.
Il affiche les blocs, les transactions, les adresses et les contrats de la chaîne de démo.

## Origine du code

L'explorateur n'est pas écrit par nous. Il s'appuie sur deux dépôts de
[yassirboudda](https://github.com/yassirboudda) (AMIChain) :

| Dépôt | Rôle | Commit figé |
|---|---|---|
| `erol-explorer-backend` | API REST et indexeur (MongoDB) | `f90149b` |
| `codenekt-explorer-frontend` | Interface SvelteKit | `c70427b` |

Ces dépôts ne sont pas copiés ici : `setup.sh` les clone au commit figé et leur
applique nos correctifs, rangés dans `patches/`. Ce dossier ne contient donc que
nos fichiers : les lanceurs, les correctifs, le lanceur MongoDB.

Nos correctifs :

- backend : `getTransaction` accepte un objet transaction, pas seulement un hash ;
- frontend : habillage VETO (titre, en-tête, pied de page, symbole du jeton, logo),
  noms lisibles des adresses connues (`src/lib/utils/labels.ts`),
  retrait de Google Analytics et des liens de l'éditeur d'origine.

## Lancer

Node 22 et git suffisent. Ni Docker ni MongoDB installé : `mongodb-memory-server`
télécharge un binaire `mongod` et le lance sur le port 27018.

Le RPC du L1 doit répondre en local. Par défaut : le tunnel SSH vers le validateur,
port 9670. Pour un autre RPC : `RPC=<url>` devant chaque commande.

```
./setup.sh                 # une fois : clone, correctifs, .env, dépendances
./start.sh --rattrapage    # premier lancement : indexe toute la chaîne (dix minutes)
./start.sh                 # lancements suivants
./stop.sh
```

Sous Windows ou macOS : `node start.mjs` à la place de `start.sh`.

L'explorateur répond sur le port 5180, ouvert au réseau local : `http://<ip>:5180`.

## Ports

| Port | Service |
|---|---|
| 5180 | Interface (toutes les interfaces réseau) |
| 3050 | API (toutes les interfaces réseau) |
| 27018 | MongoDB (local seulement) |

## Limites

- L'indexeur ne suit que les blocs produits pendant qu'il tourne. Après un arrêt,
  relancer avec `--rattrapage`.
- Vérifié sur le L1 de démo : indexation jusqu'en tête, puis suivi en direct d'une
  demande (blocs 929 à 933). `setup.sh` : le clonage et les correctifs sont rejoués
  et comparés à la pile qui tourne ; l'installation des dépendances depuis zéro
  n'a pas été rejouée.
- Depuis un autre poste, les pages se lisent, mais les appels que le navigateur
  fait lui-même au RPC (lecture de contrat, bouton « Copy RPC ») visent `127.0.0.1`
  et n'aboutissent que sur le poste qui porte le tunnel.
- Aucune vérification de source des contrats (pas de Sourcify sur ce L1).
- Les dépôts d'origine ne portent pas de licence.
