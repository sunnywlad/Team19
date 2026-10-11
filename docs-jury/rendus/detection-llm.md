# VETO : détection par un comité de cinq vérificateurs

Banc expérimental du 11 octobre 2026, terminé à 12 h 15. Configuration retenue : **cinq instances, quatre modèles, trois fournisseurs**. Vrais appels Amazon Bedrock ; agrégation hors chaîne. Le comité de cinq n'est pas déployé sur le L1 de la démo.

## Résultat sur 40 pièces

Vingt demandes légitimes et vingt attaques synthétiques, réparties en dix familles avec deux variantes chacune. Les pièces, références, montants et mandats sont cohérents. Les labels ne sont pas transmis aux modèles. Le corpus est figé avant les appels.

| Mesure | Comité de cinq | Référence de trois |
|---|---:|---:|
| Attaques refusées par le comité seul | **18/20, soit 90 %** | 18/20, soit 90 % |
| Précision des refus | **100 %**, 18 refus corrects sur 18 | 100 % |
| Faux positifs sur les demandes légitimes | **0/20** | 0/20 |
| Attaques en revue humaine | **2/20** | 2/20 |
| Attaques acceptées | **0/20** | 0/20 |
| Familles d'attaque entièrement refusées | **9/10** | 9/10 |
| Maximum des durées individuelles, p50 / p95 | **3,738 s / 4,471 s** | 2,934 s / 4,339 s |

Les deux variantes de changement de coordonnées sont envoyées en revue humaine. Une revue humaine est comptée séparément d'un refus. Les cinq instances n'améliorent pas le rappel observé sur ce corpus. Les durées sont un proxy d'évaluation parallèle, hors chaîne ; elles n'incluent pas les fenêtres commit/reveal, l'indexeur ou la réponse à incident.

## Comité et preuves

Haiku 4.5, Pixtral Large, Sonnet 4.5, Llama 3.3 70B et une deuxième instance Sonnet 4.5. Les deux instances Sonnet partagent un modèle. Les mêmes 120 votes des trois premiers servent aux deux comparaisons. Règle conservée : majorité stricte de refus, unanimité pour accepter, sinon revue humaine.

**200 votes finaux portent `source=llm`, sans erreur ni timeout.** Tous les montants restent sous le plafond : aucun résultat final n'est un refus déterministe. Nova Premier a renvoyé 40 erreurs d'indisponibilité ; ses traces sont conservées séparément et exclues des scores. Le cinquième a été remplacé sans changer le corpus ni le prompt. L'évaluateur de production est inchangé.

Sources livrées : [rapport JSON](../../offchain/experimental-bench5/rapport.json), [votes](../../offchain/experimental-bench5/votes.jsonl), [pièces](../../offchain/experimental-bench5/fixtures.json), [protocole complet et limites](../../offchain/experimental-bench5/rapport.md). Les scripts permettent de reproduire les appels avec ses propres identifiants Bedrock et de recompter les résultats sans réseau : [README du banc](../../offchain/experimental-bench5/README.md).

## Montants : preuve distincte du coffre

Le banc LLM ne paie rien et ne mesure aucune perte monétaire. Dans la [campagne séparée du coffre simulé](../../demo/campagne/README.md), 500 tentatives sur dix familles produisent **zéro paiement détourné et zéro unité perdue**. Les 50 demandes hostiles acceptées lorsque le filtre est contourné paient le bénéficiaire et le montant déjà admis. Unités comptables synthétiques, sans conversion en euros ; rôle d'admission non compromis.

## Portée

Petit corpus choisi par l'équipe, avec des attaques souvent explicites. Aucune extrapolation à la fraude réelle. Ces 90 % sont ceux du comité LLM, sur ce banc ; le filtre à règles de la porte conserve sa mesure distincte de 50/100 sur son jeu de test. Le comité ne pilote pas le coffre. Le prototype Solidity de cinq est éprouvé séparément en local ; les résultats ci-dessus portent sur l'agrégation des votes LLM hors chaîne.
