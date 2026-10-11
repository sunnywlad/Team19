# Comparaison expérimentale LLM : trois et cinq vérificateurs

Fin du banc UTC : 2026-10-11T10:15:26.965133+00:00. [Rapport JSON](rapport.json), [votes nettoyés](votes.jsonl), [corpus fixé](fixtures.json).

**Le passage à cinq ne démontre aucune amélioration du rappel sur ce corpus.**
Les deux comités refusent 18 attaques sur 20, mettent les deux autres en revue
humaine et acceptent les 20 demandes légitimes. La revue humaine ne compte pas
comme une détection par refus. Le benchmark ne mesure pas le détecteur à
règles de la porte, dont le rappel publié reste 50 sur 100 sur son autre jeu.

## Protocole

- 40 cas synthétiques équilibrés :20 attaques,20 légitimes ; dix familles d'attaque, deux variantes chacune.
- Facture, référence, montant et bénéficiaire cohérents avec la décision prévue. Mandat complet. Montants 120 à 367 unités mineures, sous le plafond et palier 500 : aucun vote final ne vient d'une règle dure.
- Corpus fixé avant les appels. Étiquettes et familles conservées hors du payload envoyé aux modèles. Prompt de production et évaluateur inchangés.
- Les 200 votes finaux ont tous `source=llm`, sans erreur, timeout ni JSON invalide. Les mêmes 120 votes servent le comité 3 et sont repris dans le comité 5.
- Trois : Haiku 4.5 / Pixtral Large / Sonnet 4.5. Cinq : mêmes trois, Llama 3.3 70B et une deuxième instance Sonnet 4.5. **Cinq instances, quatre modèles, trois fournisseurs**. Les deux Sonnet ne sont pas des modèles indépendants.
- Règle existante avec toutes les révélations : majorité stricte de refus donne 0 ; unanimité d'acceptation donne 2 ; sinon revue humaine 1. Calcul hors chaîne seulement, aucun déploiement ni transaction.
- Départs des processus espacés d'au moins 1 s, maximum 5 évaluations concurrentes ; délai du service 15 s, délai interne 12 s. Métadonnées AWS lues avant sélection des modèles.

## Résultats

| Mesure | Comité 3 | Comité 5 |
|---|---:|---:|
| Détection : refus 0 sur attaques | 90.0 % | 90.0 % |
| Précision des refus 0 | 100.0 % | 100.0 % |
| Faux positifs : refus 0 sur légitimes | 0.0 % | 0.0 % |
| Attaques refusées ou en revue 0/1 | 100.0 % | 100.0 % |
| Légitimes refusées ou en revue 0/1 | 0.0 % | 0.0 % |
| Refus corrects sur 20 attaques | 18 | 18 |
| Attaques en revue humaine | 2 | 2 |
| Légitimes en revue humaine | 0 | 0 |
| Maximum durée évaluateur par cas, p50 | 2.934 s | 3.738 s |
| Maximum durée évaluateur par cas, p95 | 4.339 s | 4.471 s |

Les deux cas non refusés sont les variantes de changement de coordonnées
`c029` et `c030`. Elles restent en revue humaine : aucun des deux comités
ne les accepte. Un refus correct (code 0) et une mise en revue(code 1) sont
comptés séparément.

## Latences et panne distincte

Les latences individuelles sont mesurées de l'ouverture du processus à sa
sortie, import Python compris. Le maximum par cas est un **proxy pour des
évaluations lancées simultanément**, sans blockchain, commit/reveal, indexeur
ou confinement. Il n'est pas un temps de détection de bout en bout du système.
La cinquième instance a été rejouée après les quatre premières ; on ne rapporte
pas une durée murale de comité comme si elles avaient tourné ensemble.

Le profil Nova Premier était ACTIVE dans les métadonnées, mais ses 40 tentatives
Converse ont toutes renvoyé `ResourceNotFoundException`. Les [votes initiaux](votes-initial-unavailable.jsonl)
et [tentatives initiales](calls-initial-unavailable.jsonl) sont archivés.
Ce modèle a été remplacé pour indisponibilité, sans consulter son score ni
modifier les pièces :160 votes fonctionnels repris et 40 appels Sonnet ajoutés.
Les 40 erreurs n'entrent pas dans les métriques finales.
Les journaux d'appels comptent 200 tentatives initiales(160 réussies,40 erreurs)
et 40 tentatives de remplacement réussies, plus un appel probe Llama réussi
hors journal. Aucun nouvel appel après le calcul du résultat.

## Portée

Petit corpus synthétique choisi par l'équipe, avec attaques souvent explicites.
Ce n'est pas le jeu de test indépendant de la porte et aucune généralisation
au taux de fraude réel n'est permise. Les payloads comprennent le mandat complet,
ce qui diffère des demandes historiques limitées à une phrase. Les cinq
instances partagent le même évaluateur et le même prompt. La redondance n'est
pas une mesure d'indépendance. La comparaison porte sur les votes hors chaîne,
pas sur un système 5 déployé sur AWS ni sur le paiement du coffre.

Empreinte du corpus : `2b987edb6fc926516cfa63bda8fac5a0bb1b8d99be132dc3700561ce786aafce`.
Empreinte de l'évaluateur inchangé : `277bc0bdd5e854e363965aca60d19306ffc3e8302f3e7b5b8a5da686a7ab75c8`.
Le JSON conserve aussi les empreintes des votes, journaux, modèles et scripts.
