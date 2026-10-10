// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {Vm} from "forge-std/Vm.sol";
import {VerificationMarket} from "../src/VerificationMarket.sol";
import {IVerificationMarket} from "../src/interfaces/IVerificationMarket.sol";

/// @title Tests VerificationMarket phase 1
/// @notice Suite forge-std conforme a spec-lot3.md. src/ non modifie.
contract VerificationMarketTest is Test {
    VerificationMarket internal market;

    // Comite fixe de 3 adresses deterministes (indices de test 1, 2, 3).
    address internal constant C0 = 0x70997970C51812dc3A010C7d01b50e0d17dc79C8;
    address internal constant C1 = 0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC;
    address internal constant C2 = 0x90F79bf6EB2c4f870365E785982E1f101E93b906;

    address internal constant OUTSIDER = address(0xBEEF);
    address internal constant REQUESTER = address(0xCAFE);

    uint256 internal constant FEE = 1 ether;
    uint64 internal constant COMMIT_WINDOW = 180;
    uint64 internal constant REVEAL_WINDOW = 60;
    uint64 internal constant CONTEST_WINDOW = 600;

    bytes32 internal constant H = keccak256("une-demande");

    // Re-declaration des evenements pour vm.expectEmit.
    event RequestCreated(
        uint256 indexed requestId,
        address indexed requester,
        bytes32 indexed h,
        uint256 fee,
        uint64 commitDeadline,
        uint64 revealDeadline
    );
    event CommitteeDrawn(uint256 indexed requestId, address[] committee);
    event VerdictCommitted(uint256 indexed requestId, address indexed verifier, bytes32 commitment);
    event VerdictRevealed(
        uint256 indexed requestId, address indexed verifier, IVerificationMarket.Code vote, uint16 reasons, bytes32 detailHash
    );
    event VerifierMissed(uint256 indexed requestId, address indexed verifier, bool committed);
    event RequestFinalized(
        uint256 indexed requestId,
        IVerificationMarket.Code code,
        uint8 revealed,
        uint8 refuseCount,
        uint8 humanCount,
        uint8 acceptCount,
        uint64 contestDeadline
    );
    event RequestClosed(uint256 indexed requestId);

    function setUp() public {
        // Horloge non triviale pour que les deadlines ne degenerent pas.
        vm.warp(1_000_000);
        address[3] memory committee = [C0, C1, C2];
        market = new VerificationMarket(committee, FEE, COMMIT_WINDOW, REVEAL_WINDOW, CONTEST_WINDOW);
        vm.deal(REQUESTER, 100 ether);
    }

    // =====================================================================
    // Helpers
    // =====================================================================

    function _create() internal returns (uint256 id) {
        vm.prank(REQUESTER);
        id = market.createRequest{value: FEE}(H);
    }

    function _members() internal pure returns (address[3] memory) {
        return [C0, C1, C2];
    }

    /// @notice Passe en phase Reveal (horloge).
    function _toReveal(uint256 id) internal {
        IVerificationMarket.Request memory r = market.getRequest(id);
        vm.warp(r.commitDeadline);
    }

    function _commit(uint256 id, address who, bytes32 commitment) internal {
        vm.prank(who);
        market.commitVerdict(id, commitment);
    }

    function _reveal(
        uint256 id,
        address who,
        IVerificationMarket.Code vote,
        uint16 reasons,
        bytes32 detailHash,
        bytes32 salt
    ) internal {
        vm.prank(who);
        market.revealVerdict(id, vote, reasons, detailHash, salt);
    }

    // =====================================================================
    // 1. Constructeur
    // =====================================================================

    function test_constructor_storesValues() public view {
        assertEq(market.requestFee(), FEE);
        assertEq(market.committee0(), C0);
        assertEq(market.committee1(), C1);
        assertEq(market.committee2(), C2);
        assertEq(market.commitWindow(), COMMIT_WINDOW);
        assertEq(market.revealWindow(), REVEAL_WINDOW);
        assertEq(market.contestWindow(), CONTEST_WINDOW);
    }

    function test_constructor_feeCanBeZero() public {
        address[3] memory committee = [C0, C1, C2];
        VerificationMarket m = new VerificationMarket(committee, 0, COMMIT_WINDOW, REVEAL_WINDOW, CONTEST_WINDOW);
        assertEq(m.requestFee(), 0);
    }

    function test_constructor_zeroAddressReverts() public {
        address[3] memory committee = [address(0), C1, C2];
        vm.expectRevert(VerificationMarket.InvalidCommittee.selector);
        new VerificationMarket(committee, FEE, COMMIT_WINDOW, REVEAL_WINDOW, CONTEST_WINDOW);
    }

    function test_constructor_duplicateReverts() public {
        address[3] memory committee = [C0, C0, C2];
        vm.expectRevert(VerificationMarket.InvalidCommittee.selector);
        new VerificationMarket(committee, FEE, COMMIT_WINDOW, REVEAL_WINDOW, CONTEST_WINDOW);
    }

    function test_constructor_zeroCommitWindowReverts() public {
        address[3] memory committee = [C0, C1, C2];
        vm.expectRevert(VerificationMarket.InvalidWindow.selector);
        new VerificationMarket(committee, FEE, 0, REVEAL_WINDOW, CONTEST_WINDOW);
    }

    function test_constructor_zeroRevealWindowReverts() public {
        address[3] memory committee = [C0, C1, C2];
        vm.expectRevert(VerificationMarket.InvalidWindow.selector);
        new VerificationMarket(committee, FEE, COMMIT_WINDOW, 0, CONTEST_WINDOW);
    }

    function test_constructor_zeroContestWindowReverts() public {
        address[3] memory committee = [C0, C1, C2];
        vm.expectRevert(VerificationMarket.InvalidWindow.selector);
        new VerificationMarket(committee, FEE, COMMIT_WINDOW, REVEAL_WINDOW, 0);
    }

    // =====================================================================
    // 2. createRequest
    // =====================================================================

    function test_createRequest_storesAndEmits() public {
        uint64 nowTs = uint64(block.timestamp);
        uint64 commitDeadline = nowTs + COMMIT_WINDOW;
        uint64 revealDeadline = commitDeadline + REVEAL_WINDOW;

        address[] memory expectedCommittee = new address[](3);
        expectedCommittee[0] = C0;
        expectedCommittee[1] = C1;
        expectedCommittee[2] = C2;

        vm.expectEmit(true, true, true, true);
        emit RequestCreated(1, REQUESTER, H, FEE, commitDeadline, revealDeadline);
        vm.expectEmit(true, false, false, true);
        emit CommitteeDrawn(1, expectedCommittee);

        vm.prank(REQUESTER);
        uint256 id = market.createRequest{value: FEE}(H);
        assertEq(id, 1);

        IVerificationMarket.Request memory r = market.getRequest(id);
        assertEq(r.requester, REQUESTER);
        assertEq(r.h, H);
        assertEq(r.fee, FEE);
        assertEq(r.createdAt, nowTs);
        assertEq(r.commitDeadline, commitDeadline);
        assertEq(r.revealDeadline, revealDeadline);
        assertEq(r.contestDeadline, 0);
        assertEq(uint8(r.status), uint8(IVerificationMarket.Status.Commit));
    }

    function test_createRequest_zeroHashReverts() public {
        vm.prank(REQUESTER);
        vm.expectRevert(IVerificationMarket.ZeroHash.selector);
        market.createRequest{value: FEE}(bytes32(0));
    }

    function test_createRequest_insufficientFeeReverts() public {
        vm.prank(REQUESTER);
        vm.expectRevert(abi.encodeWithSelector(IVerificationMarket.InsufficientFee.selector, FEE - 1, FEE));
        market.createRequest{value: FEE - 1}(H);
    }

    function test_createRequest_feeTooLargeReverts() public {
        // msg.value > type(uint96).max : impossible a financer en ether reel,
        // mais testable car le controle precede l'ecriture. On dote le compte.
        uint256 tooLarge = uint256(type(uint96).max) + 1;
        // Marche avec fee=0 pour que msg.value < fee ne precede pas.
        address[3] memory committee = [C0, C1, C2];
        VerificationMarket m = new VerificationMarket(committee, 0, COMMIT_WINDOW, REVEAL_WINDOW, CONTEST_WINDOW);
        vm.deal(REQUESTER, tooLarge);
        vm.prank(REQUESTER);
        vm.expectRevert(VerificationMarket.FeeTooLarge.selector);
        m.createRequest{value: tooLarge}(H);
    }

    function test_createRequest_overpayAcceptedAndStored() public {
        uint256 paid = FEE + 0.5 ether;
        vm.prank(REQUESTER);
        uint256 id = market.createRequest{value: paid}(H);
        IVerificationMarket.Request memory r = market.getRequest(id);
        assertEq(r.fee, paid);
        assertEq(address(market).balance, paid);
    }

    function test_createRequest_idsIncrement() public {
        uint256 a = _create();
        uint256 b = _create();
        uint256 c = _create();
        assertEq(a, 1);
        assertEq(b, 2);
        assertEq(c, 3);
    }

    function test_createRequest_balanceEqualsSumOfFees() public {
        _create();
        _create();
        _create();
        assertEq(address(market).balance, 3 * FEE);
    }

    // =====================================================================
    // 3. commitVerdict
    // =====================================================================

    function test_commit_storesAndEmits() public {
        uint256 id = _create();
        bytes32 commitment = keccak256("c");
        vm.expectEmit(true, true, false, true);
        emit VerdictCommitted(id, C0, commitment);
        _commit(id, C0, commitment);
        IVerificationMarket.Reveal memory rev = market.getReveal(id, C0);
        assertTrue(rev.committed);
        assertFalse(rev.revealed);
    }

    function test_commit_zeroCommitmentAccepted() public {
        uint256 id = _create();
        _commit(id, C0, bytes32(0));
        assertTrue(market.getReveal(id, C0).committed);
    }

    function test_commit_unknownRequestReverts() public {
        vm.prank(C0);
        vm.expectRevert(abi.encodeWithSelector(IVerificationMarket.UnknownRequest.selector, uint256(99)));
        market.commitVerdict(99, keccak256("c"));
    }

    function test_commit_notMemberReverts() public {
        uint256 id = _create();
        vm.prank(OUTSIDER);
        vm.expectRevert(abi.encodeWithSelector(IVerificationMarket.NotCommitteeMember.selector, id, OUTSIDER));
        market.commitVerdict(id, keccak256("c"));
    }

    function test_commit_wrongPhaseReverts() public {
        uint256 id = _create();
        _toReveal(id); // phase effective Reveal
        vm.prank(C0);
        vm.expectRevert(
            abi.encodeWithSelector(
                IVerificationMarket.WrongPhase.selector,
                id,
                IVerificationMarket.Status.Commit,
                IVerificationMarket.Status.Reveal
            )
        );
        market.commitVerdict(id, keccak256("c"));
    }

    function test_commit_alreadyCommittedReverts() public {
        uint256 id = _create();
        _commit(id, C0, keccak256("c"));
        vm.prank(C0);
        vm.expectRevert(abi.encodeWithSelector(IVerificationMarket.AlreadyCommitted.selector, id, C0));
        market.commitVerdict(id, keccak256("c2"));
    }

    // =====================================================================
    // Bords d'horloge
    // =====================================================================

    function test_commit_atDeadlineMinusOneAccepted() public {
        uint256 id = _create();
        IVerificationMarket.Request memory r = market.getRequest(id);
        vm.warp(r.commitDeadline - 1);
        _commit(id, C0, keccak256("c"));
        assertTrue(market.getReveal(id, C0).committed);
    }

    function test_commit_atDeadlineRejected() public {
        uint256 id = _create();
        IVerificationMarket.Request memory r = market.getRequest(id);
        vm.warp(r.commitDeadline); // statut effectif passe a Reveal
        vm.prank(C0);
        vm.expectRevert(
            abi.encodeWithSelector(
                IVerificationMarket.WrongPhase.selector,
                id,
                IVerificationMarket.Status.Commit,
                IVerificationMarket.Status.Reveal
            )
        );
        market.commitVerdict(id, keccak256("c"));
    }

    function test_reveal_atDeadlineMinusOneAccepted() public {
        uint256 id = _create();
        bytes32 salt = keccak256("s");
        bytes32 commitment = market.commitmentOf(id, C0, IVerificationMarket.Code.Accept, 0, bytes32(0), salt);
        _commit(id, C0, commitment);
        IVerificationMarket.Request memory r = market.getRequest(id);
        vm.warp(r.revealDeadline - 1);
        _reveal(id, C0, IVerificationMarket.Code.Accept, 0, bytes32(0), salt);
        assertTrue(market.getReveal(id, C0).revealed);
    }

    function test_reveal_atDeadlineRejected() public {
        uint256 id = _create();
        bytes32 salt = keccak256("s");
        bytes32 commitment = market.commitmentOf(id, C0, IVerificationMarket.Code.Accept, 0, bytes32(0), salt);
        _commit(id, C0, commitment);
        IVerificationMarket.Request memory r = market.getRequest(id);
        vm.warp(r.revealDeadline);
        vm.prank(C0);
        vm.expectRevert(abi.encodeWithSelector(VerificationMarket.RevealWindowClosed.selector, id));
        market.revealVerdict(id, IVerificationMarket.Code.Accept, 0, bytes32(0), salt);
    }

    function test_close_atDeadlineMinusOneRejected() public {
        uint256 id = _finalizedRequest();
        IVerificationMarket.Request memory r = market.getRequest(id);
        vm.warp(r.contestDeadline - 1);
        vm.expectRevert(abi.encodeWithSelector(IVerificationMarket.TooEarly.selector, id));
        market.close(id);
    }

    function test_close_atDeadlineAccepted() public {
        uint256 id = _finalizedRequest();
        IVerificationMarket.Request memory r = market.getRequest(id);
        vm.warp(r.contestDeadline);
        market.close(id);
        assertEq(uint8(market.getRequest(id).status), uint8(IVerificationMarket.Status.Closed));
    }

    // =====================================================================
    // 4. revealVerdict
    // =====================================================================

    function test_reveal_storesAndEmits() public {
        uint256 id = _create();
        bytes32 salt = keccak256("salt");
        uint16 reasons = 5;
        bytes32 detailHash = keccak256("detail");
        bytes32 commitment =
            market.commitmentOf(id, C0, IVerificationMarket.Code.Refuse, reasons, detailHash, salt);
        _commit(id, C0, commitment);
        _toReveal(id);

        vm.expectEmit(true, true, false, true);
        emit VerdictRevealed(id, C0, IVerificationMarket.Code.Refuse, reasons, detailHash);
        _reveal(id, C0, IVerificationMarket.Code.Refuse, reasons, detailHash, salt);

        IVerificationMarket.Reveal memory rev = market.getReveal(id, C0);
        assertTrue(rev.revealed);
        assertEq(uint8(rev.vote), uint8(IVerificationMarket.Code.Refuse));
        assertEq(rev.reasons, reasons);
        assertEq(rev.detailHash, detailHash);
    }

    function test_reveal_unknownRequestReverts() public {
        vm.prank(C0);
        vm.expectRevert(abi.encodeWithSelector(IVerificationMarket.UnknownRequest.selector, uint256(99)));
        market.revealVerdict(99, IVerificationMarket.Code.Accept, 0, bytes32(0), keccak256("s"));
    }

    function test_reveal_notMemberReverts() public {
        uint256 id = _create();
        _toReveal(id);
        vm.prank(OUTSIDER);
        vm.expectRevert(abi.encodeWithSelector(IVerificationMarket.NotCommitteeMember.selector, id, OUTSIDER));
        market.revealVerdict(id, IVerificationMarket.Code.Accept, 0, bytes32(0), keccak256("s"));
    }

    function test_reveal_wrongPhaseReverts() public {
        // Encore en Commit.
        uint256 id = _create();
        vm.prank(C0);
        vm.expectRevert(
            abi.encodeWithSelector(
                IVerificationMarket.WrongPhase.selector,
                id,
                IVerificationMarket.Status.Reveal,
                IVerificationMarket.Status.Commit
            )
        );
        market.revealVerdict(id, IVerificationMarket.Code.Accept, 0, bytes32(0), keccak256("s"));
    }

    function test_reveal_alreadyRevealedReverts() public {
        uint256 id = _create();
        bytes32 salt = keccak256("s");
        bytes32 commitment = market.commitmentOf(id, C0, IVerificationMarket.Code.Accept, 0, bytes32(0), salt);
        _commit(id, C0, commitment);
        _toReveal(id);
        _reveal(id, C0, IVerificationMarket.Code.Accept, 0, bytes32(0), salt);
        vm.prank(C0);
        vm.expectRevert(abi.encodeWithSelector(IVerificationMarket.AlreadyRevealed.selector, id, C0));
        market.revealVerdict(id, IVerificationMarket.Code.Accept, 0, bytes32(0), salt);
    }

    function test_reveal_noCommitmentReverts() public {
        uint256 id = _create();
        _toReveal(id);
        vm.prank(C0);
        vm.expectRevert(abi.encodeWithSelector(IVerificationMarket.NoCommitment.selector, id, C0));
        market.revealVerdict(id, IVerificationMarket.Code.Accept, 0, bytes32(0), keccak256("s"));
    }

    function test_reveal_mismatchVoteReverts() public {
        uint256 id = _create();
        bytes32 salt = keccak256("s");
        bytes32 commitment = market.commitmentOf(id, C0, IVerificationMarket.Code.Accept, 0, bytes32(0), salt);
        _commit(id, C0, commitment);
        _toReveal(id);
        vm.prank(C0);
        vm.expectRevert(abi.encodeWithSelector(IVerificationMarket.CommitmentMismatch.selector, id, C0));
        market.revealVerdict(id, IVerificationMarket.Code.Refuse, 0, bytes32(0), salt);
    }

    function test_reveal_mismatchReasonsReverts() public {
        uint256 id = _create();
        bytes32 salt = keccak256("s");
        bytes32 commitment = market.commitmentOf(id, C0, IVerificationMarket.Code.Accept, 1, bytes32(0), salt);
        _commit(id, C0, commitment);
        _toReveal(id);
        vm.prank(C0);
        vm.expectRevert(abi.encodeWithSelector(IVerificationMarket.CommitmentMismatch.selector, id, C0));
        market.revealVerdict(id, IVerificationMarket.Code.Accept, 2, bytes32(0), salt);
    }

    function test_reveal_mismatchDetailHashReverts() public {
        uint256 id = _create();
        bytes32 salt = keccak256("s");
        bytes32 commitment =
            market.commitmentOf(id, C0, IVerificationMarket.Code.Accept, 0, keccak256("a"), salt);
        _commit(id, C0, commitment);
        _toReveal(id);
        vm.prank(C0);
        vm.expectRevert(abi.encodeWithSelector(IVerificationMarket.CommitmentMismatch.selector, id, C0));
        market.revealVerdict(id, IVerificationMarket.Code.Accept, 0, keccak256("b"), salt);
    }

    function test_reveal_mismatchSaltReverts() public {
        uint256 id = _create();
        bytes32 commitment =
            market.commitmentOf(id, C0, IVerificationMarket.Code.Accept, 0, bytes32(0), keccak256("s1"));
        _commit(id, C0, commitment);
        _toReveal(id);
        vm.prank(C0);
        vm.expectRevert(abi.encodeWithSelector(IVerificationMarket.CommitmentMismatch.selector, id, C0));
        market.revealVerdict(id, IVerificationMarket.Code.Accept, 0, bytes32(0), keccak256("s2"));
    }

    function test_reveal_commitmentForAnotherVerifierReverts() public {
        // C0 commite un commitment calcule pour C1 : au reveal, commitmentOf(C0,...) differe.
        uint256 id = _create();
        bytes32 salt = keccak256("s");
        bytes32 commitmentForC1 =
            market.commitmentOf(id, C1, IVerificationMarket.Code.Accept, 0, bytes32(0), salt);
        _commit(id, C0, commitmentForC1);
        _toReveal(id);
        vm.prank(C0);
        vm.expectRevert(abi.encodeWithSelector(IVerificationMarket.CommitmentMismatch.selector, id, C0));
        market.revealVerdict(id, IVerificationMarket.Code.Accept, 0, bytes32(0), salt);
    }

    function test_reveal_outOfRangeVoteRevertsLowLevel() public {
        uint256 id = _create();
        // commit d'un commitment arbitraire pour franchir la phase et le controle NoCommitment
        // n'est pas atteint car le decodeur ABI echoue avant toute execution.
        bytes32 salt = keccak256("s");
        bytes32 commitment = market.commitmentOf(id, C0, IVerificationMarket.Code.Accept, 0, bytes32(0), salt);
        _commit(id, C0, commitment);
        _toReveal(id);

        // vote = 3 : hors enum Code (0..2). Appel bas niveau avec encodage manuel.
        bytes memory data = abi.encodeWithSelector(
            IVerificationMarket.revealVerdict.selector, id, uint8(3), uint16(0), bytes32(0), salt
        );
        vm.prank(C0);
        (bool ok, bytes memory ret) = address(market).call(data);
        assertFalse(ok, "l'appel aurait du revert");
        assertEq(ret.length, 0, "revert sans donnee attendu (echec du decodeur ABI)");
    }

    // =====================================================================
    // 5. finalize et agregation
    // =====================================================================

    /// @notice Oracle independant du code attendu, duplique en Solidity de test.
    /// states[i] : 0 absent sans commit, 1 commit sans reveal, 2 vote Refuse, 3 vote Human, 4 vote Accept.
    function _oracleCode(uint8[3] memory states) internal pure returns (Counts memory o) {
        for (uint256 i = 0; i < 3; i++) {
            uint8 st = states[i];
            if (st == 0 || st == 1) {
                o.missed++;
            } else if (st == 2) {
                o.refuse++;
            } else if (st == 3) {
                o.human++;
            } else {
                o.accept++;
            }
        }
        o.n = o.refuse + o.human + o.accept;
        if (o.n < 2) {
            o.code = 1;
        } else if (uint256(o.refuse) * 2 > o.n) {
            o.code = 0;
        } else if (o.accept == o.n) {
            o.code = 2;
        } else {
            o.code = 1;
        }
    }

    function test_finalize_aggregationExhaustive() public {
        address[3] memory members = _members();
        for (uint8 a = 0; a < 5; a++) {
            for (uint8 b = 0; b < 5; b++) {
                for (uint8 cc = 0; cc < 5; cc++) {
                    uint8[3] memory states = [a, b, cc];
                    _runOneCombination(members, states);
                }
            }
        }
    }

    /// @notice Comptes agreges, pour contourner le stack too deep.
    struct Counts {
        uint8 code;
        uint8 n;
        uint8 refuse;
        uint8 human;
        uint8 accept;
        uint8 missed;
    }

    function _vote(uint8 state) internal pure returns (IVerificationMarket.Code) {
        if (state == 2) return IVerificationMarket.Code.Refuse;
        if (state == 3) return IVerificationMarket.Code.HumanReview;
        return IVerificationMarket.Code.Accept;
    }

    function _runOneCombination(address[3] memory members, uint8[3] memory states) internal {
        uint256 snap = vm.snapshotState();
        uint256 id = _create();

        // Commits (phase Commit) pour state >= 1.
        for (uint256 i = 0; i < 3; i++) {
            if (states[i] >= 1) {
                bytes32 salt = keccak256(abi.encode("salt", members[i], states[i]));
                _commit(id, members[i], market.commitmentOf(id, members[i], _vote(states[i]), 0, bytes32(0), salt));
            }
        }

        _toReveal(id);

        // Reveals pour state >= 2.
        for (uint256 i = 0; i < 3; i++) {
            if (states[i] >= 2) {
                bytes32 salt = keccak256(abi.encode("salt", members[i], states[i]));
                _reveal(id, members[i], _vote(states[i]), 0, bytes32(0), salt);
            }
        }

        // Si moins de 3 reveals, finalize anticipe revert TooEarly : on depasse revealDeadline.
        {
            uint8 revealedN = 0;
            for (uint256 i = 0; i < 3; i++) {
                if (states[i] >= 2) revealedN++;
            }
            if (revealedN < 3) {
                vm.warp(market.getRequest(id).revealDeadline);
            }
        }

        Counts memory oracle = _oracleCode(states);

        vm.recordLogs();
        uint8 realCode = uint8(market.finalize(id));
        Counts memory got = _parseLogs(vm.getRecordedLogs());

        assertEq(realCode, oracle.code, "code agrege");
        assertEq(got.missed, oracle.missed, "nombre de VerifierMissed");
        assertEq(got.n, oracle.n, "revealed count");
        assertEq(got.refuse, oracle.refuse, "refuse count");
        assertEq(got.human, oracle.human, "human count");
        assertEq(got.accept, oracle.accept, "accept count");

        vm.revertToState(snap);
    }

    /// @notice Compte les VerifierMissed et lit les champs de RequestFinalized.
    function _parseLogs(Vm.Log[] memory logs) internal pure returns (Counts memory got) {
        bytes32 missedSig = keccak256("VerifierMissed(uint256,address,bool)");
        bytes32 finalizedSig = keccak256("RequestFinalized(uint256,uint8,uint8,uint8,uint8,uint8,uint64)");
        bool finalizedSeen = false;
        for (uint256 i = 0; i < logs.length; i++) {
            if (logs[i].topics[0] == missedSig) {
                got.missed++;
            } else if (logs[i].topics[0] == finalizedSig) {
                finalizedSeen = true;
                (, uint8 rv, uint8 rf, uint8 hu, uint8 ac,) =
                    abi.decode(logs[i].data, (uint8, uint8, uint8, uint8, uint8, uint64));
                got.n = rv;
                got.refuse = rf;
                got.human = hu;
                got.accept = ac;
            }
        }
        require(finalizedSeen, "RequestFinalized absent");
    }


    function test_finalize_unknownRequestReverts() public {
        vm.expectRevert(abi.encodeWithSelector(IVerificationMarket.UnknownRequest.selector, uint256(99)));
        market.finalize(99);
    }

    function test_finalize_wrongPhaseReverts() public {
        // Encore en Commit.
        uint256 id = _create();
        vm.expectRevert(
            abi.encodeWithSelector(
                IVerificationMarket.WrongPhase.selector,
                id,
                IVerificationMarket.Status.Reveal,
                IVerificationMarket.Status.Commit
            )
        );
        market.finalize(id);
    }

    function test_finalize_tooEarlyWithTwoReveals() public {
        uint256 id = _create();
        bytes32 s0 = keccak256("s0");
        bytes32 s1 = keccak256("s1");
        _commit(id, C0, market.commitmentOf(id, C0, IVerificationMarket.Code.Accept, 0, bytes32(0), s0));
        _commit(id, C1, market.commitmentOf(id, C1, IVerificationMarket.Code.Accept, 0, bytes32(0), s1));
        _toReveal(id);
        _reveal(id, C0, IVerificationMarket.Code.Accept, 0, bytes32(0), s0);
        _reveal(id, C1, IVerificationMarket.Code.Accept, 0, bytes32(0), s1);
        // Encore avant revealDeadline, seuls 2 ont revele.
        vm.expectRevert(abi.encodeWithSelector(IVerificationMarket.TooEarly.selector, id));
        market.finalize(id);
    }

    function test_finalize_earlyWithThreeReveals() public {
        uint256 id = _create();
        bytes32 s0 = keccak256("s0");
        bytes32 s1 = keccak256("s1");
        bytes32 s2 = keccak256("s2");
        _commit(id, C0, market.commitmentOf(id, C0, IVerificationMarket.Code.Accept, 0, bytes32(0), s0));
        _commit(id, C1, market.commitmentOf(id, C1, IVerificationMarket.Code.Accept, 0, bytes32(0), s1));
        _commit(id, C2, market.commitmentOf(id, C2, IVerificationMarket.Code.Accept, 0, bytes32(0), s2));
        _toReveal(id);
        _reveal(id, C0, IVerificationMarket.Code.Accept, 0, bytes32(0), s0);
        _reveal(id, C1, IVerificationMarket.Code.Accept, 0, bytes32(0), s1);
        _reveal(id, C2, IVerificationMarket.Code.Accept, 0, bytes32(0), s2);
        // 3 reveals, avant revealDeadline : finalize autorise.
        IVerificationMarket.Code code = market.finalize(id);
        assertEq(uint8(code), uint8(IVerificationMarket.Code.Accept));
        assertEq(uint8(market.getRequest(id).status), uint8(IVerificationMarket.Status.Contest));
    }

    function test_finalize_afterDeadlineZeroReveals() public {
        uint256 id = _create();
        IVerificationMarket.Request memory r = market.getRequest(id);
        vm.warp(r.revealDeadline);
        IVerificationMarket.Code code = market.finalize(id);
        assertEq(uint8(code), uint8(IVerificationMarket.Code.HumanReview)); // n=0 < 2
    }

    function test_finalize_afterDeadlineOneReveal() public {
        uint256 id = _create();
        bytes32 s0 = keccak256("s0");
        _commit(id, C0, market.commitmentOf(id, C0, IVerificationMarket.Code.Refuse, 0, bytes32(0), s0));
        _toReveal(id);
        _reveal(id, C0, IVerificationMarket.Code.Refuse, 0, bytes32(0), s0);
        IVerificationMarket.Request memory r = market.getRequest(id);
        vm.warp(r.revealDeadline);
        IVerificationMarket.Code code = market.finalize(id);
        assertEq(uint8(code), uint8(IVerificationMarket.Code.HumanReview)); // n=1 < 2
    }

    function test_finalize_afterDeadlineTwoReveals() public {
        uint256 id = _create();
        bytes32 s0 = keccak256("s0");
        bytes32 s1 = keccak256("s1");
        _commit(id, C0, market.commitmentOf(id, C0, IVerificationMarket.Code.Refuse, 0, bytes32(0), s0));
        _commit(id, C1, market.commitmentOf(id, C1, IVerificationMarket.Code.Refuse, 0, bytes32(0), s1));
        _toReveal(id);
        _reveal(id, C0, IVerificationMarket.Code.Refuse, 0, bytes32(0), s0);
        _reveal(id, C1, IVerificationMarket.Code.Refuse, 0, bytes32(0), s1);
        IVerificationMarket.Request memory r = market.getRequest(id);
        vm.warp(r.revealDeadline);
        IVerificationMarket.Code code = market.finalize(id);
        assertEq(uint8(code), uint8(IVerificationMarket.Code.Refuse)); // 2 refuse, 2*2>2
    }

    function test_finalize_missedOrderAndEvents() public {
        // C0 absent, C1 commit sans reveal, C2 reveal : ordre VerifierMissed C0 (false) puis C1 (true).
        uint256 id = _create();
        bytes32 s1 = keccak256("s1");
        bytes32 s2 = keccak256("s2");
        _commit(id, C1, market.commitmentOf(id, C1, IVerificationMarket.Code.Accept, 0, bytes32(0), s1));
        _commit(id, C2, market.commitmentOf(id, C2, IVerificationMarket.Code.Accept, 0, bytes32(0), s2));
        _toReveal(id);
        _reveal(id, C2, IVerificationMarket.Code.Accept, 0, bytes32(0), s2);
        IVerificationMarket.Request memory r = market.getRequest(id);
        vm.warp(r.revealDeadline);

        uint64 contestDeadline = r.revealDeadline + CONTEST_WINDOW;

        vm.expectEmit(true, true, false, true);
        emit VerifierMissed(id, C0, false);
        vm.expectEmit(true, true, false, true);
        emit VerifierMissed(id, C1, true);
        vm.expectEmit(true, false, false, true);
        emit RequestFinalized(id, IVerificationMarket.Code.HumanReview, 1, 0, 0, 1, contestDeadline);

        market.finalize(id);
    }

    // =====================================================================
    // 6. close
    // =====================================================================

    /// @notice Cree, finalise (3 reveals Accept), rend l'id en phase Contest.
    function _finalizedRequest() internal returns (uint256 id) {
        id = _create();
        bytes32 s0 = keccak256("s0");
        bytes32 s1 = keccak256("s1");
        bytes32 s2 = keccak256("s2");
        _commit(id, C0, market.commitmentOf(id, C0, IVerificationMarket.Code.Accept, 0, bytes32(0), s0));
        _commit(id, C1, market.commitmentOf(id, C1, IVerificationMarket.Code.Accept, 0, bytes32(0), s1));
        _commit(id, C2, market.commitmentOf(id, C2, IVerificationMarket.Code.Accept, 0, bytes32(0), s2));
        _toReveal(id);
        _reveal(id, C0, IVerificationMarket.Code.Accept, 0, bytes32(0), s0);
        _reveal(id, C1, IVerificationMarket.Code.Accept, 0, bytes32(0), s1);
        _reveal(id, C2, IVerificationMarket.Code.Accept, 0, bytes32(0), s2);
        market.finalize(id);
    }

    function test_close_emitsAndClosed() public {
        uint256 id = _finalizedRequest();
        IVerificationMarket.Request memory r = market.getRequest(id);
        vm.warp(r.contestDeadline);
        vm.expectEmit(true, false, false, true);
        emit RequestClosed(id);
        market.close(id);
        assertEq(uint8(market.getRequest(id).status), uint8(IVerificationMarket.Status.Closed));
    }

    function test_close_unknownRequestReverts() public {
        vm.expectRevert(abi.encodeWithSelector(IVerificationMarket.UnknownRequest.selector, uint256(99)));
        market.close(99);
    }

    function test_close_wrongPhaseReverts() public {
        // Encore en Commit.
        uint256 id = _create();
        vm.expectRevert(
            abi.encodeWithSelector(
                IVerificationMarket.WrongPhase.selector,
                id,
                IVerificationMarket.Status.Contest,
                IVerificationMarket.Status.Commit
            )
        );
        market.close(id);
    }

    function test_close_tooEarlyReverts() public {
        uint256 id = _finalizedRequest();
        // avant contestDeadline
        vm.expectRevert(abi.encodeWithSelector(IVerificationMarket.TooEarly.selector, id));
        market.close(id);
    }

    // =====================================================================
    // 7. Lecture et etats
    // =====================================================================

    function test_getRequest_unknownReverts() public {
        vm.expectRevert(abi.encodeWithSelector(IVerificationMarket.UnknownRequest.selector, uint256(1)));
        market.getRequest(1);
    }

    function test_status_commit() public {
        uint256 id = _create();
        assertEq(uint8(market.getRequest(id).status), uint8(IVerificationMarket.Status.Commit));
    }

    function test_status_revealByClock() public {
        uint256 id = _create();
        _toReveal(id);
        assertEq(uint8(market.getRequest(id).status), uint8(IVerificationMarket.Status.Reveal));
    }

    function test_status_contest() public {
        uint256 id = _finalizedRequest();
        assertEq(uint8(market.getRequest(id).status), uint8(IVerificationMarket.Status.Contest));
    }

    function test_status_closed() public {
        uint256 id = _finalizedRequest();
        IVerificationMarket.Request memory r = market.getRequest(id);
        vm.warp(r.contestDeadline);
        market.close(id);
        assertEq(uint8(market.getRequest(id).status), uint8(IVerificationMarket.Status.Closed));
    }

    function test_getCommittee_returnsThree() public {
        uint256 id = _create();
        address[] memory c = market.getCommittee(id);
        assertEq(c.length, 3);
        assertEq(c[0], C0);
        assertEq(c[1], C1);
        assertEq(c[2], C2);
    }

    function test_getCommittee_unknownReverts() public {
        vm.expectRevert(abi.encodeWithSelector(IVerificationMarket.UnknownRequest.selector, uint256(1)));
        market.getCommittee(1);
    }

    function test_getReveal_zeroWhenNothing() public {
        uint256 id = _create();
        IVerificationMarket.Reveal memory rev = market.getReveal(id, C0);
        assertFalse(rev.committed);
        assertFalse(rev.revealed);
        assertEq(uint8(rev.vote), 0);
        assertEq(rev.reasons, 0);
        assertEq(rev.detailHash, bytes32(0));
    }

    function test_isCommitteeMember() public {
        uint256 id = _create();
        assertTrue(market.isCommitteeMember(id, C0));
        assertTrue(market.isCommitteeMember(id, C1));
        assertTrue(market.isCommitteeMember(id, C2));
        assertFalse(market.isCommitteeMember(id, OUTSIDER));
    }

    function test_isCommitteeMember_unknownIsFalse() public view {
        assertFalse(market.isCommitteeMember(99, C0));
    }

    function test_hashOf_matchesLocal() public view {
        IVerificationMarket.Facts memory facts = IVerificationMarket.Facts({
            amount: 12345,
            currency: bytes3("EUR"),
            beneficiaryId: keccak256("ben"),
            referenceId: keccak256("ref")
        });
        bytes32 contentHash = keccak256("content");
        bytes32 expected = keccak256(abi.encode(facts, contentHash));
        assertEq(market.hashOf(facts, contentHash), expected);
    }

    function test_commitmentOf_matchesLocal() public view {
        bytes32 salt = keccak256("salt");
        bytes32 expected = keccak256(
            abi.encode(
                block.chainid,
                address(market),
                uint256(1),
                C0,
                IVerificationMarket.Code.Accept,
                uint16(7),
                keccak256("d"),
                salt
            )
        );
        assertEq(
            market.commitmentOf(1, C0, IVerificationMarket.Code.Accept, 7, keccak256("d"), salt), expected
        );
    }

    function test_requests_independent() public {
        uint256 a = _create();
        uint256 b = _create();
        _commit(a, C0, keccak256("ca"));
        // commit sur a n'affecte pas b
        assertTrue(market.getReveal(a, C0).committed);
        assertFalse(market.getReveal(b, C0).committed);
    }

    // =====================================================================
    // Fuzz : commitmentOf puis reveal reussit pour tout (vote borne, reasons, detailHash, salt)
    // =====================================================================

    function testFuzz_commitReveal(uint8 voteRaw, uint16 reasons, bytes32 detailHash, bytes32 salt) public {
        IVerificationMarket.Code vote = IVerificationMarket.Code(uint8(bound(voteRaw, 0, 2)));
        uint256 id = _create();
        bytes32 commitment = market.commitmentOf(id, C0, vote, reasons, detailHash, salt);
        _commit(id, C0, commitment);
        _toReveal(id);
        _reveal(id, C0, vote, reasons, detailHash, salt);
        IVerificationMarket.Reveal memory rev = market.getReveal(id, C0);
        assertTrue(rev.revealed);
        assertEq(uint8(rev.vote), uint8(vote));
        assertEq(rev.reasons, reasons);
        assertEq(rev.detailHash, detailHash);
    }
}
