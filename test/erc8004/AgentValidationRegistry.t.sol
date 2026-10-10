// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {AgentIdentityRegistry} from "../../src/erc8004/AgentIdentityRegistry.sol";
import {AgentValidationRegistry} from "../../src/erc8004/AgentValidationRegistry.sol";

/// @title Tests AgentValidationRegistry (lot 7b)
/// @notice Suite forge-std conforme a spec-lot7.md partie 7b : demande (proprietaire seul, hash unique),
///         reponse (validateur designe seul, response <= 100), lecture, getSummary (moyenne entiere).
/// @dev src/ non modifie. Les evenements du standard sont verifies par vm.expectEmit.
contract AgentValidationRegistryTest is Test {
    AgentIdentityRegistry internal identity;
    AgentValidationRegistry internal val;

    address internal constant AGENT = address(0xA6E7);
    address internal constant VALIDATOR = address(0x7A11D);
    address internal constant OTHER = address(0x07E42);

    uint256 internal agentId;
    bytes32 internal constant RH = keccak256("request-1");

    event ValidationRequest(
        bytes32 indexed requestHash, address indexed validatorAddress, uint256 indexed agentId, string requestURI
    );
    event ValidationResponse(
        bytes32 indexed requestHash,
        address indexed validatorAddress,
        uint8 response,
        string responseURI,
        bytes32 responseHash,
        string tag
    );

    function setUp() public {
        identity = new AgentIdentityRegistry();
        val = new AgentValidationRegistry();
        val.initialize(address(identity));

        vm.prank(AGENT);
        agentId = identity.register();
    }

    /// @notice Pose une demande standard (proprietaire = AGENT, validateur = VALIDATOR, hash = RH).
    function _request() internal {
        vm.prank(AGENT);
        val.validationRequest(VALIDATOR, agentId, "uri", RH);
    }

    // =====================================================================
    // 1. Initialisation
    // =====================================================================

    function test_initialize_setsRegistry() public view {
        assertEq(val.getIdentityRegistry(), address(identity));
    }

    function test_initialize_revertsSecondTime() public {
        vm.expectRevert(AgentValidationRegistry.AlreadyInitialized.selector);
        val.initialize(address(identity));
    }

    function test_initialize_revertsZeroAddress() public {
        AgentValidationRegistry fresh = new AgentValidationRegistry();
        vm.expectRevert(AgentValidationRegistry.ZeroAddress.selector);
        fresh.initialize(address(0));
    }

    // =====================================================================
    // 2. validationRequest
    // =====================================================================

    /// @notice validationRequest par le proprietaire : ValidationRequest, etat et listes a jour.
    function test_validationRequest_emitsAndStores() public {
        vm.expectEmit(true, true, true, true);
        emit ValidationRequest(RH, VALIDATOR, agentId, "uri");
        vm.prank(AGENT);
        val.validationRequest(VALIDATOR, agentId, "uri", RH);

        AgentValidationRegistry.Validation memory v = val.getValidationStatus(RH);
        assertEq(v.validatorAddress, VALIDATOR);
        assertEq(v.agentId, agentId);
        assertFalse(v.responded);

        bytes32[] memory a = val.getAgentValidations(agentId);
        assertEq(a.length, 1);
        assertEq(a[0], RH);
        bytes32[] memory r = val.getValidatorRequests(VALIDATOR);
        assertEq(r.length, 1);
        assertEq(r[0], RH);
    }

    /// @notice validationRequest par un tiers (pas le proprietaire) : NotAgentOwner.
    function test_validationRequest_revertsNotOwner() public {
        vm.prank(OTHER);
        vm.expectRevert(abi.encodeWithSelector(AgentValidationRegistry.NotAgentOwner.selector, agentId, OTHER));
        val.validationRequest(VALIDATOR, agentId, "uri", RH);
    }

    /// @notice validationRequest sur un agent inexistant : UnknownAgent.
    function test_validationRequest_revertsUnknownAgent() public {
        vm.prank(AGENT);
        vm.expectRevert(abi.encodeWithSelector(AgentValidationRegistry.UnknownAgent.selector, uint256(999)));
        val.validationRequest(VALIDATOR, 999, "uri", RH);
    }

    /// @notice requestHash deja demande : RequestExists.
    function test_validationRequest_revertsRequestExists() public {
        _request();
        vm.prank(AGENT);
        vm.expectRevert(abi.encodeWithSelector(AgentValidationRegistry.RequestExists.selector, RH));
        val.validationRequest(VALIDATOR, agentId, "uri", RH);
    }

    // =====================================================================
    // 3. validationResponse
    // =====================================================================

    /// @notice Reponse du validateur designe : ValidationResponse, etat a jour.
    function test_validationResponse_emitsAndStores() public {
        _request();
        vm.expectEmit(true, true, false, true);
        emit ValidationResponse(RH, VALIDATOR, 80, "ruri", bytes32(0), "final");
        vm.prank(VALIDATOR);
        val.validationResponse(RH, 80, "ruri", bytes32(0), "final");

        AgentValidationRegistry.Validation memory v = val.getValidationStatus(RH);
        assertTrue(v.responded);
        assertEq(v.response, 80);
        assertEq(v.tag, "final");
    }

    /// @notice Reponse par un autre que le validateur designe : NotValidator (point d'attention).
    function test_validationResponse_revertsNotValidator() public {
        _request();
        vm.prank(OTHER);
        vm.expectRevert(abi.encodeWithSelector(AgentValidationRegistry.NotValidator.selector, RH, OTHER));
        val.validationResponse(RH, 50, "", bytes32(0), "");
    }

    /// @notice Reponse sur un hash inconnu : UnknownRequest.
    function test_validationResponse_revertsUnknownRequest() public {
        vm.prank(VALIDATOR);
        vm.expectRevert(abi.encodeWithSelector(AgentValidationRegistry.UnknownRequest.selector, RH));
        val.validationResponse(RH, 50, "", bytes32(0), "");
    }

    /// @notice response > 100 : ResponseTooLarge.
    function test_validationResponse_revertsResponseTooLarge() public {
        _request();
        vm.prank(VALIDATOR);
        vm.expectRevert(abi.encodeWithSelector(AgentValidationRegistry.ResponseTooLarge.selector, uint8(101)));
        val.validationResponse(RH, 101, "", bytes32(0), "");
    }

    /// @notice response = 100 exactement : accepte (borne).
    function test_validationResponse_acceptsHundred() public {
        _request();
        vm.prank(VALIDATOR);
        val.validationResponse(RH, 100, "", bytes32(0), "");
        assertEq(val.getValidationStatus(RH).response, 100);
    }

    // =====================================================================
    // 4. getValidationStatus / listes vides
    // =====================================================================

    /// @notice Hash jamais demande : validatorAddress nul.
    function test_getValidationStatus_emptyWhenNone() public view {
        AgentValidationRegistry.Validation memory v = val.getValidationStatus(RH);
        assertEq(v.validatorAddress, address(0));
    }

    function test_getAgentValidations_emptyWhenNone() public view {
        assertEq(val.getAgentValidations(agentId).length, 0);
    }

    function test_getValidatorRequests_emptyWhenNone() public view {
        assertEq(val.getValidatorRequests(VALIDATOR).length, 0);
    }

    // =====================================================================
    // 5. getSummary : moyenne entiere, filtre de tag, filtre de validateurs
    // =====================================================================

    /// @notice Deux reponses -> moyenne entiere (division euclidienne).
    function test_getSummary_integerAverage() public {
        // Deux demandes du meme agent, deux validateurs, deux reponses.
        vm.startPrank(AGENT);
        val.validationRequest(VALIDATOR, agentId, "", keccak256("a"));
        val.validationRequest(OTHER, agentId, "", keccak256("b"));
        vm.stopPrank();
        vm.prank(VALIDATOR);
        val.validationResponse(keccak256("a"), 80, "", bytes32(0), "final");
        vm.prank(OTHER);
        val.validationResponse(keccak256("b"), 61, "", bytes32(0), "final");

        address[] memory none = new address[](0);
        (uint64 count, uint8 avg) = val.getSummary(agentId, none, "");
        assertEq(count, 2);
        assertEq(avg, 70); // (80 + 61) / 2 = 70 (euclidienne)
    }

    /// @notice Aucune reponse : count 0, moyenne 0.
    function test_getSummary_zeroWhenNoResponse() public {
        _request();
        address[] memory none = new address[](0);
        (uint64 count, uint8 avg) = val.getSummary(agentId, none, "");
        assertEq(count, 0);
        assertEq(avg, 0);
    }

    /// @notice Filtre de tag : seules les reponses du tag demande sont comptees.
    function test_getSummary_filtersTag() public {
        vm.startPrank(AGENT);
        val.validationRequest(VALIDATOR, agentId, "", keccak256("a"));
        val.validationRequest(OTHER, agentId, "", keccak256("b"));
        vm.stopPrank();
        vm.prank(VALIDATOR);
        val.validationResponse(keccak256("a"), 80, "", bytes32(0), "final");
        vm.prank(OTHER);
        val.validationResponse(keccak256("b"), 40, "", bytes32(0), "draft");

        address[] memory none = new address[](0);
        (uint64 count, uint8 avg) = val.getSummary(agentId, none, "final");
        assertEq(count, 1);
        assertEq(avg, 80);
    }

    /// @notice Filtre de validateurs : seules les reponses des validateurs listes comptent.
    function test_getSummary_filtersValidators() public {
        vm.startPrank(AGENT);
        val.validationRequest(VALIDATOR, agentId, "", keccak256("a"));
        val.validationRequest(OTHER, agentId, "", keccak256("b"));
        vm.stopPrank();
        vm.prank(VALIDATOR);
        val.validationResponse(keccak256("a"), 80, "", bytes32(0), "final");
        vm.prank(OTHER);
        val.validationResponse(keccak256("b"), 40, "", bytes32(0), "final");

        address[] memory only = new address[](1);
        only[0] = VALIDATOR;
        (uint64 count, uint8 avg) = val.getSummary(agentId, only, "");
        assertEq(count, 1);
        assertEq(avg, 80);
    }
}
