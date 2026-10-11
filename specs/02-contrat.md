# 02. Contrat

Interface entre Wladimir (contrat) et Joseph (relais, indexeur, dashboard).
Interface Solidity : [contract/IArgentVault.sol](contract/IArgentVault.sol), sans
implémentation. Statuts : voir [README.md](README.md).

## 1. Principes

| Principe | Statut |
|---|---|
| Le contrat vérifie la signature, calcule sur son propre état, décide 0, 1 ou 2 et agit dans la même transaction | FAIT (PROPOSITION § 3, étape 9) |
| Un refus ne fait pas échouer la transaction : il émet un événement avec son motif. Le dashboard lit l'événement, jamais le statut du reçu | FAIT (PROPOSITION § 4) |
| Si le transfert échoue, toute l'opération est annulée | FAIT (PROPOSITION § 4) |
| Rôles séparés, verrou de réentrance, état mis à jour avant tout appel externe, identifiant de demande consommé une fois, pas de proxy | FAIT (PROPOSITION § 7) |
| Sur la chaîne : identifiants et empreintes seulement, aucun nom ni libellé | FAIT (PROPOSITION § 7) |
| Fonds en monnaie native de la chaîne : les jetons ERC-20 sont hors périmètre | FAIT (PROPOSITION § 8) |
| Aucune fonction de retrait. Les fonds ne sortent que par une facture inscrite ou un placement préenregistré | PROPOSÉ, d'après « Propriétaire : ne peut pas retirer les fonds » (§ 4) |
| Un appelant sans le bon rôle fait échouer la transaction (`NotAuthorized`) : ce n'est pas un refus métier | PROPOSÉ, d'après PLANNING § 3 |

## 2. Rôles

Tableau de PROPOSITION § 4. FAIT.

| Rôle | Peut | Ne peut pas |
|---|---|---|
| Propriétaire | Fixer les paramètres, lever une pause | Retirer les fonds |
| Admission | Inscrire factures et bénéficiaires | Payer |
| Relais | Soumettre une demande signée par le client | Créer une demande, détenir des fonds |
| Approbateur | Approuver ou refuser un cas 1 | Modifier le montant ou le bénéficiaire |
| Gardien | Mettre en pause | Reprendre, payer |

Chaque rôle a sa propre clé. Aucune clé n'est partagée entre deux rôles. FAIT (§ 4).

### Fonctions par rôle

| Fonction | Propriétaire | Admission | Relais | Approbateur | Gardien | Tous | Statut |
|---|---|---|---|---|---|---|---|
| `submit` | | | oui | | | | FAIT |
| `approve`, `refuse` | | | | oui | | | FAIT |
| `expire` | | | | | | oui | PROPOSÉ |
| `registerBeneficiary`, `registerInvoice` | | oui | | | | | FAIT |
| `cancelInvoice`, `registerPlacement` | | oui | | | | | PROPOSÉ |
| `registerAgent` | oui | | | | | | PROPOSÉ |
| `setSafetyReserve`, `setThreshold`, `setApprovalDelay` | oui | | | | | | FAIT |
| `resumeVault`, `resumeAgent` | oui | | | | | | FAIT |
| `pauseVault`, `pauseAgent` | | | | | oui | | FAIT |
| `fund` et toutes les vues | | | | | | oui | PROPOSÉ |

Choix PROPOSÉS :

- Les cinq adresses sont fixées au déploiement, toutes différentes (`RoleCollision` sinon), et ne changent plus. Pas de fonction de rotation : une clé compromise se traite par un redéploiement. Moins de surface à tester.
- `expire` est ouverte à tous : elle ne fait que refuser, après le délai. Le contrat ne peut pas se réveiller seul ; le relais l'appelle.
- L'agent est inscrit par le propriétaire : accorder un mandat est un acte de gouvernance. Le placement est inscrit par l'admission, vers un bénéficiaire déjà inscrit : le propriétaire ne peut ainsi désigner aucune destination de fonds.
- Le propriétaire ne peut pas mettre en pause, le gardien ne peut pas reprendre. Voir [00-a-trancher.md](00-a-trancher.md), point b, pour savoir qui tient la clé du gardien.

## 3. Registres

| Registre | Clé | Contenu | Règle |
|---|---|---|---|
| Client | `clientId()` | `clientSigner()` | Un seul client, fixé au déploiement. PROPOSÉ |
| Bénéficiaires | `beneficiaryId` | adresse de paiement | Inscription unique, non modifiable. PROPOSÉ |
| Factures | `invoiceId` | bénéficiaire, montant, état | « Une facture se paie une seule fois, au bénéficiaire inscrit, pour le montant inscrit. » FAIT (§ 4) |
| Placements | `placementId` | bénéficiaire, montant, état | Action préenregistrée (FAIT, § 5), à usage unique (PROPOSÉ) |
| Agents | `agentId` | mandat, pause | PROPOSÉ, point a |
| Demandes consommées | `requestId` | vrai ou faux | FAIT (§ 7) |
| Cas 1 en attente | `requestId` | agent, action, référence, montant, échéance | FAIT (§ 4) |

Un bénéficiaire non modifiable est voulu : le changement de bénéficiaire est une
des six familles d'attaque du jeu de test (PROPOSITION § 6).

États d'une facture ou d'un placement (`RefStatus`) : `None`, `Admitted`, `Held`
(cas 1 en attente), `Settled` (payée ou placée), `Cancelled`. PROPOSÉ.

Mandat d'un agent : OU binaire de `ACTION_PAY_INVOICE` (1) et `ACTION_PLACE` (2).
Un mandat à 0 désigne un agent connu sans droit d'action, par exemple un lecteur.
PROPOSÉ.

## 4. Montant plaçable et deux « réserves »

```
plaçable = cash − dettes admises − réserve
```

FAIT (PROPOSITION § 4). Le mot « réserve » y a deux sens. Deux noms distincts,
PROPOSÉS (point c) :

| Nom | Vue | Sens |
|---|---|---|
| Réserve de sécurité | `safetyReserve()` | Paramètre du propriétaire, dans la formule |
| Montant bloqué | `totalHeld()` | Somme des cas 1 en attente d'approbation |

Définitions, PROPOSÉES :

| Vue | Définition |
|---|---|
| `cash()` | Solde du contrat |
| `admittedDebts()` | Somme des factures `Admitted` et `Held` |
| `heldPlacements()` | Part du montant bloqué due à des placements |
| `placeable()` | `max(0, cash − admittedDebts − safetyReserve − heldPlacements)` |

Une facture bloquée par un cas 1 reste une dette admise : elle n'est pas payée.
Elle est donc déjà déduite du plaçable depuis son inscription, et n'est pas
déduite une seconde fois. Un placement bloqué n'est pas une dette : il est déduit
à part, d'où `heldPlacements`.

Règles de sortie :

| Action | Condition pour ne pas être refusée | Statut |
|---|---|---|
| `PLACE` | `montant ≤ placeable()` | FAIT (§ 4) |
| `PAY_INVOICE` | `montant ≤ cash − totalHeld` : on ne paie pas avec de l'argent déjà bloqué | PROPOSÉ |
| Les deux | `montant > threshold()` donne la décision 1 et bloque le montant | FAIT (§ 4) pour le principe ; application à `PLACE` PROPOSÉE, point j |

Payer une facture fait baisser ensemble le cash et les dettes (Scénarios, 1) : le
plaçable ne change pas.

## 5. `submit` : ordre des contrôles

L'ordre est gelé : il fixe le motif quand plusieurs s'appliquent. PROPOSÉ.

| # | Contrôle | Issue | Motif | `requestId` consommé |
|---|---|---|---|---|
| 0 | L'appelant n'est pas le relais | Échec de la transaction | `NotAuthorized` | non |
| 1 | Signature mal formée, `s` haut, ou signataire différent de `clientSigner()` pour ce `clientId` | 0 | `SIGNATURE_INVALID` | non |
| 2 | `requestId` déjà consommé | 0 | `REQUEST_REPLAYED` | déjà |
| | **À partir d'ici, `requestId` est consommé, quelle que soit l'issue** | | | |
| 3 | `action` différente de 1 et 2 | 0 | `ACTION_UNKNOWN` | oui |
| 4 | Fenêtre invalide ([01-demande.md](01-demande.md) § 4) | 0 | `VALIDITY_WINDOW_INVALID` | oui |
| 5 | Horodatage du bloc > `expiresAt` | 0 | `REQUEST_EXPIRED` | oui |
| 6 | Coffre en pause | 0 | `VAULT_PAUSED` | oui |
| 7 | Agent non inscrit, ou mandat sans cette action | 0 | `AGENT_NOT_AUTHORIZED` | oui |
| 8 | Agent en pause | 0 | `AGENT_PAUSED` | oui |
| 9 | Référence jamais inscrite ou annulée | 0 | `INVOICE_UNKNOWN` ou `PLACEMENT_UNKNOWN` | oui |
| 10 | Référence déjà réglée | 0 | `INVOICE_ALREADY_PAID` ou `PLACEMENT_ALREADY_EXECUTED` | oui |
| 11 | Référence en attente d'approbation | 0 | `REF_PENDING_APPROVAL` | oui |
| 12 | `PLACE` : montant > `placeable()` | 0 | `EXCEEDS_PLACEABLE` | oui |
| 12 | `PAY_INVOICE` : montant > `cash − totalHeld` | 0 | `INSUFFICIENT_CASH` | oui |
| 13 | Montant > `threshold()` | 1, montant bloqué | `ABOVE_THRESHOLD` | oui |
| 14 | Sinon | 2, paiement | `NONE` | oui |

Pourquoi une signature invalide ne consomme pas l'identifiant : sinon, quiconque
tient la clé du relais pourrait brûler l'identifiant d'une demande légitime en la
soumettant avec une signature fausse.

Pourquoi tout le reste le consomme : une demande authentifiée reçoit une seule
décision. Après un refus, le client émet une nouvelle demande.

Si le transfert de la ligne 14 échoue, la transaction échoue (`TransferFailed`) et
rien n'est consommé. FAIT (§ 4).

## 6. Cas 1 : validation humaine

| Événement | Qui | Effet | Événement `Decision` |
|---|---|---|---|
| Décision 1 | `submit` | Référence `Held`, montant bloqué, échéance = bloc + `approvalDelay()` | 1, `ABOVE_THRESHOLD` |
| Approbation avant l'échéance | Approbateur | Paiement au bénéficiaire et pour le montant inscrits, référence `Settled` | 2, `APPROVED` |
| Approbation après l'échéance | Approbateur | Aucun paiement, référence `Admitted` | 0, `APPROVAL_TIMEOUT` |
| Refus | Approbateur | Référence `Admitted` | 0, `APPROVAL_REFUSED` |
| Expiration | Quiconque, après l'échéance | Référence `Admitted` | 0, `APPROVAL_TIMEOUT` |

- L'approbateur ne passe que `requestId` : il ne peut modifier ni le montant ni le bénéficiaire. FAIT (§ 4).
- Sans réponse humaine dans le délai, la demande est refusée. FAIT (PLAYBOOK, « Règles » ; CHECKLIST).
- Après un refus ou une expiration, la facture redevient `Admitted` : refuser une approbation n'éteint pas une dette. Il faut une nouvelle demande signée. PROPOSÉ.
- `approve` échoue si le coffre est en pause (`VaultIsPaused`) ou si l'agent d'origine est en pause (`AgentIsPaused`). L'échéance continue de courir. `refuse` et `expire` restent possibles en pause : elles ne font que bloquer. PROPOSÉ.
- `approvalDelay` se règle en secondes pour la démo (CHECKLIST, « Démo »). Bornes PROPOSÉES : de 10 s à 7 jours, `ParameterOutOfRange` hors bornes.

## 7. Motifs

Liste fermée. On ajoute en fin de liste ; on ne renumérote ni ne réemploie
jamais. Un lecteur qui reçoit un code inconnu le traite comme un refus et
l'affiche comme « motif inconnu (n) ». Les codes 1 à 11 sont le minimum demandé ;
les suivants sont PROPOSÉS.

| Code | Nom | Décision | Sens |
|---|---|---|---|
| 0 | `NONE` | 2 | Accepté et payé dans la transaction |
| 1 | `INVOICE_UNKNOWN` | 0 | Facture jamais inscrite, ou annulée |
| 2 | `INVOICE_ALREADY_PAID` | 0 | Facture déjà payée |
| 3 | `REQUEST_REPLAYED` | 0 | `requestId` déjà consommé |
| 4 | `SIGNATURE_INVALID` | 0 | Signature absente, mal formée, ou d'un autre signataire |
| 5 | `REQUEST_EXPIRED` | 0 | Bloc postérieur à `expiresAt` |
| 6 | `EXCEEDS_PLACEABLE` | 0 | Placement supérieur au plaçable |
| 7 | `VAULT_PAUSED` | 0 | Coffre en pause |
| 8 | `AGENT_PAUSED` | 0 | Agent en pause |
| 9 | `AGENT_NOT_AUTHORIZED` | 0 | Agent non inscrit, ou sans mandat pour cette action |
| 10 | `ABOVE_THRESHOLD` | 1 | Montant au-dessus du seuil, bloqué en attente d'un humain |
| 11 | `APPROVAL_TIMEOUT` | 0 | Délai d'approbation dépassé |
| 12 | `APPROVAL_REFUSED` | 0 | Refusé par l'approbateur |
| 13 | `APPROVED` | 2 | Approuvé et payé |
| 14 | `VALIDITY_WINDOW_INVALID` | 0 | Durée de vie hors bornes, ou émission dans le futur |
| 15 | `ACTION_UNKNOWN` | 0 | Code d'action hors liste |
| 16 | `PLACEMENT_UNKNOWN` | 0 | Placement jamais inscrit |
| 17 | `PLACEMENT_ALREADY_EXECUTED` | 0 | Placement déjà exécuté |
| 18 | `REF_PENDING_APPROVAL` | 0 | Référence déjà en attente d'approbation |
| 19 | `INSUFFICIENT_CASH` | 0 | Cash disponible inférieur au montant de la facture |

Les scénarios 4 et 8 de la page « Scénarios » emploient des libellés qui ne sont
pas des motifs : « bénéficiaire hors registre » se lit `INVOICE_UNKNOWN`, « déjà
consommé » se lit `REQUEST_REPLAYED` ou `INVOICE_ALREADY_PAID`. Voir
[acceptance/scenarios.md](acceptance/scenarios.md), corrections.

## 8. Événements

### `Decision`

| Champ | Type | Indexé | Contenu |
|---|---|---|---|
| `requestId` | `bytes32` | oui | Identifiant de la demande |
| `agentId` | `bytes32` | oui | Agent |
| `clientId` | `bytes32` | oui | Client |
| `action` | `uint8` | | 1 `PAY_INVOICE`, 2 `PLACE` |
| `decision` | `uint8` | | 0 refusé, 1 validation humaine, 2 accepté |
| `reason` | `uint8` | | Motif, § 7 |
| `refId` | `bytes32` | | Référence |

Règles de lecture, pour l'indexeur et le dashboard. PROPOSÉ.

- Une demande a un événement `Decision`, ou deux si elle passe par le cas 1. Sa décision courante est celle du dernier.
- Pour `SIGNATURE_INVALID`, `agentId` et `clientId` viennent d'une demande non authentifiée. Ne rien afficher ni déclencher contre cet agent sur cette seule base.
- Un même `requestId` peut porter plusieurs `SIGNATURE_INVALID` ou `REQUEST_REPLAYED`. La clé d'un événement est le couple transaction et index de journal, pas `requestId`.
- L'horodatage d'une décision est celui du bloc.

### Autres événements

| Événement | Quand | Sert à |
|---|---|---|
| `Paid` | Décision 2, immédiate ou après approbation | Montant effectivement sorti, pour le rapport d'incident |
| `HoldPlaced`, `HoldReleased` | Entrée et sortie du cas 1 | Montant bloqué et échéance affichés |
| `Funded` | Approvisionnement | Cash |
| `BeneficiaryRegistered`, `InvoiceRegistered`, `InvoiceCancelled`, `PlacementRegistered`, `AgentRegistered` | Inscriptions | Dettes admises, registres |
| `SafetyReserveChanged`, `ThresholdChanged`, `ApprovalDelayChanged` | Paramètres | Recalcul du plaçable à la main par l'auditeur |
| `VaultPaused`, `VaultResumed`, `AgentPaused`, `AgentResumed` | Pauses | Bandeau du dashboard, rapport d'incident |

Le dashboard peut aussi lire les vues de § 4 pour afficher le plaçable. Les
événements suffisent à le recalculer, ce qui est la vérification de l'auditeur
(CONFORMITE, étape 5).

## 9. Pauses

| Pause | Posée par | Levée par | Effet |
|---|---|---|---|
| Coffre | Gardien | Propriétaire | Aucune sortie : `submit` donne 0 `VAULT_PAUSED`, `approve` échoue |
| Agent | Gardien | Propriétaire | `submit` donne 0 `AGENT_PAUSED` pour cet agent, `approve` échoue pour ses cas 1 |

FAIT pour les rôles (§ 4) et pour « Pause : aucune sortie, seul le propriétaire
reprend » (PLANNING § 3). La pause par agent sur la chaîne est PROPOSÉE, point b.
Les inscriptions et les réglages restent possibles en pause. PROPOSÉ.

## 10. Tests de PLANNING § 3 et interface

| Test | Ce qui le porte |
|---|---|
| Chaque fonction sensible refuse un appelant sans le bon rôle | `NotAuthorized`, tableau du § 2 |
| Décision 2 : bénéficiaire et montant inscrits | `Paid` |
| Décision 1 : montant bloqué, l'approbation paie, le délai dépassé refuse | § 6 |
| Décision 0 : placement au-dessus du plaçable | `EXCEEDS_PLACEABLE` |
| Décision 0 : facture inconnue, déjà payée, demande rejouée, signature invalide, expirée | Codes 1 à 5 ; vecteurs de [01-demande.md](01-demande.md) § 6 |
| Pause : aucune sortie, seul le propriétaire reprend | § 9 |
| Transfert en échec : tout est annulé | `TransferFailed` |
| Réentrance | Hors interface : exigence d'implémentation (§ 1) |
| Invariants | [acceptance/scenarios.md](acceptance/scenarios.md), « Invariants » |

## 11. Limites

- Le contrat ne vérifie pas qu'une facture est vraie. Une fausse dette inscrite par l'admission peut être payée. FAIT (PROPOSITION § 9).
- Le contrat ne protège que les fonds qu'il détient. FAIT (§ 9).
- Sans fonction de retrait, des fonds déposés par erreur ne sortent que par une facture ou un placement inscrits. Acceptable sur un réseau de test ; à dire.
- Les montants et les adresses de paiement sont publics sur la chaîne, par nature. Les identifiants ne révèlent rien s'ils sont tirés au hasard.
