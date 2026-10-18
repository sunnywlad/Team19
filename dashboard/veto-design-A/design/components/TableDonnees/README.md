La table de données : entête en majuscules fines, filets, chiffres alignés à droite en monospace.

**Fournir** : des lignes dont chaque cellule vient d'une API validée. Une valeur absente est « — » ou « Non mesuré ».

- L'entête porte un filet de 2px en `texte`, les lignes un filet `trait` de 1px. Pas de zèbre, pas de carte autour.
- Identifiants et montants en Plex Mono avec chiffres tabulaires, alignés à droite.
- La décision est une `PastilleDecision`, le motif un code `identifiant`. Les deux ensemble disent la même chose en deux langues.
- La ligne sélectionnée prend `accent-fond` et `aria-selected="true"`.
- Sous 1100 px, les tables passent en fiches (une fiche par ligne) : l'ordre des colonnes devient l'ordre des lignes de la fiche.
- Hors des 24 px de cible : les lignes cliquables font au moins 40 px de haut.
