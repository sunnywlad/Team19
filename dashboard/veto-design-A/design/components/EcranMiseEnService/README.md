La mise en service vérifie qu'un environnement est prêt à être utilisé : joignable, lisible, réglé, alerté. Elle reste ensuite comme page de contrôle.

**Fournir** : pour chaque contrôle, le résultat de la dernière lecture (réussi, à faire, en échec), son heure, et où agir quand rien ne peut se faire ici.

- C'est une checklist de vérification, pas un assistant de configuration : le dashboard ne fait que des `GET`. Les seuils, les approbateurs et les canaux se règlent côté contrat, relais et annuaire de l'entreprise.
- Quatre états en mots avec icône : Vérifié, À faire, Échec, Non vérifié. Jamais de couleur seule.
- « Revérifier » relit la donnée (un GET) ; il ne modifie rien.
- Chaque ligne « À faire » ou « Échec » dit quoi faire et où : « hors dashboard ». La ligne se met à jour à la lecture suivante.
- Le compte « 6 / 8 » dit combien de vérifications sont passées, sans promettre que le reste va bien.
- Pas de bandeau de trésorerie ici : c'est une page de contrôle, pas un écran de travail.
