// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {VerifierRegistry} from "../src/VerifierRegistry.sol";
import {IVerifierRegistry} from "../src/interfaces/IVerifierRegistry.sol";

/// @title Tests VerifierRegistry phase 2
/// @notice Suite forge-std conforme a spec-lot6.md. src/ non modifie.
/// @dev minStake = 100 VETO, lockBps = 2000 (20 % de la caution totale bloques par mission).
contract VerifierRegistryTest is Test {
    VerifierRegistry internal registry;

    address internal immutable ADMIN = address(this); // le deployeur
    address internal constant MARKET = address(0x1A2E7); // marche cable par setMarket
    address internal constant SLASHING = address(0x51A5); // Slashing cable par setSlashing
    address internal constant TREASURY = address(0x15EA50);

    address internal constant V1 = address(0xA11CE);
    address internal constant V2 = address(0xB0B);
    address internal constant V3 = address(0xC0FFEE);
    address internal constant OUTSIDER = address(0xBEEF);

    uint256 internal constant MIN_STAKE = 100 ether;
    uint16 internal constant LOCK_BPS = 2000; // 20 %

    // Re-declaration des evenements pour vm.expectEmit.
    event VerifierRegistered(address indexed verifier, uint256 stake);
    event VerifierExited(address indexed verifier, uint256 stakeReturned);
    event StakeLocked(address indexed verifier, uint256 indexed requestId, uint256 amount);
    event StakeUnlocked(address indexed verifier, uint256 indexed requestId, uint256 amount);
    event StakeSlashed(address indexed verifier, uint256 indexed requestId, uint256 amount);

    function setUp() public {
        registry = new VerifierRegistry(MIN_STAKE, LOCK_BPS, TREASURY);
        registry.setMarket(MARKET);
        registry.setSlashing(SLASHING);

        vm.deal(V1, 1000 ether);
        vm.deal(V2, 1000 ether);
        vm.deal(V3, 1000 ether);
        vm.deal(OUTSIDER, 1000 ether);
    }

    // =====================================================================
    // Helpers
    // =====================================================================

    function _admitAndRegister(address v, uint256 amount) internal {
        registry.admit(v);
        vm.prank(v);
        registry.register{value: amount}();
    }

    // =====================================================================
    // 1. Constructeur et reglages uniques
    // =====================================================================

    function test_constructor_storesValues() public view {
        assertEq(registry.admin(), ADMIN);
        assertEq(registry.minStakeAmount(), MIN_STAKE);
        assertEq(registry.minStake(), MIN_STAKE);
        assertEq(registry.lockBps(), LOCK_BPS);
        assertEq(registry.treasury(), TREASURY);
        assertEq(registry.market(), MARKET);
        assertEq(registry.slashing(), SLASHING);
    }

    function test_constructor_zeroTreasuryReverts() public {
        vm.expectRevert(VerifierRegistry.ZeroAddress.selector);
        new VerifierRegistry(MIN_STAKE, LOCK_BPS, address(0));
    }

    function test_setMarket_twiceReverts() public {
        vm.expectRevert(VerifierRegistry.AlreadySet.selector);
        registry.setMarket(address(0xDEAD));
    }

    function test_setMarket_zeroReverts() public {
        VerifierRegistry fresh = new VerifierRegistry(MIN_STAKE, LOCK_BPS, TREASURY);
        vm.expectRevert(VerifierRegistry.ZeroAddress.selector);
        fresh.setMarket(address(0));
    }

    function test_setMarket_onlyAdmin() public {
        VerifierRegistry fresh = new VerifierRegistry(MIN_STAKE, LOCK_BPS, TREASURY);
        vm.prank(OUTSIDER);
        vm.expectRevert(abi.encodeWithSelector(VerifierRegistry.OnlyAdmin.selector, OUTSIDER));
        fresh.setMarket(MARKET);
    }

    function test_setSlashing_twiceReverts() public {
        vm.expectRevert(VerifierRegistry.AlreadySet.selector);
        registry.setSlashing(address(0xDEAD));
    }

    function test_setSlashing_zeroReverts() public {
        VerifierRegistry fresh = new VerifierRegistry(MIN_STAKE, LOCK_BPS, TREASURY);
        vm.expectRevert(VerifierRegistry.ZeroAddress.selector);
        fresh.setSlashing(address(0));
    }

    function test_setSlashing_onlyAdmin() public {
        VerifierRegistry fresh = new VerifierRegistry(MIN_STAKE, LOCK_BPS, TREASURY);
        vm.prank(OUTSIDER);
        vm.expectRevert(abi.encodeWithSelector(VerifierRegistry.OnlyAdmin.selector, OUTSIDER));
        fresh.setSlashing(SLASHING);
    }

    // =====================================================================
    // 2. Admission (admin)
    // =====================================================================

    function test_admit_onlyAdmin() public {
        vm.prank(OUTSIDER);
        vm.expectRevert(abi.encodeWithSelector(VerifierRegistry.OnlyAdmin.selector, OUTSIDER));
        registry.admit(V1);
    }

    function test_admit_zeroReverts() public {
        vm.expectRevert(VerifierRegistry.ZeroAddress.selector);
        registry.admit(address(0));
    }

    function test_revoke_onlyAdmin() public {
        registry.admit(V1);
        vm.prank(OUTSIDER);
        vm.expectRevert(abi.encodeWithSelector(VerifierRegistry.OnlyAdmin.selector, OUTSIDER));
        registry.revoke(V1);
    }

    function test_revoke_setsInactive() public {
        _admitAndRegister(V1, MIN_STAKE);
        assertTrue(registry.isActive(V1));
        registry.revoke(V1);
        assertFalse(registry.isActive(V1));
    }

    // =====================================================================
    // 3. register
    // =====================================================================

    function test_register_notAdmittedReverts() public {
        vm.prank(OUTSIDER);
        vm.expectRevert(abi.encodeWithSelector(IVerifierRegistry.NotAdmitted.selector, OUTSIDER));
        registry.register{value: MIN_STAKE}();
    }

    function test_register_belowMinStakeReverts() public {
        registry.admit(V1);
        vm.prank(V1);
        vm.expectRevert(abi.encodeWithSelector(IVerifierRegistry.StakeTooLow.selector, MIN_STAKE - 1, MIN_STAKE));
        registry.register{value: MIN_STAKE - 1}();
    }

    function test_register_storesAndEmits() public {
        registry.admit(V1);
        vm.expectEmit(true, false, false, true);
        emit VerifierRegistered(V1, MIN_STAKE);
        vm.prank(V1);
        registry.register{value: MIN_STAKE}();

        (uint256 total, uint256 locked) = registry.stakeOf(V1);
        assertEq(total, MIN_STAKE);
        assertEq(locked, 0);
        assertTrue(registry.isActive(V1));
    }

    function test_register_topUpAllowed() public {
        _admitAndRegister(V1, MIN_STAKE);
        // Un rajout peut etre inferieur a minStake une fois inscrit.
        vm.prank(V1);
        registry.register{value: 10 ether}();
        (uint256 total,) = registry.stakeOf(V1);
        assertEq(total, MIN_STAKE + 10 ether);
    }

    function test_register_addedToActiveOnce() public {
        _admitAndRegister(V1, MIN_STAKE);
        vm.prank(V1);
        registry.register{value: 10 ether}();
        address[] memory active = registry.activeVerifiers();
        uint256 occurrences = 0;
        for (uint256 i = 0; i < active.length; i++) {
            if (active[i] == V1) occurrences++;
        }
        assertEq(occurrences, 1);
    }

    // =====================================================================
    // 4. Verrou de mission (marche)
    // =====================================================================

    function test_lockStake_onlyMarket() public {
        _admitAndRegister(V1, MIN_STAKE);
        vm.prank(OUTSIDER);
        vm.expectRevert(abi.encodeWithSelector(IVerifierRegistry.OnlyMarket.selector, OUTSIDER));
        registry.lockStake(V1, 1);
    }

    function test_lockStake_inactiveReverts() public {
        // Admis mais non inscrit : inactif.
        registry.admit(V1);
        vm.prank(MARKET);
        vm.expectRevert(abi.encodeWithSelector(IVerifierRegistry.NotAdmitted.selector, V1));
        registry.lockStake(V1, 1);
    }

    function test_lockStake_exactAmountAndEmits() public {
        _admitAndRegister(V1, MIN_STAKE);
        uint256 expected = (MIN_STAKE * LOCK_BPS) / 10000; // 20 ether
        vm.expectEmit(true, true, false, true);
        emit StakeLocked(V1, 1, expected);
        vm.prank(MARKET);
        registry.lockStake(V1, 1);
        (, uint256 locked) = registry.stakeOf(V1);
        assertEq(locked, expected);
        assertEq(registry.lockedFor(V1, 1), expected);
    }

    function test_lockStake_cumulativeTwoMissions() public {
        _admitAndRegister(V1, MIN_STAKE);
        uint256 part = (MIN_STAKE * LOCK_BPS) / 10000; // 20 %
        vm.startPrank(MARKET);
        registry.lockStake(V1, 1);
        registry.lockStake(V1, 2);
        vm.stopPrank();
        (, uint256 locked) = registry.stakeOf(V1);
        assertEq(locked, 2 * part);
        assertEq(registry.lockedFor(V1, 1), part);
        assertEq(registry.lockedFor(V1, 2), part);
    }

    function test_lockStake_insufficientFreeStake() public {
        // Caution tout juste suffisante pour 5 missions a 20 % ; la 6e manque de libre.
        _admitAndRegister(V1, MIN_STAKE);
        vm.startPrank(MARKET);
        for (uint256 id = 1; id <= 5; id++) {
            registry.lockStake(V1, id);
        }
        // 100 % bloque : plus de libre.
        vm.expectRevert(abi.encodeWithSelector(VerifierRegistry.InsufficientFreeStake.selector, V1));
        registry.lockStake(V1, 6);
        vm.stopPrank();
    }

    function test_unlockStake_onlyMarket() public {
        _admitAndRegister(V1, MIN_STAKE);
        vm.prank(MARKET);
        registry.lockStake(V1, 1);
        vm.prank(OUTSIDER);
        vm.expectRevert(abi.encodeWithSelector(IVerifierRegistry.OnlyMarket.selector, OUTSIDER));
        registry.unlockStake(V1, 1);
    }

    function test_unlockStake_releasesAndEmits() public {
        _admitAndRegister(V1, MIN_STAKE);
        uint256 part = (MIN_STAKE * LOCK_BPS) / 10000;
        vm.startPrank(MARKET);
        registry.lockStake(V1, 1);
        vm.expectEmit(true, true, false, true);
        emit StakeUnlocked(V1, 1, part);
        registry.unlockStake(V1, 1);
        vm.stopPrank();
        (, uint256 locked) = registry.stakeOf(V1);
        assertEq(locked, 0);
        assertEq(registry.lockedFor(V1, 1), 0);
    }

    function test_unlockStake_zeroAccepted() public {
        _admitAndRegister(V1, MIN_STAKE);
        // Aucune mission bloquee pour l'id 7 : unlock emet 0, sans revert.
        vm.expectEmit(true, true, false, true);
        emit StakeUnlocked(V1, 7, 0);
        vm.prank(MARKET);
        registry.unlockStake(V1, 7);
    }

    // =====================================================================
    // 5. Saisie (Slashing)
    // =====================================================================

    function test_slash_onlySlashing() public {
        _admitAndRegister(V1, MIN_STAKE);
        vm.prank(MARKET);
        registry.lockStake(V1, 1);
        vm.prank(OUTSIDER);
        vm.expectRevert(abi.encodeWithSelector(VerifierRegistry.OnlySlashing.selector, OUTSIDER));
        registry.slash(V1, 1);
    }

    function test_slash_seizesAllLockedToTreasury() public {
        _admitAndRegister(V1, MIN_STAKE);
        uint256 part = (MIN_STAKE * LOCK_BPS) / 10000; // 20 ether bloque
        vm.prank(MARKET);
        registry.lockStake(V1, 1);

        uint256 treasuryBefore = TREASURY.balance;
        vm.expectEmit(true, true, false, true);
        emit StakeSlashed(V1, 1, part);
        vm.prank(SLASHING);
        registry.slash(V1, 1);

        (uint256 total, uint256 locked) = registry.stakeOf(V1);
        assertEq(total, MIN_STAKE - part);
        assertEq(locked, 0);
        assertEq(registry.lockedFor(V1, 1), 0);
        assertEq(TREASURY.balance - treasuryBefore, part);
    }

    function test_seize_onlySlashing() public {
        _admitAndRegister(V1, MIN_STAKE);
        vm.prank(MARKET);
        registry.lockStake(V1, 1);
        vm.prank(OUTSIDER);
        vm.expectRevert(abi.encodeWithSelector(VerifierRegistry.OnlySlashing.selector, OUTSIDER));
        registry.seize(V1, 1, 100);
    }

    function test_seize_fractionOnePercent() public {
        _admitAndRegister(V1, MIN_STAKE);
        vm.prank(MARKET);
        registry.lockStake(V1, 1);
        uint256 expected = (MIN_STAKE * 100) / 10000; // 1 ether
        uint256 treasuryBefore = TREASURY.balance;
        vm.prank(SLASHING);
        uint256 seized = registry.seize(V1, 1, 100);
        assertEq(seized, expected);
        assertEq(TREASURY.balance - treasuryBefore, expected);
        (uint256 total,) = registry.stakeOf(V1);
        assertEq(total, MIN_STAKE - expected);
    }

    function test_seize_fractionFivePercent() public {
        _admitAndRegister(V1, MIN_STAKE);
        vm.prank(MARKET);
        registry.lockStake(V1, 1);
        uint256 expected = (MIN_STAKE * 500) / 10000; // 5 ether
        vm.prank(SLASHING);
        uint256 seized = registry.seize(V1, 1, 500);
        assertEq(seized, expected);
    }

    function test_seize_boundedByLocked() public {
        // bps vise 50 % de la caution totale, mais seuls 20 % sont bloques : saisie plafonnee au bloque.
        _admitAndRegister(V1, MIN_STAKE);
        uint256 part = (MIN_STAKE * LOCK_BPS) / 10000; // 20 ether bloque
        vm.prank(MARKET);
        registry.lockStake(V1, 1);
        vm.prank(SLASHING);
        uint256 seized = registry.seize(V1, 1, 5000); // 50 % voulu
        assertEq(seized, part); // plafonne au bloque
    }

    // =====================================================================
    // 6. exit et swap and pop
    // =====================================================================

    function test_exit_lockedReverts() public {
        _admitAndRegister(V1, MIN_STAKE);
        uint256 part = (MIN_STAKE * LOCK_BPS) / 10000;
        vm.prank(MARKET);
        registry.lockStake(V1, 1);
        vm.prank(V1);
        vm.expectRevert(abi.encodeWithSelector(IVerifierRegistry.StakeLockedInMission.selector, V1, part));
        registry.exit();
    }

    function test_exit_allowedAfterUnlock() public {
        _admitAndRegister(V1, MIN_STAKE);
        vm.prank(MARKET);
        registry.lockStake(V1, 1);
        vm.prank(MARKET);
        registry.unlockStake(V1, 1);

        uint256 balBefore = V1.balance;
        vm.expectEmit(true, false, false, true);
        emit VerifierExited(V1, MIN_STAKE);
        vm.prank(V1);
        registry.exit();

        assertEq(V1.balance - balBefore, MIN_STAKE);
        (uint256 total,) = registry.stakeOf(V1);
        assertEq(total, 0);
        assertFalse(registry.isActive(V1));
    }

    function test_exit_swapAndPop() public {
        _admitAndRegister(V1, MIN_STAKE);
        _admitAndRegister(V2, MIN_STAKE);
        _admitAndRegister(V3, MIN_STAKE);
        assertEq(registry.activeVerifiers().length, 3);

        // Sortie du milieu : V2 remplace par le dernier (V3), longueur 2, V2 absent.
        vm.prank(V2);
        registry.exit();

        address[] memory active = registry.activeVerifiers();
        assertEq(active.length, 2);
        bool v2Present = false;
        bool v1Present = false;
        bool v3Present = false;
        for (uint256 i = 0; i < active.length; i++) {
            if (active[i] == V1) v1Present = true;
            if (active[i] == V2) v2Present = true;
            if (active[i] == V3) v3Present = true;
        }
        assertFalse(v2Present);
        assertTrue(v1Present);
        assertTrue(v3Present);
    }

    // =====================================================================
    // 7. isActive
    // =====================================================================

    function test_isActive_falseWhenBelowMinStakeAfterSeize() public {
        // Caution a minStake pile ; une saisie la fait passer sous minStake : isActive devient faux.
        _admitAndRegister(V1, MIN_STAKE);
        vm.prank(MARKET);
        registry.lockStake(V1, 1);
        assertTrue(registry.isActive(V1));
        vm.prank(SLASHING);
        registry.seize(V1, 1, 100); // -1 ether : total 99 < 100
        assertFalse(registry.isActive(V1));
    }

    function test_isActive_falseWhenNotRegistered() public {
        registry.admit(V1);
        assertFalse(registry.isActive(V1));
    }

    function test_isActive_falseWhenNotAdmitted() public view {
        assertFalse(registry.isActive(OUTSIDER));
    }
}
