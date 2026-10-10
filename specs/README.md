# specs/ : les interfaces gelées

Cinq interfaces et leurs tests d'acceptation (PLANNING § 1). Une fois la branche
fusionnée, toute modification de ce dossier se décide à quatre.

| Fichier | Interface | Entre qui |
|---|---|---|
| [00-a-trancher.md](00-a-trancher.md) | Décisions ouvertes et contradictions entre les sources | Tous |
| [01-demande.md](01-demande.md) | Demande signée | Loris, Joseph, Wladimir |
| [02-contrat.md](02-contrat.md) | Contrat : rôles, fonctions, événements, motifs | Wladimir, Joseph |
| [03-detecteur.md](03-detecteur.md) | Sortie de la porte d'entrée | Loris, Joseph, Nicolas |
| [03-detecteur.md](03-detecteur.md) § 2 | Demande reçue par la porte d'entrée (sixième interface, point i) | Loris, Joseph |
| [04-journal.md](04-journal.md) | Entrée de journal et vérification | Loris, Joseph |
| [05-incident.md](05-incident.md) | Rapport d'incident et réactions automatiques | Loris, Nicolas |
| [acceptance/scenarios.md](acceptance/scenarios.md) | Les huit scénarios et les invariants | Tous |

## Lire un statut

- **FAIT (source)** : repris d'un document du kit, cité entre parenthèses. Les documents du kit font foi.
- **PROPOSÉ** : le kit est silencieux ou se contredit. Valeur par défaut retenue ici, à valider à quatre. La liste complète est dans [00-a-trancher.md](00-a-trancher.md).

Sources citées : PROPOSITION, PLAYBOOK, PLANNING, CHECKLIST, CONFORMITE, FICHE-DEFENSE, et les deux pages « Scénarios » et « Composants ».

## Conventions communes

| Sujet | Convention | Statut |
|---|---|---|
| Identifiant opaque | 32 octets, `0x` + 64 chiffres hexadécimaux minuscules, jamais nul | PROPOSÉ |
| Adresse | `0x` + 40 chiffres hexadécimaux minuscules | PROPOSÉ |
| Empreinte SHA-256 | 64 chiffres hexadécimaux minuscules, sans préfixe | PROPOSÉ |
| Horodatage d'une demande signée | secondes Unix, entier, champ sans suffixe (`issued_at`) | PROPOSÉ |
| Horodatage mesuré hors chaîne | millisecondes Unix, entier, suffixe `_ms` | PROPOSÉ |
| Montant | wei, entier ; en JSON, chaîne décimale | PROPOSÉ |
| Liste fermée | on ajoute en fin de liste, on ne renumérote ni ne réemploie jamais | PROPOSÉ |
| Donnée nominative | aucune, ni sur la chaîne ni dans le journal : identifiants et empreintes seulement | FAIT (PROPOSITION § 7) |

Un identifiant est tiré au hasard. Il n'est jamais l'empreinte d'un nom ou d'un
numéro réel : une telle empreinte se retrouve par essais. Seules les fixtures
dérivent leurs identifiants d'un libellé, pour être reproductibles
([examples/fixtures.json](examples/fixtures.json)).

## Vérifier

```bash
make specs
```

Lance [tools/check.sh](tools/check.sh) : chaque exemple de `examples/` est validé
contre son schéma avec ajv, version figée par `package-lock.json`. La cible fait
partie de `make check`.

Chaque dossier `examples/<interface>/` porte un `manifest.json` qui déclare, pour
chaque fichier, l'issue attendue : `valid`, `schema-invalid`, ou `rule-invalid`
(le schéma passe, une règle hors schéma échoue). Un exemple non déclaré fait
échouer le contrôle.

Les signatures des demandes d'exemple se régénèrent avec
[tools/gen-request-vectors.js](tools/gen-request-vectors.js), à la main. Aucune
clé n'est stockée : voir [01-demande.md](01-demande.md) § 6.
