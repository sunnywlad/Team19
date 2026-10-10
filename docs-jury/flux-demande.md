# Flux d'une demande

Voici le parcours d'une demande, du dépôt du contenu jusqu'au code final.

1. L'agent demandeur envoie son contenu à la passerelle : prompt, contexte,
   décision prévue, sel aléatoire. La passerelle dérive les faits calculables
   (montant, devise, bénéficiaire, référence).
2. La passerelle dépose le contenu au cache. Le cache rend `contentHash` et le
   hash H, avec `H = keccak256(abi.encode(facts, contentHash))`.
3. La passerelle appelle `createRequest(H)` sur le marché et paie en CHK. Le
   marché rend un `requestId` croissant. Événement émis : `RequestCreated`.
4. Le comité de 3 est désigné. En phase 1 il est fixe, et `CommitteeDrawn` sort
   dès la création. En phase 3 il est tiré par `drawCommittee(requestId)` à
   partir du bloc suivant, et `CommitteeDrawn` sort au tirage.
5. Chaque membre tiré lit H dans le cache. Le cache contrôle sur la chaîne que
   l'adresse appartient bien au comité, par `isCommitteeMember`.
6. Chaque membre lance un sous-agent LLM jetable et forme un verdict : un vote
   0/1/2 et un masque de motifs.

## Commit puis reveal

7. Chaque membre dépose d'abord un commit : le hash de son verdict, lié à la
   chaîne, au marché, à la demande et à son adresse. Événement :
   `VerdictCommitted`. Le vote reste secret.
8. Après la fenêtre de commit, chaque membre révèle son verdict en clair. Le
   marché vérifie que le reveal correspond au commit. Événement :
   `VerdictRevealed`, un par membre.

Nous séparons le commit du reveal pour empêcher la copie entre vérificateurs. Un
membre ne voit le vote d'un autre qu'une fois le sien déjà engagé. Retenir son
reveal après avoir vu les autres est traité comme une faute.

## Agrégation en code 0/1/2

9. `finalize(requestId)` agrège les reveals valides. Soit `n` leur nombre. La
   règle est prudente :

| Condition | Code |
|---|---|
| `n < 2` (quorum manqué) | 1, validation humaine conseillée |
| majorité stricte de refus (`refus * 2 > n`) | 0, refusé |
| tous les reveals valides à Accept | 2, accepté |
| sinon | 1, validation humaine conseillée |

Un seul doute empêche le code 2. La finalisation émet un `VerifierMissed` par
membre absent, puis `RequestFinalized`, et passe la demande en Contest. Chaque
reveal valide touche la même part de frais, quel que soit son vote.

10. La fenêtre de contestation s'ouvre. Une faute de fond peut encore être
    prouvée (voir `fautes.md`). À l'issue, `close(requestId)` passe la demande en
    Closed. Événement : `RequestClosed`. Le cache supprime alors le contenu.

11. Le demandeur lit le code simple par la passerelle, puis agit hors chaîne. Le
    code 1 n'est qu'un conseil.

## Les fenêtres de démo

| Fenêtre | Démo (deploy-all) | Scène d'attaque | Hors démo |
|---|---|---|---|
| Commit | 180 s | 30 s | 180 s |
| Reveal | 60 s | 20 s | 60 s |
| Contestation | 600 s | 60 s | 72 h |

Les fenêtres se règlent par les variables `COMMIT_WINDOW`, `REVEAL_WINDOW` et
`CONTEST_WINDOW`. La scène d'attaque les raccourcit pour un déroulé fluide.
