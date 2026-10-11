// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {VetoDesk} from "../src/VetoDesk.sol";
import {MockNativeMinter} from "./mocks/MockNativeMinter.sol";
import {NATIVE_MINTER} from "../src/precompiles/INativeMinter.sol";

/// @title Tests VetoDesk phase 2
/// @notice Suite forge-std conforme a spec-lot6.md. src/ non modifie.
/// @dev Precompile NativeMinter remplace par un faux via vm.etch, provisionne par vm.deal.
contract VetoDeskTest is Test {
    VetoDesk internal desk;

    address internal constant OPERATOR = address(0x09E7A);
    address internal constant CLIENT = address(0xC11E27);
    address internal constant OUTSIDER = address(0xBEEF);

    bytes32 internal constant REF = keccak256("paiement-1");

    event Credited(address indexed client, uint256 amount, bytes32 indexed paymentRef);
    event OperatorSet(address indexed operator, bool allowed);

    function setUp() public {
        desk = new VetoDesk(); // admin = address(this), operateur par defaut

        MockNativeMinter minter = new MockNativeMinter();
        vm.etch(NATIVE_MINTER, address(minter).code);
        vm.deal(NATIVE_MINTER, 1000 ether);
    }

    function _mock() internal pure returns (MockNativeMinter) {
        return MockNativeMinter(payable(NATIVE_MINTER));
    }

    // =====================================================================
    // 1. Constructeur
    // =====================================================================

    function test_constructor_adminIsOperator() public view {
        assertEq(desk.admin(), address(this));
        assertTrue(desk.isOperator(address(this)));
    }

    // =====================================================================
    // 2. setOperator
    // =====================================================================

    function test_setOperator_onlyAdmin() public {
        vm.prank(OUTSIDER);
        vm.expectRevert(abi.encodeWithSelector(VetoDesk.OnlyAdmin.selector, OUTSIDER));
        desk.setOperator(OPERATOR, true);
    }

    function test_setOperator_zeroReverts() public {
        vm.expectRevert(VetoDesk.ZeroAddress.selector);
        desk.setOperator(address(0), true);
    }

    function test_setOperator_addsAndEmits() public {
        vm.expectEmit(true, false, false, true);
        emit OperatorSet(OPERATOR, true);
        desk.setOperator(OPERATOR, true);
        assertTrue(desk.isOperator(OPERATOR));
    }

    function test_setOperator_removes() public {
        desk.setOperator(OPERATOR, true);
        desk.setOperator(OPERATOR, false);
        assertFalse(desk.isOperator(OPERATOR));
    }

    // =====================================================================
    // 3. credit
    // =====================================================================

    function test_credit_notOperatorReverts() public {
        vm.prank(OUTSIDER);
        vm.expectRevert(abi.encodeWithSelector(VetoDesk.OnlyOperator.selector, OUTSIDER));
        desk.credit(CLIENT, 10 ether, REF);
    }

    function test_credit_zeroClientReverts() public {
        vm.expectRevert(VetoDesk.ZeroAddress.selector);
        desk.credit(address(0), 10 ether, REF);
    }

    function test_credit_zeroAmountReverts() public {
        vm.expectRevert(VetoDesk.ZeroAmount.selector);
        desk.credit(CLIENT, 0, REF);
    }

    function test_credit_mintsAndEmits() public {
        vm.expectEmit(true, true, false, true);
        emit Credited(CLIENT, 10 ether, REF);
        desk.credit(CLIENT, 10 ether, REF);

        assertTrue(desk.credited(REF));
        assertEq(_mock().totalMintedTo(CLIENT), 10 ether);
        assertEq(CLIENT.balance, 10 ether); // le faux minteur transfere reellement
    }

    function test_credit_byAddedOperator() public {
        desk.setOperator(OPERATOR, true);
        vm.prank(OPERATOR);
        desk.credit(CLIENT, 5 ether, REF);
        assertEq(_mock().totalMintedTo(CLIENT), 5 ether);
    }

    function test_credit_replayedRefReverts() public {
        desk.credit(CLIENT, 10 ether, REF);
        vm.expectRevert(abi.encodeWithSelector(VetoDesk.PaymentAlreadyCredited.selector, REF));
        desk.credit(CLIENT, 20 ether, REF);
    }

    function test_credit_differentRefsAccepted() public {
        desk.credit(CLIENT, 10 ether, keccak256("ref-a"));
        desk.credit(CLIENT, 20 ether, keccak256("ref-b"));
        assertEq(_mock().totalMintedTo(CLIENT), 30 ether);
    }
}
