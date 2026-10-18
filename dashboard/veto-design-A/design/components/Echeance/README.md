L'échéance dit jusqu'à quand un humain peut trancher. Le client vise un jour ouvré : personne ne reste devant l'écran, il est notifié.

**Fournir** : l'heure de la demande, l'échéance inscrite par le contrat (date et heure, en heure locale), la liste des notifications envoyées, et la date d'un rappel s'il est planifié.

- Trois états : normal, proche (dernier quart du délai), échue. L'état proche ajoute la mention « Échéance proche » en toutes lettres, la couleur seule ne porte pas le sens.
- Temps restant écrit en heures et minutes (`20 h 12`), jamais en secondes. La jauge compte 24 cases quelle que soit la durée : une case = 1/24 du délai.
- La phrase « Sans signature avant l'échéance : refusé » reste affichée dans chaque état. Une fois l'échéance passée : « Refusé : APPROVAL_TIMEOUT. Rien n'est parti, le montant est libéré. »
- Jalons : demande reçue, notification envoyée (canal et heure), rappel, échéance. La ligne « Rappel prévu » n'existe que si le relais planifie un rappel : sinon elle est omise, jamais inventée.
- Le délai « un jour ouvré » est calculé par le relais ou le contrat : le dashboard affiche l'échéance qu'on lui donne et ne calcule aucun jour ouvré.
- Pas de sablier animé, pas de clignotement : le mouvement est réservé aux faits.
