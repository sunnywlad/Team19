# Console Veto (direction D) : d'où vient chaque donnée

État du dépôt : `main` à `d5a49d3`. Décision d'architecture : **option A**. La console reste en lecture seule (GET uniquement, aucune clé) et les décisions se signent dans une app d'approbation séparée.

Légende de la colonne État :
- **OK** : la donnée existe telle quelle ;
- **DÉRIVER** : calculable côté dashboard à partir de ce qui existe ;
- **MANQUE** : il faut un ajout, décrit dans la colonne Proposition ;
- **VISION** : non construit, à afficher comme tel ou à retirer de l'écran réel.

## Trois écarts structurants (à lire d'abord)

1. **Aucune donnée nominative dans l'API.** `specs/README.md` impose des identifiants opaques (`0x` + 64 hex). La console affiche pourtant « Transports Bellec », « IBAN FR76 •••• 4021 » et « Claire Martin ».
   - Proposition : un **référentiel de libellés** local, qui associe un identifiant opaque à un libellé. Il est servi par le proxy du dashboard (`GET /api/local/libelles`) depuis un fichier hors bundle.
   - En démo, il est synthétique (`dashboard/fixtures/libelles.json`). En production, il viendrait de l'ERP.
   - Il n'est jamais transmis au relais ni écrit sur la chaîne. Si un libellé manque, la console affiche l'identifiant abrégé.
2. **Les montants sont en wei.**
   - Proposition : une unité d'affichage déclarée par le proxy (`GET /api/local/unite` → `{ "symbole": "u" | "€", "decimales": 15 }`).
   - Sans déclaration, la console affiche « u », jamais « € » par défaut.
3. **Pas de signature dans la console.** Le geste humain existe aujourd'hui en ligne de commande (`demo/human.mjs approve|refuse|expire`, clé `APPROVER_PRIVATE_KEY`) et, en démo, par le port de contrôle du faux coffre.
   - L'app d'approbation (mobile, passkey) est un **chantier séparé**. Il demande un choix de compte signataire, par exemple un compte à passkey (P-256) désigné comme `approver` du contrat. Ce choix est à trancher avec Wladimir.
   - La console se contente d'un bouton « Ouvrir dans l'app d'approbation », désactivé tant que l'app n'existe pas, avec la mention « à signer par l'approbateur ».

## Écran par écran

| Écran · élément | Source réelle | État | Proposition |
|---|---|---|---|
| **Vue d'ensemble** · paiements exécutés (nombre, montant) | `GET /events` `Paid` (+ `block_timestamp`) | DÉRIVER | Somme sur la période. Au-delà de 500 événements : §6 `order=desc` d'`API-NEEDS.md` |
| · part sans intervention | `Decision` décision 2 motif `NONE` (0) vs `APPROVED` (13) | DÉRIVER | Ratio sur la période |
| · à valider | `GET /decisions` : cas 1 non fermés (`APPROVED`, `APPROVAL_REFUSED`, `APPROVAL_TIMEOUT`) | OK | Logique déjà dans `PendingView` |
| · bloqués par une règle + montant non sorti | `Decision` 0 + journal `DETECTION` verdict `BLOCK` (`/journal/entries`) | DÉRIVER | Montant = montant inscrit de la référence (`InvoiceRegistered`) ; inconnu → « montant inconnu » |
| · graphique décisions par jour | les mêmes événements, groupés par jour de `block_timestamp` | DÉRIVER | Palette `serie-*` du système de design |
| · agents (paiements, bloqués, statut) | `AgentRegistered`, `Decision` par `agentId`, `/agents/paused`, `AgentPaused`/`AgentResumed` | DÉRIVER | Nom affiché via le référentiel de libellés |
| **À valider** · liste et tiroir | `/decisions` (cas 1), `HoldPlaced` (montant, `deadline`) | OK | — |
| · échéance « dans 3 h 07 » | `HoldPlaced.deadline` vs heure de bloc | MANQUE | §6 : `head_block_timestamp` dans `/status` |
| · contrôles : facture enregistrée, bénéficiaire enregistré, seuil, plaçable, agent autorisé | motifs du contrat (`INVOICE_UNKNOWN` 1, `ABOVE_THRESHOLD` 10, `EXCEEDS_PLACEABLE` 6, `AGENT_NOT_AUTHORIZED` 9…) + `DETECTION` (score, seuil, codes) | DÉRIVER | Libellés métier, code technique en détail seulement |
| · contrôles « écart à l'habitude », « doublon possible » | — | VISION | Retirer de l'écran réel, ou les étiqueter « à venir » |
| · IBAN, SIREN, ancienneté au référentiel | — | MANQUE | Référentiel de libellés (écart 1) |
| · Ouvrir dans l'app d'approbation | — | MANQUE | Écart 3 : bouton désactivé + « à signer par l'approbateur » |
| **Incidents** · liste, gravité, extrait, chronologie | `GET /incidents` (rapport `specs/05-incident.md` + `quarantine_excerpt`) | OK | Gravité dérivée du déclencheur du rapport |
| · délais +226 ms / +24 ms / +32 ms | horodatages du rapport (`_ms`, même horloge) | OK | Règle existante : une durée seulement entre deux horodatages de la même horloge |
| · agent suspendu | `/agents/paused` + `AgentPaused` | OK | — |
| · réactivation à 2 administrateurs, clôture | — | VISION | Bouton absent en mode réel |
| · rapport (page document) | rapport `specs/05-incident.md` + entrée de journal | DÉRIVER | Vue imprimable ; PDF signé = VISION |
| **Fournisseurs** | `BeneficiaryRegistered` (id, compte) | DÉRIVER | Libellés via référentiel ; « changement d'IBAN 72 h » = VISION |
| **Agents** | `AgentRegistered` (mandat), pauses | DÉRIVER | Permissions affichées depuis le mandat (0 lecture, 1 paiement, 2 trésorerie) |
| **Règles** · seuil de validation, réserve de sécurité | `GET /vault` (`threshold_wei`, `safety_reserve_wei`) | OK | Lecture seule, sans bouton Modifier |
| · délai de réponse | `ApprovalDelayChanged` | DÉRIVER | — |
| · plafond par paiement, plafond par jour, « assouplir = 24 h » | — | VISION | Prévu dans le durcissement v2 (`feat/vault-v2-durcissement`) |
| **Piste d'audit** · entrées, empreintes | `GET /journal/entries` | OK | — |
| · chaîne intègre, vérifiée à… | `GET /journal/verification` | OK | Afficher « non vérifié » si `verification` est `null` ; mentionner `expected_head_checked` |
| · export CSV / PDF signé | — | VISION | — |
| Comité de vérificateurs (votes, tirage au sort) | `VerificationMarket` / `DrawnVerificationMarket` sur le L1, lisible dans `explorateur/` | MANQUE | Existe côté contrats, mais n'est relié ni au relais ni au dashboard : hors portage, à brancher dans un second temps |
| **Rôles et accès**, **Connexion SSO** | — (dashboard local, lié à 127.0.0.1) | VISION | Pas dans le portage |
| **App d'approbation** | — | MANQUE | Chantier séparé (écart 3) |

## Ce que le portage garde intact

- Le lint de sécurité (`tools/lint.mjs`) : pas d'`innerHTML`, pas de `style={…}`, pas d'URL absolue, pas de `<form>`, uniquement des `GET`.
- La validation de chaque réponse par schéma, les étiquettes « réel / simulation / origine non confirmée », le bandeau « données indisponibles » après 10 s, la règle « absent = non disponible, jamais 0 ».
- La CSP stricte : les polices Geist et Geist Mono deviennent des fichiers locaux (licence OFL), pas un lien Google Fonts.
