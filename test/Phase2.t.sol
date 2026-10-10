// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {StakedVerificationMarket} from "../src/StakedVerificationMarket.sol";
import {VerificationMarket} from "../src/VerificationMarket.sol";
import {IVerificationMarket} from "../src/interfaces/IVerificationMarket.sol";
import {VerifierRegistry} from "../src/VerifierRegistry.sol";
import {IVerifierRegistry} from "../src/interfaces/IVerifierRegistry.sol";
import {Slashing} from "../src/Slashing.sol";
import {ISlashing} from "../src/interfaces/ISlashing.sol";
import {Rewards} from "../src/Rewards.sol";
import {MockNativeMinter} from "./mocks/MockNativeMinter.sol";
import {NATIVE_MINTER} from "../src/precompiles/INativeMinter.sol";

/// @title Tests d'integration phase 2
/// @notice Bout en bout sur StakedVerificationMarket, conforme a spec-lot6.md. src/ non modifie.
/// @dev Cablage complet : Registry, Slashing, Rewards, marche cautionne. Precompile faux via vm.etch.
contract Phase2Test is Test {
    StakedVerificationMarket internal market;
    VerifierRegistry internal registry;
    Slashing internal slashing;
    Rewards internal rewards;

    address internal constant C0 = 0x70997970C51812dc3A010C7d01b50e0d17dc79C8;
    address internal constant C1 = 0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC;
    address internal constant C2 = 0x90F79bf6EB2c4f870365E785982E1f101E93b906;

    address internal constant REQUESTER = address(0xCAFE);
    address internal constant TREASURY = address(0x15EA50);

    uint256 internal constant MIN_STAKE = 100 ether;
    uint16 internal constant LOCK_BPS = 2000; // 20 %
    uint8 internal constant STRIKE_LIMIT = 3;
    uint256 internal constant EXCLUSION = 10;
    uint256 internal constant BONUS = 1 ether;

    uint256 internal constant FEE = 1 ether;
    uint64 internal constant COMMIT_WINDOW = 180;
    uint64 internal constant REVEAL_WINDOW = 60;
    uint64 internal constant CONTEST_WINDOW = 600;

    bytes3 internal constant EUR = bytes3("EUR");
    bytes32 internal constant BEN = keccak256("beneficiaire-ok");

    function setUp() public {
        vm.warp(1_000_000);

        registry = new VerifierRegistry(MIN_STAKE, LOCK_BPS, TREASURY);
        slashing = new Slashing(registry, STRIKE_LIMIT, EXCLUSION);
        rewards = new Rewards(TREASURY, BONUS);

        address[3] memory committee = [C0, C1, C2];
        market = new StakedVerificationMarket(
            committee,
            FEE,
            COMMIT_WINDOW,
            REVEAL_WINDOW,
            CONTEST_WINDOW,
            IVerifierRegistry(address(registry)),
            ISlashing(address(slashing)),
            rewards
        );

        // Cablage.
        registry.setMarket(address(market));
        registry.setSlashing(address(slashing));
        slashing.setMarket(address(market));
        rewards.setMarket(address(market));

        // Faux precompile pose et provisionne pour le bonus.
        MockNativeMinter minter = new MockNativeMinter();
        vm.etch(NATIVE_MINTER, address(minter).code);
        vm.deal(NATIVE_MINTER, 1000 ether);

        vm.deal(C0, 1000 ether);
        vm.deal(C1, 1000 ether);
        vm.deal(C2, 1000 ether);
        vm.deal(REQUESTER, 1000 ether);
    }

    // =====================================================================
    // Helpers
    // =====================================================================

    function _admitRegister(address v) internal {
        registry.admit(v);
        vm.prank(v);
        registry.register{value: MIN_STAKE}();
    }

    function _facts(uint256 amount, bytes32 beneficiary) internal pure returns (IVerificationMarket.Facts memory f) {
        f = IVerificationMarket.Facts({
            amount: amount, currency: EUR, beneficiaryId: beneficiary, referenceId: keccak256("ref")
        });
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

    // =====================================================================
    // 1. Bout en bout : 2 reveals, 1 absent, saisie auto, frais partages, contest, close, exit
    // =====================================================================

    // Variables de scenario partagees entre les etapes du bout en bout (evite le stack too deep).
    uint256 internal e2eId;
    IVerificationMarket.Facts internal e2eFacts;
    bytes32 internal e2eContentHash;

    function test_endToEnd() public {
        _admitRegister(C0);
        _admitRegister(C1);
        _admitRegister(C2);

        _e2eCreate();
        _e2eCommitReveal();
        _e2eFinalizeChecks();
        _e2eContest();
        _e2eCloseAndExit();
    }

    /// @notice Creation : faits avec plafond depasse (overCap), verrouille 20 % des 3 membres.
    function _e2eCreate() internal {
        slashing.setCap(EUR, 1000);
        e2eFacts = _facts(2000, BEN); // 2000 > cap -> overCap
        e2eContentHash = keccak256("contenu");
        bytes32 h = market.hashOf(e2eFacts, e2eContentHash);

        vm.prank(REQUESTER);
        e2eId = market.createRequest{value: FEE}(h);
        uint256 part = (MIN_STAKE * LOCK_BPS) / 10000; // 20 ether
        (, uint256 locked0) = registry.stakeOf(C0);
        assertEq(locked0, part);
    }

    /// @notice C0 et C1 commitent puis revelent, C2 absent (pas de commit).
    function _e2eCommitReveal() internal {
        uint256 id = e2eId;
        bytes32 s0 = keccak256("s0");
        bytes32 s1 = keccak256("s1");
        _commit(id, C0, IVerificationMarket.Code.Refuse, 1, s0); // Refuse + bit0 coherent (overCap)
        _commit(id, C1, IVerificationMarket.Code.Accept, 1, s1); // Accept fautif malgre overCap

        vm.warp(market.getRequest(id).commitDeadline);
        _reveal(id, C0, IVerificationMarket.Code.Refuse, 1, s0);
        _reveal(id, C1, IVerificationMarket.Code.Accept, 1, s1);

        vm.warp(market.getRequest(id).revealDeadline);
    }

    /// @notice Finalisation : saisie auto de C2 (1 %), frais partages, bonus frappe.
    function _e2eFinalizeChecks() internal {
        uint256 id = e2eId;
        (uint256 c2TotalBefore,) = registry.stakeOf(C2);
        market.finalize(id);

        uint256 oneP = (MIN_STAKE * 100) / 10000; // 1 %
        (uint256 c2TotalAfter,) = registry.stakeOf(C2);
        assertEq(c2TotalBefore - c2TotalAfter, oneP);
        assertEq(slashing.strikesOf(C2), 1);

        assertEq(rewards.claimable(C0), FEE / 2);
        assertEq(rewards.claimable(C1), FEE / 2);

        MockNativeMinter m = MockNativeMinter(payable(NATIVE_MINTER));
        assertEq(m.totalMintedTo(C0), BONUS);
        assertEq(m.totalMintedTo(C1), BONUS);
    }

    /// @notice Contestation reussie sur l'Accept fautif de C1 (20 %).
    function _e2eContest() internal {
        uint256 id = e2eId;
        uint256 twentyP = (MIN_STAKE * 2000) / 10000;
        (uint256 c1TotalBefore,) = registry.stakeOf(C1);
        bool upheld = slashing.contest(id, C1, e2eFacts, e2eContentHash);
        assertTrue(upheld);
        (uint256 c1TotalAfter,) = registry.stakeOf(C1);
        assertEq(c1TotalBefore - c1TotalAfter, twentyP);
    }

    /// @notice Close -> deverrouillage des 3 membres, exit de C0, retrait des frais par C1.
    function _e2eCloseAndExit() internal {
        uint256 id = e2eId;
        vm.warp(market.getRequest(id).contestDeadline);
        market.close(id);
        (, uint256 locked0After) = registry.stakeOf(C0);
        (, uint256 locked1After) = registry.stakeOf(C1);
        (, uint256 locked2After) = registry.stakeOf(C2);
        assertEq(locked0After, 0);
        assertEq(locked1After, 0);
        assertEq(locked2After, 0);

        vm.prank(C0);
        registry.exit();
        (uint256 c0Total,) = registry.stakeOf(C0);
        assertEq(c0Total, 0);

        uint256 balBefore = C1.balance;
        vm.prank(C1);
        rewards.claim();
        assertEq(C1.balance - balBefore, FEE / 2);
    }

    // =====================================================================
    // 2. Membre non inscrit : createRequest echoue (le lock remonte)
    // =====================================================================

    function test_createRequest_failsWhenMemberNotRegistered() public {
        // Seuls C0 et C1 inscrits ; C2 non inscrit -> inactif -> lockStake revert NotAdmitted.
        _admitRegister(C0);
        _admitRegister(C1);

        bytes32 h = keccak256("demande");
        vm.prank(REQUESTER);
        vm.expectRevert(abi.encodeWithSelector(IVerifierRegistry.NotAdmitted.selector, C2));
        market.createRequest{value: FEE}(h);
    }

    // =====================================================================
    // 3. Deuxieme mission : verrou cumule
    // =====================================================================

    function test_secondMission_cumulativeLock() public {
        _admitRegister(C0);
        _admitRegister(C1);
        _admitRegister(C2);

        bytes32 h1 = keccak256("d1");
        bytes32 h2 = keccak256("d2");
        vm.prank(REQUESTER);
        market.createRequest{value: FEE}(h1);
        vm.prank(REQUESTER);
        market.createRequest{value: FEE}(h2);

        uint256 part = (MIN_STAKE * LOCK_BPS) / 10000;
        (, uint256 locked0) = registry.stakeOf(C0);
        assertEq(locked0, 2 * part); // deux missions verrouillees en meme temps
    }
}
