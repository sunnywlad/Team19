# evaluator-stub

Évaluateur factice pour Team19. Lit un payload JSON sur stdin, rend une ligne JSON sur stdout.

## Paliers (amountMinor)

| Condition | vote | reasons |
|---|---|---|
| > 1 000 000 (10 000,00) | 0 | `["amount_above_cap"]` |
| > 100 000 (1 000,00) | 1 | `["insufficient_context"]` |
| ≤ 100 000 | 2 | `[]` |

## Variables de test

- `STUB_SLEEP_MS` — délai en ms avant la réponse (simule un appel LLM lent).
- `STUB_EXIT` — code de sortie forcé (simule une erreur du script).

## Usage

```sh
echo '{"schemaVersion":1,"plannedDecision":{"amountMinor":"50000",...}}' | node offchain/evaluator-stub/index.ts
```

Payload illisible ou JSON invalide : code de sortie 1, message sur stderr.
