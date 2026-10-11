// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {Rewards} from "../src/Rewards.sol";
import {MockNativeMinter} from "./mocks/MockNativeMinter.sol";
import {NATIVE_MINTER} from "../src/precompiles/INativeMinter.sol";

/// @title Tests Rewards phase 2
/// @notice Suite forge-std conforme a spec-lot6.md. src/ non modifie.
/// @dev Le precompile NativeMinter est remplace par un faux via vm.etch ; sa provision VETO vient
///      de vm.deal. Le contrat de test joue le role du marche (setMarket(address(this))).
contract RewardsTest is Test {
    Rewards internal rewards;
    MockNativeMinter internal minter;

    address internal constant TREASURY = address(0x15EA50);
    address internal constant R1 = address(0xA11CE);
    address internal constant R2 = address(0xB0B);
    address internal constant R3 = address(0xC0FFEE);
    address internal constant OUTSIDER = address(0xBEEF);

    uint256 internal constant BONUS = 1 ether;

    event RewardsDistributed(uint256 indexed requestId, uint256 share, uint256 count);
    event Claimed(address indexed account, uint256 amount);

    function setUp() public {
        rewards = new Rewards(TREASURY, BONUS);
        rewards.setMarket(address(this)); // le test joue le marche

        // Faux precompile pose a l'adresse canonique, provisionne pour le bonus.
        minter = new MockNativeMinter();
        vm.etch(NATIVE_MINTER, address(minter).code);
        vm.deal(NATIVE_MINTER, 1000 ether);

        vm.deal(address(this), 1000 ether);
        vm.deal(OUTSIDER, 1000 ether);
    }

    // =====================================================================
    // 1. Constructeur et reglage unique
    // =====================================================================

    function test_constructor_storesValues() public view {
        assertEq(rewards.admin(), address(this));
        assertEq(rewards.treasury(), TREASURY);
        assertEq(rewards.bonus(), BONUS);
        assertEq(rewards.market(), address(this));
    }

    function test_constructor_zeroTreasuryReverts() public {
        vm.expectRevert(Rewards.ZeroAddress.selector);
        new Rewards(address(0), BONUS);
    }

    function test_setMarket_twiceReverts() public {
        vm.expectRevert(Rewards.AlreadySet.selector);
        rewards.setMarket(address(0xDEAD));
    }

    function test_setMarket_onlyAdmin() public {
        Rewards fresh = new Rewards(TREASURY, BONUS);
        vm.prank(OUTSIDER);
        vm.expectRevert(abi.encodeWithSelector(Rewards.OnlyAdmin.selector, OUTSIDER));
        fresh.setMarket(address(this));
    }

    // =====================================================================
    // 2. distribute : acces reserve
    // =====================================================================

    function test_distribute_onlyMarket() public {
        address[] memory revealers = new address[](1);
        revealers[0] = R1;
        vm.prank(OUTSIDER);
        vm.expectRevert(abi.encodeWithSelector(Rewards.OnlyMarket.selector, OUTSIDER));
        rewards.distribute{value: 1 ether}(1, revealers);
    }

    // =====================================================================
    // 3. distribute : partage et reste
    // =====================================================================

    function test_distribute_equalShares() public {
        address[] memory revealers = new address[](2);
        revealers[0] = R1;
        revealers[1] = R2;
        uint256 fee = 10 ether; // divisible par 2
        vm.expectEmit(true, false, false, true);
        emit RewardsDistributed(1, 5 ether, 2);
        rewards.distribute{value: fee}(1, revealers);

        assertEq(rewards.claimable(R1), 5 ether);
        assertEq(rewards.claimable(R2), 5 ether);
        assertEq(rewards.claimable(TREASURY), 0);
    }

    function test_distribute_remainderToTreasury() public {
        address[] memory revealers = new address[](3);
        revealers[0] = R1;
        revealers[1] = R2;
        revealers[2] = R3;
        uint256 fee = 10 ether; // 10 / 3 = 3.333..., reste 1 wei de 10 ether % 3
        uint256 share = fee / 3;
        uint256 remainder = fee - share * 3;
        rewards.distribute{value: fee}(1, revealers);

        assertEq(rewards.claimable(R1), share);
        assertEq(rewards.claimable(R2), share);
        assertEq(rewards.claimable(R3), share);
        assertEq(rewards.claimable(TREASURY), remainder);
    }

    function test_distribute_zeroRevealersAllToTreasury() public {
        address[] memory revealers = new address[](0);
        uint256 fee = 7 ether;
        vm.expectEmit(true, false, false, true);
        emit RewardsDistributed(1, 0, 0);
        rewards.distribute{value: fee}(1, revealers);

        assertEq(rewards.claimable(TREASURY), fee);
    }

    // =====================================================================
    // 4. distribute : bonus frappe
    // =====================================================================

    function test_distribute_bonusMinted() public {
        address[] memory revealers = new address[](2);
        revealers[0] = R1;
        revealers[1] = R2;
        rewards.distribute{value: 4 ether}(1, revealers);

        // Le faux minteur a bien ete appele une fois par reveal, montant = bonus.
        MockNativeMinter m = MockNativeMinter(payable(NATIVE_MINTER));
        assertEq(m.mintedCount(), 2);
        assertEq(m.totalMintedTo(R1), BONUS);
        assertEq(m.totalMintedTo(R2), BONUS);
    }

    function test_distribute_noBonusWhenZero() public {
        Rewards noBonus = new Rewards(TREASURY, 0);
        noBonus.setMarket(address(this));
        address[] memory revealers = new address[](1);
        revealers[0] = R1;
        noBonus.distribute{value: 2 ether}(1, revealers);

        MockNativeMinter m = MockNativeMinter(payable(NATIVE_MINTER));
        assertEq(m.mintedCount(), 0); // aucune frappe
    }

    function test_distribute_zeroRevealersNoBonus() public {
        address[] memory revealers = new address[](0);
        rewards.distribute{value: 3 ether}(1, revealers);
        MockNativeMinter m = MockNativeMinter(payable(NATIVE_MINTER));
        assertEq(m.mintedCount(), 0);
    }

    // =====================================================================
    // 5. claim (pull)
    // =====================================================================

    function test_claim_transfersAndEmits() public {
        address[] memory revealers = new address[](1);
        revealers[0] = R1;
        rewards.distribute{value: 6 ether}(1, revealers);
        assertEq(rewards.claimable(R1), 6 ether);

        uint256 balBefore = R1.balance;
        vm.expectEmit(true, false, false, true);
        emit Claimed(R1, 6 ether);
        vm.prank(R1);
        rewards.claim();

        assertEq(R1.balance - balBefore, 6 ether);
        assertEq(rewards.claimable(R1), 0);
    }

    function test_claim_nothingToClaimReverts() public {
        vm.prank(OUTSIDER);
        vm.expectRevert(Rewards.NothingToClaim.selector);
        rewards.claim();
    }

    function test_claim_twiceSecondReverts() public {
        address[] memory revealers = new address[](1);
        revealers[0] = R1;
        rewards.distribute{value: 6 ether}(1, revealers);
        vm.prank(R1);
        rewards.claim();
        vm.prank(R1);
        vm.expectRevert(Rewards.NothingToClaim.selector);
        rewards.claim();
    }

    function test_claim_treasuryShare() public {
        address[] memory revealers = new address[](0);
        rewards.distribute{value: 5 ether}(1, revealers);
        uint256 balBefore = TREASURY.balance;
        vm.prank(TREASURY);
        rewards.claim();
        assertEq(TREASURY.balance - balBefore, 5 ether);
    }
}
