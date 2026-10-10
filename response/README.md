# response/ : journal chaîné et rapport d'incident

Chaque étape du flux écrit une entrée dans le journal. Chaque entrée contient
l'empreinte de la précédente : modifier ou supprimer une entrée casse la chaîne.
Le rapport d'incident est généré depuis ce journal.

## Utilisation

```ts
import { Journal } from "../response/journal.ts";

const journal = new Journal("var/journal.db");
journal.append({
  step: "7_FILE_ENTREE",
  actor: "file",
  request_id: "req-123",
  data: { agent: "p_3f9a…" },
});
```

```bash
npm run journal -- verify var/journal.db
```

```bash
npm run journal -- report var/journal.db req-123
```

`verify` sort avec le code 1 si la chaîne est rompue. `report` accepte `--json`.

## Format d'une entrée

| Champ | Contenu |
|---|---|
| `seq` | Numéro, à partir de 1, sans trou |
| `ts` | Horodatage ISO 8601 en UTC |
| `step` | Étape, dans la liste fermée `STEPS` de `journal.ts` |
| `actor` | Composant qui écrit : `entree`, `porte`, `file`, `relais`, `reponse`… |
| `request_id` | Identifiant de la demande, ou `null` |
| `data` | Objet JSON libre, sans donnée identifiante |
| `prev_hash` | Empreinte de l'entrée précédente, 64 zéros pour la première |
| `hash` | SHA-256 de tous les champs ci-dessus, sérialisés clés triées |

Le journal est une base SQLite (table `journal`) : un composant écrit dans un
autre langage peut y écrire en respectant ce calcul d'empreinte.

## Champs de `data` lus par le rapport

| Étape | Champs |
|---|---|
| toute entrée | `agent`, `client` : pseudonymes de l'origine |
| `2_TESTS_SECURITE` | `score`, `reason_codes`, `blocked` |
| `9_DECISION_CONTRAT` | `code` (0, 1 ou 2), `reason`, `tx_hash`, `amount_exposed`, `amount_moved` |
| `QUALIFICATION_HUMAINE`, `10_VALIDATION_HUMAINE` | `decision`, `by` |

La détection est datée au premier `2_TESTS_SECURITE` avec `blocked: true`, ou
au premier `9_DECISION_CONTRAT` avec `code: 0`.

## Règles

- Rien d'identifiant dans `data` : passer les identifiants d'agent et de client
  par `pseudonymize()` (`pseudonym.ts`, clé `PSEUDONYM_KEY`).
- Les montants sont des chaînes, pour ne pas perdre de précision.

## Limites

- Supprimer les **dernières** entrées laisse une chaîne valide. La détection
  demande l'empreinte de tête conservée ailleurs : `verify <base> <empreinte>`.
  Chaque rapport d'incident la consigne.
- Quiconque peut réécrire tout le fichier peut reconstruire une chaîne
  cohérente. Seul un ancrage extérieur de l'empreinte de tête, par exemple
  on-chain, protège contre ce cas. Il n'est pas implémenté.
- Le journal prouve l'intégrité de ce qui a été écrit, pas sa vérité.
