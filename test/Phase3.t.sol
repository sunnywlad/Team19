// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {DrawnVerificationMarket} from "../src/DrawnVerificationMarket.sol";
import {IVerificationMarket} from "../src/interfaces/IVerificationMarket.sol";
import {VerifierRegistry} from "../src/VerifierRegistry.sol";
import {Slashing} from "../src/Slashing.sol";
import {Rewards} from "../src/Rewards.sol";
import {AgentIdentityRegistry} from "../src/erc8004/AgentIdentityRegistry.sol";
import {AgentReputationRegistry} from "../src/erc8004/AgentReputationRegistry.sol";
import {AgentValidationRegistry} from "../src/erc8004/AgentValidationRegistry.sol";
import {MockNativeMinter} from "./mocks/MockNativeMinter.sol";
import {NATIVE_MINTER} from "../src/precompiles/INativeMinter.sol";

/// @title Tests Phase3 : branchement ERC-8004 sur DrawnVerificationMarket (lot 7b)
/// @notice Conforme a spec-lot7.md partie 7b, section Tests : bout en bout tirage -> reveals (un absent)
///         -> finalize : reputation +1 pour les revelateurs, -1 pour l'absent ; reponse de validation
///         100/50/0 selon le code quand le marche est le validateur designe ; et surtout finalize jamais
///         bloque (sans identite, sans demande de validation, registres non branches, registre qui revert).
/// @dev src/ non modifie, tests existants non modifies. Aucun appel au L1 (precompile faux via vm.etch).
contract Phase3Test is Test {
    DrawnVerificationMarket internal market;
    VerifierRegistry internal registry;
    Slashing internal slashing;
    Rewards internal rewards;

    AgentIdentityRegistry internal identity;
    AgentReputationRegistry internal reputation;
    AgentValidationRegistry internal validation;

    address internal constant V0 = 0x70997970C51812dc3A010C7d01b50e0d17dc79C8;
    address internal constant V1 = 0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC;
    address internal constant V2 = 0x90F79bf6EB2c4f870365E785982E1f101E93b906;
    address internal constant V3 = 0x15d34AAf54267DB7D7c367839AAf71A00a2C6A65;
    address internal constant V4 = 0x9965507D1a55bcC2695C58ba16FB37d819B0A4dc;

    address internal constant REQUESTER = address(0xCAFE);
    address internal constant TREASURY = address(0x15EA50);

    uint256 internal constant MIN_STAKE = 100 ether;
    uint16 internal constant LOCK_BPS = 2000;
    uint8 internal constant STRIKE_LIMIT = 3;
    uint256 internal constant EXCLUSION = 10;
    uint256 internal constant BONUS = 1 ether;

    uint256 internal constant FEE = 1 ether;
    uint64 internal constant COMMIT_WINDOW = 180;
    uint64 internal constant REVEAL_WINDOW = 60;
    uint64 internal constant CONTEST_WINDOW = 600;

    bytes32 internal constant H = keccak256("demande-phase3");

    function setUp() public {
        vm.warp(1_000_000);
        vm.roll(1_000);

        registry = new VerifierRegistry(MIN_STAKE, LOCK_BPS, TREASURY);
        slashing = new Slashing(registry, STRIKE_LIMIT, EXCLUSION);
        rewards = new Rewards(TREASURY, BONUS);
        market =
            new DrawnVerificationMarket(FEE, COMMIT_WINDOW, REVEAL_WINDOW, CONTEST_WINDOW, registry, slashing, rewards);

        registry.setMarket(address(market));
        registry.setSlashing(address(slashing));
        slashing.setMarket(address(market));
        rewards.setMarket(address(market));

        MockNativeMinter minter = new MockNativeMinter();
        vm.etch(NATIVE_MINTER, address(minter).code);
        vm.deal(NATIVE_MINTER, 10_000 ether);

        vm.deal(REQUESTER, 1000 ether);
        vm.deal(V0, 1000 ether);
        vm.deal(V1, 1000 ether);
        vm.deal(V2, 1000 ether);
        vm.deal(V3, 1000 ether);
        vm.deal(V4, 1000 ether);

        identity = new AgentIdentityRegistry();
        reputation = new AgentReputationRegistry();
        validation = new AgentValidationRegistry();
        reputation.initialize(address(identity));
        validation.initialize(address(identity));
    }

    // =====================================================================
    // Helpers
    // =====================================================================

    function _admitRegister(address v) internal {
        registry.admit(v);
        vm.prank(v);
        registry.register{value: MIN_STAKE}();
    }

    function _admitFour() internal {
        _admitRegister(V0);
        _admitRegister(V1);
        _admitRegister(V2);
        _admitRegister(V3);
    }

    function _create(bytes32 h) internal returns (uint256 id) {
        vm.prank(REQUESTER);
        id = market.createRequest{value: FEE}(h);
    }

    function _draw(uint256 id, bytes32 bh) internal {
        uint256 db = market.drawBlock(id);
        vm.roll(db + 1);
        vm.setBlockhash(db, bh);
        market.drawCommittee(id);
    }

    function _commit(uint256 id, address who, IVerificationMarket.Code vote, bytes32 salt) internal {
        bytes32 c = market.commitmentOf(id, who, vote, 0, bytes32(0), salt);
        vm.prank(who);
        market.commitVerdict(id, c);
    }

    function _reveal(uint256 id, address who, IVerificationMarket.Code vote, bytes32 salt) internal {
        vm.prank(who);
        market.revealVerdict(id, vote, 0, bytes32(0), salt);
    }

    /// @notice Chaque membre du comite enregistre une identite d'agent.
    function _registerIdentities(address[] memory c) internal {
        for (uint256 i = 0; i < c.length; i++) {
            vm.prank(c[i]);
            identity.register();
        }
    }

    // =====================================================================
    // 1. Bout en bout : reputation +1 revelateurs / -1 absent + reponse de validation
    // =====================================================================

    /// @notice Tirage -> deux reveals, un absent -> finalize : reputation +1 pour les deux revelateurs,
    ///         -1 pour l'absent ; reponse de validation 100 (code Accept) car le marche est le validateur.
    function test_endToEnd_reputationAndValidation_accept() public {
        _admitFour();
        market.setErc8004(address(identity), address(reputation), address(validation));

        uint256 id = _create(H);
        _draw(id, keccak256("bh-p3-accept"));
        address[] memory c = market.getCommittee(id);
        assertEq(c.length, 3);

        _registerIdentities(c);

        // Une demande de validation designe le marche comme validateur du hash H.
        // Posee par le proprietaire de l'agent du membre c[0] (il possede l'agentId correspondant).
        uint256 agent0 = identity.agentIdOf(c[0]);
        vm.prank(c[0]);
        validation.validationRequest(address(market), agent0, "", H);

        // c[0] et c[1] revelent Accept ; c[2] absent.
        bytes32 s0 = keccak256("ps0");
        bytes32 s1 = keccak256("ps1");
        _commit(id, c[0], IVerificationMarket.Code.Accept, s0);
        _commit(id, c[1], IVerificationMarket.Code.Accept, s1);
        vm.warp(market.getRequest(id).commitDeadline);
        _reveal(id, c[0], IVerificationMarket.Code.Accept, s0);
        _reveal(id, c[1], IVerificationMarket.Code.Accept, s1);

        // Finalize apres revealDeadline (deux reveals : code depend du quorum ; ici n=2 Accept -> Accept).
        vm.warp(market.getRequest(id).revealDeadline);
        IVerificationMarket.Code code = market.finalize(id);
        assertEq(uint8(code), uint8(IVerificationMarket.Code.Accept));

        // Reputation : +1 pour c[0] et c[1] (reveal), -1 pour c[2] (absent). Donneur = le marche.
        _assertFeedback(agent0, c[0], 1);
        _assertFeedback(identity.agentIdOf(c[1]), c[1], 1);
        _assertFeedback(identity.agentIdOf(c[2]), c[2], -1);

        // Reponse de validation : code Accept -> 100.
        AgentValidationRegistry.Validation memory v = validation.getValidationStatus(H);
        assertTrue(v.responded);
        assertEq(v.response, 100);
    }

    /// @notice Lit le feedback depose par le marche (dernier index) pour un agent et verifie la valeur.
    function _assertFeedback(uint256 agentId, address, int128 expected) internal view {
        uint256 last = reputation.getLastIndex(agentId, address(market));
        assertEq(last, 1);
        (int128 value, uint8 dec,, string memory tag1,) = reputation.readFeedback(agentId, address(market), 1);
        assertEq(value, expected);
        assertEq(dec, 0);
        assertEq(tag1, "reveal");
    }

    /// @notice Reponse de validation 0 quand le code final est Refuse.
    function test_endToEnd_validationResponse_refuse() public {
        _admitFour();
        market.setErc8004(address(identity), address(reputation), address(validation));

        uint256 id = _create(H);
        _draw(id, keccak256("bh-p3-refuse"));
        address[] memory c = market.getCommittee(id);
        _registerIdentities(c);

        uint256 agent0 = identity.agentIdOf(c[0]);
        vm.prank(c[0]);
        validation.validationRequest(address(market), agent0, "", H);

        // Les trois revelent Refuse -> code Refuse.
        bytes32 s0 = keccak256("r0");
        bytes32 s1 = keccak256("r1");
        bytes32 s2 = keccak256("r2");
        _commit(id, c[0], IVerificationMarket.Code.Refuse, s0);
        _commit(id, c[1], IVerificationMarket.Code.Refuse, s1);
        _commit(id, c[2], IVerificationMarket.Code.Refuse, s2);
        vm.warp(market.getRequest(id).commitDeadline);
        _reveal(id, c[0], IVerificationMarket.Code.Refuse, s0);
        _reveal(id, c[1], IVerificationMarket.Code.Refuse, s1);
        _reveal(id, c[2], IVerificationMarket.Code.Refuse, s2);

        IVerificationMarket.Code code = market.finalize(id);
        assertEq(uint8(code), uint8(IVerificationMarket.Code.Refuse));
        assertEq(validation.getValidationStatus(H).response, 0);
    }

    // =====================================================================
    // 2. finalize intact sans identite (branche, mais aucun membre n'a d'agent)
    // =====================================================================

    /// @notice Registres branches, mais aucun membre du comite n'a d'identite : finalize passe,
    ///         aucun feedback depose.
    function test_finalize_okWithoutIdentity() public {
        _admitFour();
        market.setErc8004(address(identity), address(reputation), address(validation));

        uint256 id = _create(H);
        _draw(id, keccak256("bh-noid"));
        address[] memory c = market.getCommittee(id);

        bytes32 s0 = keccak256("n0");
        bytes32 s1 = keccak256("n1");
        bytes32 s2 = keccak256("n2");
        _commit(id, c[0], IVerificationMarket.Code.Accept, s0);
        _commit(id, c[1], IVerificationMarket.Code.Accept, s1);
        _commit(id, c[2], IVerificationMarket.Code.Accept, s2);
        vm.warp(market.getRequest(id).commitDeadline);
        _reveal(id, c[0], IVerificationMarket.Code.Accept, s0);
        _reveal(id, c[1], IVerificationMarket.Code.Accept, s1);
        _reveal(id, c[2], IVerificationMarket.Code.Accept, s2);

        IVerificationMarket.Code code = market.finalize(id);
        assertEq(uint8(code), uint8(IVerificationMarket.Code.Accept));
        // Aucun agent enregistre : aucun feedback.
        assertEq(identity.lastAgentId(), 0);
    }

    // =====================================================================
    // 3. finalize intact sans demande de validation (identites presentes, pas de requete)
    // =====================================================================

    /// @notice Membres identifies mais aucune demande de validation posee : finalize passe, feedback depose,
    ///         aucune reponse de validation (le marche n'est validateur d'aucun hash).
    function test_finalize_okWithoutValidationRequest() public {
        _admitFour();
        market.setErc8004(address(identity), address(reputation), address(validation));

        uint256 id = _create(H);
        _draw(id, keccak256("bh-noval"));
        address[] memory c = market.getCommittee(id);
        _registerIdentities(c);

        bytes32 s0 = keccak256("v0");
        bytes32 s1 = keccak256("v1");
        bytes32 s2 = keccak256("v2");
        _commit(id, c[0], IVerificationMarket.Code.Accept, s0);
        _commit(id, c[1], IVerificationMarket.Code.Accept, s1);
        _commit(id, c[2], IVerificationMarket.Code.Accept, s2);
        vm.warp(market.getRequest(id).commitDeadline);
        _reveal(id, c[0], IVerificationMarket.Code.Accept, s0);
        _reveal(id, c[1], IVerificationMarket.Code.Accept, s1);
        _reveal(id, c[2], IVerificationMarket.Code.Accept, s2);

        market.finalize(id);
        // Feedback bien depose pour c[0].
        assertEq(reputation.getLastIndex(identity.agentIdOf(c[0]), address(market)), 1);
        // Aucune reponse de validation : le hash H n'a aucune demande.
        assertEq(validation.getValidationStatus(H).validatorAddress, address(0));
    }

    // =====================================================================
    // 4. finalize intact registres non branches (setErc8004 jamais appele)
    // =====================================================================

    /// @notice Sans setErc8004 : finalize passe sans toucher aucun registre.
    function test_finalize_okErc8004NotWired() public {
        _admitFour();
        // Pas de setErc8004.
        uint256 id = _create(H);
        _draw(id, keccak256("bh-nowire"));
        address[] memory c = market.getCommittee(id);
        _registerIdentities(c);

        bytes32 s0 = keccak256("w0");
        bytes32 s1 = keccak256("w1");
        bytes32 s2 = keccak256("w2");
        _commit(id, c[0], IVerificationMarket.Code.Accept, s0);
        _commit(id, c[1], IVerificationMarket.Code.Accept, s1);
        _commit(id, c[2], IVerificationMarket.Code.Accept, s2);
        vm.warp(market.getRequest(id).commitDeadline);
        _reveal(id, c[0], IVerificationMarket.Code.Accept, s0);
        _reveal(id, c[1], IVerificationMarket.Code.Accept, s1);
        _reveal(id, c[2], IVerificationMarket.Code.Accept, s2);

        IVerificationMarket.Code code = market.finalize(id);
        assertEq(uint8(code), uint8(IVerificationMarket.Code.Accept));
        // Aucun feedback (branchement off).
        assertEq(reputation.getLastIndex(identity.agentIdOf(c[0]), address(market)), 0);
    }

    /// @notice Branchement a adresses nulles : desactive, finalize passe.
    function test_finalize_okErc8004WiredToZero() public {
        _admitFour();
        market.setErc8004(address(0), address(0), address(0));
        uint256 id = _create(H);
        _draw(id, keccak256("bh-zero"));
        address[] memory c = market.getCommittee(id);

        bytes32 s0 = keccak256("z0");
        bytes32 s1 = keccak256("z1");
        bytes32 s2 = keccak256("z2");
        _commit(id, c[0], IVerificationMarket.Code.Accept, s0);
        _commit(id, c[1], IVerificationMarket.Code.Accept, s1);
        _commit(id, c[2], IVerificationMarket.Code.Accept, s2);
        vm.warp(market.getRequest(id).commitDeadline);
        _reveal(id, c[0], IVerificationMarket.Code.Accept, s0);
        _reveal(id, c[1], IVerificationMarket.Code.Accept, s1);
        _reveal(id, c[2], IVerificationMarket.Code.Accept, s2);

        IVerificationMarket.Code code = market.finalize(id);
        assertEq(uint8(code), uint8(IVerificationMarket.Code.Accept));
    }

    // =====================================================================
    // 5. finalize intact avec un registre qui revert (mock)
    // =====================================================================

    /// @notice Un registre de reputation qui revert sur tout appel ne doit pas faire echouer finalize.
    function test_finalize_okWhenReputationReverts() public {
        _admitFour();
        RevertingReputation bad = new RevertingReputation();
        // identity reel (pour agentIdOf != 0), reputation = mock qui revert, pas de validation.
        market.setErc8004(address(identity), address(bad), address(0));

        uint256 id = _create(H);
        _draw(id, keccak256("bh-badrep"));
        address[] memory c = market.getCommittee(id);
        _registerIdentities(c);

        bytes32 s0 = keccak256("b0");
        bytes32 s1 = keccak256("b1");
        bytes32 s2 = keccak256("b2");
        _commit(id, c[0], IVerificationMarket.Code.Accept, s0);
        _commit(id, c[1], IVerificationMarket.Code.Accept, s1);
        _commit(id, c[2], IVerificationMarket.Code.Accept, s2);
        vm.warp(market.getRequest(id).commitDeadline);
        _reveal(id, c[0], IVerificationMarket.Code.Accept, s0);
        _reveal(id, c[1], IVerificationMarket.Code.Accept, s1);
        _reveal(id, c[2], IVerificationMarket.Code.Accept, s2);

        vm.warp(market.getRequest(id).revealDeadline);
        // Ne doit pas revert malgre le registre fautif.
        IVerificationMarket.Code code = market.finalize(id);
        assertEq(uint8(code), uint8(IVerificationMarket.Code.Accept));
        assertEq(uint8(market.getRequest(id).status), uint8(IVerificationMarket.Status.Contest));
    }

    /// @notice Un registre de validation qui revert ne doit pas faire echouer finalize.
    function test_finalize_okWhenValidationReverts() public {
        _admitFour();
        RevertingValidation bad = new RevertingValidation();
        market.setErc8004(address(identity), address(reputation), address(bad));

        uint256 id = _create(H);
        _draw(id, keccak256("bh-badval"));
        address[] memory c = market.getCommittee(id);
        _registerIdentities(c);

        bytes32 s0 = keccak256("bv0");
        bytes32 s1 = keccak256("bv1");
        bytes32 s2 = keccak256("bv2");
        _commit(id, c[0], IVerificationMarket.Code.Accept, s0);
        _commit(id, c[1], IVerificationMarket.Code.Accept, s1);
        _commit(id, c[2], IVerificationMarket.Code.Accept, s2);
        vm.warp(market.getRequest(id).commitDeadline);
        _reveal(id, c[0], IVerificationMarket.Code.Accept, s0);
        _reveal(id, c[1], IVerificationMarket.Code.Accept, s1);
        _reveal(id, c[2], IVerificationMarket.Code.Accept, s2);

        vm.warp(market.getRequest(id).revealDeadline);
        IVerificationMarket.Code code = market.finalize(id);
        assertEq(uint8(code), uint8(IVerificationMarket.Code.Accept));
    }

    // =====================================================================
    // 6. Demande jamais tiree avec ERC-8004 branche : finalize code 1 intact
    // =====================================================================

    /// @notice Branchement actif mais demande jamais tiree : finalize code 1, aucun crochet reputation
    ///         (comite vide), pas de revert.
    function test_finalize_neverDrawn_withErc8004() public {
        _admitFour();
        market.setErc8004(address(identity), address(reputation), address(validation));
        uint256 id = _create(H);
        // Pas de tirage.
        vm.warp(market.getRequest(id).revealDeadline);
        IVerificationMarket.Code code = market.finalize(id);
        assertEq(uint8(code), uint8(IVerificationMarket.Code.HumanReview));
    }

    // =====================================================================
    // 7. setErc8004 : admin seul, une seule fois
    // =====================================================================

    function test_setErc8004_revertsNotAdmin() public {
        vm.prank(V0);
        vm.expectRevert(abi.encodeWithSelector(DrawnVerificationMarket.OnlyErc8004Admin.selector, V0));
        market.setErc8004(address(identity), address(reputation), address(validation));
    }

    function test_setErc8004_revertsSecondTime() public {
        market.setErc8004(address(identity), address(reputation), address(validation));
        vm.expectRevert(DrawnVerificationMarket.Erc8004AlreadySet.selector);
        market.setErc8004(address(identity), address(reputation), address(validation));
    }

    function test_pokeErc8004_revertsNotSelf() public {
        vm.expectRevert(abi.encodeWithSelector(DrawnVerificationMarket.OnlySelf.selector, address(this)));
        market.pokeErc8004(1);
    }
}

/// @notice Faux registre de reputation : revert sur tout appel attendu par le crochet.
contract RevertingReputation {
    error Boom();

    function agentIdOf(address) external pure returns (uint256) {
        // Le crochet lit agentIdOf sur identityRegistry (le vrai), pas ici : ce mock sert de reputation.
        revert Boom();
    }

    function giveFeedback(uint256, AgentReputationRegistry.FeedbackData calldata) external pure returns (uint256) {
        revert Boom();
    }
}

/// @notice Faux registre de validation : revert sur getValidationStatus.
contract RevertingValidation {
    error Boom();

    function getValidationStatus(bytes32) external pure returns (AgentValidationRegistry.Validation memory) {
        revert Boom();
    }
}
