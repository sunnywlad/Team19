# Argent Intelligent

Passerelle de confiance entre des agents IA et la trésorerie d'une entreprise.
Hackathon Secure Horizons, track 1 « Fintech Security ». Dépôt gelé dimanche 12h.

## Flux

1. Un agent demandeur envoie une demande.
2. La porte d'entrée la teste (score, codes raison) et la valide contre un schéma JSON strict.
3. L'IA du client émet une demande de décision en JSON, signée par la clé du client.
4. La demande entre dans la file d'attente (base temporaire).
5. Le relais la soumet au contrat sur Avalanche Fuji.
6. Le contrat décide : `0` refusé, `1` validation humaine, `2` accepté et payé dans la même transaction.
7. L'indexeur copie les événements du contrat dans la base durable.
8. Le dashboard affiche. Chaque étape écrit une entrée dans le journal chaîné.

## Dossiers et propriétaires

| Dossier | Contenu | Propriétaire |
|---|---|---|
| `contracts/` | Contrat Solidity (Foundry) | Wladimir |
| `response/` | Journal chaîné, rapport d'incident | Loris |
| `relay/` | File d'attente, relais, indexeur | Loris |
| `dashboard/` | Dashboard en lecture seule | Loris |
| `.github/`, `scripts/`, `Makefile` | CI et socle de sécurité | Joseph |
| `specs/` | Interfaces gelées | Tous, décision à 4 |

Ne modifie que le dossier de la personne pour qui tu travailles. Si un changement
touche un autre dossier, dis-le avant de le faire.

## Commandes

- `npm test` : tests TypeScript (lanceur de tests intégré à Node)
- `npm run typecheck` : vérification des types
- `make check` : rejoue la CI en local (secrets, contrat, dépendances)

## Stack TypeScript

- Node 22, exécution directe des `.ts` : pas d'étape de compilation.
- Syntaxe effaçable uniquement : pas d'`enum`, pas de propriétés de paramètres.
- Imports relatifs avec l'extension `.ts`.
- SQLite par `node:sqlite`, tests par `node:test`. Toute nouvelle dépendance se justifie.
- Versions exactes dans `package.json`, `package-lock.json` commité.

## Règles de sécurité

- Aucun secret dans le dépôt : ni clé privée, ni clé d'API, ni fichier `.env`. Les jurys vérifient.
- Ne lis jamais `.env`. Les noms de variables sont dans `.env.example`, sans valeur.
- Données synthétiques uniquement : aucun nom, IBAN ou adresse réels, y compris dans les tests.
- Sur la chaîne, uniquement des identifiants et des empreintes.
- Le dashboard est en lecture seule. Aucune action automatique ne déplace de fonds.
- Une panne ou un délai dépassé vaut refus, jamais autorisation.
- La décision se lit dans l'événement du contrat, jamais dans le statut du reçu.

## Git

- `main` est protégée : une branche par brique, fusion par pull request avec CI verte.
- Ne commite et ne pousse que sur demande.
- Les interfaces de `specs/` ne changent pas sans décision à 4.
