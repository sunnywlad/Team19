# Questions du jury : réponses courtes

Chaque réponse tient en trente secondes et se termine par sa limite réelle.
L'état du dépôt est celui du [README](../../README.md), « État des composants » :
le contrat n'est pas écrit, le flux tourne contre un faux coffre.

## « Si votre modèle se trompe, qui est responsable ? »

Le détecteur ne décide pas d'un paiement : il bloque ou laisse passer. La
décision appartient à une règle que le propriétaire du coffre a approuvée, et
chaque décision est tracée avec son motif. Au-dessus du seuil, un humain
approuve, et sans réponse dans le délai la demande est refusée.

**Limite.** La perte est bornée, pas nulle : une fausse dette inscrite en amont
peut être payée. L'outil ne tranche pas le partage juridique de la
responsabilité. Et dans le dépôt, il n'y a pas de modèle : le détecteur est un
jeu de règles, l'« IA du client » un bouchon qui signe.

## « Pourquoi pas des règles fixes ? »

Nous en avons, et ce sont elles qui décident : une facture se paie une fois, au
bénéficiaire inscrit, pour le montant inscrit. Mais une règle de paiement
refuse sans rien dire de l'origine. Le détecteur lit le document que l'agent
transmet, avant toute signature, et la réponse isole l'agent qui l'a transmis :
quarantaine, pause, alerte, rapport.

**Limite.** La comparaison avec des règles fixes seules n'est pas mesurée : la
ligne est « à mesurer » dans la [fiche de défense](../fiche-defense.md). Notre
détecteur est lui-même fait de règles : une attaque formulée autrement passe.

## « Pourquoi une blockchain ? »

Pour que la règle qui paie ne dépende pas de nos serveurs. Le contrat calcule
sur son propre état et publie sa décision et son motif dans un événement que
n'importe qui relit. Les rôles sont séparés par des clés : le relais ne porte
que du gaz et ne peut soumettre que ce que le client a signé. Un auditeur
recalcule la règle sans nous faire confiance.

**Limite.** Ce contrat n'est pas écrit : il existe une interface gelée
(`specs/contract/IArgentVault.sol`) et un faux coffre. Seuls les fonds détenus
par le contrat seraient protégés, pas un compte bancaire. Montants et adresses
de paiement sont publics sur une chaîne.

## « Êtes-vous en règle avec DORA ? »

Non, et nous ne le revendiquons pas. L'outil apporte trois choses utiles à une
entité qui doit l'être : un journal dont l'altération se détecte, un rapport
d'incident prérempli, des horodatages de détection, de pause et d'alerte.

**Limite.** La classification d'un incident et sa notification restent
humaines et hors de l'outil. Nous ne citons aucun délai réglementaire : nous
ne les avons pas relus à la source. Détail : [conformite.md](../conformite.md).

## « Que se passe-t-il si l'agent est compromis ? »

Il ne peut rien désigner : ni montant, ni bénéficiaire, seulement l'identifiant
d'une facture déjà inscrite. Son jeton est court, révocable et lié à un mandat.
Au premier signal hostile, il est mis en pause : la porte d'entrée le refuse,
le relais écarte ses demandes, et seul un humain lève la pause.

**Limite.** La pause est hors chaîne : un relais compromis la contournerait,
faute de contrat pour la répéter. Un agent compromis mais discret peut encore
faire payer une facture inscrite, une seule fois, à son vrai bénéficiaire. Une
clé de client ou de propriétaire compromise sort du modèle.

## « Et si l'injection de prompt réussit ? »

C'est notre scénario 4, et nous le montrons. Le détecteur laisse passer le
document, l'IA du client est trompée et signe. La demande vise une facture que
personne n'a inscrite : le contrat la refuse, motif « facture inconnue », rien
ne sort, et ce refus déclenche la même réponse que si la porte avait bloqué.
Le texte piégé n'atteint jamais le composant qui signe : la porte ne transmet
que des identifiants.

**Limite.** Nous n'empêchons pas l'injection, nous en bornons les
conséquences. Ce refus est aujourd'hui rejoué par un faux coffre
(`relay/test/scenarios.test.ts`), pas par un contrat sur une chaîne. Et une
injection qui vise une facture inscrite obtient son paiement : au bon
bénéficiaire, pour le bon montant, mais sans que personne l'ait voulu à ce
moment-là.

## Ce que nous ne disons pas

<!-- ce-que-nous-ne-disons-pas:debut -->
| Nous ne disons pas | Nous disons |
|---|---|
| « protégé contre l'injection » | L'injection n'est pas empêchée, ses conséquences sont bornées |
| « zéro attaque réussie » | Le nombre mesuré, avec la taille du jeu et la date, ou « à mesurer » |
| « conforme », « conforme DORA » | Ce que l'outil apporte face au texte, et ce qu'il ne fait pas |
| « certifié » | Démonstration sur réseau de test, sans audit indépendant |
| « détecte les zero-days » | Des règles ne voient que ce qu'elles décrivent |
| « anonymisé » | Identifiants opaques et empreintes, données synthétiques |
<!-- ce-que-nous-ne-disons-pas:fin -->

Nous ne disons pas non plus :

- « le contrat bloque » au présent : il n'est pas écrit. Nous disons « la règle
  du contrat, rejouée par un faux coffre ».
- « bénéficiaire hors registre » pour le scénario 4 : la demande ne porte pas
  de bénéficiaire. Le motif est « facture inconnue »
  ([specs/00-a-trancher.md](../../specs/00-a-trancher.md), point e).
- un chiffre de détection sans sa réserve, ni aucun chiffre du jeu provisoire.
- « l'alerte est envoyée » : elle est affichée et journalisée.
