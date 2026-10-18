La carte d'incident donne à l'analyste sécurité l'essentiel d'un coup d'œil : l'agent, les signaux, la réaction, les délais mesurés.

**Fournir** : le titre en mots simples, les codes du détecteur (`INSTRUCTION_IN_DATA`, `AUTHORITY_VIOLATION`, `PAYMENT_ANOMALY`), le motif du contrat, l'agent concerné et les réactions déclenchées.

- Une ligne par incident, séparée par un filet, jamais une carte dans une carte. L'incident sélectionné prend le fond `accent-fond`.
- Les codes restent en `identifiant` (Plex Mono) : ils sont les faits bruts, l'analyste les copie.
- Trois mesures : détection, pause, alerte. Une mesure absente affiche « Non mesuré », pas 0 ni une estimation.
- Toute durée est suivie de sa condition (« mesurée entre les horodatages du journal »). Une durée sans deux horodatages d'une même horloge s'affiche « Non mesuré ».
- Le contenu d'un document reçu est inerte : jamais interprété, borné, en monospace. Il n'apparaît ni dans le titre ni dans l'alerte.
- À ne pas faire : « zéro attaque réussie », « protégé contre l'injection ». On écrit ce qui est mesuré.
