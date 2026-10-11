# Script de la vidéo de démo

Durée visée : 2 min 50, dans la fourchette de 2 à 3 minutes. La scène suit les
huit scénarios de [specs/acceptance/scenarios.md](../../specs/acceptance/scenarios.md) :
trois sont joués en entier (3, 4, puis 1 pour finir), un en accéléré (6), quatre
en un plan chacun (2, 5, 7, 8). Un agent demandeur par scène, pour qu'une pause
n'arrête pas la suivante.

## Ce qui est réel et ce qui ne l'est pas

À dire une fois à l'oral et à garder visible à l'écran : en mode fake, le
dashboard porte un bandeau permanent « COFFRE SIMULÉ : aucun fonds, aucune
chaîne », et chaque panneau son étiquette « réel » ou « simulation ».

Ce tableau dit ce qui a été observé en lançant `make demo` puis `make scenes`
le 11 octobre 2026, en mode fake (coffre simulé), pas ce qui est espéré.

| Plan | Source | Observé |
|---|---|---|
| Scénarios 1 à 8 dans le terminal, par `make scenes` | Réel : chaque demande passe par `gateway/` en HTTP, puis `response/` et `relay/`. Coffre simulé | Oui : décisions, motifs, montants et réactions attendus dans les dix scènes, aux deux écarts connus près (plus bas) |
| Porte d'entrée, détecteur, pause hors chaîne, rapport d'incident (scénarios 2, 3) | Réel | Oui |
| Cas manqué (scénario 4) | Réel pour la porte : document d-105 de dev.jsonl, cas manqué du jeu de réglage (`data/jeu-factures/dev.jsonl`), que le détecteur laisse passer avec un score de 45 sur un seuil de 70 | Oui : il passe, puis il est refusé par le coffre simulé, facture inconnue |
| Décisions du contrat (scénarios 1, 4, 6, 7, 8) | **Simulées** : règles de la spec rejouées par un faux coffre, dans le relais. Aucun fonds, aucune chaîne | Oui, sur le faux coffre |
| Approbation et délai dépassé (scénario 6) | Faux coffre, et un port de contrôle de démo à la place de l'approbateur. Le compte à rebours de 30 s est réel | Oui |
| Relais en panne (scénario 5) | Réel : le processus du relais est arrêté | En partie. Rien n'est soumis ; `QUEUE_EXPIRED` s'écrit à l'échéance, relais arrêté. L'alerte de disponibilité ne part pas pendant la panne (écart connu E2) : elle n'arrive qu'à la relance du relais, après l'expiration |
| Vérification du journal | Réel | Oui : chaînage intègre sur le journal courant et sur chaque journal archivé |
| Dashboard, écran Décisions, après les scènes 3, 4, 6a et 1 | `make demo` le lance en mode réel, branché sur `relay/` et `response/` | Oui, regardé sur captures : bandeau « COFFRE SIMULÉ », étiquette « simulation » sur « Montant plaçable » et « Décisions du contrat », « réel » sur la porte, la file et les délais. Scène 3 : ligne « bloquée à la porte d'entrée », `INSTRUCTION_IN_DATA`, score 100, aucune décision. Scène 4 : incident ouvert, score 45, « refusée par le contrat : facture inconnue » marquée « simulation », sorti 0. Scène 6a : « en attente d'approbation » 30 bloqué puis « approuvée et payée » 30, cash 70. Scène 1 : « acceptée et payée » 10, cash 90 |
| Dashboard pendant les scènes 2, 5, 6b, 7, 8, et écrans Journal et En attente en détail | Même lancement | **Non** : écrans non vus. À relire avant le tournage |
| Pause d'un agent sur la chaîne (scénarios 3, 4) | Absente : aucun composant ne la pose. `AGENT_PAUSED (ONCHAIN)` n'est jamais écrit | Non observée |

Deux écarts connus avec la spec s'affichent dans le terminal, « ÉCART CONNU
(E1) » et « ÉCART CONNU (E2) », et sont listés dans `demo/ecarts-connus.json` :
l'ordre de `FORWARDED_TO_CLIENT_AI` dans le journal, et l'alerte de
disponibilité du scénario 5. `make scenes` les réaffiche à chaque passage. Ne
pas couper ces lignes au montage sans le dire.

Si un contrat est déployé avant le tournage, ce tableau et les mentions
« simulation » se mettent à jour, pas avant.

## Préparation

Toute la chaîne, depuis la racine, puis une scène à la fois :

```bash
make demo
```

```bash
make scene S=3
```

Chaque scène repart d'un monde neuf : le journal et les bases d'avant sont
archivés, rien n'est effacé, et le dashboard se vide. Le plan 3 → 4 → 1 se
tourne donc en trois prises, une par scène, et non en un seul plan continu : au
montage, ne pas laisser croire que l'incident de la scène 3 est encore ouvert
pendant la scène 1. Arrêt : `make demo-stop`.

Repli sur le dashboard simulé : deux terminaux, depuis `dashboard/`. La scène
enchaîne les scénarios 3, 4 puis 1 en 47 s ; relancer le serveur de fixtures la
rejoue.

```bash
npm run dev:fixtures
```

```bash
npm run dev:sim
```

Pour un scénario seul, par exemple le 6 avec délai dépassé :

```bash
npm run dev:fixtures -- 6b
```

## Délais d'attente de la scène

Tous en secondes, valeurs de [specs/00-a-trancher.md](../../specs/00-a-trancher.md), point p.

| Attente | Durée | À l'image |
|---|---|---|
| Pause hors chaîne après un blocage | immédiate | En direct |
| Délai d'approbation (scénario 6) | 30 s | Compte à rebours montré 5 s, puis coupe |
| Alerte de disponibilité (scénario 5) | 15 s dans la spec | Non montrée en réel : relais arrêté, elle ne part pas (écart connu E2). Sur les fixtures seulement, étiquetées « simulation » |
| Expiration en file, relais arrêté (scénario 5) | de l'ordre de 30 s | Terminal : `QUEUE_EXPIRED` à l'échéance |
| Durée de vie d'une demande en démo | de l'ordre de 30 s | Non montrée |
| Fenêtre de répétition | 3 en 60 s | Citée, non montrée |

## Déroulé

| Temps | Scénario | À l'écran | Ce qui est dit |
|---|---|---|---|
| 0:00 – 0:15 | | Titre, puis une facture dont une ligne ordonne un paiement | « Un agent IA lit une facture. Une ligne cachée lui ordonne de payer un inconnu. S'il obéit, l'argent part. Argent Intelligent se place entre l'agent et la trésorerie. » |
| 0:15 – 0:50 | 3 | Terminal : l'agent `A-DEM-2` envoie la facture piégée, réponse « rejected ». Puis `/agents/paused` et le rapport d'incident. Dashboard : ligne « bloquée à la porte d'entrée », code `INSTRUCTION_IN_DATA`, incident ouvert | « La porte d'entrée note chaque demande. Ici, le score dépasse le seuil : la demande est bloquée, le document mis en quarantaine, l'agent mis en pause, l'analyste alerté, le rapport écrit. Aucune de ces actions ne déplace de fonds : elles ne font que bloquer. Seul un humain lèvera la pause. » |
| 0:50 – 1:25 | 4 | Dashboard : la même attaque, reformulée, passe la porte. Ligne « refusée par le contrat : facture inconnue ». Incident ouvert, montant sorti 0. Bandeau « COFFRE SIMULÉ : aucun fonds, aucune chaîne » lisible | « Maintenant, le cas que notre détecteur rate. L'attaque est reformulée, elle passe, et l'IA du client, trompée, signe la demande. C'est la règle de paiement qui l'arrête : cette facture n'est inscrite nulle part. Nous n'empêchons pas l'injection, nous bornons ses conséquences. Ce refus est rejoué ici par un faux coffre : le contrat reste à écrire. » |
| 1:25 – 1:35 | 4 | Carton : section « Cas manqués » de la [fiche de défense](../fiche-defense.md), telle qu'elle est le jour du tournage | « Les attaques manquées sur notre jeu de test sont listées dans la fiche de défense. » Tant que rien n'est mesuré, le carton montre « à mesurer » et la phrase devient : « La mesure sur le jeu de test n'est pas encore faite. » |
| 1:35 – 1:55 | 6 | Dashboard : ligne « en attente d'approbation », 30, compte à rebours. Coupe. Ligne refusée, délai dépassé | « Au-dessus du seuil, la décision revient à un humain. Il voit la facture et le montant inscrits, pas la justification de l'agent. Sans réponse en trente secondes, la demande est refusée : un délai dépassé ne vaut jamais accord. » |
| 1:55 – 2:20 | 2, 5, 7, 8 | Quatre plans de six secondes : « rejetée à l'entrée » ; scénario 5 dans le terminal, `QUEUE_EXPIRED` relais arrêté (le bandeau « relais indisponible » du dashboard dépend de l'alerte, qui ne part qu'à la relance du relais : écran non vu en réel, voir E2) ; « refusée : dépasse le plaçable » ; « refusée : facture déjà payée » | « Un jeton invalide : rejeté, sans punir l'agent usurpé. Le relais tombe : rien n'est autorisé. Un placement trop élevé : refusé. Une facture présentée deux fois : payée une fois. » |
| 2:20 – 2:30 | | Terminal : vérification du journal, « 6 entrées, tête … », code 0 | « Chaque étape est dans un journal chaîné. Un script le vérifie ; modifier une entrée se voit. » |
| 2:30 – 2:50 | 1 | Dashboard : l'agent `A-DEM-1` transmet une facture saine. Ligne « acceptée et payée », 10. Aucun incident | « Et une facture légitime ? Elle passe. Même porte, même règle, payée au bénéficiaire inscrit, pour le montant inscrit. Le système ne bloque pas tout. » |

## À ne pas dire

Les formules écartées et leurs remplacements sont dans
[questions-reponses.md](../pitch/questions-reponses.md), « Ce que nous ne disons pas ».
Dans la vidéo en particulier : pas de chiffre de détection à l'oral tant que la
fiche affiche « à mesurer », et pas de « le contrat refuse » sans « rejoué par
un faux coffre » tant qu'il n'est pas déployé. Une fois déployé : jamais « le
contrat paie » sans « sur réseau de test ». Le connecteur bancaire envisagé
pour la production n'est pas montré et n'est jamais présenté comme existant
([README](../../README.md), « Cadrage du paiement »).

## Repli

Les fixtures du dashboard montrent ce que la spec prévoit, pas ce que les
services font : on y voit une pause de l'agent « sur la chaîne », qu'aucun composant réel ne
pose, et un bandeau « relais indisponible » pendant la panne, alors qu'en réel
l'alerte dont il dépend ne part qu'à la relance du relais. Un
plan tourné sur les fixtures garde son étiquette « simulation » à l'image et ne
se commente pas comme un fait observé.

Si un service ne démarre pas au tournage : la scène entière se joue sur les
fixtures du dashboard, et le plan du terminal est remplacé par les tests,
depuis `relay/` :

```bash
npm test
```
