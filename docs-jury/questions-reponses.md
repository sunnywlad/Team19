# Questions-réponses blockchain

## 1. Quel lien entre votre marché de vérification et le coffre ?

Au temps 1, le coffre décide seul à partir de ses registres. Le verdict du marché n'entre pas dans `submit`. La jonction est conçue pour le temps 2, mais n'est pas construite.

Preuve : `docs-jury/architecture.md`, sections correspondantes aux lignes 45 et 56-57.

## 2. Pourquoi un L1 dédié plutôt que la C-Chain ?

Le L1 dédié permet des contrôles au niveau du réseau : écriture réservée aux adresses admises, RPC privé et jeton natif frappé par un précompilé. Aucun gain de coût ou de performance n'est mesuré. Ce choix ajoute un validateur à exploiter.

Preuve : `infra/l1/README.md`, lignes 13-16 ; `docs-jury/architecture.md`, lignes 9-16.

## 3. Qui peut écrire sur votre chaîne ?

Seules les adresses admises par la TxAllowList peuvent écrire. Le nœud refuse l'émetteur avant l'exécution de tout contrat. Une adresse financée en gaz mais non admise est rejetée.

Preuve : `docs-jury/preuves/scene-aws.md`, étape a ; `docs-jury/preuves/vault-l1-local.md`, ligne 55.

## 4. Un seul validateur : où est la décentralisation ?

La démonstration n'est pas décentralisée : elle repose sur un validateur et une administration centrale. La perte du nœud arrête la chaîne. Aucun essai de panne n'est consigné.

Preuve : `docs-jury/architecture.md`, ligne 16 ; `docs-jury/rapport-securite.md`, ligne 341.

## 5. Un LLM vérifie-t-il déjà les demandes ?

Oui. L'évaluateur Bedrock est branché au marché et a été joué en local puis sur le L1 AWS. Les preuves initiales portent sur Haiku 4.5, Pixtral Large et Sonnet 4.5 ; la campagne de 16 demandes du rapport utilise trois vérificateurs Haiku. Les règles dures restent appliquées avant le modèle. Le verdict du marché n'entre pas dans la décision du coffre.

Preuves : [vérificateurs LLM](verificateurs-llm.md), [passage AWS initial](preuves/llm-e2e-aws.md) et [rapport de la campagne de 16 demandes](rendus/pitch-chiffres.html). Ce dernier rapporte des résultats, sans journaux bruts associés dans le dépôt.

## 6. Peut-on rejouer une demande signée, ici ou sur une autre chaîne ?

Non. La signature EIP-712 lie le chainId et l'adresse du coffre, et un `requestId` ne peut être consommé qu'une fois, même en cas de refus. Le rejeu a été refusé sur le L1 local avec le motif `REQUEST_REPLAYED`.

Preuve : `docs-jury/tests.md`, lignes 43 et 76 ; `docs-jury/preuves/vault-l1-local.md`, ligne 121.

## 7. Un bénéficiaire malveillant peut-il réentrer pendant le paiement ?

Non. Les effets sont écrits avant l'appel externe, sous verrou de réentrance. Si le transfert échoue, la transaction entière est annulée. Cinq tests d'attaque couvrent les cas rapportés : bénéficiaire, relais et approbateur malveillants, ainsi qu'un transfert en échec.

Preuve : `docs-jury/tests.md`, lignes 42 et 99-102.

## 8. Qui frappe les VETO, et si l'admin est compromis ?

L'admin du L1 accorde le droit de frappe à Rewards et à VetoDesk. Il n'existe ni plafond global ni multisignature. Un admin compromis est hors du modèle de menace retenu, et ce risque est assumé.

Preuve : `docs-jury/rapport-securite.md`, ligne 341 ; `src/VetoDesk.sol`, ligne 59 ; `src/Rewards.sol`, ligne 102.
