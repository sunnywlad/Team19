La pastille de décision montre l'issue 0, 1 ou 2 du contrat, toujours en trois signes : chiffre, glyphe, mot.

**Fournir** : la décision lue dans l'événement du contrat (jamais dans le reçu). Un motif inconnu, ou une décision qui ne va pas avec son motif, se traite comme 0.

- **0 · Refusé** : croix, `refuse`. **1 · Validation humaine** : sablier, `humain`. **2 · Payé** : coche, `accepte`.
- « Arrêté à la porte » (`bloque`) est un état de la porte d'entrée, sans chiffre : le contrat n'a pas décidé.
- Même pastille dans les tables, les notifications, les exports et le rapport PDF. En noir et blanc, le chiffre et le mot suffisent.
- Le glyphe sur aplat `-signal` est une icône (3:1) ; le texte reste en encre `refuse`, `humain` ou `accepte` sur son `-fond` (4,5:1).
- Variante `decision-grand` pour la carte de validation et l'en-tête d'un rapport.
- À ne pas faire : « Accepté » à la place de « Payé » avant que le contrat ait payé, ni « Payé » sans « réseau de test » dans une présentation.
