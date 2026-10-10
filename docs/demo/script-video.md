# Script de la vidéo de démo

Durée visée : 2 min 50, dans la fourchette de 2 à 3 minutes. La scène suit les
huit scénarios de [specs/acceptance/scenarios.md](../../specs/acceptance/scenarios.md) :
trois sont joués en entier (3, 4, puis 1 pour finir), un en accéléré (6), quatre
en un plan chacun (2, 5, 7, 8). Un agent demandeur par scène, pour qu'une pause
n'arrête pas la suivante.

## Ce qui est réel et ce qui ne l'est pas

À dire une fois à l'oral et à garder visible à l'écran : chaque panneau du
dashboard porte son étiquette « réel » ou « simulation ».

| Plan | Source |
|---|---|
| Scénario 3 dans le terminal | Réel : `gateway/` et `response/` lancés, commandes du [README](../../README.md), « Lancer la démo » |
| Tous les plans du dashboard | Simulés par les fixtures de `dashboard/`, tant qu'aucun contrat n'est déployé |
| Décisions du contrat (scénarios 1, 4, 6, 7, 8) | Règles de la spec, rejouées par un faux coffre. Aucun fonds réel |

Si un contrat est déployé avant le tournage, ce tableau et les mentions
« simulation » se mettent à jour, pas avant.

## Préparation

Deux terminaux pour le dashboard, depuis `dashboard/`. La scène enchaîne les
scénarios 3, 4 puis 1 en 47 s ; relancer le serveur de fixtures la rejoue.

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
| Alerte de disponibilité, relais arrêté (scénario 5) | 15 s | Coupe, le bandeau est montré une fois affiché |
| Durée de vie d'une demande en démo | de l'ordre de 30 s | Non montrée |
| Fenêtre de répétition | 3 en 60 s | Citée, non montrée |

## Déroulé

| Temps | Scénario | À l'écran | Ce qui est dit |
|---|---|---|---|
| 0:00 – 0:15 | | Titre, puis une facture dont une ligne ordonne un paiement | « Un agent IA lit une facture. Une ligne cachée lui ordonne de payer un inconnu. S'il obéit, l'argent part. Argent Intelligent se place entre l'agent et la trésorerie. » |
| 0:15 – 0:50 | 3 | Terminal : l'agent `A-DEM-2` envoie la facture piégée, réponse « rejected ». Puis `/agents/paused` et le rapport d'incident. Dashboard : ligne « bloquée à la porte d'entrée », code `INSTRUCTION_IN_DATA`, incident ouvert | « La porte d'entrée note chaque demande. Ici, le score dépasse le seuil : la demande est bloquée, le document mis en quarantaine, l'agent mis en pause, l'analyste alerté, le rapport écrit. Aucune de ces actions ne déplace de fonds : elles ne font que bloquer. Seul un humain lèvera la pause. » |
| 0:50 – 1:25 | 4 | Dashboard : la même attaque, reformulée, passe la porte. Ligne « refusée par le contrat : facture inconnue ». Incident ouvert, montant sorti 0. Bandeau « simulation » lisible | « Maintenant, le cas que notre détecteur rate. L'attaque est reformulée, elle passe, et l'IA du client, trompée, signe la demande. C'est la règle de paiement qui l'arrête : cette facture n'est inscrite nulle part. Nous n'empêchons pas l'injection, nous bornons ses conséquences. Ce refus est rejoué ici par un faux coffre : le contrat reste à écrire. » |
| 1:25 – 1:35 | 4 | Carton : section « Cas manqués » de la [fiche de défense](../fiche-defense.md), telle qu'elle est le jour du tournage | « Les attaques manquées sur notre jeu de test sont listées dans la fiche de défense. » Tant que rien n'est mesuré, le carton montre « à mesurer » et la phrase devient : « La mesure sur le jeu de test n'est pas encore faite. » |
| 1:35 – 1:55 | 6 | Dashboard : ligne « en attente d'approbation », 30, compte à rebours. Coupe. Ligne refusée, délai dépassé | « Au-dessus du seuil, la décision revient à un humain. Il voit la facture et le montant inscrits, pas la justification de l'agent. Sans réponse en trente secondes, la demande est refusée : un délai dépassé ne vaut jamais accord. » |
| 1:55 – 2:20 | 2, 5, 7, 8 | Quatre plans de six secondes : « rejetée à l'entrée » ; bandeau « relais indisponible » puis « expirée en file » ; « refusée : dépasse le plaçable » ; « refusée : facture déjà payée » | « Un jeton invalide : rejeté, sans punir l'agent usurpé. Le relais tombe : rien n'est autorisé. Un placement trop élevé : refusé. Une facture présentée deux fois : payée une fois. » |
| 2:20 – 2:30 | | Terminal : vérification du journal, « 6 entrées, tête … », code 0 | « Chaque étape est dans un journal chaîné. Un script le vérifie ; modifier une entrée se voit. » |
| 2:30 – 2:50 | 1 | Dashboard : l'agent `A-DEM-1` transmet une facture saine. Ligne « acceptée et payée », 10. Aucun incident | « Et une facture légitime ? Elle passe. Même porte, même règle, payée au bénéficiaire inscrit, pour le montant inscrit. Le système ne bloque pas tout. » |

## À ne pas dire

Les formules écartées et leurs remplacements sont dans
[questions-reponses.md](../pitch/questions-reponses.md), « Ce que nous ne disons pas ».
Dans la vidéo en particulier : pas de chiffre de détection à l'oral tant que la
fiche affiche « à mesurer », et pas de « le contrat refuse » sans « rejoué par
un faux coffre » tant qu'il n'est pas déployé.

## Repli

Si un service ne démarre pas au tournage : la scène entière se joue sur les
fixtures du dashboard, et le plan du terminal est remplacé par les tests,
depuis `relay/` :

```bash
npm test
```
