# Architecture

## Le L1 privé CHK

Nous faisons tourner un L1 Avalanche privé, de jeton natif CHK.

| Trait | Valeur |
|---|---|
| chainId | 191919 |
| Consensus | PoA (preuve d'autorité) |
| Écriture | TxAllowList : seule une adresse admise envoie une transaction. |
| Frappe de CHK | Native Minter : un précompilé frappe le jeton natif. |
| Messagerie inter-chaînes | Pas d'ICM applicatif : ni TeleporterMessenger ni relayer. Le warpConfig reste actif dans la genèse, requis par le ValidatorManager pour parler à la P-Chain. |
| Validateurs | un seul validateur pour la démo. |

Les deux précompilés sont activés dans la genèse. La TxAllowList siège à
`0x02...02`, le Native Minter à `0x02...01`. Leur administrateur est l'adresse
admin du L1. Le gasLimit du bloc vaut 8 000 000.

## Les contrats par phase

Nous avons construit la pile en trois phases. Chaque phase ajoute une couche sans
réécrire la précédente.

### Phase 1 : le marché à comité fixe

| Contrat | Rôle |
|---|---|
| `VerificationMarket` | Reçoit une demande payée en CHK, retient un commit puis un reveal par membre, agrège en code 0/1/2, ouvre la contestation. Le comité de 3 est figé au déploiement. |

### Phase 2 : caution, sanctions, récompenses, guichet

| Contrat | Rôle |
|---|---|
| `VerifierRegistry` | Inscrit les vérificateurs admis, garde leur caution en CHK, bloque une part par mission. |
| `StakedVerificationMarket` | Le marché de phase 1 cautionné. Verrouille la caution à la création, saisit les absents et partage les frais à la finalisation, déverrouille à la clôture. |
| `Slashing` | Constate les fautes, saisit la caution, tient les strikes et l'exclusion. |
| `Rewards` | Partage les frais entre les reveals valides, en modèle pull ; frappe un bonus en CHK par reveal valide. |
| `ChkDesk` | Guichet : un opérateur frappe des CHK pour un client payé hors chaîne. |

### Phase 3 : tirage au sort et registres ERC-8004

| Contrat | Rôle |
|---|---|
| `DrawnVerificationMarket` | Le marché cautionné dont le comité de 3 est tiré au sort par demande, à partir du hash d'un bloc postérieur à la création. |
| `AgentIdentityRegistry` | Identité d'agent, jeton ERC-721 non transférable. |
| `AgentReputationRegistry` | Retours de réputation sur un agent. |
| `AgentValidationRegistry` | Demandes et réponses de validation d'un agent. |

Les trois registres ERC-8004 sont un sous-ensemble adapté du standard, sans
dépendance externe. Les noms de fonctions et d'événements du standard sont
conservés. Le marché de phase 3 écrit un retour de réputation à la finalisation,
sans jamais pouvoir faire échouer la finalisation.

## La part hors chaîne

Le contenu d'une demande ne passe jamais par la chaîne. Seul le hash H y est
inscrit.

- Le cache stocke le contenu adressé par H, contrôle le droit de lecture sur la
  chaîne, et supprime à la clôture.
- La passerelle est la seule porte vers le L1 depuis l'extérieur ; elle dépose
  au cache, envoie les transactions, et relit les événements.
- Les services vérificateurs écoutent les événements, lancent un sous-agent LLM
  jetable par demande, et jouent le commit puis le reveal.
