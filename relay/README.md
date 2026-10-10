# relay/ : file d'attente, relais, indexeur

## Ce qui existe

| Fichier | Étape | Rôle |
|---|---|---|
| `request.ts` | 6 | Format d'une demande de décision et validation stricte |
| `queue.ts` | 7 | File d'attente, base SQLite temporaire |
| `intake.ts` | 6 et 7 | Réception : validation, mise en file, journal |
| `server.ts` | 6 | Point d'entrée HTTP local pour l'IA du client |

Le relais vers le contrat et l'indexeur arrivent dans les branches suivantes.

## Déposer une demande

`POST /decision-requests`, corps JSON de 16 Ko au plus.

| Réponse | Sens |
|---|---|
| `202` | Demande acceptée et mise en file |
| `400` | Demande rejetée, avec la liste des motifs |
| `409` | Identifiant de demande déjà reçu |
| `413` | Corps trop volumineux |

## Format d'une demande

Proposition, à confirmer dans `specs/` avec le contrat.

| Champ | Type | Contenu |
|---|---|---|
| `request_id` | identifiant | Unique, consommé une seule fois |
| `client_id` | identifiant | Client |
| `agent_id` | identifiant | Agent d'origine |
| `action` | `PAY_INVOICE` ou `PLACE` | Action demandée |
| `ref_id` | identifiant | Facture ou action préenregistrée |
| `issued_at` | entier | Secondes Unix |
| `expires_at` | entier | Secondes Unix, 15 minutes au plus après `issued_at` |
| `signature` | `0x` + 130 hexadécimaux | Signature du client sur les champs ci-dessus |

Un identifiant fait 1 à 64 caractères parmi lettres, chiffres, `_` et `-`.
Aucun montant, aucun bénéficiaire, aucun texte libre : le contrat les lit dans
ses registres. Tout champ inconnu, manquant ou mal typé est un rejet.

## Règles

- La demande est stockée telle quelle : le contrat vérifie la signature sur ces
  champs exacts. La pseudonymisation s'applique au journal, à la base durable et
  au dashboard, pas à la file.
- La file ne vérifie pas la signature. Elle est un tuyau non fiable : c'est le
  contrat qui décide.
- Une demande jamais soumise expire. Elle n'est jamais autorisée par défaut.
- Le contenu des demandes terminées est effacé après le délai de rétention.
  L'identifiant est conservé pour refuser un rejeu.
