// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.24;

import {IVerificationMarket} from "../../../src/interfaces/IVerificationMarket.sol";

/// @notice Contrat factice pour les tests off-chain.
/// Comité fixe de 3 adresses passé au constructeur.
/// Fenêtres passées au constructeur (en secondes depuis la création).
/// hashOf et commitmentOf conformes à l'interface.
/// Cycle complet : createRequest → commit → reveal → finalize → close.
contract MockMarket is IVerificationMarket {
    // ─── Storage ──────────────────────────────────────────────────────────

    uint256 private _requestFee;
    uint64 public commitWindow;   // durée fenêtre commit (s)
    uint64 public revealWindow;   // durée fenêtre reveal (s)
    uint64 public contestWindow;  // durée fenêtre contestation (s)

    address[3] private _committee;

    uint256 private _nextId = 1;

    mapping(uint256 => Request) private _requests;
    mapping(uint256 => Reveal[3]) private _reveals;

    // ─── Constructor ──────────────────────────────────────────────────────

    constructor(
        address[3] memory committee_,
        uint64 commitWindow_,
        uint64 revealWindow_,
        uint64 contestWindow_,
        uint256 fee_
    ) {
        _committee     = committee_;
        commitWindow   = commitWindow_;
        revealWindow   = revealWindow_;
        contestWindow  = contestWindow_;
        _requestFee    = fee_;
    }

    // ─── Écriture ─────────────────────────────────────────────────────────

    function createRequest(bytes32 h) external payable returns (uint256 requestId) {
        if (msg.value < _requestFee) revert InsufficientFee(msg.value, _requestFee);
        if (h == bytes32(0)) revert ZeroHash();

        requestId = _nextId++;
        Request storage r = _requests[requestId];
        r.requester     = msg.sender;
        r.h             = h;
        r.fee           = uint96(msg.value);
        r.createdAt     = uint64(block.timestamp);
        r.commitDeadline = uint64(block.timestamp) + commitWindow;
        r.revealDeadline = uint64(block.timestamp) + commitWindow + revealWindow;
        r.status        = Status.Commit;

        address[] memory c = new address[](3);
        c[0] = _committee[0];
        c[1] = _committee[1];
        c[2] = _committee[2];

        emit RequestCreated(requestId, msg.sender, h, msg.value, r.commitDeadline, r.revealDeadline);
        emit CommitteeDrawn(requestId, c);
    }

    function commitVerdict(uint256 requestId, bytes32 commitment) external {
        Request storage r = _requireStatus(requestId, Status.Commit);
        if (block.timestamp >= r.commitDeadline) revert WrongPhase(requestId, Status.Commit, r.status);

        uint8 idx = _memberIdx(requestId, msg.sender);
        Reveal storage rv = _reveals[requestId][idx];
        if (rv.committed) revert AlreadyCommitted(requestId, msg.sender);

        rv.committed = true;
        // Store commitment temporarily in detailHash slot (overwritten at reveal)
        rv.detailHash = commitment;

        emit VerdictCommitted(requestId, msg.sender, commitment);
    }

    /// @notice Transition Commit → Reveal : appelable par tous dès que commitDeadline est passée.
    /// La spec indique que ce passage se fait "par l'horloge" (§ 2).
    function transitionToReveal(uint256 requestId) external {
        Request storage r = _requireStatus(requestId, Status.Commit);
        if (block.timestamp < r.commitDeadline) revert WrongPhase(requestId, Status.Reveal, r.status);
        r.status = Status.Reveal;
    }

    function revealVerdict(
        uint256 requestId,
        Code vote,
        uint16 reasons,
        bytes32 detailHash,
        bytes32 salt
    ) external {
        Request storage r = _requireStatus(requestId, Status.Reveal);

        uint8 idx = _memberIdx(requestId, msg.sender);
        Reveal storage rv = _reveals[requestId][idx];
        if (!rv.committed) revert NoCommitment(requestId, msg.sender);
        if (rv.revealed)   revert AlreadyRevealed(requestId, msg.sender);

        bytes32 expected = commitmentOf(requestId, msg.sender, vote, reasons, detailHash, salt);
        if (rv.detailHash != expected) revert CommitmentMismatch(requestId, msg.sender);

        rv.revealed    = true;
        rv.vote        = vote;
        rv.reasons     = reasons;
        rv.detailHash  = detailHash;

        emit VerdictRevealed(requestId, msg.sender, vote, reasons, detailHash);
    }

    function finalize(uint256 requestId) external returns (Code code) {
        Request storage r = _requireStatus(requestId, Status.Reveal);

        // Compter les reveals valides
        uint8 revealed = 0;
        uint8 refuseCount = 0;
        uint8 humanCount  = 0;
        uint8 acceptCount = 0;

        for (uint8 i = 0; i < 3; i++) {
            Reveal storage rv = _reveals[requestId][i];
            if (rv.revealed) {
                revealed++;
                if (rv.vote == Code.Refuse)      refuseCount++;
                else if (rv.vote == Code.HumanReview) humanCount++;
                else acceptCount++;
            } else {
                // Émet VerifierMissed
                emit VerifierMissed(requestId, _committee[i], rv.committed);
            }
        }

        // Agrégation § 4
        if (revealed < 2) {
            code = Code.HumanReview;
        } else if (refuseCount * 2 > revealed) {
            code = Code.Refuse;
        } else if (acceptCount == revealed) {
            code = Code.Accept;
        } else {
            code = Code.HumanReview;
        }

        uint64 contestDeadline = uint64(block.timestamp) + contestWindow;
        r.code            = code;
        r.contestDeadline = contestDeadline;
        r.status          = Status.Contest;

        emit RequestFinalized(requestId, code, revealed, refuseCount, humanCount, acceptCount, contestDeadline);
    }

    function close(uint256 requestId) external {
        Request storage r = _requireStatus(requestId, Status.Contest);
        if (block.timestamp < r.contestDeadline) revert TooEarly(requestId);
        r.status = Status.Closed;
        emit RequestClosed(requestId);
    }

    // ─── Lecture ──────────────────────────────────────────────────────────

    function requestFee() external view returns (uint256) { return _requestFee; }

    function getRequest(uint256 requestId) external view returns (Request memory) {
        return _requests[requestId];
    }

    function getCommittee(uint256 /*requestId*/) external view returns (address[] memory) {
        address[] memory c = new address[](3);
        c[0] = _committee[0];
        c[1] = _committee[1];
        c[2] = _committee[2];
        return c;
    }

    function getReveal(uint256 requestId, address verifier) external view returns (Reveal memory) {
        uint8 idx = _memberIdxView(requestId, verifier);
        if (idx == type(uint8).max) {
            return Reveal({ committed: false, revealed: false, vote: Code.Refuse, reasons: 0, detailHash: bytes32(0) });
        }
        return _reveals[requestId][idx];
    }

    function isCommitteeMember(uint256 /*requestId*/, address account) external view returns (bool) {
        return account == _committee[0] || account == _committee[1] || account == _committee[2];
    }

    function hashOf(Facts calldata facts, bytes32 contentHash) external pure returns (bytes32) {
        return keccak256(abi.encode(facts, contentHash));
    }

    function commitmentOf(
        uint256 requestId,
        address verifier,
        Code vote,
        uint16 reasons,
        bytes32 detailHash,
        bytes32 salt
    ) public view returns (bytes32) {
        return keccak256(abi.encode(block.chainid, address(this), requestId, verifier, uint8(vote), reasons, detailHash, salt));
    }

    // ─── Internes ─────────────────────────────────────────────────────────

    function _requireStatus(uint256 requestId, Status expected) internal view returns (Request storage r) {
        r = _requests[requestId];
        if (r.status == Status.None && requestId >= _nextId) revert UnknownRequest(requestId);
        if (r.status != expected) revert WrongPhase(requestId, expected, r.status);
    }

    function _memberIdx(uint256 requestId, address account) internal view returns (uint8) {
        for (uint8 i = 0; i < 3; i++) {
            if (_committee[i] == account) return i;
        }
        revert NotCommitteeMember(requestId, account);
    }

    function _memberIdxView(uint256 /*requestId*/, address account) internal view returns (uint8) {
        for (uint8 i = 0; i < 3; i++) {
            if (_committee[i] == account) return i;
        }
        return type(uint8).max;
    }
}
