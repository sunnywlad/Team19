# Preuve : passage de bout en bout sur le L1 local, trois demandes

Extrait nettoyé du journal `llm-e2e-local.log` (hors dépôt). Trois cycles, un par demande :
le service crée la demande, les trois vérificateurs LLM réels (Bedrock) votent, le
contrat révèle, la demande passe à Closed.

Conditions : montant 400 (sous le plafond de 500 unités mineures lu sur la chaîne),
contenu « Payer la facture INV-E2E-001 », sans pièce jointe. Fenêtres commit 30 s,
reveal 20 s, contest 60 s. Délai de l'évaluateur 15 s.

Au départ : RPC OK, contrat marché OK, registre OK, trois vérificateurs actifs.

## Votes par demande

Vote 0 = Refuse, 1 = HumanReview, 2 = Accept.

| Demande | Claude Haiku 4.5 | Mistral Pixtral Large | Claude Sonnet 4.5 | Code final |
|---|---|---|---|---|
| 12 | 1 (insufficient_context) | 2 | 1 (insufficient_context) | 1 (HumanReview) |
| 13 | 1 (insufficient_context) | 2 | 1 (insufficient_context) | 1 (HumanReview) |
| 14 | 1 (insufficient_context, reference_unknown) | 2 | 1 (insufficient_context) | 1 (HumanReview) |

Chaque demande : trois verdicts révélés, trois détails lus (un par vérificateur).

## Cycles et état

| Demande | Verdicts révélés | Statut final (lu par cast call) |
|---|---|---|
| 12 | 3 | 4 (Closed) |
| 13 | 3 | 4 (Closed) |
| 14 | 3 | 4 (Closed) |

Le statut reste à 3 pendant l'attente, puis passe à 4 (Closed) au sondage de 60 s.

## Saisies

Après les trois cycles, pour chacun des trois vérificateurs :

| Vérificateur | Total staké | Verrouillé |
|---|---|---|
| 1 | 500e18 | 0 |
| 2 | 500e18 | 0 |
| 3 | 500e18 | 0 |

Aucune saisie : rien n'est verrouillé et le total reste inchangé.
