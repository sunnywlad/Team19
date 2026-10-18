La barre de navigation du dashboard : marque, cinq écrans, mention « Lecture seule », bascule de thème.

**Fournir** : la liste des écrans (Cockpit, Validation, Incidents, Journal, Rôles) et l'écran courant. Rien d'autre : il n'y a ni compte ni profil.

- Fond `entete-fond`, texte `entete-texte`, onglets inactifs `entete-discret`, trait courant `entete-accent`.
- L'écran courant porte `aria-current="page"`. Cibles de 56px de haut, au-dessus de `cible-min`.
- « Lecture seule » reste visible en permanence : c'est la force du produit, le dashboard ne détient aucune clé.
- Le focus est tracé en `entete-accent` à l'intérieur de la barre.
- La marque est la table ovale du logo : ses classes `marque-table`, `marque-siege` et `marque-trait` suivent le thème.
