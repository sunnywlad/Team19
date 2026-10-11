// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.24;

import {IVerificationMarket} from "./interfaces/IVerificationMarket.sol";

/// @title VerificationMarketBase
/// @notice Logique commune des marchés : demande payée en VETO, commit puis reveal, agrégation 0/1/2,
///         contestation. Le comité est lu par `_committee(requestId)`, surchargé par chaque marché.
/// @dev Phase 1 (comité fixe) et phase 3 (comité tiré) partagent cette base. Aucun appel externe ici,
///      donc pas de garde de réentrance ; les crochets d'extension gèrent la caution (phase 2 et 3).
// Les frais restent captifs dans la base (partage par Rewards via les crochets) : pas de retrait, lint attendu.
// forge-lint: disable-next-line(locked-ether)
abstract contract VerificationMarketBase is IVerificationMarket {
    // ---------------------------------------------------------------------
    // Erreurs propres au contrat
    // ---------------------------------------------------------------------

    /// @notice Fenêtre de durée nulle au déploiement.
    error InvalidWindow();
    /// @notice Frais supérieurs à type(uint96).max, non stockables.
    error FeeTooLarge();
    /// @notice Reveal après revealDeadline.
    error RevealWindowClosed(uint256 requestId);

    // ---------------------------------------------------------------------
    // Configuration immuable
    // ---------------------------------------------------------------------

    uint256 public immutable fee;
    uint64 public immutable commitWindow;
    uint64 public immutable revealWindow;
    uint64 public immutable contestWindow;

    // ---------------------------------------------------------------------
    // État
    // ---------------------------------------------------------------------

    uint256 public count;

    mapping(uint256 => Request) internal _requests;
    mapping(uint256 => mapping(address => bytes32)) internal _commitment;
    mapping(uint256 => mapping(address => Reveal)) internal _reveal;

    /// @dev Fenêtres figées au déploiement. Fenêtre nulle : InvalidWindow.
    constructor(uint256 fee_, uint64 commitWindow_, uint64 revealWindow_, uint64 contestWindow_) {
        if (commitWindow_ == 0 || revealWindow_ == 0 || contestWindow_ == 0) {
            revert InvalidWindow();
        }
        fee = fee_;
        commitWindow = commitWindow_;
        revealWindow = revealWindow_;
        contestWindow = contestWindow_;
    }

    // ---------------------------------------------------------------------
    // Écriture
    // ---------------------------------------------------------------------

    /// @notice Dépose une demande payée en VETO natif ; H est le seul contenu inscrit.
    function createRequest(bytes32 h) external payable returns (uint256 requestId) {
        if (h == bytes32(0)) revert ZeroHash();
        if (msg.value < fee) revert InsufficientFee(msg.value, fee);
        if (msg.value > type(uint96).max) revert FeeTooLarge();

        requestId = ++count;

        // cast uint64 sûr : block.timestamp tient dans uint64 jusqu'en l'an 584 milliards.
        // forge-lint: disable-next-line(unsafe-typecast)
        uint64 nowTs = uint64(block.timestamp);
        uint64 commitDeadline = nowTs + commitWindow;
        uint64 revealDeadline = commitDeadline + revealWindow;

        Request storage r = _requests[requestId];
        r.requester = msg.sender;
        r.h = h;
        // cast uint96 sûr : msg.value > type(uint96).max déjà rejeté par FeeTooLarge ci-dessus.
        // forge-lint: disable-next-line(unsafe-typecast)
        r.fee = uint96(msg.value);
        r.createdAt = nowTs;
        r.commitDeadline = commitDeadline;
        r.revealDeadline = revealDeadline;
        r.contestDeadline = 0;
        r.status = Status.Commit;

        emit RequestCreated(requestId, msg.sender, h, msg.value, commitDeadline, revealDeadline);

        _onCreated(requestId);
        _afterCreate(requestId);
    }

    /// @notice Dépose le commitment d'un membre pendant la fenêtre de commit.
    function commitVerdict(uint256 requestId, bytes32 commitment) external {
        Request storage r = _requests[requestId];
        if (r.status == Status.None) revert UnknownRequest(requestId);
        if (!_isMember(requestId, msg.sender)) revert NotCommitteeMember(requestId, msg.sender);

        Status s = _status(requestId);
        if (s != Status.Commit) revert WrongPhase(requestId, Status.Commit, s);

        Reveal storage rev = _reveal[requestId][msg.sender];
        if (rev.committed) revert AlreadyCommitted(requestId, msg.sender);

        rev.committed = true;
        _commitment[requestId][msg.sender] = commitment;

        emit VerdictCommitted(requestId, msg.sender, commitment);
    }

    /// @notice Révèle un verdict pendant la fenêtre de reveal ; doit correspondre au commit.
    function revealVerdict(uint256 requestId, Code vote, uint16 reasons, bytes32 detailHash, bytes32 salt) external {
        Request storage r = _requests[requestId];
        if (r.status == Status.None) revert UnknownRequest(requestId);
        if (!_isMember(requestId, msg.sender)) revert NotCommitteeMember(requestId, msg.sender);

        Status s = _status(requestId);
        if (s != Status.Reveal) revert WrongPhase(requestId, Status.Reveal, s);
        // dépendance au timestamp assumée : les fenêtres (180/60/600 s) tolèrent la dérive du validateur.
        // forge-lint: disable-next-line(block-timestamp)
        if (block.timestamp >= r.revealDeadline) revert RevealWindowClosed(requestId);

        Reveal storage rev = _reveal[requestId][msg.sender];
        if (rev.revealed) revert AlreadyRevealed(requestId, msg.sender);
        if (!rev.committed) revert NoCommitment(requestId, msg.sender);

        bytes32 expected = commitmentOf(requestId, msg.sender, vote, reasons, detailHash, salt);
        if (expected != _commitment[requestId][msg.sender]) revert CommitmentMismatch(requestId, msg.sender);

        rev.revealed = true;
        rev.vote = vote;
        rev.reasons = reasons;
        rev.detailHash = detailHash;

        emit VerdictRevealed(requestId, msg.sender, vote, reasons, detailHash);
    }

    /// @notice Agrège les reveals, émet un VerifierMissed par absent, puis passe en Contest.
    function finalize(uint256 requestId) external returns (Code code) {
        Request storage r = _requests[requestId];
        if (r.status == Status.None) revert UnknownRequest(requestId);

        Status s = _status(requestId);
        if (s != Status.Reveal) revert WrongPhase(requestId, Status.Reveal, s);

        address[3] memory members = _committee(requestId);

        // Finalisation anticipée seulement si les 3 ont révélé.
        // Comité non tiré (phase 3, members = adresses nulles) : aucun reveal, on attend revealDeadline.
        uint8 revealedCount = 0;
        for (uint256 i = 0; i < 3; i++) {
            if (members[i] != address(0) && _reveal[requestId][members[i]].revealed) revealedCount++;
        }
        // dépendance au timestamp assumée.
        // forge-lint: disable-next-line(block-timestamp)
        if (revealedCount < 3 && block.timestamp < r.revealDeadline) revert TooEarly(requestId);

        uint8 refuseCount = 0;
        uint8 humanCount = 0;
        uint8 acceptCount = 0;
        for (uint256 i = 0; i < 3; i++) {
            if (members[i] == address(0)) continue;
            Reveal storage rev = _reveal[requestId][members[i]];
            if (!rev.committed) {
                emit VerifierMissed(requestId, members[i], false);
            } else if (!rev.revealed) {
                emit VerifierMissed(requestId, members[i], true);
            } else {
                if (rev.vote == Code.Refuse) refuseCount++;
                else if (rev.vote == Code.HumanReview) humanCount++;
                else acceptCount++;
            }
        }

        uint8 n = refuseCount + humanCount + acceptCount;
        if (n < 2) {
            code = Code.HumanReview;
        } else if (uint256(refuseCount) * 2 > n) {
            code = Code.Refuse;
        } else if (acceptCount == n) {
            code = Code.Accept;
        } else {
            code = Code.HumanReview;
        }

        // cast uint64 sûr : block.timestamp tient dans uint64.
        // forge-lint: disable-next-line(unsafe-typecast)
        uint64 contestDeadline = uint64(block.timestamp) + contestWindow;
        r.contestDeadline = contestDeadline;
        r.status = Status.Contest;
        r.code = code;

        emit RequestFinalized(requestId, code, n, refuseCount, humanCount, acceptCount, contestDeadline);

        _afterFinalize(requestId, r.fee);
    }

    /// @notice Clôt la contestation après contestDeadline ; passe en Closed.
    function close(uint256 requestId) external {
        Request storage r = _requests[requestId];
        if (r.status == Status.None) revert UnknownRequest(requestId);
        if (r.status != Status.Contest) revert WrongPhase(requestId, Status.Contest, r.status);
        // dépendance au timestamp assumée.
        // forge-lint: disable-next-line(block-timestamp)
        if (block.timestamp < r.contestDeadline) revert TooEarly(requestId);

        r.status = Status.Closed;

        emit RequestClosed(requestId);

        _afterClose(requestId);
    }

    // ---------------------------------------------------------------------
    // Lecture
    // ---------------------------------------------------------------------

    /// @notice Tarif minimal d'une demande, en wei.
    function requestFee() external view returns (uint256) {
        return fee;
    }

    /// @notice Rend la demande avec son statut effectif (Reveal déduit de l'horloge).
    function getRequest(uint256 requestId) external view returns (Request memory) {
        Request memory r = _requests[requestId];
        if (r.status == Status.None) revert UnknownRequest(requestId);
        r.status = _status(requestId);
        return r;
    }

    /// @notice Rend les adresses du comité de la demande, ou revert si la demande est inconnue.
    /// @dev Comité non encore tiré (phase 3) : tableau vide.
    function getCommittee(uint256 requestId) external view returns (address[] memory) {
        if (_requests[requestId].status == Status.None) revert UnknownRequest(requestId);
        address[3] memory m = _committee(requestId);
        if (m[0] == address(0) && m[1] == address(0) && m[2] == address(0)) {
            return new address[](0);
        }
        address[] memory c = new address[](3);
        c[0] = m[0];
        c[1] = m[1];
        c[2] = m[2];
        return c;
    }

    /// @notice Rend la struct Reveal d'un vérificateur, zéros si rien, sans revert.
    function getReveal(uint256 requestId, address verifier) external view returns (Reveal memory) {
        return _reveal[requestId][verifier];
    }

    /// @notice Vrai si l'adresse appartient au comité de la demande, false si la demande est inconnue.
    function isCommitteeMember(uint256 requestId, address account) external view returns (bool) {
        if (_requests[requestId].status == Status.None) return false;
        return _isMember(requestId, account);
    }

    /// @notice keccak256(abi.encode(facts, contentHash)).
    function hashOf(Facts calldata facts, bytes32 contentHash) external pure returns (bytes32) {
        return keccak256(abi.encode(facts, contentHash));
    }

    /// @notice keccak256 liant chaîne, contrat, demande, vérificateur et le verdict secret.
    function commitmentOf(
        uint256 requestId,
        address verifier,
        Code vote,
        uint16 reasons,
        bytes32 detailHash,
        bytes32 salt
    ) public view returns (bytes32) {
        return keccak256(abi.encode(block.chainid, address(this), requestId, verifier, vote, reasons, detailHash, salt));
    }

    // ---------------------------------------------------------------------
    // Interne
    // ---------------------------------------------------------------------

    /// @notice Statut effectif : Commit stocké devient Reveal une fois commitDeadline atteint.
    function _status(uint256 requestId) internal view returns (Status) {
        Request storage r = _requests[requestId];
        // dépendance au timestamp assumée : passage Commit -> Reveal par l'horloge.
        // forge-lint: disable-next-line(block-timestamp)
        if (r.status == Status.Commit && block.timestamp >= r.commitDeadline) {
            return Status.Reveal;
        }
        return r.status;
    }

    /// @notice Appartenance au comité de la demande.
    function _isMember(uint256 requestId, address account) internal view returns (bool) {
        if (account == address(0)) return false;
        address[3] memory m = _committee(requestId);
        return account == m[0] || account == m[1] || account == m[2];
    }

    /// @notice Source du comité d'une demande. Surchargée par chaque marché.
    /// @dev Comité fixe (phase 1) : les 3 immutables. Comité tiré (phase 3) : stocké au tirage,
    ///      adresses nulles tant que `drawCommittee` n'a pas eu lieu.
    function _committee(uint256 requestId) internal view virtual returns (address[3] memory);

    // ---------------------------------------------------------------------
    // Crochets d'extension (phase 2 et 3 : caution, saisie, partage)
    // ---------------------------------------------------------------------

    /// @notice Appelé juste après l'émission de RequestCreated, avant `_afterCreate`.
    /// @dev Comité fixe (phase 1) : émet CommitteeDrawn ici. Comité tiré (phase 3) : vide, l'événement
    ///      sort au tirage. Séparé de `_afterCreate` pour que l'ordre d'événements de phase 1 soit intact.
    function _onCreated(uint256 requestId) internal virtual {}

    /// @notice Appelé à la fin de createRequest. Vide par défaut.
    function _afterCreate(uint256 requestId) internal virtual {}

    /// @notice Appelé à la fin de finalize, avec les frais payés par la demande. Vide par défaut.
    function _afterFinalize(uint256 requestId, uint256 fee_) internal virtual {}

    /// @notice Appelé à la fin de close. Vide par défaut.
    function _afterClose(uint256 requestId) internal virtual {}
}

/// @title VerificationMarket
/// @notice Phase 1 : comité fixe de 3, commit puis reveal, agrégation 0/1/2, contestation.
/// @dev Même constructeur et même comportement qu'en phase 1 : le comité est figé au déploiement.
// Les frais restent captifs en phase 1 (partage par Rewards en phase 2) : pas de retrait, lint attendu.
// forge-lint: disable-next-line(locked-ether)
contract VerificationMarket is VerificationMarketBase {
    /// @notice Comité invalide : adresse nulle ou doublon.
    error InvalidCommittee();

    address public immutable committee0;
    address public immutable committee1;
    address public immutable committee2;

    /// @notice Comité fixe de 3 adresses, frais et fenêtres figés au déploiement.
    /// @dev Adresse nulle ou doublon : InvalidCommittee. Fenêtre nulle : InvalidWindow.
    constructor(
        address[3] memory committee,
        uint256 fee_,
        uint64 commitWindow_,
        uint64 revealWindow_,
        uint64 contestWindow_
    ) VerificationMarketBase(fee_, commitWindow_, revealWindow_, contestWindow_) {
        if (committee[0] == address(0) || committee[1] == address(0) || committee[2] == address(0)) {
            revert InvalidCommittee();
        }
        if (committee[0] == committee[1] || committee[0] == committee[2] || committee[1] == committee[2]) {
            revert InvalidCommittee();
        }
        committee0 = committee[0];
        committee1 = committee[1];
        committee2 = committee[2];
    }

    /// @notice Comité fixe : les 3 immutables, quelle que soit la demande.
    function _committee(uint256) internal view override returns (address[3] memory) {
        return [committee0, committee1, committee2];
    }

    /// @notice Émet CommitteeDrawn à la création : le comité fixe est connu d'emblée (comportement phase 1).
    function _onCreated(uint256 requestId) internal override {
        address[] memory c = new address[](3);
        c[0] = committee0;
        c[1] = committee1;
        c[2] = committee2;
        emit CommitteeDrawn(requestId, c);
    }
}
