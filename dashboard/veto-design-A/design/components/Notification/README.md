Une notification annonce un changement d'état réel : paiement, validation en attente, veto, information.

**Fournir** : un titre court (verbe d'action ou fait), une ligne de détail, le rôle ARIA : `status` par défaut, `alert` pour un veto ou une pause.

- Une pastille de signe (icône sur aplat) plus un titre en gras. Aucune barre colorée sur le côté.
- Elle apparaît seulement sur un fait : un paiement, un veto, une échéance. Jamais pour « tout va bien ».
- Le texte ne promet rien de plus que la preuve : « décision 2 du contrat », pas « sécurisé ».
- La même pastille 0/1/2 et les mêmes mots que dans les tables. Cible de fermeture : 24 px.
- Les messages d'e-mail et d'export reprennent le même titre et le même signe.
