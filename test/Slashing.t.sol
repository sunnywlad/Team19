// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {Slashing} from "../src/Slashing.sol";
import {ISlashing} from "../src/interfaces/ISlashing.sol";
import {VerificationMarket} from "../src/VerificationMarket.sol";
import {IVerificationMarket} from "../src/interfaces/IVerificationMarket.sol";
import {VerifierRegistry} from "../src/VerifierRegistry.sol";

/// @title Tests Slashing phase 2
/// @notice Suite forge-std conforme a spec-lot6.md. src/ non modifie.
/// @dev Marche reel de phase 1 (sans crochets) pour que getRequest/getReveal/hashOf/count repondent.
///      Le registre a pour marche le contrat de test (lock manuel) et pour Slashing le contrat Slashing.
///      Taux : NoCommit 1 %, NoReveal 5 %, PredicateViolation 20 % de la caution totale.
contract SlashingTest is Test {
    Slashing internal slashing;
    VerificationMarket internal market;
    VerifierRegistry internal registry;

    // Comite fixe de 3 (memes adresses de test que la phase 1).
    address internal constant C0 = 0x70997970C51812dc3A010C7d01b50e0d17dc79C8;
    address internal constant C1 = 0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC;
    address internal constant C2 = 0x90F79bf6EB2c4f870365E785982E1f101E93b906;

    address internal constant REQUESTER = address(0xCAFE);
    address internal constant OUTSIDER = address(0xBEEF);
    address internal constant TREASURY = address(0x15EA50);

    uint256 internal constant MIN_STAKE = 100 ether;
    uint16 internal constant LOCK_BPS = 2000; // 20 %
    uint8 internal constant STRIKE_LIMIT = 3;
    uint256 internal constant EXCLUSION = 10;

    uint256 internal constant FEE = 1 ether;
    uint64 internal constant COMMIT_WINDOW = 180;
    uint64 internal constant REVEAL_WINDOW = 60;
    uint64 internal constant CONTEST_WINDOW = 600;

    bytes32 internal constant H = keccak256("une-demande");

    bytes3 internal constant EUR = bytes3("EUR");
    bytes32 internal constant BEN = keccak256("beneficiaire-ok");
    bytes32 internal constant BEN_BAD = keccak256("beneficiaire-interdit");

    event ContestOpened(uint256 indexed requestId, address indexed verifier, address indexed challenger);
    event ContestResolved(uint256 indexed requestId, address indexed verifier, bool upheld);
    event VerifierSlashed(uint256 indexed requestId, address indexed verifier, ISlashing.Fault fault, uint256 amount);
    event VerifierStruck(address indexed verifier, uint8 strikes);

    function setUp() public {
        vm.warp(1_000_000);

        address[3] memory committee = [C0, C1, C2];
        market = new VerificationMarket(committee, FEE, COMMIT_WINDOW, REVEAL_WINDOW, CONTEST_WINDOW);

        registry = new VerifierRegistry(MIN_STAKE, LOCK_BPS, TREASURY);
        slashing = new Slashing(registry, STRIKE_LIMIT, EXCLUSION);
        slashing.setMarket(address(market));

        // Le test joue le marche du registre (pour verrouiller a la main) ; Slashing est le vrai contrat.
        registry.setMarket(address(this));
        registry.setSlashing(address(slashing));

        // Admission et caution des 3 membres.
        vm.deal(C0, 1000 ether);
        vm.deal(C1, 1000 ether);
        vm.deal(C2, 1000 ether);
        vm.deal(REQUESTER, 1000 ether);
        _admitRegister(C0);
        _admitRegister(C1);
        _admitRegister(C2);
    }

    // =====================================================================
    // Helpers
    // =====================================================================

    function _admitRegister(address v) internal {
        registry.admit(v);
        vm.prank(v);
        registry.register{value: MIN_STAKE}();
    }

    /// @notice Verrouille la part de mission des 3 membres (role du marche, joue par le test).
    function _lockAll(uint256 id) internal {
        registry.lockStake(C0, id);
        registry.lockStake(C1, id);
        registry.lockStake(C2, id);
    }

    function _create() internal returns (uint256 id) {
        vm.prank(REQUESTER);
        id = market.createRequest{value: FEE}(H);
        _lockAll(id);
    }

    function _toReveal(uint256 id) internal {
        vm.warp(market.getRequest(id).commitDeadline);
    }

    function _commit(uint256 id, address who, IVerificationMarket.Code vote, uint16 reasons, bytes32 salt) internal {
        bytes32 c = market.commitmentOf(id, who, vote, reasons, bytes32(0), salt);
        vm.prank(who);
        market.commitVerdict(id, c);
    }

    function _reveal(uint256 id, address who, IVerificationMarket.Code vote, uint16 reasons, bytes32 salt) internal {
        vm.prank(who);
        market.revealVerdict(id, vote, reasons, bytes32(0), salt);
    }

    /// @notice Cree une demande ou C0 ne commite pas, C1 commite sans reveal, C2 revele (vote/reasons donnes).
    ///         Finalise apres revealDeadline, laisse en Contest.
    function _requestWithC2Reveal(IVerificationMarket.Code c2Vote, uint16 c2Reasons) internal returns (uint256 id) {
        id = _create();
        bytes32 s1 = keccak256(abi.encode("s1", id));
        bytes32 s2 = keccak256(abi.encode("s2", id));
        _commit(id, C1, IVerificationMarket.Code.Accept, 0, s1); // commite, ne revelera pas
        _commit(id, C2, c2Vote, c2Reasons, s2);
        _toReveal(id);
        _reveal(id, C2, c2Vote, c2Reasons, s2);
        vm.warp(market.getRequest(id).revealDeadline);
        market.finalize(id);
    }

    /// @notice Les faits dont H = keccak256(abi.encode(facts, contentHash)) ; on recalcule H et on
    ///         recree une demande avec ce H precis pour que hashOf corresponde.
    function _facts(uint256 amount, bytes32 beneficiary) internal pure returns (IVerificationMarket.Facts memory f) {
        f = IVerificationMarket.Facts({
            amount: amount, currency: EUR, beneficiaryId: beneficiary, referenceId: keccak256("ref")
        });
    }

    /// @notice Cree une demande dont H colle aux faits, C2 revele (vote/reasons), finalise en Contest.
    function _contestableRequest(
        IVerificationMarket.Facts memory facts,
        bytes32 contentHash,
        IVerificationMarket.Code c2Vote,
        uint16 c2Reasons
    ) internal returns (uint256 id, bytes32 h) {
        h = market.hashOf(facts, contentHash);
        vm.prank(REQUESTER);
        id = market.createRequest{value: FEE}(h);
        _lockAll(id);
        bytes32 s2 = keccak256(abi.encode("s2", id));
        _commit(id, C2, c2Vote, c2Reasons, s2);
        _toReveal(id);
        _reveal(id, C2, c2Vote, c2Reasons, s2);
        vm.warp(market.getRequest(id).revealDeadline);
        market.finalize(id);
    }

    // =====================================================================
    // 1. Constructeur et reglages
    // =====================================================================

    function test_constructor_storesValues() public view {
        assertEq(slashing.admin(), address(this));
        assertEq(address(slashing.registry()), address(registry));
        assertEq(slashing.strikeLimit(), STRIKE_LIMIT);
        assertEq(slashing.exclusionRequests(), EXCLUSION);
        assertEq(address(slashing.market()), address(market));
    }

    function test_setMarket_twiceReverts() public {
        vm.expectRevert(Slashing.AlreadySet.selector);
        slashing.setMarket(address(0xDEAD));
    }

    function test_setMarket_onlyAdmin() public {
        Slashing fresh = new Slashing(registry, STRIKE_LIMIT, EXCLUSION);
        vm.prank(OUTSIDER);
        vm.expectRevert(abi.encodeWithSelector(Slashing.OnlyAdmin.selector, OUTSIDER));
        fresh.setMarket(address(market));
    }

    function test_setCap_onlyAdmin() public {
        vm.prank(OUTSIDER);
        vm.expectRevert(abi.encodeWithSelector(Slashing.OnlyAdmin.selector, OUTSIDER));
        slashing.setCap(EUR, 1000);
    }

    function test_setBeneficiaryAllowed_onlyAdmin() public {
        vm.prank(OUTSIDER);
        vm.expectRevert(abi.encodeWithSelector(Slashing.OnlyAdmin.selector, OUTSIDER));
        slashing.setBeneficiaryAllowed(BEN, true);
    }

    function test_setBeneficiaryListEnabled_onlyAdmin() public {
        vm.prank(OUTSIDER);
        vm.expectRevert(abi.encodeWithSelector(Slashing.OnlyAdmin.selector, OUTSIDER));
        slashing.setBeneficiaryListEnabled(true);
    }

    // =====================================================================
    // 2. slashMissed : NoCommit (1 %) et NoReveal (5 %), montants exacts
    // =====================================================================

    function test_slashMissed_noCommitOnePercent() public {
        // C0 n'a jamais commite.
        uint256 id = _requestWithC2Reveal(IVerificationMarket.Code.Accept, 0);
        uint256 expected = (MIN_STAKE * 100) / 10000; // 1 %
        (uint256 totalBefore,) = registry.stakeOf(C0);
        uint256 treasuryBefore = TREASURY.balance;

        vm.expectEmit(true, true, false, true);
        emit VerifierSlashed(id, C0, ISlashing.Fault.NoCommit, expected);
        slashing.slashMissed(id, C0);

        (uint256 totalAfter,) = registry.stakeOf(C0);
        assertEq(totalBefore - totalAfter, expected);
        assertEq(TREASURY.balance - treasuryBefore, expected);
        assertEq(slashing.strikesOf(C0), 1);
    }

    function test_slashMissed_noRevealFivePercent() public {
        // C1 a commite sans reveler.
        uint256 id = _requestWithC2Reveal(IVerificationMarket.Code.Accept, 0);
        uint256 expected = (MIN_STAKE * 500) / 10000; // 5 %
        (uint256 totalBefore,) = registry.stakeOf(C1);

        vm.expectEmit(true, true, false, true);
        emit VerifierSlashed(id, C1, ISlashing.Fault.NoReveal, expected);
        slashing.slashMissed(id, C1);

        (uint256 totalAfter,) = registry.stakeOf(C1);
        assertEq(totalBefore - totalAfter, expected);
        assertEq(slashing.strikesOf(C1), 1);
    }

    function test_slashMissed_revealedIsNoViolation() public {
        // C2 a revele : aucune faute d'absence.
        uint256 id = _requestWithC2Reveal(IVerificationMarket.Code.Accept, 0);
        vm.expectRevert(abi.encodeWithSelector(ISlashing.NoViolation.selector, id, C2));
        slashing.slashMissed(id, C2);
    }

    function test_slashMissed_notCommitteeMemberIsNoViolation() public {
        uint256 id = _requestWithC2Reveal(IVerificationMarket.Code.Accept, 0);
        vm.expectRevert(abi.encodeWithSelector(ISlashing.NoViolation.selector, id, OUTSIDER));
        slashing.slashMissed(id, OUTSIDER);
    }

    function test_slashMissed_alreadySlashedReverts() public {
        uint256 id = _requestWithC2Reveal(IVerificationMarket.Code.Accept, 0);
        slashing.slashMissed(id, C0);
        vm.expectRevert(abi.encodeWithSelector(Slashing.AlreadySlashed.selector, id, C0));
        slashing.slashMissed(id, C0);
    }

    function test_slashMissed_notFinalizedReverts() public {
        // Demande encore en phase Commit : pas Contest ni Closed.
        uint256 id = _create();
        vm.expectRevert(abi.encodeWithSelector(Slashing.NotFinalized.selector, id));
        slashing.slashMissed(id, C0);
    }

    function test_slashMissed_worksAfterClosed() public {
        uint256 id = _requestWithC2Reveal(IVerificationMarket.Code.Accept, 0);
        vm.warp(market.getRequest(id).contestDeadline);
        market.close(id);
        // Toujours sanctionnable en Closed.
        slashing.slashMissed(id, C0);
        assertEq(slashing.strikesOf(C0), 1);
    }

    // =====================================================================
    // 3. Strikes : 3 strikes -> VerifierStruck + struckUntil
    // =====================================================================

    function test_slashMissed_threeStrikesStrucks() public {
        // 3 demandes ou C0 ne commite jamais : 3 slashMissed, le 3e declenche VerifierStruck.
        uint256 id1 = _requestWithC2Reveal(IVerificationMarket.Code.Accept, 0);
        uint256 id2 = _requestWithC2Reveal(IVerificationMarket.Code.Accept, 0);
        uint256 id3 = _requestWithC2Reveal(IVerificationMarket.Code.Accept, 0);

        slashing.slashMissed(id1, C0);
        assertEq(slashing.strikesOf(C0), 1);
        slashing.slashMissed(id2, C0);
        assertEq(slashing.strikesOf(C0), 2);

        // Le 3e strike : VerifierStruck(C0, 3), strikes remis a 0, struckUntil = count + exclusion.
        vm.expectEmit(true, false, false, true);
        emit VerifierStruck(C0, 3);
        slashing.slashMissed(id3, C0);

        assertEq(slashing.strikesOf(C0), 0); // remis a zero
        assertEq(slashing.struckUntil(C0), market.count() + EXCLUSION);
    }

    // =====================================================================
    // 4. contest : chaque cas de violation du point 5
    // =====================================================================

    function test_contest_acceptOverCap() public {
        // cap EUR = 1000 ; montant 2000 > cap ; vote Accept ; reasons 0 (bits coherents avec overCap=true ? non).
        // Ici on vise la faute de vote : Accept malgre depassement. reasons doit refleter les bits pour
        // isoler voteFault, on pose bit0 (overCap) et pas bit1 : bits coherents, seule la faute de vote tient.
        slashing.setCap(EUR, 1000);
        IVerificationMarket.Facts memory f = _facts(2000, BEN);
        bytes32 contentHash = keccak256("c");
        // reasons = bit0 (amount above cap) seul : overCap=true -> bit0 coherent ; notAllowed=false -> bit1 coherent.
        uint16 reasons = 1; // BIT_AMOUNT_ABOVE_CAP
        (uint256 id,) = _contestableRequest(f, contentHash, IVerificationMarket.Code.Accept, reasons);

        uint256 expected = _lockedTwentyPct(C2, id);
        vm.expectEmit(true, true, false, true);
        emit VerifierSlashed(id, C2, ISlashing.Fault.PredicateViolation, expected);
        bool upheld = slashing.contest(id, C2, f, contentHash);
        assertTrue(upheld);
        assertEq(slashing.strikesOf(C2), 0); // pas de strike pour la faute 3
    }

    function test_contest_acceptBeneficiaryNotAllowed() public {
        slashing.setBeneficiaryListEnabled(true);
        slashing.setBeneficiaryAllowed(BEN_BAD, false); // explicitement hors liste
        IVerificationMarket.Facts memory f = _facts(50, BEN_BAD);
        bytes32 contentHash = keccak256("c");
        // notAllowed=true ; reasons pose bit1 (coherent) ; overCap=false ; bit0 absent (coherent).
        uint16 reasons = 2; // BIT_BENEFICIARY_NOT_ALLOWED
        (uint256 id,) = _contestableRequest(f, contentHash, IVerificationMarket.Code.Accept, reasons);

        bool upheld = slashing.contest(id, C2, f, contentHash);
        assertTrue(upheld);
    }

    function test_contest_bit0SetWrongly() public {
        // Pas de cap : overCap=false. Le verificateur pose bit0 a tort. Vote Refuse (pas de voteFault).
        IVerificationMarket.Facts memory f = _facts(2000, BEN);
        bytes32 contentHash = keccak256("c");
        uint16 reasons = 1; // bit0 pose alors que overCap=false -> bit0Fault
        (uint256 id,) = _contestableRequest(f, contentHash, IVerificationMarket.Code.Refuse, reasons);

        bool upheld = slashing.contest(id, C2, f, contentHash);
        assertTrue(upheld);
    }

    function test_contest_bit0OmittedWrongly() public {
        // cap depasse : overCap=true. Le verificateur omet bit0. Vote Refuse (pas de voteFault car Refuse).
        slashing.setCap(EUR, 1000);
        IVerificationMarket.Facts memory f = _facts(2000, BEN);
        bytes32 contentHash = keccak256("c");
        uint16 reasons = 0; // bit0 omis alors que overCap=true -> bit0Fault
        (uint256 id,) = _contestableRequest(f, contentHash, IVerificationMarket.Code.Refuse, reasons);

        bool upheld = slashing.contest(id, C2, f, contentHash);
        assertTrue(upheld);
    }

    function test_contest_bit1SetWrongly() public {
        // Liste desactivee : notAllowed=false. Le verificateur pose bit1 a tort. Vote Refuse.
        IVerificationMarket.Facts memory f = _facts(50, BEN);
        bytes32 contentHash = keccak256("c");
        uint16 reasons = 2; // bit1 pose alors que notAllowed=false -> bit1Fault
        (uint256 id,) = _contestableRequest(f, contentHash, IVerificationMarket.Code.Refuse, reasons);

        bool upheld = slashing.contest(id, C2, f, contentHash);
        assertTrue(upheld);
    }

    function test_contest_bit1OmittedWrongly() public {
        // Liste active, beneficiaire hors liste : notAllowed=true. Le verificateur omet bit1. Vote Refuse.
        slashing.setBeneficiaryListEnabled(true);
        IVerificationMarket.Facts memory f = _facts(50, BEN_BAD);
        bytes32 contentHash = keccak256("c");
        uint16 reasons = 0; // bit1 omis alors que notAllowed=true -> bit1Fault
        (uint256 id,) = _contestableRequest(f, contentHash, IVerificationMarket.Code.Refuse, reasons);

        bool upheld = slashing.contest(id, C2, f, contentHash);
        assertTrue(upheld);
    }

    function test_contest_twentyPercentAmount() public {
        // Montant exact de la saisie de contestation : 20 % de la caution totale, borne par le bloque.
        IVerificationMarket.Facts memory f = _facts(2000, BEN);
        bytes32 contentHash = keccak256("c");
        uint16 reasons = 1; // bit0 pose a tort (pas de cap) -> bit0Fault
        (uint256 id,) = _contestableRequest(f, contentHash, IVerificationMarket.Code.Refuse, reasons);

        uint256 expected = (MIN_STAKE * 2000) / 10000; // 20 ether
        (uint256 totalBefore,) = registry.stakeOf(C2);
        uint256 treasuryBefore = TREASURY.balance;
        slashing.contest(id, C2, f, contentHash);
        (uint256 totalAfter,) = registry.stakeOf(C2);
        assertEq(totalBefore - totalAfter, expected);
        assertEq(TREASURY.balance - treasuryBefore, expected);
    }

    // =====================================================================
    // 5. contest : aucun faux positif
    // =====================================================================

    function test_contest_refuseCorrectNoViolation() public {
        // cap depasse (overCap=true), vote Refuse (correct, pas de voteFault), bit0 pose (coherent),
        // bit1 absent (coherent) : aucune faute.
        slashing.setCap(EUR, 1000);
        IVerificationMarket.Facts memory f = _facts(2000, BEN);
        bytes32 contentHash = keccak256("c");
        uint16 reasons = 1; // bit0 coherent avec overCap=true
        (uint256 id,) = _contestableRequest(f, contentHash, IVerificationMarket.Code.Refuse, reasons);

        vm.expectRevert(abi.encodeWithSelector(ISlashing.NoViolation.selector, id, C2));
        slashing.contest(id, C2, f, contentHash);
    }

    function test_contest_humanReviewCoherentNoViolation() public {
        // Aucun predicat viole (pas de cap, liste off), vote HumanReview, reasons 0 : coherent, aucune faute.
        IVerificationMarket.Facts memory f = _facts(50, BEN);
        bytes32 contentHash = keccak256("c");
        uint16 reasons = 0;
        (uint256 id,) = _contestableRequest(f, contentHash, IVerificationMarket.Code.HumanReview, reasons);

        vm.expectRevert(abi.encodeWithSelector(ISlashing.NoViolation.selector, id, C2));
        slashing.contest(id, C2, f, contentHash);
    }

    function test_contest_acceptCleanNoViolation() public {
        // Aucun predicat viole, vote Accept legitime, reasons 0 : overCap/notAllowed faux -> pas de voteFault.
        IVerificationMarket.Facts memory f = _facts(50, BEN);
        bytes32 contentHash = keccak256("c");
        uint16 reasons = 0;
        (uint256 id,) = _contestableRequest(f, contentHash, IVerificationMarket.Code.Accept, reasons);

        vm.expectRevert(abi.encodeWithSelector(ISlashing.NoViolation.selector, id, C2));
        slashing.contest(id, C2, f, contentHash);
    }

    // =====================================================================
    // 6. contest : erreurs de garde
    // =====================================================================

    function test_contest_hashMismatchReverts() public {
        IVerificationMarket.Facts memory f = _facts(2000, BEN);
        bytes32 contentHash = keccak256("c");
        uint16 reasons = 1;
        (uint256 id,) = _contestableRequest(f, contentHash, IVerificationMarket.Code.Accept, reasons);

        // Faits ne recomposant pas H.
        IVerificationMarket.Facts memory wrong = _facts(999, BEN);
        vm.expectRevert(abi.encodeWithSelector(ISlashing.HashMismatch.selector, id));
        slashing.contest(id, C2, wrong, contentHash);
    }

    function test_contest_windowClosedBeforeContest() public {
        // Demande encore en Commit : statut != Contest.
        uint256 id = _create();
        IVerificationMarket.Facts memory f = _facts(2000, BEN);
        vm.expectRevert(abi.encodeWithSelector(ISlashing.ContestWindowClosed.selector, id));
        slashing.contest(id, C2, f, keccak256("c"));
    }

    function test_contest_windowClosedAtDeadline() public {
        IVerificationMarket.Facts memory f = _facts(2000, BEN);
        bytes32 contentHash = keccak256("c");
        uint16 reasons = 1;
        (uint256 id,) = _contestableRequest(f, contentHash, IVerificationMarket.Code.Accept, reasons);
        // A contestDeadline pile : fenetre fermee (block.timestamp >= contestDeadline).
        vm.warp(market.getRequest(id).contestDeadline);
        vm.expectRevert(abi.encodeWithSelector(ISlashing.ContestWindowClosed.selector, id));
        slashing.contest(id, C2, f, contentHash);
    }

    function test_contest_verifierNotRevealedNoViolation() public {
        // C1 a commite sans reveler : contre C1, NoViolation (pas de verdict a contester).
        IVerificationMarket.Facts memory f = _facts(2000, BEN);
        bytes32 contentHash = keccak256("c");
        bytes32 h = market.hashOf(f, contentHash);
        vm.prank(REQUESTER);
        uint256 id = market.createRequest{value: FEE}(h);
        _lockAll(id);
        bytes32 s1 = keccak256(abi.encode("s1", id));
        _commit(id, C1, IVerificationMarket.Code.Accept, 0, s1); // commite, ne revele pas
        _toReveal(id);
        vm.warp(market.getRequest(id).revealDeadline);
        market.finalize(id);

        vm.expectRevert(abi.encodeWithSelector(ISlashing.NoViolation.selector, id, C1));
        slashing.contest(id, C1, f, contentHash);
    }

    function test_contest_alreadySlashedReverts() public {
        // Deja saisi par slashMissed (C0 absent), puis contest sur C0 : AlreadySlashed.
        // Ici on contest C2 deux fois : premiere reussit, seconde -> AlreadySlashed.
        IVerificationMarket.Facts memory f = _facts(2000, BEN);
        bytes32 contentHash = keccak256("c");
        uint16 reasons = 1; // bit0 pose a tort -> faute
        (uint256 id,) = _contestableRequest(f, contentHash, IVerificationMarket.Code.Refuse, reasons);
        slashing.contest(id, C2, f, contentHash);
        vm.expectRevert(abi.encodeWithSelector(Slashing.AlreadySlashed.selector, id, C2));
        slashing.contest(id, C2, f, contentHash);
    }

    // =====================================================================
    // Helper : part bloquee effective pour (v, id) a 20 %
    // =====================================================================

    function _lockedTwentyPct(address v, uint256 id) internal view returns (uint256) {
        // La saisie 20 % = min(total*2000/10000, lockedFor) ; total inchange ici donc = 20 %.
        return registry.lockedFor(v, id);
    }
}
