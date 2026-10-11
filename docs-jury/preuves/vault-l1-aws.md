# Répétition du coffre sur le L1 AWS

Extrait nettoyé de la répétition finale du coffre avec le code postérieur à M4,
le 11 octobre 2026. Les essais interrompus antérieurs ne figurent pas ici.

- Réseau : chainId `191919`.
- Coffre : `0x12e611639ab72237cd8c3ca82b4e5f6db1f1a3a0` (déploiement consommé).
- `RehearseArgentVault.s.sol` : 12 reçus réussis ; `finish-latest.json` : 7 reçus réussis.
- Décisions réelles (décision, motif) : `(2,0), (1,10), (0,12), (1,10), (0,11), (1,10), (2,13), (0,3), (0,4)`.
- État final : caisse `0,06 VETO`, dettes admises `0`, fonds bloqués `0`, plaçable `0,02 VETO`, coffre en pause `false`.

## Scènes d'attaque sur le L1

Extrait nettoyé du journal des scènes. Les montants et les décisions sont ceux
observés lors de cette répétition.

| Cas | Porte | Contrat | Fonds sortis |
|---|---|---|---:|
| 3, document piégé détecté | Refusé (`403 BLOCK`, score 100) | Non atteint | 0 |
| 4, document piégé non détecté | Accepté (`202 PASS`, score 45) | Refusé (`0/INVOICE_UNKNOWN`) | 0 |
| 8a, demande signée rejouée | Pas de nouveau passage par la porte | Refusé (`0/REQUEST_REPLAYED`) | 0 |
| 8b, facture déjà payée représentée | Accepté (`202 PASS`, score 30) | Refusé (`0/INVOICE_ALREADY_PAID`) | 0 |

Bilan des quatre attaques jouées : deux ont passé la porte puis ont été refusées
par le contrat ; aucune sortie de fonds. La scène 8a est un rejeu remis en file,
et ne compte donc pas comme un nouveau passage par la porte.
