# Campagne AWS de 16 demandes : extraction des états locaux

Capture UTC : 2026-10-11T10:05:24.919427+00:00. Source nettoyée : [llm-campagne-16-etats.json](llm-campagne-16-etats.json).

## Ce qui est observé

Les trois services de la pile permanente conservent chacun les demandes 14 à 29.
Leurs sorties portent explicitement `source=llm` et un identifiant de modèle,
ou `source=rule` pour la décision déterministe.

- Vérificateur 1 : Claude Haiku 4.5, 15 sorties LLM.
- Vérificateur 2 : Mistral Pixtral Large, 15 sorties LLM.
- Vérificateur 3 : Claude Sonnet 4.5, 15 sorties LLM.
- Demande 16 : trois refus `amount_above_cap` par règle, modèle non appelé.
- Total : 16 demandes, 48 votes, 45 sorties LLM et 3 sorties déterministes.

Il s'agit du même comité de modèles que les [preuves initiales AWS](llm-e2e-aws.md),
avec un autre échantillon. L'ancienne mention « trois Haiku » du rapport était
erronée ; elle est corrigée à partir de ces états.

Votes 0 = refus, 1 = revue humaine, 2 = acceptation. Ordre : Haiku / Pixtral / Sonnet.

| Demande | Votes | Source | Étapes persistées |
|---|---|---|---|
| 14 | 1 / 2 / 1 | LLM | closed / closed / closed |
| 15 | 1 / 2 / 1 | LLM | closed / closed / closed |
| 16 | 0 / 0 / 0 | règle déterministe | closed / closed / closed |
| 17 | 0 / 0 / 0 | LLM | closed / closed / closed |
| 18 | 0 / 0 / 0 | LLM | closed / closed / closed |
| 19 | 0 / 0 / 0 | LLM | closed / closed / closed |
| 20 | 1 / 2 / 1 | LLM | closed / closed / closed |
| 21 | 2 / 2 / 2 | LLM | closed / closed / closed |
| 22 | 2 / 2 / 2 | LLM | closed / closed / closed |
| 23 | 2 / 2 / 2 | LLM | closed / closed / closed |
| 24 | 0 / 0 / 0 | LLM | closed / closed / closed |
| 25 | 0 / 0 / 0 | LLM | closed / closed / closed |
| 26 | 0 / 0 / 0 | LLM | closed / closed / closed |
| 27 | 0 / 0 / 0 | LLM | closed / closed / closed |
| 28 | 0 / 0 / 0 | LLM | closed / closed / closed |
| 29 | 0 / 0 / 0 | LLM | closed / closed / closed |

## Portée de la preuve

Cette extraction rapporte l'état local des services. Elle ne constitue pas
une relecture indépendante des événements de la blockchain ni une attestation
indépendante des appels Bedrock. Le nombre de sorties n'établit pas le nombre
d'appels facturés, d'éventuels essais réseau répétés ni l'absence d'un mode
simulé à la seule lecture des états. Les champs `source` et `model` sont ceux que
l'évaluateur a persistés. La demande 16 n'a pas sollicité de modèle.
Les échéances commit, reveal et contest sont copiées dans le JSON ; elles
ne mesurent ni l'heure d'arrivée ni le délai d'évaluation. Le délai médian de
39,8 s reste celui rapporté dans [pitch-chiffres.html](../rendus/pitch-chiffres.html),
non recalculé par cette extraction. Aucun appel réseau ni transaction n'a été
lancé pour cette capture. La validité actuelle des identifiants Bedrock n'est
pas établie par une sortie historique.

Aucun sel, signature, secret, prompt ou résumé libre n'est copié. Les empreintes
ci-dessous portent sur les fichiers originaux complets, conservés hors dépôt.
Elles identifient cette capture ; elles ne prouvent pas l'authenticité de leur contenu.

## Provenance

- Vérificateur 1 : /tmp/team19-e2e-ufFMpm/verifier-1/state.json. Modification UTC : 2026-10-11T09:54:47.113771+00:00. SHA-256 : `de1c90034d9e1b35c46d0d8c2b6f1343a9524c01a656ded4a15b7b452c44c6d4`.
- Vérificateur 2 : /tmp/team19-e2e-ufFMpm/verifier-2/state.json. Modification UTC : 2026-10-11T09:54:46.728768+00:00. SHA-256 : `816a063245b27ec3c34581d6ed27f6bbf9cb3d9cf77b4b6eb268a87ab2899239`.
- Vérificateur 3 : /tmp/team19-e2e-ufFMpm/verifier-3/state.json. Modification UTC : 2026-10-11T09:54:48.919787+00:00. SHA-256 : `af5e9060ae1fca27652642f129e3bed3bb7cb7e326b4c23528b783d1478ae562`.
