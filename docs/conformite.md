# Slide conformité : contenu

Livrable du track 1. La slide dit ce que l'outil apporte face à chaque texte et
comment un auditeur vérifie une décision. Elle ne revendique aucune conformité.

## Tableau de la slide

| Texte | Ce que l'outil apporte | Ce qu'on ne revendique pas |
|---|---|---|
| DORA | Journal chaîné dont l'altération se détecte, rapport d'incident prérempli, horodatages de détection, de pause et d'alerte dans chaque rapport | Classification de l'incident, notification à une autorité, toute revendication de conformité |
| AI Act | Journalisation automatique de chaque étape, validation humaine prévue pour les montants au-dessus du seuil, pause levée par un humain seulement | Qualification du système (haut risque ou non) |
| MiCA | Démonstration prévue sur un réseau de test, en monnaie native | Statut de prestataire de services sur crypto-actifs |
| AML | Chaîne d'autorité de chaque demande (agent, client, signature, décision), décision finale humaine au-dessus du seuil | Vérification d'identité, filtrage de sanctions |
| RGPD | Données synthétiques ; identifiants opaques et empreintes seulement dans le journal et dans l'interface du contrat | Anonymisation |

Ce que le dépôt montre derrière chaque ligne :

| Affirmation | Preuve | Réserve |
|---|---|---|
| Journal chaîné | [specs/04-journal.md](../specs/04-journal.md), `response/src/journal.ts`, six chaînes d'essai dans `specs/examples/journal/` | Sans empreinte de tête gardée ailleurs, une troncature en fin de journal ou une réécriture complète passent inaperçues (§ 6 de la spec) |
| Rapport prérempli | `response/src/report.ts`, schéma `specs/schemas/incident-report.schema.json` | Le montant exposé reste vide |
| Horodatages et délais | Champ `timestamps` du rapport, [specs/05-incident.md](../specs/05-incident.md) § 5 | Aucun délai n'est encore mesuré : voir la [fiche de défense](fiche-defense.md) |
| Validation humaine au-dessus du seuil | [specs/02-contrat.md](../specs/02-contrat.md) § 6 | Règle du contrat, qui n'est pas écrit. Elle est rejouée par un faux coffre |
| Réseau de test | `.env.example` : clés de test seulement | Aucun contrat n'est déployé aujourd'hui |
| Identifiants et empreintes | Schéma `specs/schemas/journal-entry.schema.json` : aucun champ libre | Le document gelé en quarantaine, lui, est conservé en clair sur le disque du service |

<!-- ce-que-nous-ne-disons-pas:debut -->
Ce que nous ne disons pas : « conforme DORA », « conforme » à quoi que ce
soit, « certifié », « anonymisé ».
<!-- ce-que-nous-ne-disons-pas:fin -->

## Comment un auditeur vérifie une décision

Les routes sont celles des services lancés en local (`relay/README.md`,
`response/README.md`). `<id>` est l'identifiant de la demande.

1. **Il prend l'identifiant d'une demande.** La porte d'entrée l'attribue à
   l'arrivée et le rend à l'agent. Il figure dans chaque entrée de journal et
   dans chaque rapport.

2. **Il retrouve l'événement du contrat** : décision, motif, horodatage du bloc.

   ```bash
   curl -s http://127.0.0.1:8787/decisions/<id>
   ```

   La réponse porte `tx_hash`, `log_index`, `block_number` et `block_timestamp` :
   avec eux, l'auditeur relit l'événement `Decision` sur un nœud de son choix,
   sans passer par nous. La décision se lit dans l'événement, jamais dans le
   statut du reçu.

3. **Il retrouve dans le journal l'origine de la demande** : agent, client,
   signature, score et codes raison.

   ```bash
   curl -s "http://127.0.0.1:8790/journal/entries?request_id=<id>&limit=100"
   ```

   Il y lit `REQUEST_RECEIVED` (empreinte du document), `DETECTION` (score,
   seuil, codes, version du détecteur), `REQUEST_SIGNED` (signataire, empreinte
   de la demande), `SUBMITTED` (transaction) et `DECISION_OBSERVED`.

4. **Il relance le script de vérification**, depuis `response/`, avec
   l'empreinte de tête portée par un rapport d'incident (`journal_head`).

   ```bash
   npm run verify-journal -- var/journal.jsonl --expect-head <empreinte> --expect-seq <rang>
   ```

   Code 0 : chaîne intègre et tête attendue. Code 1 : une entrée a été
   modifiée, retirée ou déplacée. Code 3 : la chaîne est cohérente mais sa tête
   n'est pas celle du rapport. Sans `--expect-head`, le script ne voit ni une
   troncature en fin de journal ni une réécriture complète.

5. **Il recalcule la règle à la main** : cash, dettes admises, réserve.

   ```bash
   curl -s http://127.0.0.1:8787/vault
   ```

   ```
   plaçable = max(0, cash − dettes admises − réserve de sécurité − placements bloqués)
   ```

   Une facture bloquée dans l'attente d'une approbation est déjà une dette
   admise depuis son inscription : elle n'est pas déduite une seconde fois, et
   le plaçable ne bouge pas quand elle entre en attente
   ([specs/02-contrat.md](../specs/02-contrat.md) § 4). Les événements du
   contrat suffisent à refaire ce calcul sans nos services.

Réserves à dire à l'auditeur :

- Les étapes 2 et 5 demandent un contrat. Il n'y en a pas : l'index des
  décisions est vide et `/vault` répond 503. Elles ne se rejouent aujourd'hui
  que sur le faux coffre des tests de `relay/`.
- Le journal est « au moins une fois » : une entrée peut y figurer deux fois,
  par exemple `ENQUEUED` ou `REQUEST_SIGNED` après une reprise. Jamais zéro
  (`relay/README.md`, « Journal : boîte d'envoi »).
- Le journal prouve l'intégrité de ce qui a été écrit, pas sa vérité. Aucune
  authentification entre composants : les services n'écoutent que sur la
  machine locale.
- `agent_id` est affirmé par le client dans la demande signée. Le contrat en
  vérifierait le mandat déclaré, pas l'identité réelle.

## Réponse à « si votre modèle se trompe, qui est responsable ? »

Le détecteur propose, il ne décide pas. La règle approuvée par le propriétaire
du coffre décide : une facture se paie une seule fois, au bénéficiaire inscrit,
pour le montant inscrit. Chaque décision est tracée avec son motif. La perte
est bornée, pas nulle : une fausse dette inscrite par l'admission peut être
payée. Les exceptions passent par un humain. Le partage juridique de la
responsabilité n'est pas tranché par l'outil.

Deux précisions honnêtes sur l'état du dépôt :

- Il n'y a pas de modèle dans le chemin de démo. Le détecteur est un jeu de
  règles déterministes (`gateway/src/detector.ts`), et l'« IA du client » est
  un bouchon qui signe tout ce qui passe le schéma (`relay/src/client-ia.ts`).
- « La règle décide » est aujourd'hui une interface gelée et un faux coffre, pas
  un contrat déployé.

## Question ouverte : sommes-nous un prestataire tiers de nos clients ?

Nous ne le savons pas. Si un client est une entité financière, l'outil pourrait
relever de ses prestataires de services informatiques au sens de DORA. C'est une
déduction, pas un fait établi : elle se pose à un juriste avant d'être écrite
sur une slide.

## Points à vérifier avant d'écrire la slide

- Aucun délai de déclaration DORA n'est cité ici : ils n'ont pas été relus sur
  EUR-Lex. À vérifier, ou à ne pas citer.
- Aucune date d'application de l'AI Act n'est citée ici, pour la même raison.
  Un agent de paiement ne figure pas d'office parmi les systèmes à haut risque :
  à vérifier aussi.
- Le kit situe l'exigence de protection des journaux dans une norme technique
  de DORA et non dans l'AI Act. La référence exacte est à relire à la source
  avant toute citation.
- Les références de ce tableau restent « à vérifier »
  ([specs/00-a-trancher.md](../specs/00-a-trancher.md), « À vérifier avant de citer »).
