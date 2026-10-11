# Banc LLM expérimental : trois et cinq instances

Résultat et portée : [rapport.md](rapport.md). Les métriques viennent du
[rapport JSON](rapport.json) et des [200 votes](votes.jsonl). Ce dossier ne
modifie aucun évaluateur, contrat, service ou déploiement de production.

## Rejouer

Prérequis : Python 3 avec `boto3`, accès Amazon Bedrock Converse aux quatre
modèles de [models.json](models.json), identifiants temporaires valides dans
un fichier hors dépôt. Le script reprend exactement le corpus public figé.
Les données envoyées ne contiennent ni étiquette ni résultat attendu.

```sh
BENCH_OUTPUT_DIR=/tmp/veto-bench5-replay \
BENCH_CREDENTIAL_FILE=/chemin/hors-depot/identifiants \
python offchain/experimental-bench5/bench.py
```

Le Python utilisé est celui qui lance le script (`sys.executable`) ;
`BENCH_PYTHON` permet de choisir un autre environnement disposant de boto3.
Le chemin d'identifiants par défaut est `~/.config/aws-hackathon/env`.
Ses valeurs ne sont ni affichées ni copiées dans les sorties.
`BENCH_OUTPUT_DIR` doit être neuf : le banc refuse d'écraser ses journaux.

Une reproduction nominale prévoit 200 évaluations : 40 pièces × 5 instances.
Un ralentissement peut entraîner plusieurs tentatives réseau, comptées par
le journal `calls.jsonl`. Une expiration des identifiants arrête le lancement
de nouvelles évaluations. Le délai interne est 12 secondes, sans modification
du prompt ou de l'évaluateur de production.

## Première exécution et provenance

La première sélection ajoutait Llama 3.3 70B et Nova Premier, deux profils
ACTIVE selon les métadonnées Bedrock. Llama a répondu à un appel probe réel.
Nova Premier a échoué 40 fois (`ResourceNotFoundException`). L'activité de ce
modèle est archivée dans les fichiers `*-initial-unavailable.*`.

[fallback.py](fallback.py) a repris les 160 votes fonctionnels et rejoué
uniquement le cinquième évaluateur avec Sonnet. Corpus et prompt inchangés.
[rapporter.py](rapporter.py) produit le rapport et les empreintes, sans appel
réseau. Les erreurs initiales sont exclues des scores finaux et restent
consultables. Budget constaté : 240 tentatives journalisées, dont 200 réussies,
plus un appel probe réussi hors journal. Les métadonnées ne sont pas des
appels d'évaluation.

[preparer.py](preparer.py) permet de reconstruire les mêmes 40 fixtures.
Les labels sont posés avant les appels, sans adaptation après résultat.

## Vérifier sans nouvel appel

```sh
python offchain/experimental-bench5/verifier.py
```

Ce contrôle recompte les décisions depuis les votes et les labels figés,
vérifie les empreintes et les tentatives réseau archivées.
