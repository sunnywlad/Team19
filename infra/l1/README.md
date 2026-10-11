# L1 VETO : configuration du réseau

Le L1 de l'équipe est une blockchain Subnet-EVM privée de bout en bout, avec un jeton natif VETO et le chainId 191919. Il en existe deux exemplaires aux propriétés identiques :
- `fuji/` : le L1 de démo, sur la testnet publique Fuji, avec un validateur sur AWS EC2 ;
- `repli/` : une copie sur un réseau local distinct, en secours si Fuji n'est pas joignable pendant la démo.

Aucune clé n'est dans ce dossier. Les clés de staking des nœuds et les clés des comptes restent hors du dépôt.

## Ce qui rend le L1 privé

| Propriété | Où elle se lit |
|---|---|
| Écriture réservée aux adresses admises (TxAllowList) | `txAllowListConfig` dans `fuji/genesis-fuji.json` ; précompilé `0x0200000000000000000000000000000000000002` |
| Frappe de VETO réservée (Native Minter) | `contractNativeMinterConfig` dans la même genèse ; précompilé `0x0200000000000000000000000000000000000001` |
| Synchronisation réservée aux validateurs | `subnet-config.json` = `{"validatorOnly": true}`, chargé par le validateur (`subnet-config-dir`) |
| RPC privé | `"http-host": "127.0.0.1"` dans `node-validator.json` ; seul le port P2P 9651 est ouvert sur la VM, et l'accès au RPC se fait par tunnel SSH (`fuji/fuji-tunnel.sh`) |
| APIs d'administration fermées | `chain-config.json` : ni `admin`, ni `personal`, ni `debug` |
| Pas d'ICM | ni TeleporterMessenger ni relayer. `warpConfig` reste actif dans la genèse, parce que le ValidatorManager en a besoin pour parler à la P-Chain |

La genèse Fuji reprend `l1/genesis.json`, à une différence près : l'admin de la TxAllowList, du Native Minter et du ProxyAdmin y est `0xB38451f8731010c6734B0B4fBB3430c7D65A102a`, et non la clé de test publique de la CLI Avalanche.

Les fichiers `fuji/node-validator.json` et `fuji/node-observer.json` sont des copies de référence : l'IP publique y est remplacée par `<IP publique du validateur>`, et ce ne sont pas les fichiers qui tournent sur la VM. `fuji/fuji-tunnel.sh` lit l'hôte dans `FUJI_HOST`, ou à défaut dans `~/.config/team19/fuji-host`, hors dépôt.

## Identifiants Fuji, vérifiables publiquement

- subnetID : `KmZRZtLMC3zFV1tmUesNe3QDtJQQFtAeGaYpVgYX4cB9aqcpv`
- blockchainID : `RkJGt3ZenMaUz64EP1cUZeisftYMb9WaJdvYw54xfvkUccgke`
- Validateur : `NodeID-NmW7KRQUrNfe34BvEo72iYFwAiHbfKW6g`, poids 100

Le validateur se lit sur l'API publique de la P-Chain de Fuji :

```
curl -s -X POST -H 'content-type:application/json' \
  --data '{"jsonrpc":"2.0","id":1,"method":"platform.getCurrentValidators","params":{"subnetID":"KmZRZtLMC3zFV1tmUesNe3QDtJQQFtAeGaYpVgYX4cB9aqcpv"}}' \
  https://api.avax-test.network/ext/bc/P
```

## Ce qui a été prouvé

Les deux propriétés ont été testées sur Fuji et sur le repli :
- un nœud non validateur, connecté au validateur et qui suit le subnet, ne reçoit pas la chaîne : `isBootstrapped` reste à `false`, et son RPC répond `chain is not done bootstrapping` ;
- une adresse hors de la TxAllowList voit sa transaction refusée : `cannot issue transaction from non-allow listed address`.

Sur le repli, une contre-épreuve complète le test 1 : avec `validatorOnly: false`, le même observateur synchronise.

## Versions

avalanchego v1.15.1 et subnet-evm v1.15.1, depuis la release officielle d'avalanchego. Le plugin est nommé par le VMID Subnet-EVM `srEXiWaHuhNyGwPUi444Tu47ZEDwxTWrbQiuD7FmgSAQ6X7Dy`. Les transactions P-Chain (subnet, chaîne, conversion en L1) passent par Platform CLI v2.2.0.

## Repli local

`repli/genesis-repli.json` est la genèse d'un réseau primaire propre, `network-1919`, à un seul validateur. Le L1 de repli utilise `l1/genesis.json` tel quel, si bien que les contrats déployés en local y fonctionnent sans changement. `repli/start.sh` lance le validateur (ajouter `--with-observer` pour rejouer le test de synchronisation) ; il attend les données et les clés des nœuds dans `CHK_REPLI_DIR`, qui vaut `~/phaseF/repli` par défaut.
