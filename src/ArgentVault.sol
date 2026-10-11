// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.24;

import "../specs/contract/IArgentVault.sol";

/// @title ArgentVault, coffre « Argent Intelligent » (temps 1)
/// @notice Seul à décider et à payer : 0 refusé, 1 validation humaine (montant bloqué),
///         2 accepté et payé dans la même transaction.
/// @dev Implémente specs/contract/IArgentVault.sol à l'identique ; règles et ordre des
///      contrôles : specs/02-contrat.md. Temps 1 seulement : aucun vote du marché.
///      Fonds en jeton natif de la chaîne : VETO sur le L1 de démo Team19 (chainId 191919),
///      ETH de test sur anvil. Sur réseau de test, la décision 2 émet Paid et fait le
///      transfert natif dans la même transaction. En production, Paid serait l'autorisation
///      consommée par un connecteur bancaire : envisagé, non construit, hors de ce contrat.
///      Une demande ne porte que des identifiants : montant et bénéficiaire sont lus dans
///      les registres ci-dessous, jamais dans la demande. Aucune donnée nominative sur la
///      chaîne : identifiants opaques, adresses, montants et codes.
contract ArgentVault is IArgentVault {
    // ------------------------------------------------------------------
    // Constantes
    // ------------------------------------------------------------------

    bytes32 private constant DOMAIN_TYPEHASH =
        keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)");
    /// @dev specs/01-demande.md § 5 : 0x9c20c49e…7c6ce2.
    bytes32 private constant REQUEST_TYPEHASH = keccak256(
        "Request(bytes32 requestId,bytes32 clientId,bytes32 agentId,uint8 action,bytes32 refId,uint64 issuedAt,uint64 expiresAt)"
    );
    bytes32 private constant NAME_HASH = keccak256("ArgentVault");
    bytes32 private constant VERSION_HASH = keccak256("1");

    /// @dev Moitié de l'ordre de secp256k1 : un s au-dessus donne une signature malléable.
    uint256 private constant HALF_ORDER = 0x7FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF5D576E7357A4501DDFE92F46681B20A0;

    /// @dev Bornes de approvalDelay (specs/02 § 6).
    uint64 public constant MIN_APPROVAL_DELAY = 10;
    uint64 public constant MAX_APPROVAL_DELAY = 7 days;

    uint256 private constant UNLOCKED = 1;
    uint256 private constant LOCKED = 2;

    // ------------------------------------------------------------------
    // Erreur propre à l'implémentation (absente de l'interface)
    // ------------------------------------------------------------------

    /// @notice Appel réentrant pendant un paiement.
    error Reentrancy();

    // ------------------------------------------------------------------
    // Rôles et client : fixés au déploiement, jamais modifiés
    // ------------------------------------------------------------------

    address public immutable owner;
    address public immutable admission;
    address public immutable relay;
    address public immutable approver;
    address public immutable guardian;

    bytes32 public immutable clientId;
    address public immutable clientSigner;

    // ------------------------------------------------------------------
    // Registres
    // ------------------------------------------------------------------

    /// @dev Facture ou placement : même forme, deux registres distincts.
    struct Ref {
        bytes32 beneficiaryId;
        uint256 amount;
        RefStatus status;
    }

    struct Agent {
        bool registered;
        bool paused;
        uint8 mandate;
    }

    struct Pending {
        bytes32 agentId;
        bytes32 refId;
        uint256 amount;
        uint64 deadline; // 0 : aucun cas 1 en attente
        uint8 action;
    }

    mapping(bytes32 => address payable) private _beneficiaries;
    mapping(bytes32 => Ref) private _invoices;
    mapping(bytes32 => Ref) private _placements;
    mapping(bytes32 => Agent) private _agents;
    mapping(bytes32 => bool) private _consumed;
    mapping(bytes32 => Pending) private _pending;

    uint256 private _admittedDebts;
    uint256 private _totalHeld;
    uint256 private _heldPlacements;
    uint256 private _safetyReserve;
    uint256 private _threshold;
    uint64 private _approvalDelay;
    bool private _vaultPaused;

    uint256 private _lock = UNLOCKED;

    // ------------------------------------------------------------------
    // Modificateurs
    // ------------------------------------------------------------------

    /// @dev Verrou de réentrance écrit à la main (aucune dépendance).
    modifier nonReentrant() {
        if (_lock == LOCKED) revert Reentrancy();
        _lock = LOCKED;
        _;
        _lock = UNLOCKED;
    }

    modifier only(address role) {
        if (msg.sender != role) revert NotAuthorized(msg.sender);
        _;
    }

    // ------------------------------------------------------------------
    // Déploiement
    // ------------------------------------------------------------------

    /// @notice Fixe les cinq rôles, le client et son signataire. Six adresses toutes différentes.
    /// @dev Seuil et réserve partent de 0 : tant que le propriétaire n'a pas fixé le seuil,
    ///      tout paiement passe par la validation humaine. Délai d'approbation initial : 1 h.
    constructor(
        address owner_,
        address admission_,
        address relay_,
        address approver_,
        address guardian_,
        bytes32 clientId_,
        address clientSigner_
    ) {
        if (clientId_ == bytes32(0)) revert ZeroId();
        address[6] memory accounts = [owner_, admission_, relay_, approver_, guardian_, clientSigner_];
        for (uint256 i = 0; i < accounts.length; ++i) {
            if (accounts[i] == address(0)) revert ZeroAddress();
            for (uint256 j = 0; j < i; ++j) {
                if (accounts[i] == accounts[j]) revert RoleCollision(accounts[i]);
            }
        }
        owner = owner_;
        admission = admission_;
        relay = relay_;
        approver = approver_;
        guardian = guardian_;
        clientId = clientId_;
        clientSigner = clientSigner_;
        _approvalDelay = 1 hours;
    }

    // ------------------------------------------------------------------
    // Relais
    // ------------------------------------------------------------------

    /// @inheritdoc IArgentVault
    function submit(Request calldata request, bytes calldata signature)
        external
        nonReentrant
        returns (uint8 decision, uint8 reason)
    {
        // 0. Rôle : relais.
        if (msg.sender != relay) revert NotAuthorized(msg.sender);
        // 1. Signature : un échec ne consomme pas requestId.
        if (request.clientId != clientId || _recover(hashRequest(request), signature) != clientSigner) {
            return _decide(request, DECISION_REFUSED, REASON_SIGNATURE_INVALID);
        }
        // 2. Rejeu.
        if (_consumed[request.requestId]) return _decide(request, DECISION_REFUSED, REASON_REQUEST_REPLAYED);
        // À partir d'ici, requestId est consommé quelle que soit l'issue.
        _consumed[request.requestId] = true;

        // 3 à 8. Demande, coffre, agent.
        reason = _checkRequest(request);
        if (reason != REASON_NONE) return _decide(request, DECISION_REFUSED, reason);

        // 9 à 12. Référence et fonds.
        Ref storage ref = request.action == ACTION_PAY_INVOICE ? _invoices[request.refId] : _placements[request.refId];
        reason = _checkRef(request.action, ref);
        if (reason != REASON_NONE) return _decide(request, DECISION_REFUSED, reason);

        // 13. Au-dessus du seuil : montant bloqué, validation humaine.
        if (ref.amount > _threshold) {
            _hold(request, ref);
            return _decide(request, DECISION_HUMAN, REASON_ABOVE_THRESHOLD);
        }

        // 14. Paiement : état et événements d'abord, transfert en dernier.
        uint256 amount = ref.amount;
        bytes32 beneficiaryId = ref.beneficiaryId;
        _settle(request.action, ref);
        (decision, reason) = _decide(request, DECISION_ACCEPTED, REASON_NONE);
        emit Paid(request.requestId, request.refId, beneficiaryId, amount);
        (bool ok,) = _beneficiaries[beneficiaryId].call{value: amount}("");
        if (!ok) revert TransferFailed(beneficiaryId);
    }

    // ------------------------------------------------------------------
    // Cas 1 : validation humaine
    // ------------------------------------------------------------------

    /// @inheritdoc IArgentVault
    /// @dev Pause vérifiée avant l'échéance : en pause, approve échoue même après le délai,
    ///      et expire reste disponible.
    function approve(bytes32 requestId) external nonReentrant {
        if (msg.sender != approver) revert NotAuthorized(msg.sender);
        Pending memory p = _pendingOf(requestId);
        if (_vaultPaused) revert VaultIsPaused();
        if (_agents[p.agentId].paused) revert AgentIsPaused(p.agentId);

        if (block.timestamp > p.deadline) {
            _release(requestId, p, REASON_APPROVAL_TIMEOUT);
            return;
        }

        Ref storage ref = p.action == ACTION_PAY_INVOICE ? _invoices[p.refId] : _placements[p.refId];
        bytes32 beneficiaryId = ref.beneficiaryId;
        delete _pending[requestId];
        _totalHeld -= p.amount;
        if (p.action == ACTION_PLACE) _heldPlacements -= p.amount;
        _settle(p.action, ref);

        emit Decision(requestId, p.agentId, clientId, p.action, DECISION_ACCEPTED, REASON_APPROVED, p.refId);
        emit HoldReleased(requestId, p.refId, p.amount);
        emit Paid(requestId, p.refId, beneficiaryId, p.amount);
        (bool ok,) = _beneficiaries[beneficiaryId].call{value: p.amount}("");
        if (!ok) revert TransferFailed(beneficiaryId);
    }

    /// @inheritdoc IArgentVault
    function refuse(bytes32 requestId) external nonReentrant only(approver) {
        _release(requestId, _pendingOf(requestId), REASON_APPROVAL_REFUSED);
    }

    /// @inheritdoc IArgentVault
    function expire(bytes32 requestId) external nonReentrant {
        Pending memory p = _pendingOf(requestId);
        if (block.timestamp <= p.deadline) revert DeadlineNotReached(requestId, p.deadline);
        _release(requestId, p, REASON_APPROVAL_TIMEOUT);
    }

    // ------------------------------------------------------------------
    // Admission
    // ------------------------------------------------------------------

    /// @inheritdoc IArgentVault
    function registerBeneficiary(bytes32 beneficiaryId, address payable account) external only(admission) {
        if (beneficiaryId == bytes32(0)) revert ZeroId();
        if (account == address(0)) revert ZeroAddress();
        if (_beneficiaries[beneficiaryId] != address(0)) revert AlreadyRegistered(beneficiaryId);
        _beneficiaries[beneficiaryId] = account;
        emit BeneficiaryRegistered(beneficiaryId, account);
    }

    /// @inheritdoc IArgentVault
    function registerInvoice(bytes32 invoiceId, bytes32 beneficiaryId, uint256 amount) external only(admission) {
        _register(_invoices, invoiceId, beneficiaryId, amount);
        _admittedDebts += amount;
        emit InvoiceRegistered(invoiceId, beneficiaryId, amount);
    }

    /// @inheritdoc IArgentVault
    function cancelInvoice(bytes32 invoiceId) external only(admission) {
        Ref storage inv = _invoices[invoiceId];
        if (inv.status != RefStatus.Admitted) revert InvoiceNotCancellable(invoiceId);
        inv.status = RefStatus.Cancelled;
        _admittedDebts -= inv.amount;
        emit InvoiceCancelled(invoiceId);
    }

    /// @inheritdoc IArgentVault
    function registerPlacement(bytes32 placementId, bytes32 beneficiaryId, uint256 amount) external only(admission) {
        _register(_placements, placementId, beneficiaryId, amount);
        emit PlacementRegistered(placementId, beneficiaryId, amount);
    }

    // ------------------------------------------------------------------
    // Propriétaire
    // ------------------------------------------------------------------

    /// @inheritdoc IArgentVault
    function registerAgent(bytes32 agentId, uint8 mandate) external only(owner) {
        if (agentId == bytes32(0)) revert ZeroId();
        if (mandate > (ACTION_PAY_INVOICE | ACTION_PLACE)) revert InvalidMandate(mandate);
        if (_agents[agentId].registered) revert AlreadyRegistered(agentId);
        _agents[agentId] = Agent({registered: true, paused: false, mandate: mandate});
        emit AgentRegistered(agentId, mandate);
    }

    /// @inheritdoc IArgentVault
    function setSafetyReserve(uint256 amount) external only(owner) {
        emit SafetyReserveChanged(_safetyReserve, amount);
        _safetyReserve = amount;
    }

    /// @inheritdoc IArgentVault
    function setThreshold(uint256 amount) external only(owner) {
        emit ThresholdChanged(_threshold, amount);
        _threshold = amount;
    }

    /// @inheritdoc IArgentVault
    function setApprovalDelay(uint64 delay) external only(owner) {
        if (delay < MIN_APPROVAL_DELAY || delay > MAX_APPROVAL_DELAY) revert ParameterOutOfRange();
        emit ApprovalDelayChanged(_approvalDelay, delay);
        _approvalDelay = delay;
    }

    /// @inheritdoc IArgentVault
    function resumeVault() external only(owner) {
        if (!_vaultPaused) revert VaultNotPaused();
        _vaultPaused = false;
        emit VaultResumed(msg.sender);
    }

    /// @inheritdoc IArgentVault
    function resumeAgent(bytes32 agentId) external only(owner) {
        Agent storage a = _agents[agentId];
        if (!a.registered) revert UnknownAgent(agentId);
        if (!a.paused) revert AgentNotPaused(agentId);
        a.paused = false;
        emit AgentResumed(agentId, msg.sender);
    }

    // ------------------------------------------------------------------
    // Gardien
    // ------------------------------------------------------------------

    /// @inheritdoc IArgentVault
    function pauseVault() external only(guardian) {
        if (_vaultPaused) revert VaultIsPaused();
        _vaultPaused = true;
        emit VaultPaused(msg.sender);
    }

    /// @inheritdoc IArgentVault
    function pauseAgent(bytes32 agentId) external only(guardian) {
        Agent storage a = _agents[agentId];
        if (!a.registered) revert UnknownAgent(agentId);
        if (a.paused) revert AgentIsPaused(agentId);
        a.paused = true;
        emit AgentPaused(agentId, msg.sender);
    }

    // ------------------------------------------------------------------
    // Approvisionnement
    // ------------------------------------------------------------------

    /// @inheritdoc IArgentVault
    /// @dev Aucune fonction receive ni fallback : un envoi direct échoue.
    function fund() external payable {
        if (msg.value == 0) revert ZeroAmount();
        emit Funded(msg.sender, msg.value);
    }

    // ------------------------------------------------------------------
    // Vues
    // ------------------------------------------------------------------

    function cash() public view returns (uint256) {
        return address(this).balance;
    }

    function admittedDebts() external view returns (uint256) {
        return _admittedDebts;
    }

    function safetyReserve() external view returns (uint256) {
        return _safetyReserve;
    }

    function totalHeld() external view returns (uint256) {
        return _totalHeld;
    }

    function heldPlacements() external view returns (uint256) {
        return _heldPlacements;
    }

    /// @inheritdoc IArgentVault
    function placeable() public view returns (uint256) {
        uint256 locked = _admittedDebts + _safetyReserve + _heldPlacements;
        uint256 balance = address(this).balance;
        return balance > locked ? balance - locked : 0;
    }

    function threshold() external view returns (uint256) {
        return _threshold;
    }

    function approvalDelay() external view returns (uint64) {
        return _approvalDelay;
    }

    function vaultPaused() external view returns (bool) {
        return _vaultPaused;
    }

    function agentPaused(bytes32 agentId) external view returns (bool) {
        return _agents[agentId].paused;
    }

    function agentMandate(bytes32 agentId) external view returns (bool registered, uint8 mandate) {
        Agent storage a = _agents[agentId];
        return (a.registered, a.mandate);
    }

    function beneficiary(bytes32 beneficiaryId) external view returns (address account) {
        return _beneficiaries[beneficiaryId];
    }

    function invoice(bytes32 invoiceId) external view returns (bytes32, uint256, RefStatus) {
        Ref storage r = _invoices[invoiceId];
        return (r.beneficiaryId, r.amount, r.status);
    }

    function placement(bytes32 placementId) external view returns (bytes32, uint256, RefStatus) {
        Ref storage r = _placements[placementId];
        return (r.beneficiaryId, r.amount, r.status);
    }

    function isConsumed(bytes32 requestId) external view returns (bool) {
        return _consumed[requestId];
    }

    function pendingApproval(bytes32 requestId)
        external
        view
        returns (bytes32 agentId, uint8 action, bytes32 refId, uint256 amount, uint64 deadline)
    {
        Pending storage p = _pending[requestId];
        return (p.agentId, p.action, p.refId, p.amount, p.deadline);
    }

    /// @inheritdoc IArgentVault
    /// @dev Recalculé à chaque appel : lié à la chaîne courante et à l'adresse du contrat.
    function domainSeparator() public view returns (bytes32) {
        return keccak256(abi.encode(DOMAIN_TYPEHASH, NAME_HASH, VERSION_HASH, block.chainid, address(this)));
    }

    /// @inheritdoc IArgentVault
    function hashRequest(Request calldata request) public view returns (bytes32) {
        bytes32 structHash = keccak256(
            abi.encode(
                REQUEST_TYPEHASH,
                request.requestId,
                request.clientId,
                request.agentId,
                request.action,
                request.refId,
                request.issuedAt,
                request.expiresAt
            )
        );
        return keccak256(abi.encodePacked(hex"1901", domainSeparator(), structHash));
    }

    // ------------------------------------------------------------------
    // Interne
    // ------------------------------------------------------------------

    /// @dev Contrôles 3 à 8 de specs/02 § 5, dans l'ordre.
    function _checkRequest(Request calldata r) private view returns (uint8) {
        if (r.action != ACTION_PAY_INVOICE && r.action != ACTION_PLACE) return REASON_ACTION_UNKNOWN;
        if (
            r.expiresAt <= r.issuedAt || r.expiresAt - r.issuedAt > MAX_TTL
                || r.issuedAt > block.timestamp + MAX_CLOCK_SKEW
        ) return REASON_VALIDITY_WINDOW_INVALID;
        if (block.timestamp > r.expiresAt) return REASON_REQUEST_EXPIRED;
        if (_vaultPaused) return REASON_VAULT_PAUSED;
        Agent storage a = _agents[r.agentId];
        if (!a.registered || (a.mandate & r.action) == 0) return REASON_AGENT_NOT_AUTHORIZED;
        if (a.paused) return REASON_AGENT_PAUSED;
        return REASON_NONE;
    }

    /// @dev Contrôles 9 à 12 de specs/02 § 5, dans l'ordre.
    function _checkRef(uint8 action, Ref storage ref) private view returns (uint8) {
        bool pay = action == ACTION_PAY_INVOICE;
        RefStatus status = ref.status;
        if (status == RefStatus.None || status == RefStatus.Cancelled) {
            return pay ? REASON_INVOICE_UNKNOWN : REASON_PLACEMENT_UNKNOWN;
        }
        if (status == RefStatus.Settled) return pay ? REASON_INVOICE_ALREADY_PAID : REASON_PLACEMENT_ALREADY_EXECUTED;
        if (status == RefStatus.Held) return REASON_REF_PENDING_APPROVAL;
        if (pay) {
            // On ne paie pas avec de l'argent déjà bloqué. cash ≥ totalHeld est un invariant.
            if (ref.amount > address(this).balance - _totalHeld) return REASON_INSUFFICIENT_CASH;
        } else if (ref.amount > placeable()) {
            return REASON_EXCEEDS_PLACEABLE;
        }
        return REASON_NONE;
    }

    function _hold(Request calldata r, Ref storage ref) private {
        uint256 amount = ref.amount;
        uint64 deadline = uint64(block.timestamp) + _approvalDelay;
        ref.status = RefStatus.Held;
        _totalHeld += amount;
        if (r.action == ACTION_PLACE) _heldPlacements += amount;
        _pending[r.requestId] =
            Pending({agentId: r.agentId, refId: r.refId, amount: amount, deadline: deadline, action: r.action});
        emit HoldPlaced(r.requestId, r.refId, amount, deadline);
    }

    /// @dev Clôt un cas 1 sans paiement : la référence redevient due.
    function _release(bytes32 requestId, Pending memory p, uint8 reason) private {
        delete _pending[requestId];
        _totalHeld -= p.amount;
        if (p.action == ACTION_PAY_INVOICE) {
            _invoices[p.refId].status = RefStatus.Admitted;
        } else {
            _heldPlacements -= p.amount;
            _placements[p.refId].status = RefStatus.Admitted;
        }
        emit Decision(requestId, p.agentId, clientId, p.action, DECISION_REFUSED, reason, p.refId);
        emit HoldReleased(requestId, p.refId, p.amount);
    }

    /// @dev Une facture réglée sort des dettes admises.
    function _settle(uint8 action, Ref storage ref) private {
        ref.status = RefStatus.Settled;
        if (action == ACTION_PAY_INVOICE) _admittedDebts -= ref.amount;
    }

    function _pendingOf(bytes32 requestId) private view returns (Pending memory p) {
        p = _pending[requestId];
        if (p.deadline == 0) revert NoPendingApproval(requestId);
    }

    function _register(mapping(bytes32 => Ref) storage book, bytes32 id, bytes32 beneficiaryId, uint256 amount)
        private
    {
        if (id == bytes32(0)) revert ZeroId();
        if (amount == 0) revert ZeroAmount();
        if (_beneficiaries[beneficiaryId] == address(0)) revert UnknownBeneficiary(beneficiaryId);
        if (book[id].status != RefStatus.None) revert AlreadyRegistered(id);
        book[id] = Ref({beneficiaryId: beneficiaryId, amount: amount, status: RefStatus.Admitted});
    }

    function _decide(Request calldata r, uint8 decision, uint8 reason) private returns (uint8, uint8) {
        emit Decision(r.requestId, r.agentId, r.clientId, r.action, decision, reason, r.refId);
        return (decision, reason);
    }

    /// @dev 65 octets r ‖ s ‖ v, v ∈ {27, 28}, s en moitié basse. Sinon address(0).
    function _recover(bytes32 digest, bytes calldata signature) private pure returns (address) {
        if (signature.length != 65) return address(0);
        bytes32 r = bytes32(signature[0:32]);
        bytes32 s = bytes32(signature[32:64]);
        uint8 v = uint8(signature[64]);
        if (uint256(s) > HALF_ORDER || (v != 27 && v != 28)) return address(0);
        return ecrecover(digest, v, r, s);
    }
}
