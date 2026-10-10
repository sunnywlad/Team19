// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.24;

import {ISlashing} from "./interfaces/ISlashing.sol";
import {IVerificationMarket} from "./interfaces/IVerificationMarket.sol";
import {VerificationMarket} from "./VerificationMarket.sol";
import {VerifierRegistry} from "./VerifierRegistry.sol";

/// @title Slashing
/// @notice Phase 2 : trois fautes et aucune autre (docs/interface.md § 5).
/// NoCommit 1 %, NoReveal 5 % (constatées par le marché via VerifierMissed),
/// PredicateViolation 20 % (sur contestation d'un vote/motif contredit par un prédicat sur Facts).
/// @dev Le désaccord avec la majorité n'est jamais une faute. 3 strikes : exclusion du tirage de phase 3
///      pour `exclusionRequests` demandes, lu par le tirage via `struckUntil`.
contract Slashing is ISlashing {
    // ---------------------------------------------------------------------
    // Erreurs propres au contrat
    // ---------------------------------------------------------------------

    error OnlyAdmin(address caller);
    error AlreadySet();
    error ZeroAddress();
    /// @notice slashMissed appelé avant que la demande ne soit finalisée.
    error NotFinalized(uint256 requestId);
    /// @notice Une seule saisie par (demande, vérificateur).
    error AlreadySlashed(uint256 requestId, address verifier);

    // ---------------------------------------------------------------------
    // Taux de saisie (en bps de la caution totale)
    // ---------------------------------------------------------------------

    uint16 internal constant BPS_NO_COMMIT = 100; // 1 %
    uint16 internal constant BPS_NO_REVEAL = 500; // 5 %
    uint16 internal constant BPS_PREDICATE = 2000; // 20 %

    // Bits de motif liés à un prédicat (docs/interface.md § 3).
    uint16 internal constant BIT_AMOUNT_ABOVE_CAP = 1 << 0;
    uint16 internal constant BIT_BENEFICIARY_NOT_ALLOWED = 1 << 1;

    // ---------------------------------------------------------------------
    // Configuration
    // ---------------------------------------------------------------------

    address public immutable admin;
    VerifierRegistry public immutable registry;
    uint8 public immutable strikeLimit;
    uint256 public immutable exclusionRequests;

    IVerificationMarket public market;

    // ---------------------------------------------------------------------
    // Prédicats (admin)
    // ---------------------------------------------------------------------

    mapping(bytes3 => uint256) public cap; // plafond par devise, 0 = pas de plafond
    mapping(bytes32 => bool) public beneficiaryAllowed; // liste blanche de bénéficiaires
    bool public beneficiaryListEnabled; // si faux, aucune restriction de bénéficiaire

    // ---------------------------------------------------------------------
    // État
    // ---------------------------------------------------------------------

    mapping(address => uint8) private _strikes;
    mapping(address => uint256) public struckUntil; // market.count() en-deçà duquel exclu du tirage
    mapping(uint256 => mapping(address => bool)) public slashed; // par (demande, vérificateur)

    // ---------------------------------------------------------------------
    // Construction et réglage unique
    // ---------------------------------------------------------------------

    /// @param registry_ le registre des cautions.
    /// @param strikeLimit_ nombre de strikes avant exclusion (3).
    /// @param exclusionRequests_ durée d'exclusion en nombre de demandes (10).
    constructor(VerifierRegistry registry_, uint8 strikeLimit_, uint256 exclusionRequests_) {
        if (address(registry_) == address(0)) revert ZeroAddress();
        admin = msg.sender;
        registry = registry_;
        strikeLimit = strikeLimit_;
        exclusionRequests = exclusionRequests_;
    }

    modifier onlyAdmin() {
        if (msg.sender != admin) revert OnlyAdmin(msg.sender);
        _;
    }

    /// @notice Fixe l'adresse du marché, une seule fois. Le marché a besoin de Slashing à sa construction,
    ///         donc l'adresse du marché ne peut pas être connue au déploiement de Slashing.
    function setMarket(address market_) external onlyAdmin {
        if (address(market) != address(0)) revert AlreadySet();
        if (market_ == address(0)) revert ZeroAddress();
        market = IVerificationMarket(market_);
    }

    // ---------------------------------------------------------------------
    // Réglage des prédicats (admin)
    // ---------------------------------------------------------------------

    /// @notice Plafond de montant par devise. 0 = pas de plafond.
    function setCap(bytes3 currency, uint256 cap_) external onlyAdmin {
        cap[currency] = cap_;
    }

    /// @notice Autorise ou retire un bénéficiaire de la liste blanche.
    function setBeneficiaryAllowed(bytes32 id, bool allowed) external onlyAdmin {
        beneficiaryAllowed[id] = allowed;
    }

    /// @notice Active ou désactive le contrôle de liste blanche de bénéficiaires.
    function setBeneficiaryListEnabled(bool enabled) external onlyAdmin {
        beneficiaryListEnabled = enabled;
    }

    // ---------------------------------------------------------------------
    // Faute 1 et 2 : absence constatée par le marché
    // ---------------------------------------------------------------------

    /// @notice Sanctionne NoCommit (1 %) ou NoReveal (5 %) d'après l'état du reveal sur le marché.
    ///         Appelable par tous, une seule fois par (demande, vérificateur). CEI : effet avant appel externe.
    function slashMissed(uint256 requestId, address verifier) external {
        IVerificationMarket.Request memory r = market.getRequest(requestId);
        if (r.status != IVerificationMarket.Status.Contest && r.status != IVerificationMarket.Status.Closed) {
            revert NotFinalized(requestId);
        }
        if (!market.isCommitteeMember(requestId, verifier)) revert NoViolation(requestId, verifier);
        if (slashed[requestId][verifier]) revert AlreadySlashed(requestId, verifier);

        IVerificationMarket.Reveal memory rev = market.getReveal(requestId, verifier);
        Fault fault;
        uint16 bps;
        if (!rev.committed) {
            fault = Fault.NoCommit;
            bps = BPS_NO_COMMIT;
        } else if (!rev.revealed) {
            fault = Fault.NoReveal;
            bps = BPS_NO_REVEAL;
        } else {
            revert NoViolation(requestId, verifier);
        }

        slashed[requestId][verifier] = true;
        uint256 amount = registry.seize(verifier, requestId, bps);
        // registry est notre propre contrat, non réentrant ; l'ordre d'événement suit la spec (§ 5).
        // forge-lint: disable-next-line(reentrancy-events)
        emit VerifierSlashed(requestId, verifier, fault, amount);

        _addStrike(verifier);
    }

    // ---------------------------------------------------------------------
    // Faute 3 : contestation sur prédicat
    // ---------------------------------------------------------------------

    /// @notice Conteste le verdict d'un vérificateur révélé, prouvé par les faits. 20 %, pas de strike.
    ///         `NotAllowedToContest` reste inutilisé : sur le L1, seule une adresse de la TxAllowList
    ///         peut écrire, le contrôle d'accès est donc déjà assuré au niveau de la chaîne.
    function contest(uint256 requestId, address verifier, IVerificationMarket.Facts calldata facts, bytes32 contentHash)
        external
        returns (bool upheld)
    {
        IVerificationMarket.Request memory r = market.getRequest(requestId);

        // 1. Fenêtre de contestation ouverte.
        // dépendance au timestamp assumée : la fenêtre (600 s en démo, 72 h sinon) tolère la dérive.
        // forge-lint: disable-next-line(block-timestamp)
        if (r.status != IVerificationMarket.Status.Contest || block.timestamp >= r.contestDeadline) {
            revert ContestWindowClosed(requestId);
        }
        // 2. Les faits révélés doivent recomposer H.
        if (market.hashOf(facts, contentHash) != r.h) revert HashMismatch(requestId);

        // 3. Le vérificateur doit avoir révélé un verdict.
        IVerificationMarket.Reveal memory rev = market.getReveal(requestId, verifier);
        if (!rev.revealed) revert NoViolation(requestId, verifier);

        // 4. Évaluation des prédicats sur les faits.
        bool overCap = cap[facts.currency] != 0 && facts.amount > cap[facts.currency];
        bool notAllowed = beneficiaryListEnabled && !beneficiaryAllowed[facts.beneficiaryId];

        // 5. Violation si l'un des trois tient.
        bool voteFault = rev.vote == IVerificationMarket.Code.Accept && (overCap || notAllowed);
        bool bit0Fault = ((rev.reasons & BIT_AMOUNT_ABOVE_CAP) != 0) != overCap;
        bool bit1Fault = ((rev.reasons & BIT_BENEFICIARY_NOT_ALLOWED) != 0) != notAllowed;
        if (!voteFault && !bit0Fault && !bit1Fault) revert NoViolation(requestId, verifier);

        // 6. Une seule saisie par (demande, vérificateur).
        if (slashed[requestId][verifier]) revert AlreadySlashed(requestId, verifier);

        emit ContestOpened(requestId, verifier, msg.sender);
        slashed[requestId][verifier] = true;
        uint256 amount = registry.seize(verifier, requestId, BPS_PREDICATE);
        // registry est notre propre contrat, non réentrant ; l'ordre d'événement suit la spec (§ 5).
        // forge-lint: disable-next-line(reentrancy-events)
        emit VerifierSlashed(requestId, verifier, Fault.PredicateViolation, amount);
        // forge-lint: disable-next-line(reentrancy-events)
        emit ContestResolved(requestId, verifier, true);
        return true;
    }

    // ---------------------------------------------------------------------
    // Lecture
    // ---------------------------------------------------------------------

    function strikesOf(address verifier) external view returns (uint8) {
        return _strikes[verifier];
    }

    // ---------------------------------------------------------------------
    // Interne
    // ---------------------------------------------------------------------

    /// @notice Incrémente le compteur de strikes ; à `strikeLimit`, exclut et remet à zéro.
    function _addStrike(address verifier) private {
        uint8 strikes = _strikes[verifier] + 1;
        if (strikes >= strikeLimit) {
            uint256 until = VerificationMarket(address(market)).count() + exclusionRequests;
            _strikes[verifier] = 0;
            struckUntil[verifier] = until;
            // seize a déjà eu lieu chez l'appelant ; registre non réentrant, ordre d'événement voulu.
            // forge-lint: disable-next-line(reentrancy-events)
            emit VerifierStruck(verifier, strikes);
        } else {
            _strikes[verifier] = strikes;
        }
    }
}
