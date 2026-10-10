// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {AgentIdentityRegistry} from "../../src/erc8004/AgentIdentityRegistry.sol";

/// @title Tests AgentIdentityRegistry (lot 7b)
/// @notice Suite forge-std conforme a spec-lot7.md partie 7b : enregistrement, identite unique,
///         non-transferabilite, cle `agentWallet` reservee, URI et metadonnees, lecture ERC-721.
/// @dev src/ non modifie. Chaque evenement du standard est verifie par vm.expectEmit.
contract AgentIdentityRegistryTest is Test {
    AgentIdentityRegistry internal reg;

    address internal constant ALICE = address(0xA11CE);
    address internal constant BOB = address(0xB0B);

    // Re-declaration des evenements pour vm.expectEmit.
    event Transfer(address indexed from, address indexed to, uint256 indexed tokenId);
    event Registered(uint256 indexed agentId, string agentURI, address indexed owner);
    event MetadataSet(uint256 indexed agentId, string key, string value);
    event URIUpdated(uint256 indexed agentId, string newURI);

    function setUp() public {
        reg = new AgentIdentityRegistry();
    }

    // =====================================================================
    // 1. Enregistrement
    // =====================================================================

    /// @notice register(uri) : agentId = 1, puis 2 ; emet Transfer, Registered, MetadataSet(agentWallet).
    function test_register_withURI_emitsAllEvents() public {
        string memory uri = "ipfs://alice";
        // L'ordre d'emission est Transfer, Registered, MetadataSet.
        vm.expectEmit(true, true, true, true);
        emit Transfer(address(0), ALICE, 1);
        vm.expectEmit(true, true, false, true);
        emit Registered(1, uri, ALICE);
        vm.expectEmit(true, false, false, true);
        emit MetadataSet(1, "agentWallet", _hex(ALICE));

        vm.prank(ALICE);
        uint256 id = reg.register(uri);

        assertEq(id, 1);
        assertEq(reg.lastAgentId(), 1);
        assertEq(reg.ownerOf(1), ALICE);
        assertEq(reg.agentIdOf(ALICE), 1);
        assertEq(reg.tokenURI(1), uri);
    }

    /// @notice register() sans URI : agentId croissant, tokenURI vide.
    function test_register_noURI_incrementsId() public {
        vm.prank(ALICE);
        uint256 a = reg.register();
        vm.prank(BOB);
        uint256 b = reg.register();
        assertEq(a, 1);
        assertEq(b, 2);
        assertEq(reg.tokenURI(1), "");
        assertEq(reg.agentIdOf(BOB), 2);
    }

    /// @notice Une seule identite par adresse : AlreadyRegistered au second register.
    function test_register_revertsAlreadyRegistered() public {
        vm.prank(ALICE);
        reg.register();
        vm.prank(ALICE);
        vm.expectRevert(abi.encodeWithSelector(AgentIdentityRegistry.AlreadyRegistered.selector, ALICE));
        reg.register();
    }

    /// @notice agentIdOf d'une adresse jamais enregistree : 0.
    function test_agentIdOf_zeroWhenNone() public view {
        assertEq(reg.agentIdOf(BOB), 0);
    }

    // =====================================================================
    // 2. URI : setAgentURI
    // =====================================================================

    /// @notice setAgentURI par le proprietaire : URIUpdated, tokenURI mis a jour.
    function test_setAgentURI_ownerEmitsAndUpdates() public {
        vm.prank(ALICE);
        reg.register("old");
        vm.expectEmit(true, false, false, true);
        emit URIUpdated(1, "new");
        vm.prank(ALICE);
        reg.setAgentURI(1, "new");
        assertEq(reg.tokenURI(1), "new");
    }

    /// @notice setAgentURI par un tiers : NotAgentOwner.
    function test_setAgentURI_revertsNotOwner() public {
        vm.prank(ALICE);
        reg.register("old");
        vm.prank(BOB);
        vm.expectRevert(abi.encodeWithSelector(AgentIdentityRegistry.NotAgentOwner.selector, uint256(1), BOB));
        reg.setAgentURI(1, "new");
    }

    /// @notice setAgentURI sur un agent inexistant : UnknownAgent.
    function test_setAgentURI_revertsUnknownAgent() public {
        vm.prank(ALICE);
        vm.expectRevert(abi.encodeWithSelector(AgentIdentityRegistry.UnknownAgent.selector, uint256(42)));
        reg.setAgentURI(42, "x");
    }

    // =====================================================================
    // 3. Metadonnees et cle reservee
    // =====================================================================

    /// @notice setMetadata libre par le proprietaire : MetadataSet, getMetadata rend la valeur.
    function test_setMetadata_ownerEmitsAndReads() public {
        vm.prank(ALICE);
        reg.register();
        vm.expectEmit(true, false, false, true);
        emit MetadataSet(1, "name", "Alice");
        vm.prank(ALICE);
        reg.setMetadata(1, "name", "Alice");
        assertEq(reg.getMetadata(1, "name"), "Alice");
    }

    /// @notice setMetadata avec la cle reservee `agentWallet` : ReservedKey.
    function test_setMetadata_revertsReservedKey() public {
        vm.prank(ALICE);
        reg.register();
        vm.prank(ALICE);
        vm.expectRevert(AgentIdentityRegistry.ReservedKey.selector);
        reg.setMetadata(1, "agentWallet", "0xdead");
    }

    /// @notice setMetadata par un tiers : NotAgentOwner.
    function test_setMetadata_revertsNotOwner() public {
        vm.prank(ALICE);
        reg.register();
        vm.prank(BOB);
        vm.expectRevert(abi.encodeWithSelector(AgentIdentityRegistry.NotAgentOwner.selector, uint256(1), BOB));
        reg.setMetadata(1, "name", "x");
    }

    /// @notice getMetadata de la cle reservee rend l'adresse du proprietaire en hexadecimal.
    function test_getMetadata_reservedKeyReturnsOwnerHex() public {
        vm.prank(ALICE);
        reg.register();
        assertEq(reg.getMetadata(1, "agentWallet"), _hex(ALICE));
    }

    /// @notice getMetadata sur un agent inexistant : UnknownAgent.
    function test_getMetadata_revertsUnknownAgent() public {
        vm.expectRevert(abi.encodeWithSelector(AgentIdentityRegistry.UnknownAgent.selector, uint256(1)));
        reg.getMetadata(1, "name");
    }

    /// @notice getAgentWallet rend le proprietaire ; UnknownAgent si inexistant.
    function test_getAgentWallet() public {
        vm.prank(ALICE);
        reg.register();
        assertEq(reg.getAgentWallet(1), ALICE);
        vm.expectRevert(abi.encodeWithSelector(AgentIdentityRegistry.UnknownAgent.selector, uint256(2)));
        reg.getAgentWallet(2);
    }

    // =====================================================================
    // 4. Lecture ERC-721 minimale
    // =====================================================================

    /// @notice ownerOf d'un agent inexistant : UnknownAgent.
    function test_ownerOf_revertsUnknownAgent() public {
        vm.expectRevert(abi.encodeWithSelector(AgentIdentityRegistry.UnknownAgent.selector, uint256(1)));
        reg.ownerOf(1);
    }

    /// @notice balanceOf : 1 une fois enregistre, 0 sinon, ZeroAddress sur l'adresse nulle.
    function test_balanceOf() public {
        assertEq(reg.balanceOf(ALICE), 0);
        vm.prank(ALICE);
        reg.register();
        assertEq(reg.balanceOf(ALICE), 1);
        vm.expectRevert(AgentIdentityRegistry.ZeroAddress.selector);
        reg.balanceOf(address(0));
    }

    /// @notice tokenURI sur un agent inexistant : UnknownAgent.
    function test_tokenURI_revertsUnknownAgent() public {
        vm.expectRevert(abi.encodeWithSelector(AgentIdentityRegistry.UnknownAgent.selector, uint256(1)));
        reg.tokenURI(1);
    }

    // =====================================================================
    // 5. Non-transferabilite
    // =====================================================================

    function test_transferFrom_reverts() public {
        vm.prank(ALICE);
        reg.register();
        vm.expectRevert(AgentIdentityRegistry.NonTransferable.selector);
        vm.prank(ALICE);
        reg.transferFrom(ALICE, BOB, 1);
    }

    function test_safeTransferFrom_reverts() public {
        vm.prank(ALICE);
        reg.register();
        vm.expectRevert(AgentIdentityRegistry.NonTransferable.selector);
        vm.prank(ALICE);
        reg.safeTransferFrom(ALICE, BOB, 1);
    }

    function test_safeTransferFromData_reverts() public {
        vm.prank(ALICE);
        reg.register();
        vm.expectRevert(AgentIdentityRegistry.NonTransferable.selector);
        vm.prank(ALICE);
        reg.safeTransferFrom(ALICE, BOB, 1, "");
    }

    function test_approve_reverts() public {
        vm.expectRevert(AgentIdentityRegistry.NonTransferable.selector);
        reg.approve(BOB, 1);
    }

    function test_setApprovalForAll_reverts() public {
        vm.expectRevert(AgentIdentityRegistry.NonTransferable.selector);
        reg.setApprovalForAll(BOB, true);
    }

    // =====================================================================
    // Helper : adresse en hexadecimal minuscule "0x...", comme le contrat.
    // =====================================================================

    function _hex(address account) internal pure returns (string memory) {
        bytes16 hexDigits = "0123456789abcdef";
        bytes20 value = bytes20(account);
        bytes memory out = new bytes(42);
        out[0] = "0";
        out[1] = "x";
        for (uint256 i = 0; i < 20; i++) {
            out[2 + i * 2] = hexDigits[uint8(value[i]) >> 4];
            out[3 + i * 2] = hexDigits[uint8(value[i]) & 0x0f];
        }
        return string(out);
    }
}
