# Justification et risques de la direction A

## Pourquoi elle rend l'idée visible

L'idée de Veto, c'est plusieurs gardiens et un seul veto qui suffit. La table ronde la montre sans l'expliquer : cinq sièges, cinq couches réelles, et un siège qui se lève quand le contrat dit non. Le logo n'est pas un décor : c'est le composant principal du produit, ce qui rend la marque reconnaissable en une seconde et l'interface cohérente avec elle. Le reste du système tient la promesse de calme : grandes surfaces lilas gris, couleurs réservées au sens, une seule lueur.

## Risques

- **Rétro-futuriste : kitsch ou daté.** Les ovales, les pilules et la bande à deux filets plaisent à la démonstration, mais risquent de paraître ludiques pour un trésorier. Garde-fou : aplats francs, aucune texture, vocabulaire sobre, pas d'illustration.
- **La table ronde ne s'applique qu'à une demande à la fois.** Sur un écran avec trente demandes en file, il faut la liste d'abord et la table pour la demande sélectionnée.
- **Trois couleurs de sens, trois pastilles.** Le 0/1/2 repose sur des chiffres, des glyphes et des mots. Si le produit gagne d'autres états, la grammaire de couleur sature vite.
- **Le violet de la marque en sombre.** `table` est relevé pour tenir 3:1, ce qui le rend moins profond que le logo. À valider avec le logo imprimé.
- **Les chiffres de la démonstration.** Plus un chiffre est grand (`chiffre-xl`), plus sa condition doit rester proche. Une capture sans sa condition devient une promesse que la preuve ne soutient pas.

## À tester auprès de vrais utilisateurs

1. **Trésorier :** lit-il en moins de dix secondes qu'une décision l'attend et jusqu'à quand ? Comprend-il que ne rien faire refuse ?
2. **Analyste SOC :** retrouve-t-il l'agent, le signal et le rapport sans quitter la liste des incidents ? La table ronde l'aide-t-elle ou le ralentit-elle ?
3. **DAF :** la formule de trésorerie est-elle évidente sans légende ? Sait-il dire ce qui est bloqué et ce qui est plaçable ?
4. **Auditeur :** lit-il une rupture de chaîne sans notice ? Comprend-il « empreinte » ?
5. **Tous :** le mot « veto » est-il compris comme un refus ferme ? Les glyphes seuls (croix, sablier, coche) suffisent-ils sans mot, en niveaux de gris ?
6. Huit heures d'écran en thème sombre puis clair : fatigue, lisibilité du violet et du lilas gris, effet de la lueur unique.
7. **Approbateur notifié :** de la notification (e-mail, mobile) à la demande ouverte, comprend-il sans aide qu'il doit signer ailleurs ? Le rappel arrive-t-il au bon moment, ni trop tôt ni trop tard ?
8. **Responsable sécurité du client :** la page « Preuves et limites » le rassure-t-elle ou le fait-elle douter ? Lit-il la limite « aucun connecteur bancaire construit » comme une honnêteté ou comme un blocage ?

## Risques ajoutés par la version Production

- **Échéance d'un jour ouvré.** Le dashboard affiche ce que le contrat ou le relais renvoie ; si le délai du contrat reste celui de la démonstration, l'écran dira la vérité et le produit sera inutilisable. Le délai se règle côté contrat.
- **Rappels.** Sans support du relais, aucun rappel n'existe : l'écran n'en montre pas.
- **Connexion.** Elle suppose un SSO devant le proxy local. Sans lui, l'écran ne doit pas exister.
- **Preuves et limites.** Un client lira les limites : elles doivent rester à jour (connecteur bancaire, réseau de test).
