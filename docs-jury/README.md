# Dossier jury : la partie blockchain

Ce dossier décrit la partie blockchain du projet. Il s'adresse au jury. Nous
rassemblons ici ce que la pile fait, comment elle est bâtie, et comment la
rejouer.

## Ce que fait la partie blockchain

Nous fournissons un marché de vérification pour le flux de l'équipe.
Un agent demandeur soumet une décision prévue. Un comité de
vérificateurs la juge. La chaîne agrège les verdicts en un code simple. Le code
0 signifie refusé. Le code 1 signifie validation humaine conseillée. Le code 2
signifie accepté. Le demandeur lit ce code et agit hors chaîne.

Le marché fonctionne sur notre L1 Avalanche privé sur AWS, avec le jeton
natif VETO et le guichet VetoDesk. ArgentVault porte séparément la décision
déterministe et le paiement simulé : il est écrit, testé et joué sur anvil,
pas encore déployé sur le L1. Au temps 1, il décide sans le vote du marché ;
leur jonction appartient au temps 2.

Sources : `src/VerificationMarket.sol`, `src/VetoDesk.sol`,
`infra/l1/README.md` ; branche `feat/argent-vault`, `src/ArgentVault.sol` ;
`Team19-notes/etat-run.md`, section « Run AWS de bout en bout ».

## Les fichiers de ce dossier

| Fichier | Contenu |
|---|---|
| `README.md` | Ce sommaire et le résumé de la partie blockchain. |
| `architecture.md` | Le L1 privé VETO, les contrats par phase, la part hors chaîne. |
| `flux-demande.md` | Le parcours d'une demande, du dépôt au code final. |
| `fautes.md` | Les trois fautes, les sanctions, et nos limites assumées. |
| `rejouer-la-demo.md` | Les commandes pour redéployer et rejouer la scène d'attaque. |
| [mesures-gaz.md](mesures-gaz.md) | Tailles des contrats, coûts mesurés et réglages du compilateur. |
| [tests.md](tests.md) | Suites Foundry et hors chaîne, familles de tests et commandes. |
| [rapport-securite.md](rapport-securite.md) | Rapport de sécurité préparé séparément, à réunir à ce dossier. |
