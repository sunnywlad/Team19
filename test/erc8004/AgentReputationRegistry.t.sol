// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {AgentIdentityRegistry} from "../../src/erc8004/AgentIdentityRegistry.sol";
import {AgentReputationRegistry} from "../../src/erc8004/AgentReputationRegistry.sol";

/// @title Tests AgentReputationRegistry (lot 7b)
/// @notice Suite forge-std conforme a spec-lot7.md partie 7b : initialisation unique, depot et revocation,
///         lecture, getSummary avec filtres de tags et prise en compte de la revocation.
/// @dev src/ non modifie. L'evenement NewFeedback du standard est verifie par vm.expectEmit.
contract AgentReputationRegistryTest is Test {
    AgentIdentityRegistry internal identity;
    AgentReputationRegistry internal rep;

    address internal constant AGENT = address(0xA6E7);
    address internal constant C1 = address(0xC1);
    address internal constant C2 = address(0xC2);

    uint256 internal agentId;

    event NewFeedback(
        uint256 indexed agentId, address indexed client, uint256 index, AgentReputationRegistry.FeedbackData data
    );
    event FeedbackRevoked(uint256 indexed agentId, address indexed client, uint256 index);

    function setUp() public {
        identity = new AgentIdentityRegistry();
        rep = new AgentReputationRegistry();
        rep.initialize(address(identity));

        vm.prank(AGENT);
        agentId = identity.register();
    }

    /// @notice Construit une FeedbackData, tags libres, reste a vide.
    function _data(int128 value, uint8 dec, string memory tag1, string memory tag2)
        internal
        pure
        returns (AgentReputationRegistry.FeedbackData memory)
    {
        return AgentReputationRegistry.FeedbackData({
            value: value,
            valueDecimals: dec,
            tag1: tag1,
            tag2: tag2,
            endpoint: "",
            feedbackURI: "",
            feedbackHash: bytes32(0)
        });
    }

    // =====================================================================
    // 1. Initialisation
    // =====================================================================

    function test_initialize_setsRegistry() public view {
        assertEq(rep.getIdentityRegistry(), address(identity));
    }

    function test_initialize_revertsSecondTime() public {
        vm.expectRevert(AgentReputationRegistry.AlreadyInitialized.selector);
        rep.initialize(address(identity));
    }

    function test_initialize_revertsZeroAddress() public {
        AgentReputationRegistry fresh = new AgentReputationRegistry();
        vm.expectRevert(AgentReputationRegistry.ZeroAddress.selector);
        fresh.initialize(address(0));
    }

    // =====================================================================
    // 2. giveFeedback : succes, evenement, erreurs
    // =====================================================================

    /// @notice giveFeedback emet NewFeedback (index 1), stocke, met a jour clients et lastIndex.
    function test_giveFeedback_emitsAndStores() public {
        AgentReputationRegistry.FeedbackData memory d = _data(5, 0, "reveal", "");
        vm.expectEmit(true, true, false, true);
        emit NewFeedback(agentId, C1, 1, d);

        vm.prank(C1);
        uint256 idx = rep.giveFeedback(agentId, d);
        assertEq(idx, 1);
        assertEq(rep.getLastIndex(agentId, C1), 1);

        (int128 value, uint8 dec, bool revoked, string memory tag1, string memory tag2) =
            rep.readFeedback(agentId, C1, 1);
        assertEq(value, 5);
        assertEq(dec, 0);
        assertFalse(revoked);
        assertEq(tag1, "reveal");
        assertEq(tag2, "");

        address[] memory clients = rep.getClients(agentId);
        assertEq(clients.length, 1);
        assertEq(clients[0], C1);
    }

    /// @notice Second retour du meme client : index 2, pas de doublon dans getClients.
    function test_giveFeedback_secondIndexSameClient() public {
        vm.startPrank(C1);
        rep.giveFeedback(agentId, _data(1, 0, "", ""));
        uint256 idx2 = rep.giveFeedback(agentId, _data(2, 0, "", ""));
        vm.stopPrank();
        assertEq(idx2, 2);
        assertEq(rep.getClients(agentId).length, 1);
    }

    /// @notice Agent inexistant : UnknownAgent (via getAgentWallet du registre d'identite).
    function test_giveFeedback_revertsUnknownAgent() public {
        vm.prank(C1);
        vm.expectRevert(abi.encodeWithSelector(AgentIdentityRegistry.UnknownAgent.selector, uint256(999)));
        rep.giveFeedback(999, _data(1, 0, "", ""));
    }

    /// @notice valueDecimals > 18 : DecimalsTooLarge.
    function test_giveFeedback_revertsDecimalsTooLarge() public {
        vm.prank(C1);
        vm.expectRevert(abi.encodeWithSelector(AgentReputationRegistry.DecimalsTooLarge.selector, uint8(19)));
        rep.giveFeedback(agentId, _data(1, 19, "", ""));
    }

    /// @notice Le proprietaire de l'agent ne peut pas se noter : SelfFeedback.
    function test_giveFeedback_revertsSelfFeedback() public {
        vm.prank(AGENT);
        vm.expectRevert(abi.encodeWithSelector(AgentReputationRegistry.SelfFeedback.selector, agentId));
        rep.giveFeedback(agentId, _data(1, 0, "", ""));
    }

    // =====================================================================
    // 3. revokeFeedback
    // =====================================================================

    /// @notice revokeFeedback par l'auteur : FeedbackRevoked, isRevoked vrai.
    function test_revokeFeedback_emitsAndMarks() public {
        vm.prank(C1);
        rep.giveFeedback(agentId, _data(3, 0, "", ""));
        vm.expectEmit(true, true, false, true);
        emit FeedbackRevoked(agentId, C1, 1);
        vm.prank(C1);
        rep.revokeFeedback(agentId, 1);
        (,, bool revoked,,) = rep.readFeedback(agentId, C1, 1);
        assertTrue(revoked);
    }

    /// @notice revokeFeedback d'un index inexistant : UnknownFeedback.
    function test_revokeFeedback_revertsUnknownIndex() public {
        vm.prank(C1);
        vm.expectRevert(abi.encodeWithSelector(AgentReputationRegistry.UnknownFeedback.selector, agentId, C1, uint256(1)));
        rep.revokeFeedback(agentId, 1);
    }

    // =====================================================================
    // 4. readFeedback / getLastIndex bords
    // =====================================================================

    function test_readFeedback_revertsUnknownIndex() public {
        vm.expectRevert(abi.encodeWithSelector(AgentReputationRegistry.UnknownFeedback.selector, agentId, C1, uint256(0)));
        rep.readFeedback(agentId, C1, 0);
    }

    function test_getLastIndex_zeroWhenNone() public view {
        assertEq(rep.getLastIndex(agentId, C1), 0);
    }

    // =====================================================================
    // 5. getSummary : vide, agregation, filtres de tags, revocation, decimale ignoree
    // =====================================================================

    /// @notice getSummary avec liste de clients vide : NoClients.
    function test_getSummary_revertsNoClients() public {
        address[] memory empty = new address[](0);
        vm.expectRevert(AgentReputationRegistry.NoClients.selector);
        rep.getSummary(agentId, empty, "", "");
    }

    /// @notice Agregation simple sur deux clients, sans filtre : count et somme corrects, decimale 0.
    function test_getSummary_aggregatesNoFilter() public {
        vm.prank(C1);
        rep.giveFeedback(agentId, _data(4, 0, "a", "x"));
        vm.prank(C2);
        rep.giveFeedback(agentId, _data(6, 0, "b", "y"));

        address[] memory clients = new address[](2);
        clients[0] = C1;
        clients[1] = C2;
        (uint64 count, int256 sum, uint8 dec) = rep.getSummary(agentId, clients, "", "");
        assertEq(count, 2);
        assertEq(sum, 10);
        assertEq(dec, 0);
    }

    /// @notice Filtre tag1 : seuls les retours de tag1 correspondant sont comptes.
    function test_getSummary_filtersTag1() public {
        vm.startPrank(C1);
        rep.giveFeedback(agentId, _data(4, 0, "reveal", ""));
        rep.giveFeedback(agentId, _data(7, 0, "other", ""));
        vm.stopPrank();

        address[] memory clients = new address[](1);
        clients[0] = C1;
        (uint64 count, int256 sum,) = rep.getSummary(agentId, clients, "reveal", "");
        assertEq(count, 1);
        assertEq(sum, 4);
    }

    /// @notice Filtre tag2 combine au tag1 : les deux doivent correspondre.
    function test_getSummary_filtersTag1AndTag2() public {
        vm.startPrank(C1);
        rep.giveFeedback(agentId, _data(4, 0, "reveal", "ok"));
        rep.giveFeedback(agentId, _data(7, 0, "reveal", "ko"));
        vm.stopPrank();

        address[] memory clients = new address[](1);
        clients[0] = C1;
        (uint64 count, int256 sum,) = rep.getSummary(agentId, clients, "reveal", "ok");
        assertEq(count, 1);
        assertEq(sum, 4);
    }

    /// @notice Un retour revoque est exclu de l'agregation.
    function test_getSummary_excludesRevoked() public {
        vm.startPrank(C1);
        rep.giveFeedback(agentId, _data(4, 0, "", ""));
        rep.giveFeedback(agentId, _data(6, 0, "", ""));
        rep.revokeFeedback(agentId, 1);
        vm.stopPrank();

        address[] memory clients = new address[](1);
        clients[0] = C1;
        (uint64 count, int256 sum,) = rep.getSummary(agentId, clients, "", "");
        assertEq(count, 1);
        assertEq(sum, 6);
    }

    /// @notice Les valeurs a decimale non nulle sont ignorees (adaptation).
    function test_getSummary_ignoresNonZeroDecimals() public {
        vm.startPrank(C1);
        rep.giveFeedback(agentId, _data(4, 0, "", ""));
        rep.giveFeedback(agentId, _data(100, 2, "", ""));
        vm.stopPrank();

        address[] memory clients = new address[](1);
        clients[0] = C1;
        (uint64 count, int256 sum,) = rep.getSummary(agentId, clients, "", "");
        assertEq(count, 1);
        assertEq(sum, 4);
    }

    /// @notice Valeurs negatives agregees correctement (int128).
    function test_getSummary_negativeValues() public {
        vm.prank(C1);
        rep.giveFeedback(agentId, _data(5, 0, "", ""));
        vm.prank(C2);
        rep.giveFeedback(agentId, _data(-3, 0, "", ""));

        address[] memory clients = new address[](2);
        clients[0] = C1;
        clients[1] = C2;
        (uint64 count, int256 sum,) = rep.getSummary(agentId, clients, "", "");
        assertEq(count, 2);
        assertEq(sum, 2);
    }
}
