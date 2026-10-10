// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.24;

/// @title IVerificationMarket
/// @notice Interface figée en phase 0 : demande payée en CHK, comité, commit puis reveal, code 0/1/2, contestation.
/// @dev Le contenu de la demande ne passe jamais par la chaîne : seul H y est inscrit.
interface IVerificationMarket {
    // ---------------------------------------------------------------------
    // Types
    // ---------------------------------------------------------------------

    /// @notice Vote d'un vérificateur, et code final agrégé : mêmes valeurs.
    /// 0 refusé, 1 validation humaine conseillée, 2 accepté.
    enum Code {
        Refuse,
        HumanReview,
        Accept
    }

    /// @notice Cycle de vie d'une demande.
    /// Commit et Reveal : fenêtres ouvertes, passage par l'horloge.
    /// Contest : code émis et définitif, fenêtre de contestation ouverte.
    /// Closed : contestation close, le cache peut supprimer le contenu.
    enum Status {
        None,
        Commit,
        Reveal,
        Contest,
        Closed
    }

    /// @notice Faits calculables de la décision prévue, évaluables par un prédicat Solidity.
    struct Facts {
        uint256 amount; // en plus petite unité de la devise (centimes pour EUR)
        bytes3 currency; // code ISO 4217, ex. "EUR"
        bytes32 beneficiaryId; // keccak256 de l'identifiant canonique du bénéficiaire
        bytes32 referenceId; // keccak256 de la référence (facture), 0 si absente
    }

    struct Request {
        address requester;
        bytes32 h; // keccak256(abi.encode(facts, contentHash))
        uint96 fee; // CHK payé, en wei
        uint64 createdAt;
        uint64 commitDeadline; // commits acceptés si block.timestamp < commitDeadline
        uint64 revealDeadline; // reveals acceptés si commitDeadline <= block.timestamp < revealDeadline
        uint64 contestDeadline; // fixé par finalize
        Status status;
        Code code; // valide à partir de Contest
    }

    struct Reveal {
        bool committed;
        bool revealed;
        Code vote;
        uint16 reasons; // masque de bits, liste fermée : docs/interface.md § 3
        bytes32 detailHash; // keccak256 des octets du détail texte, déposé au cache ; 0 si absent
    }

    // ---------------------------------------------------------------------
    // Événements
    // ---------------------------------------------------------------------

    event RequestCreated(
        uint256 indexed requestId,
        address indexed requester,
        bytes32 indexed h,
        uint256 fee,
        uint64 commitDeadline,
        uint64 revealDeadline
    );

    /// @notice Comité tiré (phase 1 : comité fixe de 3 ; phase 3 : tirage).
    event CommitteeDrawn(uint256 indexed requestId, address[] committee);

    event VerdictCommitted(uint256 indexed requestId, address indexed verifier, bytes32 commitment);

    /// @notice Un événement par vérificateur : source du détail reconstruit par la passerelle.
    event VerdictRevealed(
        uint256 indexed requestId, address indexed verifier, Code vote, uint16 reasons, bytes32 detailHash
    );

    /// @notice Membre sans commit (committed = false) ou commit sans reveal valide (committed = true).
    event VerifierMissed(uint256 indexed requestId, address indexed verifier, bool committed);

    /// @notice Code simple lu par le demandeur. Ouvre la contestation.
    event RequestFinalized(
        uint256 indexed requestId,
        Code code,
        uint8 revealed,
        uint8 refuseCount,
        uint8 humanCount,
        uint8 acceptCount,
        uint64 contestDeadline
    );

    /// @notice Fin de la contestation : signal de suppression pour le cache.
    event RequestClosed(uint256 indexed requestId);

    // ---------------------------------------------------------------------
    // Erreurs
    // ---------------------------------------------------------------------

    error InsufficientFee(uint256 sent, uint256 required);
    error ZeroHash();
    error UnknownRequest(uint256 requestId);
    error NotCommitteeMember(uint256 requestId, address caller);
    error WrongPhase(uint256 requestId, Status expected, Status actual);
    error AlreadyCommitted(uint256 requestId, address verifier);
    error AlreadyRevealed(uint256 requestId, address verifier);
    error NoCommitment(uint256 requestId, address verifier);
    error CommitmentMismatch(uint256 requestId, address verifier);
    error TooEarly(uint256 requestId);

    // ---------------------------------------------------------------------
    // Écriture
    // ---------------------------------------------------------------------

    /// @notice Dépose une demande. msg.value >= requestFee(), en CHK natif.
    /// @return requestId identifiant croissant, à partir de 1.
    function createRequest(bytes32 h) external payable returns (uint256 requestId);

    /// @notice commitment = commitmentOf(requestId, msg.sender, vote, reasons, detailHash, salt).
    function commitVerdict(uint256 requestId, bytes32 commitment) external;

    function revealVerdict(uint256 requestId, Code vote, uint16 reasons, bytes32 detailHash, bytes32 salt) external;

    /// @notice Appelable par tous, dès que tous les membres ont révélé ou après revealDeadline.
    /// Émet un VerifierMissed par absent, puis RequestFinalized ; passe en Contest.
    function finalize(uint256 requestId) external returns (Code code);

    /// @notice Appelable par tous après contestDeadline, sans contestation ouverte. Passe en Closed.
    function close(uint256 requestId) external;

    // ---------------------------------------------------------------------
    // Lecture
    // ---------------------------------------------------------------------

    function requestFee() external view returns (uint256);

    function getRequest(uint256 requestId) external view returns (Request memory);

    function getCommittee(uint256 requestId) external view returns (address[] memory);

    function getReveal(uint256 requestId, address verifier) external view returns (Reveal memory);

    /// @notice Utilisé par le cache pour autoriser une lecture de contenu.
    function isCommitteeMember(uint256 requestId, address account) external view returns (bool);

    /// @notice keccak256(abi.encode(facts, contentHash)). Recalcul par le vérificateur et la contestation.
    function hashOf(Facts calldata facts, bytes32 contentHash) external pure returns (bytes32);

    /// @notice keccak256(abi.encode(block.chainid, address(this), requestId, verifier, vote, reasons, detailHash, salt)).
    function commitmentOf(
        uint256 requestId,
        address verifier,
        Code vote,
        uint16 reasons,
        bytes32 detailHash,
        bytes32 salt
    ) external view returns (bytes32);
}
