# Fautes, sanctions et limites

## Les trois fautes

Nous sanctionnons trois fautes, et aucune autre. Chacune se prouve sur la
chaîne.

| # | Faute | Preuve sur la chaîne | Saisie |
|---|---|---|---|
| 1 | Pas de commit dans le délai | `VerifierMissed(committed = false)` à la finalisation | 1 % de la caution, +1 strike |
| 2 | Commit sans reveal valide | `VerifierMissed(committed = true)` à la finalisation | 5 % de la caution, +1 strike |
| 3 | Vote ou motif contredit par un prédicat sur les faits | `contest(requestId, verifier, facts, contentHash)` pendant la contestation | 20 % de la caution, pas de strike |

La faute 2 pèse plus que la faute 1. Retenir son reveal après avoir vu ceux des
autres est une manipulation, pas un simple oubli.

Pour la faute 3, le contestataire révèle les faits et `contentHash`. Le contrat
recalcule H, puis évalue un prédicat Solidity : montant au-dessus du plafond, ou
bénéficiaire hors liste. Un vote Accept sur un prédicat violé est une faute. Un
motif lié à un prédicat, coché à tort ou omis à tort, l'est aussi.

## Pourquoi le désaccord n'est pas une faute

Un vérificateur qui diffère de la majorité ne perd rien. Aucune saisie, aucune
perte de réputation, la même part de frais que les autres reveals valides. Nous
ne voulons pas punir un désaccord de bonne foi. Punir la minorité pousserait
chacun à deviner la majorité, ce qui, avec des LLM de même famille, refléterait
le modèle et non le fait. Seules les fautes objectives et prouvables comptent :
l'absence, le reveal manquant, et la contradiction par un prédicat.

## Le strike et l'exclusion

Chaque faute 1 ou 2 ajoute un strike. À 3 strikes, le vérificateur est exclu du
tirage pour 10 demandes. Le tirage de phase 3 lit cette exclusion avant de
composer un comité.

## Les demandes canari

Pour contrer la paresse, celle de voter toujours Accept, nous injectons des
demandes canari. Elles sont indiscernables d'une vraie demande. Leur bonne
réponse découle d'un prédicat. Un vérificateur qui les valide à tort tombe sous
la faute 3, sans qu'il faille un code de plus. Ce mécanisme suppose que l'équipe
qui pose les canaris n'est pas elle-même vérificatrice.

## Limites

Nous les disons franchement.

- Biais possible du tirage. L'aléa dérive du hash d'un de nos propres blocs.
  Nos validateurs produisent ce bloc, ils pourraient donc influer sur le comité.
  Le demandeur, lui, ne peut pas viser un comité : H est figé avant que le hash
  du bloc de tirage existe, et le tirage n'est possible qu'au bloc suivant.
- Suppression du cache non prouvable. Le contenu est effacé à la clôture, mais
  rien sur la chaîne ne le prouve. Cela repose sur la confiance envers
  l'opérateur du cache. Un membre peut d'ailleurs copier ce qu'il a lu.
- Taux de saisie arbitraires. Les 1 %, 5 % et 20 % sont choisis pour la démo. Ils
  ne reposent sur aucune étude d'équilibre économique.
- Un seul validateur. La démo tourne sur un unique validateur. Il n'y a donc pas
  de décentralisation réelle. Plusieurs validateurs restent un point de pitch.
- Portée des prédicats. La faute 3 ne couvre que ce qu'un prédicat Solidity sait
  exprimer, soit le plafond de montant et la liste de bénéficiaires. Le jugement
  nuancé d'un vérificateur n'est jamais sanctionné. C'est voulu.
- Dépendance à l'horloge. Les passages de phase et les fenêtres s'appuient sur
  l'horodatage du bloc. Les fenêtres sont assez larges pour tolérer la dérive du
  validateur.
- Confiance autodéclarée écartée. Le verdict n'inclut pas de niveau de confiance.
  Un LLM le calibre mal et un vérificateur pourrait gonfler son poids. Nous nous
  en tenons à un vote 0/1/2 et à des motifs d'une liste fermée.
