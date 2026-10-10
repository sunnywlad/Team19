// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.24;

// Interface du coffre « Argent Intelligent ». Spécification : specs/02-contrat.md.
// Interface seule : aucune implémentation ici. Ce fichier est gelé ; toute
// modification se décide à quatre.
//
// Aucune donnée nominative : ni chaîne de caractères, ni libellé. Uniquement
// des identifiants opaques (bytes32), des adresses, des montants et des codes.

// --- Actions (champ « action » de la demande, et bits du mandat d'un agent) ---
uint8 constant ACTION_PAY_INVOICE = 1;
uint8 constant ACTION_PLACE = 2;

// --- Décisions ---
uint8 constant DECISION_REFUSED = 0;
uint8 constant DECISION_HUMAN = 1; // validation humaine requise, montant bloqué
uint8 constant DECISION_ACCEPTED = 2; // payé dans la même transaction

// --- Motifs : liste FERMÉE. Ajout en fin de liste uniquement, jamais de
// renumérotation ni de réemploi. Un lecteur qui reçoit un code inconnu le
// traite comme un refus. ---
uint8 constant REASON_NONE = 0; // décision 2 immédiate
uint8 constant REASON_INVOICE_UNKNOWN = 1;
uint8 constant REASON_INVOICE_ALREADY_PAID = 2;
uint8 constant REASON_REQUEST_REPLAYED = 3;
uint8 constant REASON_SIGNATURE_INVALID = 4;
uint8 constant REASON_REQUEST_EXPIRED = 5;
uint8 constant REASON_EXCEEDS_PLACEABLE = 6;
uint8 constant REASON_VAULT_PAUSED = 7;
uint8 constant REASON_AGENT_PAUSED = 8;
uint8 constant REASON_AGENT_NOT_AUTHORIZED = 9;
uint8 constant REASON_ABOVE_THRESHOLD = 10; // décision 1
uint8 constant REASON_APPROVAL_TIMEOUT = 11; // fin d'un cas 1 : décision 0
uint8 constant REASON_APPROVAL_REFUSED = 12; // fin d'un cas 1 : décision 0
uint8 constant REASON_APPROVED = 13; // fin d'un cas 1 : décision 2
uint8 constant REASON_VALIDITY_WINDOW_INVALID = 14;
uint8 constant REASON_ACTION_UNKNOWN = 15;
uint8 constant REASON_PLACEMENT_UNKNOWN = 16;
uint8 constant REASON_PLACEMENT_ALREADY_EXECUTED = 17;
uint8 constant REASON_REF_PENDING_APPROVAL = 18;
uint8 constant REASON_INSUFFICIENT_CASH = 19;

// --- Bornes de la fenêtre de validité d'une demande (specs/01-demande.md § 4) ---
uint64 constant MAX_TTL = 300; // secondes
uint64 constant MAX_CLOCK_SKEW = 60; // secondes

interface IArgentVault {
    // Données signées par le client (EIP-712). Ordre et types gelés : ils
    // entrent dans le typehash.
    struct Request {
        bytes32 requestId;
        bytes32 clientId;
        bytes32 agentId;
        uint8 action;
        bytes32 refId;
        uint64 issuedAt;
        uint64 expiresAt;
    }

    enum RefStatus {
        None, // jamais inscrite
        Admitted, // inscrite, due
        Held, // cas 1 en attente d'approbation
        Settled, // payée ou placée
        Cancelled // annulée par l'admission
    }

    // ------------------------------------------------------------------
    // Événements
    // ------------------------------------------------------------------

    /// Seule source de vérité d'une décision. Émis à chaque soumission, puis
    /// une seconde fois à la clôture d'un cas 1 (approbation, refus, délai).
    /// La décision courante d'une demande est celle de son dernier événement.
    /// Pour REASON_SIGNATURE_INVALID, agentId et clientId sont recopiés d'une
    /// demande NON authentifiée : ne rien en conclure sur l'agent.
    event Decision(
        bytes32 indexed requestId,
        bytes32 indexed agentId,
        bytes32 indexed clientId,
        uint8 action,
        uint8 decision,
        uint8 reason,
        bytes32 refId
    );

    event Paid(bytes32 indexed requestId, bytes32 indexed refId, bytes32 indexed beneficiaryId, uint256 amount);
    event HoldPlaced(bytes32 indexed requestId, bytes32 indexed refId, uint256 amount, uint64 deadline);
    event HoldReleased(bytes32 indexed requestId, bytes32 indexed refId, uint256 amount);

    event Funded(address indexed from, uint256 amount);
    event BeneficiaryRegistered(bytes32 indexed beneficiaryId, address account);
    event InvoiceRegistered(bytes32 indexed invoiceId, bytes32 indexed beneficiaryId, uint256 amount);
    event InvoiceCancelled(bytes32 indexed invoiceId);
    event PlacementRegistered(bytes32 indexed placementId, bytes32 indexed beneficiaryId, uint256 amount);
    event AgentRegistered(bytes32 indexed agentId, uint8 mandate);

    event SafetyReserveChanged(uint256 previous, uint256 current);
    event ThresholdChanged(uint256 previous, uint256 current);
    event ApprovalDelayChanged(uint64 previous, uint64 current);

    event VaultPaused(address indexed by);
    event VaultResumed(address indexed by);
    event AgentPaused(bytes32 indexed agentId, address indexed by);
    event AgentResumed(bytes32 indexed agentId, address indexed by);

    // ------------------------------------------------------------------
    // Erreurs (font échouer la transaction). Un refus métier n'en est PAS une :
    // il passe par l'événement Decision.
    // ------------------------------------------------------------------

    error NotAuthorized(address caller);
    error RoleCollision(address account);
    error ZeroAddress();
    error ZeroId();
    error ZeroAmount();
    error AlreadyRegistered(bytes32 id);
    error UnknownBeneficiary(bytes32 beneficiaryId);
    error UnknownAgent(bytes32 agentId);
    error InvalidMandate(uint8 mandate);
    error InvoiceNotCancellable(bytes32 invoiceId);
    error ParameterOutOfRange();
    error VaultIsPaused();
    error VaultNotPaused();
    error AgentIsPaused(bytes32 agentId);
    error AgentNotPaused(bytes32 agentId);
    error NoPendingApproval(bytes32 requestId);
    error DeadlineNotReached(bytes32 requestId, uint64 deadline);
    error TransferFailed(bytes32 beneficiaryId);

    // ------------------------------------------------------------------
    // Relais
    // ------------------------------------------------------------------

    /// Soumet une demande signée par le client. Rôle : relais.
    /// Ne fait jamais échouer la transaction pour un refus métier : émet
    /// Decision et renvoie (décision, motif). Échoue seulement si l'appelant
    /// n'est pas le relais, ou si le transfert d'une décision 2 échoue (toute
    /// l'opération est alors annulée, identifiant de demande compris).
    /// Ordre des contrôles : specs/02-contrat.md § 5.
    function submit(Request calldata request, bytes calldata signature)
        external
        returns (uint8 decision, uint8 reason);

    // ------------------------------------------------------------------
    // Cas 1 : validation humaine
    // ------------------------------------------------------------------

    /// Rôle : approbateur. Paie le montant bloqué, au bénéficiaire inscrit.
    /// Aucun paramètre de montant ni de bénéficiaire. Si le délai est dépassé,
    /// ne paie pas : clôt en décision 0, REASON_APPROVAL_TIMEOUT.
    /// Échoue si le coffre ou l'agent d'origine est en pause.
    function approve(bytes32 requestId) external;

    /// Rôle : approbateur. Clôt en décision 0, REASON_APPROVAL_REFUSED.
    function refuse(bytes32 requestId) external;

    /// Sans rôle : appelable par quiconque une fois le délai dépassé. Ne fait
    /// que refuser : clôt en décision 0, REASON_APPROVAL_TIMEOUT.
    function expire(bytes32 requestId) external;

    // ------------------------------------------------------------------
    // Admission
    // ------------------------------------------------------------------

    /// Rôle : admission. Une inscription ne se modifie pas.
    function registerBeneficiary(bytes32 beneficiaryId, address payable account) external;

    /// Rôle : admission. Ajoute le montant aux dettes admises.
    function registerInvoice(bytes32 invoiceId, bytes32 beneficiaryId, uint256 amount) external;

    /// Rôle : admission. Retire une facture Admitted des dettes admises.
    function cancelInvoice(bytes32 invoiceId) external;

    /// Rôle : admission. Action PLACE préenregistrée, à usage unique.
    function registerPlacement(bytes32 placementId, bytes32 beneficiaryId, uint256 amount) external;

    // ------------------------------------------------------------------
    // Propriétaire
    // ------------------------------------------------------------------

    /// Rôle : propriétaire. mandate = OU binaire de ACTION_* ; 0 = agent connu
    /// sans droit d'action (lecteur).
    function registerAgent(bytes32 agentId, uint8 mandate) external;

    function setSafetyReserve(uint256 amount) external;
    function setThreshold(uint256 amount) external;
    function setApprovalDelay(uint64 delay) external;

    /// Rôle : propriétaire. Seul rôle qui lève une pause.
    function resumeVault() external;
    function resumeAgent(bytes32 agentId) external;

    // ------------------------------------------------------------------
    // Gardien
    // ------------------------------------------------------------------

    /// Rôle : gardien. Ne peut que bloquer.
    function pauseVault() external;
    function pauseAgent(bytes32 agentId) external;

    // ------------------------------------------------------------------
    // Approvisionnement
    // ------------------------------------------------------------------

    /// Sans rôle. Il n'existe aucune fonction de retrait.
    function fund() external payable;

    // ------------------------------------------------------------------
    // Vues
    // ------------------------------------------------------------------

    /// Solde du contrat.
    function cash() external view returns (uint256);

    /// Somme des factures Admitted et Held.
    function admittedDebts() external view returns (uint256);

    /// Réserve de sécurité : paramètre du propriétaire.
    function safetyReserve() external view returns (uint256);

    /// Montant bloqué par les cas 1 en attente, factures et placements.
    function totalHeld() external view returns (uint256);

    /// Part de totalHeld() due à des placements (hors dettes admises).
    function heldPlacements() external view returns (uint256);

    /// max(0, cash − admittedDebts − safetyReserve − heldPlacements).
    function placeable() external view returns (uint256);

    function threshold() external view returns (uint256);
    function approvalDelay() external view returns (uint64);

    function vaultPaused() external view returns (bool);
    function agentPaused(bytes32 agentId) external view returns (bool);
    function agentMandate(bytes32 agentId) external view returns (bool registered, uint8 mandate);

    function beneficiary(bytes32 beneficiaryId) external view returns (address account);
    function invoice(bytes32 invoiceId)
        external
        view
        returns (bytes32 beneficiaryId, uint256 amount, RefStatus status);
    function placement(bytes32 placementId)
        external
        view
        returns (bytes32 beneficiaryId, uint256 amount, RefStatus status);

    function isConsumed(bytes32 requestId) external view returns (bool);
    function pendingApproval(bytes32 requestId)
        external
        view
        returns (bytes32 agentId, uint8 action, bytes32 refId, uint256 amount, uint64 deadline);

    function clientId() external view returns (bytes32);
    function clientSigner() external view returns (address);

    function owner() external view returns (address);
    function admission() external view returns (address);
    function relay() external view returns (address);
    function approver() external view returns (address);
    function guardian() external view returns (address);

    /// EIP-712 : séparateur de domaine et empreinte à signer d'une demande.
    function domainSeparator() external view returns (bytes32);
    function hashRequest(Request calldata request) external view returns (bytes32);
}
