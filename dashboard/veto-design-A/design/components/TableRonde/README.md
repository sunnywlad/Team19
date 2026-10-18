La table ronde est le composant central : une table ovale violette portant le V, cinq sièges qui sont les cinq couches réelles du paiement.

**Fournir** : cinq états, dans l'ordre Porte d'entrée, IA du client, Relais, Contrat, Humain, et pour un siège en veto son code motif.

- États d'un siège : `repos` (gris plein), `passe` (sarcelle, coche), `veto` (orange, siège levé, croix), `attente` (moutarde, sablier, la lueur), `non-atteint` (pointillé).
- La légende sous la table donne, pour chaque siège, son numéro, son nom et son état en mots. Un siège ne se lit jamais par sa couleur seule.
- La table ne montre que des faits. Un siège change d'état seulement quand la couche a réellement statué ; `siege-nouveau` joue l'animation une fois (240 ms pour un passage, 320 ms pour un veto).
- L'ordre des sièges suit le flux et ne se réorganise jamais. Un siège « non atteint » reste en pointillé : c'est la preuve visible que le flux s'est arrêté avant lui.
- Sa géométrie vient du logo (table ovale, cinq sièges, V). Le thème colore la table avec `table` et `table-v`.
- À ne pas faire : ajouter des votes, des détecteurs A/B ou un consensus. Ce n'est pas le flux de paiement de la démonstration.
- Largeur maximale 440px ; dessiné pour 360 × 200 (viewBox) et mis à l'échelle.
