# Dossier jury : la partie blockchain (lot C)

Ce dossier décrit la partie blockchain du projet. Il s'adresse au jury. Nous
rassemblons ici ce que la pile fait, comment elle est bâtie, et comment la
rejouer.

## Ce que fait la partie blockchain

Nous fournissons une porte de décision pour les étapes 8 et 9 du flux de
l'équipe. Un agent demandeur soumet une décision prévue. Un comité de
vérificateurs la juge. La chaîne agrège les verdicts en un code simple. Le code
0 signifie refusé. Le code 1 signifie validation humaine conseillée. Le code 2
signifie accepté. Le demandeur lit ce code et agit hors chaîne.

## Les fichiers de ce dossier

| Fichier | Contenu |
|---|---|
| `README.md` | Ce sommaire et le résumé de la partie blockchain. |
| `architecture.md` | Le L1 privé CHK, les contrats par phase, la part hors chaîne. |
| `flux-demande.md` | Le parcours d'une demande, du dépôt au code final. |
| `fautes.md` | Les trois fautes, les sanctions, et nos limites assumées. |
| `rejouer-la-demo.md` | Les commandes pour redéployer et rejouer la scène d'attaque. |
