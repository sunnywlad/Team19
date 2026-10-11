// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.24;

import {Test, Vm} from "forge-std/Test.sol";
import {ArgentVault} from "../src/ArgentVault.sol";
import "../specs/contract/IArgentVault.sol";

// =========================================================================
// Doublures
// =========================================================================

/// @notice Bénéficiaire qui refuse tout transfert natif.
contract RevertingReceiver {
    receive() external payable {
        revert("non");
    }
}

/// @notice Bénéficiaire malveillant sans rôle : rappelle le coffre à la réception.
contract MaliciousBeneficiary {
    IArgentVault public vault;
    bytes32 public pendingId;
    uint256 public received;
    uint256 public reentryFailures;
    uint256 public reentrySuccesses;

    constructor(IArgentVault vault_) {
        vault = vault_;
    }

    function setPending(bytes32 id) external {
        pendingId = id;
    }

    receive() external payable {
        received += msg.value;
        // Tente de s'approuver lui-même, puis de forcer l'expiration d'un cas 1.
        try vault.approve(pendingId) {
            ++reentrySuccesses;
        } catch {
            ++reentryFailures;
        }
        try vault.expire(pendingId) {
            ++reentrySuccesses;
        } catch {
            ++reentryFailures;
        }
    }
}

/// @notice Relais ET bénéficiaire malveillant : rejoue submit pendant le paiement.
contract ReentrantRelay {
    IArgentVault public vault;
    IArgentVault.Request internal _next;
    bytes internal _nextSig;
    bool internal _armed;
    bytes public lastError;
    uint256 public received;

    function setVault(IArgentVault vault_) external {
        vault = vault_;
    }

    function arm(IArgentVault.Request calldata next, bytes calldata sig) external {
        _next = next;
        _nextSig = sig;
        _armed = true;
    }

    function go(IArgentVault.Request calldata r, bytes calldata sig) external returns (uint8, uint8) {
        return vault.submit(r, sig);
    }

    receive() external payable {
        received += msg.value;
        if (!_armed) return;
        _armed = false;
        try vault.submit(_next, _nextSig) {}
        catch (bytes memory e) {
            lastError = e;
        }
    }
}

/// @notice Approbateur ET bénéficiaire malveillant : rappelle approve pendant le paiement.
contract ReentrantApprover {
    IArgentVault public vault;
    bytes32 public target;
    bytes public lastError;
    uint256 public received;

    function setVault(IArgentVault vault_) external {
        vault = vault_;
    }

    function approveOnce(bytes32 id) external {
        target = id;
        vault.approve(id);
    }

    receive() external payable {
        received += msg.value;
        try vault.approve(target) {}
        catch (bytes memory e) {
            lastError = e;
        }
    }
}

// =========================================================================
// Monde de test (specs/examples/fixtures.json)
// =========================================================================

abstract contract ArgentVaultBase is Test {
    uint256 internal constant U = 1e15; // 1 unité = 10^15 wei de VETO

    bytes32 internal constant C_DEMO = 0xce665c932b8b6adb314bf6ba6b5561b528027ce19de675f4c3136d7f91bf23a8;
    bytes32 internal constant A_DEM_1 = 0x4c399b1cfd777c598778cfcdefdea719b040cc331ac368cba4957cb221ab7376;
    bytes32 internal constant A_DEM_2 = 0x4c7f7a6c35ddcd70f1d7cc6e557315ff29c3a553a253d29016fed3f8234f232c;
    bytes32 internal constant A_DEM_3 = 0x2105c00130b98ee0802da8f334436b493d7f572044bbc686b71981f3c9ce1a0a;
    bytes32 internal constant A_TRESO = 0x3b012bc1ee917e20bc9fd4e7e96949b845385fe2337c9b7e57ddb78612a22c78;
    bytes32 internal constant A_LECT = 0xdff87a23384c280d386171770eb1f5418b4c990511213675d849f1f3136489a0;
    bytes32 internal constant B_001 = 0x33ffa397770ec2817195fde557898e4c16950c03357f8460e0b908a8679c1f2c;
    bytes32 internal constant B_002 = 0x6fc1b8d6a42511d0f8d5c0e9112f8b6e20a4d31c078762052849957a86850db1;
    bytes32 internal constant B_PLACEMENT = 0x70f9c3b43c463e91c42f948809c5587261b4b4bed1efbe91a5edf64cd1c183f6;
    bytes32 internal constant F_001 = 0x0665d8d815dfef587a495604ca870d4b3f510bfaabe41553ad691024b8d4b49c;
    bytes32 internal constant F_002 = 0x6caf3d2be4cf3cd29da1a2c49da20583230f10e51e083d953fb70778efa0ce3e;
    bytes32 internal constant F_999 = 0xe569d7ebe669fb8b243db35d51ef92bafb8aeea675088b9de8e86954e1bd919d;
    bytes32 internal constant P_020 = 0x4253f8c51272c785bd58704a4d22f7205299f6bf601dc39e6e0b8a72c58ca0da;
    bytes32 internal constant P_030 = 0x19dcbdf4775921fae6fd89ec78a15c1dcdd7863d64f1b97e66e467216474b005;

    uint256 internal constant SECP256K1_N = 0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364141;

    address internal OWNER = makeAddr("owner");
    address internal ADMISSION = makeAddr("admission");
    address internal RELAY = makeAddr("relay");
    address internal APPROVER = makeAddr("approver");
    address internal GUARDIAN = makeAddr("guardian");
    address internal STRANGER = makeAddr("stranger");

    address internal ACC_B001 = makeAddr("B-001");
    address internal ACC_B002 = makeAddr("B-002");
    address internal ACC_BPLACEMENT = makeAddr("B-PLACEMENT");

    address internal clientSigner;
    uint256 internal clientPk;

    ArgentVault internal vault;
    uint256 internal nonce;

    function setUp() public virtual {
        vm.warp(1_800_000_000);
        (clientSigner, clientPk) = makeAddrAndKey("client");
        vault = new ArgentVault(OWNER, ADMISSION, RELAY, APPROVER, GUARDIAN, C_DEMO, clientSigner);
        _seed(vault, ACC_B001, ACC_B002, ACC_BPLACEMENT);
    }

    /// @dev Cash 100, F-001 10 vers B-001, F-002 30 vers B-002, réserve 40, seuil 25,
    ///      P-020 20 et P-030 30 vers B-PLACEMENT, délai 30 s, cinq agents.
    function _seed(ArgentVault v, address b001, address b002, address bPlacement) internal {
        vm.startPrank(OWNER);
        v.setSafetyReserve(40 * U);
        v.setThreshold(25 * U);
        v.setApprovalDelay(30);
        v.registerAgent(A_DEM_1, ACTION_PAY_INVOICE);
        v.registerAgent(A_DEM_2, ACTION_PAY_INVOICE);
        v.registerAgent(A_DEM_3, ACTION_PAY_INVOICE);
        v.registerAgent(A_TRESO, ACTION_PLACE);
        v.registerAgent(A_LECT, 0);
        vm.stopPrank();

        vm.startPrank(ADMISSION);
        v.registerBeneficiary(B_001, payable(b001));
        v.registerBeneficiary(B_002, payable(b002));
        v.registerBeneficiary(B_PLACEMENT, payable(bPlacement));
        v.registerInvoice(F_001, B_001, 10 * U);
        v.registerInvoice(F_002, B_002, 30 * U);
        v.registerPlacement(P_020, B_PLACEMENT, 20 * U);
        v.registerPlacement(P_030, B_PLACEMENT, 30 * U);
        vm.stopPrank();

        vm.deal(OWNER, 100 * U);
        vm.prank(OWNER);
        v.fund{value: 100 * U}();
    }

    function _req(bytes32 agentId, uint8 action, bytes32 refId) internal returns (IArgentVault.Request memory r) {
        r = IArgentVault.Request({
            requestId: keccak256(abi.encode("request", ++nonce)),
            clientId: C_DEMO,
            agentId: agentId,
            action: action,
            refId: refId,
            issuedAt: uint64(block.timestamp),
            expiresAt: uint64(block.timestamp + 30)
        });
    }

    function _signWith(ArgentVault v, uint256 pk, IArgentVault.Request memory r) internal view returns (bytes memory) {
        (uint8 sv, bytes32 sr, bytes32 ss) = vm.sign(pk, v.hashRequest(r));
        return abi.encodePacked(sr, ss, sv);
    }

    function _sign(IArgentVault.Request memory r) internal view returns (bytes memory) {
        return _signWith(vault, clientPk, r);
    }

    function _submit(IArgentVault.Request memory r) internal returns (uint8, uint8) {
        bytes memory sig = _sign(r);
        vm.prank(RELAY);
        return vault.submit(r, sig);
    }

    function _assertOutcome(IArgentVault.Request memory r, uint8 decision, uint8 reason) internal {
        (uint8 d, uint8 why) = _submit(r);
        assertEq(d, decision, "decision");
        assertEq(why, reason, "motif");
    }

    function _status(bytes32 invoiceId) internal view returns (IArgentVault.RefStatus s) {
        (,, s) = vault.invoice(invoiceId);
    }

    function _placementStatus(bytes32 placementId) internal view returns (IArgentVault.RefStatus s) {
        (,, s) = vault.placement(placementId);
    }

    function _countPaid(Vm.Log[] memory logs) internal view returns (uint256 n) {
        for (uint256 i = 0; i < logs.length; ++i) {
            if (logs[i].emitter == address(vault) && logs[i].topics[0] == IArgentVault.Paid.selector) ++n;
        }
    }

    /// @dev Soumet une demande au-dessus du seuil (F-002, 30) et renvoie son requestId.
    function _holdF002() internal returns (bytes32) {
        IArgentVault.Request memory r = _req(A_DEM_1, ACTION_PAY_INVOICE, F_002);
        _assertOutcome(r, DECISION_HUMAN, REASON_ABOVE_THRESHOLD);
        return r.requestId;
    }
}

// =========================================================================
// Scénarios d'acceptation (specs/acceptance/scenarios.md)
// =========================================================================

contract ArgentVaultScenariosTest is ArgentVaultBase {
    /// Scénario 1 : facture légitime, décision 2, Paid 10 vers B-001.
    function test_Scenario1_FactureLegitime() public {
        IArgentVault.Request memory r = _req(A_DEM_1, ACTION_PAY_INVOICE, F_001);
        bytes memory sig = _sign(r);

        vm.expectEmit(true, true, true, true, address(vault));
        emit IArgentVault.Decision(
            r.requestId, A_DEM_1, C_DEMO, ACTION_PAY_INVOICE, DECISION_ACCEPTED, REASON_NONE, F_001
        );
        vm.expectEmit(true, true, true, true, address(vault));
        emit IArgentVault.Paid(r.requestId, F_001, B_001, 10 * U);
        vm.prank(RELAY);
        (uint8 d, uint8 why) = vault.submit(r, sig);

        assertEq(d, DECISION_ACCEPTED);
        assertEq(why, REASON_NONE);
        assertEq(ACC_B001.balance, 10 * U);
        assertEq(vault.cash(), 90 * U);
        assertEq(vault.admittedDebts(), 30 * U);
        assertEq(vault.placeable(), 20 * U);
        assertEq(uint8(_status(F_001)), uint8(IArgentVault.RefStatus.Settled));
        assertTrue(vault.isConsumed(r.requestId));
    }

    /// Scénario 2 : agent non reconnu. Le contrat n'est pas atteint (porte d'entrée) ; s'il
    /// l'était, une demande non signée par le client ou d'un agent hors registre est refusée.
    function test_Scenario2_AgentNonReconnu() public {
        IArgentVault.Request memory r = _req(A_DEM_1, ACTION_PAY_INVOICE, F_001);
        (, uint256 intruderPk) = makeAddrAndKey("intrus");
        bytes memory forged = _signWith(vault, intruderPk, r);
        vm.prank(RELAY);
        (uint8 d, uint8 why) = vault.submit(r, forged);
        assertEq(d, DECISION_REFUSED);
        assertEq(why, REASON_SIGNATURE_INVALID);
        assertFalse(vault.isConsumed(r.requestId), "signature invalide : non consomme");

        _assertOutcome(
            _req(keccak256("agent-inconnu"), ACTION_PAY_INVOICE, F_001), DECISION_REFUSED, REASON_AGENT_NOT_AUTHORIZED
        );
        assertEq(vault.cash(), 100 * U);
        assertFalse(vault.agentPaused(A_DEM_1), "A-DEM-1 n'est pas mis en pause");
    }

    /// Scénario 3 : facture piégée détectée. Contrat non atteint ; la pause sur la chaîne de
    /// A-DEM-2 (gardien) refuse ensuite toute demande saine jusqu'à reprise par le propriétaire.
    function test_Scenario3_FacturePiegeeDetectee() public {
        vm.expectEmit(true, true, false, false, address(vault));
        emit IArgentVault.AgentPaused(A_DEM_2, GUARDIAN);
        vm.prank(GUARDIAN);
        vault.pauseAgent(A_DEM_2);

        _assertOutcome(_req(A_DEM_2, ACTION_PAY_INVOICE, F_001), DECISION_REFUSED, REASON_AGENT_PAUSED);
        assertEq(vault.cash(), 100 * U);

        vm.prank(GUARDIAN);
        vm.expectRevert(abi.encodeWithSelector(IArgentVault.NotAuthorized.selector, GUARDIAN));
        vault.resumeAgent(A_DEM_2);

        vm.prank(OWNER);
        vault.resumeAgent(A_DEM_2);
        _assertOutcome(_req(A_DEM_2, ACTION_PAY_INVOICE, F_001), DECISION_ACCEPTED, REASON_NONE);
    }

    /// Scénario 4 : facture piégée non détectée, F-999 inscrite nulle part : INVOICE_UNKNOWN.
    function test_Scenario4_FacturePiegeeNonDetectee() public {
        vm.recordLogs();
        _assertOutcome(_req(A_DEM_3, ACTION_PAY_INVOICE, F_999), DECISION_REFUSED, REASON_INVOICE_UNKNOWN);
        assertEq(_countPaid(vm.getRecordedLogs()), 0);
        assertEq(vault.cash(), 100 * U);
    }

    /// Scénario 5 : relais en panne. Soumise après son expiration, la demande est refusée.
    function test_Scenario5_RelaisEnPanne() public {
        IArgentVault.Request memory r = _req(A_DEM_1, ACTION_PAY_INVOICE, F_001);
        bytes memory sig = _sign(r);
        vm.warp(r.expiresAt + 1);
        vm.prank(RELAY);
        (uint8 d, uint8 why) = vault.submit(r, sig);
        assertEq(d, DECISION_REFUSED);
        assertEq(why, REASON_REQUEST_EXPIRED);
        assertEq(vault.cash(), 100 * U);
        assertEq(uint8(_status(F_001)), uint8(IArgentVault.RefStatus.Admitted), "F-001 toujours due");
    }

    /// Scénario 6 : au-dessus du seuil, décision 1, HoldPlaced 30 avec échéance à 30 s.
    function test_Scenario6_MontantAuDessusDuSeuil() public {
        IArgentVault.Request memory r = _req(A_DEM_1, ACTION_PAY_INVOICE, F_002);
        bytes memory sig = _sign(r);
        vm.expectEmit(true, true, false, true, address(vault));
        emit IArgentVault.HoldPlaced(r.requestId, F_002, 30 * U, uint64(block.timestamp + 30));
        vm.prank(RELAY);
        (uint8 d, uint8 why) = vault.submit(r, sig);
        assertEq(d, DECISION_HUMAN);
        assertEq(why, REASON_ABOVE_THRESHOLD);
        assertEq(vault.cash(), 100 * U);
        assertEq(vault.totalHeld(), 30 * U);
        assertEq(vault.admittedDebts(), 40 * U);
        assertEq(vault.placeable(), 20 * U);
        (bytes32 agentId, uint8 action, bytes32 refId, uint256 amount, uint64 deadline) =
            vault.pendingApproval(r.requestId);
        assertEq(agentId, A_DEM_1);
        assertEq(action, ACTION_PAY_INVOICE);
        assertEq(refId, F_002);
        assertEq(amount, 30 * U);
        assertEq(deadline, block.timestamp + 30);
    }

    /// Scénario 6 a : approbation avant l'échéance, Paid 30 vers B-002.
    function test_Scenario6a_ApprobationAvantEcheance() public {
        bytes32 id = _holdF002();
        vm.warp(block.timestamp + 30); // à l'échéance, incluse
        vm.expectEmit(true, true, true, true, address(vault));
        emit IArgentVault.Decision(id, A_DEM_1, C_DEMO, ACTION_PAY_INVOICE, DECISION_ACCEPTED, REASON_APPROVED, F_002);
        vm.expectEmit(true, true, true, true, address(vault));
        emit IArgentVault.Paid(id, F_002, B_002, 30 * U);
        vm.prank(APPROVER);
        vault.approve(id);
        assertEq(ACC_B002.balance, 30 * U);
        assertEq(vault.cash(), 70 * U);
        assertEq(vault.admittedDebts(), 10 * U);
        assertEq(vault.totalHeld(), 0);
        assertEq(vault.placeable(), 20 * U);
    }

    /// Scénario 6 b : personne ne répond, expire : APPROVAL_TIMEOUT, HoldReleased, aucun Paid.
    function test_Scenario6b_ExpirationSansReponse() public {
        bytes32 id = _holdF002();
        vm.warp(block.timestamp + 31);
        vm.recordLogs();
        vm.expectEmit(true, true, true, true, address(vault));
        emit IArgentVault.Decision(
            id, A_DEM_1, C_DEMO, ACTION_PAY_INVOICE, DECISION_REFUSED, REASON_APPROVAL_TIMEOUT, F_002
        );
        vm.expectEmit(true, true, false, true, address(vault));
        emit IArgentVault.HoldReleased(id, F_002, 30 * U);
        vm.prank(STRANGER);
        vault.expire(id);
        assertEq(_countPaid(vm.getRecordedLogs()), 0);
        assertEq(vault.cash(), 100 * U);
        assertEq(vault.totalHeld(), 0);
        assertEq(uint8(_status(F_002)), uint8(IArgentVault.RefStatus.Admitted), "F-002 de nouveau due");
    }

    /// Scénario 6 c : approbation après l'échéance, même issue que 6 b.
    function test_Scenario6c_ApprobationApresEcheance() public {
        bytes32 id = _holdF002();
        vm.warp(block.timestamp + 31);
        vm.recordLogs();
        vm.prank(APPROVER);
        vault.approve(id);
        assertEq(_countPaid(vm.getRecordedLogs()), 0);
        assertEq(ACC_B002.balance, 0);
        assertEq(vault.cash(), 100 * U);
        assertEq(uint8(_status(F_002)), uint8(IArgentVault.RefStatus.Admitted));
    }

    /// Scénario 7 : P-030 dépasse le plaçable (20) ; P-020 passe ensuite, cash 80, plaçable 0.
    function test_Scenario7_PlacementTropEleve() public {
        _assertOutcome(_req(A_TRESO, ACTION_PLACE, P_030), DECISION_REFUSED, REASON_EXCEEDS_PLACEABLE);
        assertEq(vault.placeable(), 20 * U);

        IArgentVault.Request memory r = _req(A_TRESO, ACTION_PLACE, P_020);
        bytes memory sig = _sign(r);
        vm.expectEmit(true, true, true, true, address(vault));
        emit IArgentVault.Paid(r.requestId, P_020, B_PLACEMENT, 20 * U);
        vm.prank(RELAY);
        (uint8 d, uint8 why) = vault.submit(r, sig);
        assertEq(d, DECISION_ACCEPTED);
        assertEq(why, REASON_NONE);
        assertEq(vault.cash(), 80 * U);
        assertEq(vault.placeable(), 0);
        assertEq(uint8(_placementStatus(P_020)), uint8(IArgentVault.RefStatus.Settled));
    }

    /// Scénario 8 a : la demande R1 remise telle quelle : REQUEST_REPLAYED, aucun Paid.
    function test_Scenario8a_Rejeu() public {
        IArgentVault.Request memory r1 = _req(A_DEM_1, ACTION_PAY_INVOICE, F_001);
        bytes memory sig = _sign(r1);
        vm.prank(RELAY);
        vault.submit(r1, sig);

        vm.recordLogs();
        vm.prank(RELAY);
        (uint8 d, uint8 why) = vault.submit(r1, sig);
        assertEq(d, DECISION_REFUSED);
        assertEq(why, REASON_REQUEST_REPLAYED);
        assertEq(_countPaid(vm.getRecordedLogs()), 0);
        assertEq(vault.cash(), 90 * U);
    }

    /// Scénario 8 b : nouvelle demande R2 sur F-001 déjà payée : INVOICE_ALREADY_PAID.
    function test_Scenario8b_DoublePaiement() public {
        _assertOutcome(_req(A_DEM_1, ACTION_PAY_INVOICE, F_001), DECISION_ACCEPTED, REASON_NONE);
        vm.recordLogs();
        _assertOutcome(_req(A_DEM_1, ACTION_PAY_INVOICE, F_001), DECISION_REFUSED, REASON_INVOICE_ALREADY_PAID);
        assertEq(_countPaid(vm.getRecordedLogs()), 0);
        assertEq(vault.cash(), 90 * U);
        assertEq(ACC_B001.balance, 10 * U);
    }
}

// =========================================================================
// Rôles : un test par fonction sensible
// =========================================================================

contract ArgentVaultRolesTest is ArgentVaultBase {
    /// @dev Tous les rôles sauf `allowed`, et un inconnu, échouent en NotAuthorized ;
    ///      puis `allowed` réussit.
    function _onlyRole(address allowed, bytes memory data) internal {
        address[6] memory callers = [OWNER, ADMISSION, RELAY, APPROVER, GUARDIAN, STRANGER];
        for (uint256 i = 0; i < callers.length; ++i) {
            if (callers[i] == allowed) continue;
            vm.prank(callers[i]);
            (bool ok, bytes memory ret) = address(vault).call(data);
            assertFalse(ok, "appelant non autorise accepte");
            assertEq(ret, abi.encodeWithSelector(IArgentVault.NotAuthorized.selector, callers[i]));
        }
        vm.prank(allowed);
        (bool success,) = address(vault).call(data);
        assertTrue(success, "le bon role echoue");
    }

    function test_Role_submit_relaisSeulement() public {
        IArgentVault.Request memory r = _req(A_DEM_1, ACTION_PAY_INVOICE, F_001);
        _onlyRole(RELAY, abi.encodeCall(IArgentVault.submit, (r, _sign(r))));
        assertTrue(vault.isConsumed(r.requestId));
    }

    function test_Role_approve_approbateurSeulement() public {
        bytes32 id = _holdF002();
        _onlyRole(APPROVER, abi.encodeCall(IArgentVault.approve, (id)));
        assertEq(ACC_B002.balance, 30 * U);
    }

    function test_Role_refuse_approbateurSeulement() public {
        bytes32 id = _holdF002();
        _onlyRole(APPROVER, abi.encodeCall(IArgentVault.refuse, (id)));
        assertEq(vault.totalHeld(), 0);
    }

    function test_Role_registerBeneficiary_admissionSeulement() public {
        _onlyRole(ADMISSION, abi.encodeCall(IArgentVault.registerBeneficiary, (keccak256("B-NEW"), payable(STRANGER))));
        assertEq(vault.beneficiary(keccak256("B-NEW")), STRANGER);
    }

    function test_Role_registerInvoice_admissionSeulement() public {
        _onlyRole(ADMISSION, abi.encodeCall(IArgentVault.registerInvoice, (keccak256("F-NEW"), B_001, 1 * U)));
        assertEq(vault.admittedDebts(), 41 * U);
    }

    function test_Role_cancelInvoice_admissionSeulement() public {
        _onlyRole(ADMISSION, abi.encodeCall(IArgentVault.cancelInvoice, (F_001)));
        assertEq(uint8(_status(F_001)), uint8(IArgentVault.RefStatus.Cancelled));
    }

    function test_Role_registerPlacement_admissionSeulement() public {
        _onlyRole(ADMISSION, abi.encodeCall(IArgentVault.registerPlacement, (keccak256("P-NEW"), B_PLACEMENT, 1 * U)));
        assertEq(uint8(_placementStatus(keccak256("P-NEW"))), uint8(IArgentVault.RefStatus.Admitted));
    }

    function test_Role_registerAgent_proprietaireSeulement() public {
        _onlyRole(OWNER, abi.encodeCall(IArgentVault.registerAgent, (keccak256("A-NEW"), ACTION_PAY_INVOICE)));
        (bool registered,) = vault.agentMandate(keccak256("A-NEW"));
        assertTrue(registered);
    }

    function test_Role_setSafetyReserve_proprietaireSeulement() public {
        _onlyRole(OWNER, abi.encodeCall(IArgentVault.setSafetyReserve, (50 * U)));
        assertEq(vault.safetyReserve(), 50 * U);
    }

    function test_Role_setThreshold_proprietaireSeulement() public {
        _onlyRole(OWNER, abi.encodeCall(IArgentVault.setThreshold, (5 * U)));
        assertEq(vault.threshold(), 5 * U);
    }

    function test_Role_setApprovalDelay_proprietaireSeulement() public {
        _onlyRole(OWNER, abi.encodeCall(IArgentVault.setApprovalDelay, (60)));
        assertEq(vault.approvalDelay(), 60);
    }

    function test_Role_resumeVault_proprietaireSeulement() public {
        vm.prank(GUARDIAN);
        vault.pauseVault();
        _onlyRole(OWNER, abi.encodeCall(IArgentVault.resumeVault, ()));
        assertFalse(vault.vaultPaused());
    }

    function test_Role_resumeAgent_proprietaireSeulement() public {
        vm.prank(GUARDIAN);
        vault.pauseAgent(A_DEM_1);
        _onlyRole(OWNER, abi.encodeCall(IArgentVault.resumeAgent, (A_DEM_1)));
        assertFalse(vault.agentPaused(A_DEM_1));
    }

    function test_Role_pauseVault_gardienSeulement() public {
        _onlyRole(GUARDIAN, abi.encodeCall(IArgentVault.pauseVault, ()));
        assertTrue(vault.vaultPaused());
    }

    function test_Role_pauseAgent_gardienSeulement() public {
        _onlyRole(GUARDIAN, abi.encodeCall(IArgentVault.pauseAgent, (A_DEM_1)));
        assertTrue(vault.agentPaused(A_DEM_1));
    }

    function test_Role_expire_ouverteATous() public {
        bytes32 id = _holdF002();
        vm.warp(block.timestamp + 31);
        vm.prank(STRANGER);
        vault.expire(id);
        assertEq(vault.totalHeld(), 0);
    }

    function test_Role_fund_ouverteATous() public {
        vm.deal(STRANGER, 1 * U);
        vm.prank(STRANGER);
        vault.fund{value: 1 * U}();
        assertEq(vault.cash(), 101 * U);
    }

    function test_Constructor_collisionDeRoles() public {
        vm.expectRevert(abi.encodeWithSelector(IArgentVault.RoleCollision.selector, OWNER));
        new ArgentVault(OWNER, ADMISSION, RELAY, APPROVER, OWNER, C_DEMO, clientSigner);
        vm.expectRevert(abi.encodeWithSelector(IArgentVault.RoleCollision.selector, RELAY));
        new ArgentVault(OWNER, ADMISSION, RELAY, APPROVER, GUARDIAN, C_DEMO, RELAY);
    }

    function test_Constructor_adresseOuIdentifiantNuls() public {
        vm.expectRevert(IArgentVault.ZeroAddress.selector);
        new ArgentVault(OWNER, address(0), RELAY, APPROVER, GUARDIAN, C_DEMO, clientSigner);
        vm.expectRevert(IArgentVault.ZeroId.selector);
        new ArgentVault(OWNER, ADMISSION, RELAY, APPROVER, GUARDIAN, bytes32(0), clientSigner);
    }

    function test_Constructor_rolesExposes() public view {
        assertEq(vault.owner(), OWNER);
        assertEq(vault.admission(), ADMISSION);
        assertEq(vault.relay(), RELAY);
        assertEq(vault.approver(), APPROVER);
        assertEq(vault.guardian(), GUARDIAN);
        assertEq(vault.clientId(), C_DEMO);
        assertEq(vault.clientSigner(), clientSigner);
    }
}

// =========================================================================
// Ordre des contrôles, signature, registres
// =========================================================================

contract ArgentVaultRulesTest is ArgentVaultBase {
    function test_Signature_malleable_rejetee_nonConsommee() public {
        IArgentVault.Request memory r = _req(A_DEM_1, ACTION_PAY_INVOICE, F_001);
        (uint8 v, bytes32 sr, bytes32 ss) = vm.sign(clientPk, vault.hashRequest(r));
        bytes32 highS = bytes32(SECP256K1_N - uint256(ss));
        uint8 flippedV = v == 27 ? 28 : 27;
        // La jumelle est valide pour ecrecover : seule la règle du s bas la rejette.
        assertEq(ecrecover(vault.hashRequest(r), flippedV, sr, highS), clientSigner);

        vm.prank(RELAY);
        (uint8 d, uint8 why) = vault.submit(r, abi.encodePacked(sr, highS, flippedV));
        assertEq(d, DECISION_REFUSED);
        assertEq(why, REASON_SIGNATURE_INVALID);
        assertFalse(vault.isConsumed(r.requestId));

        vm.prank(RELAY);
        (d,) = vault.submit(r, abi.encodePacked(sr, ss, v));
        assertEq(d, DECISION_ACCEPTED, "la demande legitime passe ensuite");
    }

    function test_Signature_formesInvalides() public {
        IArgentVault.Request memory r = _req(A_DEM_1, ACTION_PAY_INVOICE, F_001);
        bytes memory sig = _sign(r);
        bytes memory badV = bytes.concat(sig);
        badV[64] = bytes1(uint8(1));
        bytes[3] memory bad = [bytes(""), bytes.concat(sig, hex"00"), badV];
        for (uint256 i = 0; i < bad.length; ++i) {
            vm.prank(RELAY);
            (, uint8 why) = vault.submit(r, bad[i]);
            assertEq(why, REASON_SIGNATURE_INVALID);
        }
        assertFalse(vault.isConsumed(r.requestId));
    }

    function test_Signature_autreClientId() public {
        IArgentVault.Request memory r = _req(A_DEM_1, ACTION_PAY_INVOICE, F_001);
        r.clientId = keccak256("autre-client");
        _assertOutcome(r, DECISION_REFUSED, REASON_SIGNATURE_INVALID);
    }

    function test_Signature_domaineLieAuContratEtALaChaine() public {
        IArgentVault.Request memory r = _req(A_DEM_1, ACTION_PAY_INVOICE, F_001);
        ArgentVault other = new ArgentVault(OWNER, ADMISSION, RELAY, APPROVER, GUARDIAN, C_DEMO, clientSigner);
        bytes memory sigOther = _signWith(other, clientPk, r);
        vm.prank(RELAY);
        (, uint8 why) = vault.submit(r, sigOther);
        assertEq(why, REASON_SIGNATURE_INVALID, "signature d'un autre contrat");

        bytes memory sig = _sign(r);
        vm.chainId(191919);
        vm.prank(RELAY);
        (, why) = vault.submit(r, sig);
        assertEq(why, REASON_SIGNATURE_INVALID, "signature d'une autre chaine");
        assertFalse(vault.isConsumed(r.requestId));
    }

    function testFuzz_Signature_quelconque_neConsommeRien(bytes calldata junk) public {
        IArgentVault.Request memory r = _req(A_DEM_1, ACTION_PAY_INVOICE, F_001);
        vm.prank(RELAY);
        (, uint8 why) = vault.submit(r, junk);
        assertEq(why, REASON_SIGNATURE_INVALID);
        assertFalse(vault.isConsumed(r.requestId));
    }

    function test_Hash_typehashDeLaSpec() public pure {
        assertEq(
            keccak256(
                "Request(bytes32 requestId,bytes32 clientId,bytes32 agentId,uint8 action,bytes32 refId,uint64 issuedAt,uint64 expiresAt)"
            ),
            0x9c20c49ec3a8f2638d52c8199e76df714419f6e2a1e6e4fba13f13ab7e7c6ce2
        );
    }

    function test_Action_inconnue_consommee() public {
        IArgentVault.Request memory r0 = _req(A_DEM_1, 0, F_001);
        _assertOutcome(r0, DECISION_REFUSED, REASON_ACTION_UNKNOWN);
        assertTrue(vault.isConsumed(r0.requestId));
        _assertOutcome(_req(A_DEM_1, 3, F_001), DECISION_REFUSED, REASON_ACTION_UNKNOWN);
    }

    function test_Fenetre_invalide() public {
        IArgentVault.Request memory r = _req(A_DEM_1, ACTION_PAY_INVOICE, F_001);
        r.expiresAt = r.issuedAt; // durée nulle
        _assertOutcome(r, DECISION_REFUSED, REASON_VALIDITY_WINDOW_INVALID);

        r = _req(A_DEM_1, ACTION_PAY_INVOICE, F_001);
        r.expiresAt = r.issuedAt + MAX_TTL + 1;
        _assertOutcome(r, DECISION_REFUSED, REASON_VALIDITY_WINDOW_INVALID);

        r = _req(A_DEM_1, ACTION_PAY_INVOICE, F_001);
        r.issuedAt = uint64(block.timestamp + MAX_CLOCK_SKEW + 1);
        r.expiresAt = r.issuedAt + 30;
        _assertOutcome(r, DECISION_REFUSED, REASON_VALIDITY_WINDOW_INVALID);
    }

    function test_Fenetre_bornesIncluses() public {
        IArgentVault.Request memory r = _req(A_DEM_1, ACTION_PAY_INVOICE, F_001);
        r.issuedAt = uint64(block.timestamp + MAX_CLOCK_SKEW);
        r.expiresAt = r.issuedAt + MAX_TTL;
        bytes memory sig = _sign(r);
        vm.warp(r.expiresAt); // lue à l'instant expiresAt
        vm.prank(RELAY);
        (uint8 d,) = vault.submit(r, sig);
        assertEq(d, DECISION_ACCEPTED);
    }

    function test_Ordre_actionAvantPause() public {
        vm.prank(GUARDIAN);
        vault.pauseVault();
        _assertOutcome(_req(A_DEM_1, 7, F_001), DECISION_REFUSED, REASON_ACTION_UNKNOWN);
    }

    function test_Ordre_expirationAvantPause() public {
        IArgentVault.Request memory r = _req(A_DEM_1, ACTION_PAY_INVOICE, F_001);
        bytes memory sig = _sign(r);
        vm.prank(GUARDIAN);
        vault.pauseVault();
        vm.warp(r.expiresAt + 1);
        vm.prank(RELAY);
        (, uint8 why) = vault.submit(r, sig);
        assertEq(why, REASON_REQUEST_EXPIRED);
    }

    function test_Ordre_mandatAvantPauseAgent() public {
        vm.prank(GUARDIAN);
        vault.pauseAgent(A_TRESO);
        _assertOutcome(_req(A_TRESO, ACTION_PAY_INVOICE, F_001), DECISION_REFUSED, REASON_AGENT_NOT_AUTHORIZED);
    }

    function test_Mandat_verifieDansLeContrat() public {
        _assertOutcome(_req(A_TRESO, ACTION_PAY_INVOICE, F_001), DECISION_REFUSED, REASON_AGENT_NOT_AUTHORIZED);
        _assertOutcome(_req(A_DEM_1, ACTION_PLACE, P_020), DECISION_REFUSED, REASON_AGENT_NOT_AUTHORIZED);
        _assertOutcome(_req(A_LECT, ACTION_PAY_INVOICE, F_001), DECISION_REFUSED, REASON_AGENT_NOT_AUTHORIZED);
        _assertOutcome(_req(A_LECT, ACTION_PLACE, P_020), DECISION_REFUSED, REASON_AGENT_NOT_AUTHORIZED);
        assertEq(vault.cash(), 100 * U);
    }

    function test_Mandat_invalideOuDejaInscrit() public {
        vm.startPrank(OWNER);
        vm.expectRevert(abi.encodeWithSelector(IArgentVault.InvalidMandate.selector, uint8(4)));
        vault.registerAgent(keccak256("A-X"), 4);
        vm.expectRevert(abi.encodeWithSelector(IArgentVault.AlreadyRegistered.selector, A_DEM_1));
        vault.registerAgent(A_DEM_1, ACTION_PLACE);
        vm.stopPrank();
    }

    function test_Placement_inconnuEtDejaExecute() public {
        _assertOutcome(_req(A_TRESO, ACTION_PLACE, keccak256("P-999")), DECISION_REFUSED, REASON_PLACEMENT_UNKNOWN);
        _assertOutcome(_req(A_TRESO, ACTION_PLACE, P_020), DECISION_ACCEPTED, REASON_NONE);
        _assertOutcome(_req(A_TRESO, ACTION_PLACE, P_020), DECISION_REFUSED, REASON_PLACEMENT_ALREADY_EXECUTED);
    }

    function test_Facture_annulee_inconnue() public {
        vm.prank(ADMISSION);
        vault.cancelInvoice(F_001);
        assertEq(vault.admittedDebts(), 30 * U);
        _assertOutcome(_req(A_DEM_1, ACTION_PAY_INVOICE, F_001), DECISION_REFUSED, REASON_INVOICE_UNKNOWN);
    }

    function test_Facture_bloquee_nonAnnulable_etEnAttente() public {
        _holdF002();
        vm.prank(ADMISSION);
        vm.expectRevert(abi.encodeWithSelector(IArgentVault.InvoiceNotCancellable.selector, F_002));
        vault.cancelInvoice(F_002);
        _assertOutcome(_req(A_DEM_1, ACTION_PAY_INVOICE, F_002), DECISION_REFUSED, REASON_REF_PENDING_APPROVAL);
    }

    function test_Facture_cashInsuffisant() public {
        vm.startPrank(ADMISSION);
        vault.registerInvoice(keccak256("F-BIG"), B_001, 80 * U);
        vm.stopPrank();
        vm.prank(OWNER);
        vault.setThreshold(100 * U);
        // cash 100, bloqué 0 : F-BIG (80) passe ; puis F-002 (30) n'a plus que 20.
        _assertOutcome(_req(A_DEM_1, ACTION_PAY_INVOICE, keccak256("F-BIG")), DECISION_ACCEPTED, REASON_NONE);
        _assertOutcome(_req(A_DEM_1, ACTION_PAY_INVOICE, F_002), DECISION_REFUSED, REASON_INSUFFICIENT_CASH);
    }

    function test_Facture_paieSansToucherAuMontantBloque() public {
        _holdF002(); // 30 bloqués sur 100
        vm.startPrank(ADMISSION);
        vault.registerInvoice(keccak256("F-75"), B_001, 75 * U);
        vm.stopPrank();
        vm.prank(OWNER);
        vault.setThreshold(100 * U);
        _assertOutcome(_req(A_DEM_1, ACTION_PAY_INVOICE, keccak256("F-75")), DECISION_REFUSED, REASON_INSUFFICIENT_CASH);
    }

    function test_Registres_inscriptionsInvalides() public {
        vm.startPrank(ADMISSION);
        vm.expectRevert(abi.encodeWithSelector(IArgentVault.AlreadyRegistered.selector, B_001));
        vault.registerBeneficiary(B_001, payable(STRANGER));
        vm.expectRevert(IArgentVault.ZeroAddress.selector);
        vault.registerBeneficiary(keccak256("B-X"), payable(address(0)));
        vm.expectRevert(IArgentVault.ZeroId.selector);
        vault.registerInvoice(bytes32(0), B_001, 1);
        vm.expectRevert(IArgentVault.ZeroAmount.selector);
        vault.registerInvoice(keccak256("F-X"), B_001, 0);
        vm.expectRevert(abi.encodeWithSelector(IArgentVault.UnknownBeneficiary.selector, keccak256("B-?")));
        vault.registerInvoice(keccak256("F-X"), keccak256("B-?"), 1);
        vm.expectRevert(abi.encodeWithSelector(IArgentVault.AlreadyRegistered.selector, F_001));
        vault.registerInvoice(F_001, B_001, 1);
        vm.expectRevert(abi.encodeWithSelector(IArgentVault.AlreadyRegistered.selector, P_020));
        vault.registerPlacement(P_020, B_PLACEMENT, 1);
        vm.stopPrank();
        assertEq(vault.beneficiary(B_001), ACC_B001, "beneficiaire non modifiable");
    }

    function test_Parametres_delaiHorsBornes() public {
        vm.startPrank(OWNER);
        vm.expectRevert(IArgentVault.ParameterOutOfRange.selector);
        vault.setApprovalDelay(9);
        vm.expectRevert(IArgentVault.ParameterOutOfRange.selector);
        vault.setApprovalDelay(7 days + 1);
        vault.setApprovalDelay(10);
        vault.setApprovalDelay(7 days);
        vm.stopPrank();
    }

    function test_Fund_montantNulEtEnvoiDirect() public {
        vm.expectRevert(IArgentVault.ZeroAmount.selector);
        vault.fund{value: 0}();
        vm.deal(STRANGER, 1 ether);
        vm.prank(STRANGER);
        (bool ok,) = address(vault).call{value: 1}("");
        assertFalse(ok, "aucun receive : pas d'envoi direct");
    }
}

// =========================================================================
// Cas 1, pauses
// =========================================================================

contract ArgentVaultCase1AndPauseTest is ArgentVaultBase {
    function test_M4_placementNouvelleFacture_refuseSansPaiement() public {
        IArgentVault.Request memory r = _holdM4Placement();
        vm.prank(ADMISSION);
        vault.registerInvoice(keccak256("F-M4-NOUVELLE"), B_001, 20 * U);
        assertEq(vault.admittedDebts(), 40 * U);
        _assertM4PlacementRefused(r);
    }

    function test_M4_placementHausseReserve_refuseSansPaiement() public {
        IArgentVault.Request memory r = _holdM4Placement();
        vm.prank(OWNER);
        vault.setSafetyReserve(30 * U);
        assertEq(vault.safetyReserve(), 30 * U);
        _assertM4PlacementRefused(r);
    }

    /// @dev Contre-exemple M4 : cash 100, dettes 20, réserve 10, seuil 0, placement 60.
    function _holdM4Placement() internal returns (IArgentVault.Request memory r) {
        vm.startPrank(ADMISSION);
        vault.cancelInvoice(F_001);
        vault.cancelInvoice(F_002);
        vault.registerInvoice(keccak256("F-M4"), B_001, 20 * U);
        bytes32 placementId = keccak256("P-M4");
        vault.registerPlacement(placementId, B_PLACEMENT, 60 * U);
        vm.stopPrank();
        vm.startPrank(OWNER);
        vault.setSafetyReserve(10 * U);
        vault.setThreshold(0);
        vm.stopPrank();
        assertEq(vault.cash(), 100 * U);
        assertEq(vault.placeable(), 70 * U);
        r = _req(A_TRESO, ACTION_PLACE, placementId);
        _assertOutcome(r, DECISION_HUMAN, REASON_ABOVE_THRESHOLD);
        assertEq(vault.totalHeld(), 60 * U);
        assertEq(vault.heldPlacements(), 60 * U);
    }

    function _assertM4PlacementRefused(IArgentVault.Request memory r) internal {
        vm.recordLogs();
        vm.prank(APPROVER);
        vault.approve(r.requestId);
        Vm.Log[] memory logs = vm.getRecordedLogs();
        assertEq(vault.cash(), 100 * U, "approve ne doit pas verser le placement");
        assertEq(ACC_BPLACEMENT.balance, 0);
        assertEq(_countPaid(logs), 0);
        assertEq(logs.length, 2);
        assertEq(logs[0].emitter, address(vault));
        assertEq(logs[0].topics[0], IArgentVault.Decision.selector);
        assertEq(logs[0].topics[1], r.requestId);
        assertEq(logs[0].topics[2], r.agentId);
        assertEq(logs[0].topics[3], C_DEMO);
        assertEq(logs[0].data, abi.encode(ACTION_PLACE, DECISION_REFUSED, REASON_EXCEEDS_PLACEABLE, r.refId));
        assertEq(logs[1].emitter, address(vault));
        assertEq(logs[1].topics[0], IArgentVault.HoldReleased.selector);
        assertEq(logs[1].topics[1], r.requestId);
        assertEq(logs[1].topics[2], r.refId);
        assertEq(logs[1].data, abi.encode(60 * U));
        assertEq(vault.totalHeld(), 0);
        assertEq(vault.heldPlacements(), 0);
        assertEq(uint8(_placementStatus(r.refId)), uint8(IArgentVault.RefStatus.Admitted));
        (,,,, uint64 deadline) = vault.pendingApproval(r.requestId);
        assertEq(deadline, 0);
        assertTrue(vault.isConsumed(r.requestId));
        assertEq(vault.placeable(), 50 * U);
        vm.prank(APPROVER);
        vm.expectRevert(abi.encodeWithSelector(IArgentVault.NoPendingApproval.selector, r.requestId));
        vault.approve(r.requestId);
        _assertOutcome(r, DECISION_REFUSED, REASON_REQUEST_REPLAYED);
    }

    function test_Cas1_approbationAvantEcheance_paie() public {
        bytes32 id = _holdF002();
        // PAY_INVOICE conserve la marge même si les engagements changent pendant le hold.
        vm.prank(ADMISSION);
        vault.registerInvoice(keccak256("F-PAY-PENDANT-HOLD"), B_001, 20 * U);
        vm.prank(OWNER);
        vault.setSafetyReserve(30 * U);
        uint256 cashBefore = vault.cash();
        uint256 debtsBefore = vault.admittedDebts();
        uint256 placeableBefore = vault.placeable();
        vm.prank(APPROVER);
        vault.approve(id);
        assertEq(ACC_B002.balance, 30 * U);
        assertEq(uint8(_status(F_002)), uint8(IArgentVault.RefStatus.Settled));
        assertEq(vault.cash(), cashBefore - 30 * U);
        assertEq(vault.admittedDebts(), debtsBefore - 30 * U);
        assertEq(vault.placeable(), placeableBefore);
    }

    function test_Cas1_approbationApresEcheance_APPROVAL_TIMEOUT() public {
        bytes32 id = _holdF002();
        vm.warp(block.timestamp + 31);
        vm.expectEmit(true, true, true, true, address(vault));
        emit IArgentVault.Decision(
            id, A_DEM_1, C_DEMO, ACTION_PAY_INVOICE, DECISION_REFUSED, REASON_APPROVAL_TIMEOUT, F_002
        );
        vm.prank(APPROVER);
        vault.approve(id);
        assertEq(ACC_B002.balance, 0);
    }

    function test_Cas1_refusExplicite_APPROVAL_REFUSED() public {
        bytes32 id = _holdF002();
        vm.expectEmit(true, true, true, true, address(vault));
        emit IArgentVault.Decision(
            id, A_DEM_1, C_DEMO, ACTION_PAY_INVOICE, DECISION_REFUSED, REASON_APPROVAL_REFUSED, F_002
        );
        vm.expectEmit(true, true, false, true, address(vault));
        emit IArgentVault.HoldReleased(id, F_002, 30 * U);
        vm.prank(APPROVER);
        vault.refuse(id);
        assertEq(ACC_B002.balance, 0);
        assertEq(vault.totalHeld(), 0);
        assertEq(uint8(_status(F_002)), uint8(IArgentVault.RefStatus.Admitted), "la dette n'est pas eteinte");
        // Une nouvelle demande signée repart en cas 1.
        _holdF002();
    }

    function test_Cas1_approbationNePaieJamaisDeuxFois() public {
        bytes32 id = _holdF002();
        vm.prank(APPROVER);
        vault.approve(id);
        vm.prank(APPROVER);
        vm.expectRevert(abi.encodeWithSelector(IArgentVault.NoPendingApproval.selector, id));
        vault.approve(id);
        vm.prank(APPROVER);
        vm.expectRevert(abi.encodeWithSelector(IArgentVault.NoPendingApproval.selector, id));
        vault.refuse(id);
        vm.expectRevert(abi.encodeWithSelector(IArgentVault.NoPendingApproval.selector, id));
        vault.expire(id);
        assertEq(ACC_B002.balance, 30 * U);
        // Et la facture réglée ne repasse pas par une nouvelle demande.
        _assertOutcome(_req(A_DEM_1, ACTION_PAY_INVOICE, F_002), DECISION_REFUSED, REASON_INVOICE_ALREADY_PAID);
    }

    function test_Cas1_expireAvantEcheance_echoue() public {
        bytes32 id = _holdF002();
        uint64 deadline = uint64(block.timestamp + 30);
        vm.warp(deadline);
        vm.expectRevert(abi.encodeWithSelector(IArgentVault.DeadlineNotReached.selector, id, deadline));
        vault.expire(id);
    }

    function test_Cas1_placementBloque_heldPlacements() public {
        vm.prank(OWNER);
        vault.setThreshold(15 * U);
        IArgentVault.Request memory r = _req(A_TRESO, ACTION_PLACE, P_020);
        _assertOutcome(r, DECISION_HUMAN, REASON_ABOVE_THRESHOLD);
        assertEq(vault.heldPlacements(), 20 * U);
        assertEq(vault.totalHeld(), 20 * U);
        assertEq(vault.placeable(), 0);
        vm.prank(APPROVER);
        vault.approve(r.requestId);
        assertEq(ACC_BPLACEMENT.balance, 20 * U);
        assertEq(vault.heldPlacements(), 0);
        assertEq(vault.cash(), 80 * U);
        assertEq(vault.placeable(), 0);
    }

    function test_Cas1_approbationEnPause_echoue_refusPossible() public {
        bytes32 id = _holdF002();
        vm.prank(GUARDIAN);
        vault.pauseVault();
        vm.prank(APPROVER);
        vm.expectRevert(IArgentVault.VaultIsPaused.selector);
        vault.approve(id);
        vm.prank(APPROVER);
        vault.refuse(id);
        assertEq(ACC_B002.balance, 0);
    }

    function test_Cas1_approbationAgentEnPause_echoue_expirePossible() public {
        bytes32 id = _holdF002();
        vm.prank(GUARDIAN);
        vault.pauseAgent(A_DEM_1);
        vm.prank(APPROVER);
        vm.expectRevert(abi.encodeWithSelector(IArgentVault.AgentIsPaused.selector, A_DEM_1));
        vault.approve(id);
        vm.warp(block.timestamp + 31);
        vault.expire(id);
        assertEq(ACC_B002.balance, 0);
    }

    function test_Pause_coffre_aucuneSortie_seulProprietaireReprend() public {
        vm.expectEmit(true, false, false, false, address(vault));
        emit IArgentVault.VaultPaused(GUARDIAN);
        vm.prank(GUARDIAN);
        vault.pauseVault();

        IArgentVault.Request memory r = _req(A_DEM_1, ACTION_PAY_INVOICE, F_001);
        _assertOutcome(r, DECISION_REFUSED, REASON_VAULT_PAUSED);
        assertTrue(vault.isConsumed(r.requestId));
        _assertOutcome(_req(A_TRESO, ACTION_PLACE, P_020), DECISION_REFUSED, REASON_VAULT_PAUSED);
        assertEq(vault.cash(), 100 * U);

        vm.prank(GUARDIAN);
        vm.expectRevert(IArgentVault.VaultIsPaused.selector);
        vault.pauseVault();
        vm.prank(GUARDIAN);
        vm.expectRevert(abi.encodeWithSelector(IArgentVault.NotAuthorized.selector, GUARDIAN));
        vault.resumeVault();

        // Inscriptions et réglages restent possibles en pause.
        vm.prank(ADMISSION);
        vault.registerInvoice(keccak256("F-PAUSE"), B_001, 1 * U);

        vm.prank(OWNER);
        vault.resumeVault();
        vm.prank(OWNER);
        vm.expectRevert(IArgentVault.VaultNotPaused.selector);
        vault.resumeVault();
        _assertOutcome(_req(A_DEM_1, ACTION_PAY_INVOICE, F_001), DECISION_ACCEPTED, REASON_NONE);
    }

    function test_Pause_agent() public {
        vm.prank(GUARDIAN);
        vault.pauseAgent(A_DEM_1);
        _assertOutcome(_req(A_DEM_1, ACTION_PAY_INVOICE, F_001), DECISION_REFUSED, REASON_AGENT_PAUSED);
        // Un autre agent n'est pas touché.
        _assertOutcome(_req(A_DEM_3, ACTION_PAY_INVOICE, F_001), DECISION_ACCEPTED, REASON_NONE);

        vm.startPrank(GUARDIAN);
        vm.expectRevert(abi.encodeWithSelector(IArgentVault.AgentIsPaused.selector, A_DEM_1));
        vault.pauseAgent(A_DEM_1);
        vm.expectRevert(abi.encodeWithSelector(IArgentVault.UnknownAgent.selector, keccak256("A-?")));
        vault.pauseAgent(keccak256("A-?"));
        vm.stopPrank();

        vm.startPrank(OWNER);
        vm.expectRevert(abi.encodeWithSelector(IArgentVault.AgentNotPaused.selector, A_DEM_2));
        vault.resumeAgent(A_DEM_2);
        vault.resumeAgent(A_DEM_1);
        vm.stopPrank();
        assertFalse(vault.agentPaused(A_DEM_1));
    }
}

// =========================================================================
// Réentrance et transfert en échec
// =========================================================================

contract ArgentVaultReentrancyTest is ArgentVaultBase {
    function test_Reentrance_beneficiaireSansRole_neContournePasLaValidation() public {
        MaliciousBeneficiary attacker = new MaliciousBeneficiary(IArgentVault(address(vault)));
        bytes32 bAtt = keccak256("B-ATT");
        bytes32 fSmall = keccak256("F-ATT-10");
        bytes32 fBig = keccak256("F-ATT-30");
        vm.startPrank(ADMISSION);
        vault.registerBeneficiary(bAtt, payable(address(attacker)));
        vault.registerInvoice(fSmall, bAtt, 10 * U);
        vault.registerInvoice(fBig, bAtt, 30 * U);
        vm.stopPrank();

        // Grosse facture en cas 1, puis petite payée : le bénéficiaire tente de s'approuver.
        IArgentVault.Request memory held = _req(A_DEM_1, ACTION_PAY_INVOICE, fBig);
        _assertOutcome(held, DECISION_HUMAN, REASON_ABOVE_THRESHOLD);
        attacker.setPending(held.requestId);

        vm.recordLogs();
        _assertOutcome(_req(A_DEM_1, ACTION_PAY_INVOICE, fSmall), DECISION_ACCEPTED, REASON_NONE);
        assertEq(_countPaid(vm.getRecordedLogs()), 1);
        assertEq(attacker.received(), 10 * U, "paye une seule fois, le montant inscrit");
        assertEq(attacker.reentrySuccesses(), 0);
        assertEq(attacker.reentryFailures(), 2);
        (,,,, uint64 deadline) = vault.pendingApproval(held.requestId);
        assertGt(deadline, 0, "le cas 1 reste en attente");
        assertEq(vault.totalHeld(), 30 * U);
    }

    function test_Reentrance_relaisMalveillant_bloqueParLeVerrou() public {
        ReentrantRelay attacker = new ReentrantRelay();
        ArgentVault v = new ArgentVault(OWNER, ADMISSION, address(attacker), APPROVER, GUARDIAN, C_DEMO, clientSigner);
        attacker.setVault(IArgentVault(address(v)));
        _seed(v, address(attacker), ACC_B002, ACC_BPLACEMENT);

        IArgentVault.Request memory r1 = _req(A_DEM_1, ACTION_PAY_INVOICE, F_001);
        IArgentVault.Request memory r2 = _req(A_DEM_1, ACTION_PAY_INVOICE, F_001);
        attacker.arm(r2, _signWith(v, clientPk, r2));

        vm.recordLogs();
        (uint8 d,) = attacker.go(r1, _signWith(v, clientPk, r1));
        Vm.Log[] memory logs = vm.getRecordedLogs();
        uint256 paid;
        for (uint256 i = 0; i < logs.length; ++i) {
            if (logs[i].topics[0] == IArgentVault.Paid.selector) ++paid;
        }
        assertEq(d, DECISION_ACCEPTED);
        assertEq(paid, 1, "un seul Paid");
        assertEq(attacker.received(), 10 * U);
        assertEq(attacker.lastError(), abi.encodeWithSelector(ArgentVault.Reentrancy.selector));
        assertFalse(v.isConsumed(r2.requestId), "l'appel reentrant n'a rien consomme");
        assertEq(v.cash(), 90 * U);
    }

    function test_Reentrance_approbateurMalveillant_neRepaiePas() public {
        ReentrantApprover attacker = new ReentrantApprover();
        ArgentVault v = new ArgentVault(OWNER, ADMISSION, RELAY, address(attacker), GUARDIAN, C_DEMO, clientSigner);
        attacker.setVault(IArgentVault(address(v)));
        _seed(v, ACC_B001, address(attacker), ACC_BPLACEMENT);

        IArgentVault.Request memory r = _req(A_DEM_1, ACTION_PAY_INVOICE, F_002);
        bytes memory sig = _signWith(v, clientPk, r);
        vm.prank(RELAY);
        (uint8 d,) = v.submit(r, sig);
        assertEq(d, DECISION_HUMAN);

        attacker.approveOnce(r.requestId);
        assertEq(attacker.received(), 30 * U, "paye une seule fois");
        assertEq(attacker.lastError(), abi.encodeWithSelector(ArgentVault.Reentrancy.selector));
        assertEq(v.cash(), 70 * U);
        assertEq(v.totalHeld(), 0);
    }

    function test_TransfertEnEchec_submit_toutEstAnnule() public {
        RevertingReceiver sink = new RevertingReceiver();
        bytes32 bRev = keccak256("B-REV");
        bytes32 fRev = keccak256("F-REV");
        vm.startPrank(ADMISSION);
        vault.registerBeneficiary(bRev, payable(address(sink)));
        vault.registerInvoice(fRev, bRev, 5 * U);
        vm.stopPrank();
        uint256 debts = vault.admittedDebts();

        IArgentVault.Request memory r = _req(A_DEM_1, ACTION_PAY_INVOICE, fRev);
        bytes memory sig = _sign(r);
        vm.prank(RELAY);
        vm.expectRevert(abi.encodeWithSelector(IArgentVault.TransferFailed.selector, bRev));
        vault.submit(r, sig);

        assertFalse(vault.isConsumed(r.requestId), "identifiant non consomme");
        assertEq(uint8(_status(fRev)), uint8(IArgentVault.RefStatus.Admitted));
        assertEq(vault.cash(), 100 * U);
        assertEq(vault.admittedDebts(), debts);
    }

    function test_TransfertEnEchec_approve_toutEstAnnule() public {
        RevertingReceiver sink = new RevertingReceiver();
        bytes32 bRev = keccak256("B-REV");
        bytes32 fRev = keccak256("F-REV-30");
        vm.startPrank(ADMISSION);
        vault.registerBeneficiary(bRev, payable(address(sink)));
        vault.registerInvoice(fRev, bRev, 30 * U);
        vm.stopPrank();
        IArgentVault.Request memory r = _req(A_DEM_1, ACTION_PAY_INVOICE, fRev);
        _assertOutcome(r, DECISION_HUMAN, REASON_ABOVE_THRESHOLD);

        vm.prank(APPROVER);
        vm.expectRevert(abi.encodeWithSelector(IArgentVault.TransferFailed.selector, bRev));
        vault.approve(r.requestId);

        (,,,, uint64 deadline) = vault.pendingApproval(r.requestId);
        assertGt(deadline, 0, "cas 1 toujours en attente");
        assertEq(vault.totalHeld(), 30 * U);
        assertEq(uint8(_status(fRev)), uint8(IArgentVault.RefStatus.Held));
        assertEq(vault.cash(), 100 * U);
    }
}

// =========================================================================
// Vecteurs de specs/examples/request/vectors.json
// =========================================================================

contract ArgentVaultVectorsTest is ArgentVaultBase {
    address internal constant VECTOR_VAULT = 0x1111111111111111111111111111111111111111;
    address internal constant EXPECTED_SIGNER = 0x2294022049feAae4987F70D940Af08735D4aF542;
    bytes32 internal constant DOMAIN_SEPARATOR = 0xa6eeee6f237cff2ac6c4724d382d4ced1a06bafb55b0708fbe164288e40a2bae;

    struct Vector {
        IArgentVault.Request message;
        bytes32 digest;
        bytes signature;
        uint256 now_;
    }

    function setUp() public override {
        vm.chainId(31337);
        deployCodeTo(
            "ArgentVault.sol:ArgentVault",
            abi.encode(OWNER, ADMISSION, RELAY, APPROVER, GUARDIAN, C_DEMO, EXPECTED_SIGNER),
            VECTOR_VAULT
        );
        vault = ArgentVault(VECTOR_VAULT);
        _seed(vault, ACC_B001, ACC_B002, ACC_BPLACEMENT);
    }

    function _vectors() internal pure returns (Vector[5] memory v) {
        v[0] = Vector(
            IArgentVault.Request(
                0x0f9f1aa766995cb9ffaf28a5118ea931ce433c676d2be21e30efa5b3eaea48ff,
                C_DEMO,
                A_DEM_1,
                1,
                F_001,
                1791662400,
                1791662520
            ),
            0x5ee250e296a956296afa86a74773da223d447cab7b4cadb03007a705eed35b1f,
            hex"4c82228d8a7efb9c7b7e289732532bbdc5b8460e8c5d8b4d2638daa846bd421d7ee55b451925d8dd766b8351c4f866daa1def50869809c94f0a991288a9b845b1c",
            1791662410
        );
        v[1] = Vector(
            IArgentVault.Request(
                0xb95585833d21070853fd3a207802ef54fa27fcbe847ae387bb25f15b79dd2d81,
                C_DEMO,
                A_TRESO,
                2,
                P_020,
                1791663000,
                1791663060
            ),
            0xe8b470528ab46df4cabec80c53d559e3f322937db251dc3f18a2d4a3d443fec3,
            hex"1b785afb1bfd7246bbfef57fc8d4da571143c97922999a372b464e53a85140b6407e3b4054be6cd7cb07568c02edb9ab461ba6b862fe35991ef9d2bbb9e44f641b",
            1791663005
        );
        v[2] = Vector(
            IArgentVault.Request(
                0x02db3ae3cd8821807a1ef2ea891b144ecb56aa167bc4b28b470564d5263e355a,
                C_DEMO,
                A_DEM_1,
                1,
                F_002,
                1791663600,
                1791663900
            ),
            0x1c6047113e5e7c0ece282a505f225e5788bf3cd3b1cc594c4e13259fd340f706,
            hex"baea1bec97fa3e8061ee7acd4990139be5d800529e37122f338bd62796fe7b2e2af14b4e18fbf5328a903ae5ff0a167330af2491462c20665d6449ec8b19488c1b",
            1791663900
        );
        v[3] = Vector(
            IArgentVault.Request(
                0xe9c3eba71a7c9fb919c63b4422e3daea64f55f8d271221c5b3a37826956f6719,
                C_DEMO,
                A_DEM_1,
                1,
                F_001,
                1791662400,
                1791662520
            ),
            0xb30d5460a6a9e414525ce1f9082f8d099bc727898e5919eacf26bb954c52c307,
            hex"c7758dbc5340800ae2aa58e08aab0f82489a9ea354b5482cc422c4fbd35161ad444c9c26c00278b21b32bbdc50778ae37a7960ff5a9cff7c89bfbdd4499312401c",
            1791662521
        );
        v[4] = Vector(
            IArgentVault.Request(
                0xb97fb86f3263f33a116a076f13b3e915eda91885bc54effc8ad895ec17892862,
                C_DEMO,
                A_DEM_1,
                1,
                F_001,
                1791662400,
                1791662701
            ),
            0xcfa7cf0a3853a6c1e1a7db5fd7bef14fe111a8f0fd2a9c5c7e8b29d95ec18ffc,
            hex"40d84ad303f336de5dd30ed68628f4b92f232e86e51a2ca862964c4f471c8f9f0db56c50190d7cd1feef4b1fe41ac25556b6b22c4d94d6dafba81ea8f354980b1b",
            1791662410
        );
    }

    function test_Vecteurs_domaineEtEmpreintes() public view {
        assertEq(vault.domainSeparator(), DOMAIN_SEPARATOR);
        Vector[5] memory v = _vectors();
        for (uint256 i = 0; i < v.length; ++i) {
            assertEq(vault.hashRequest(v[i].message), v[i].digest, "empreinte a signer");
        }
    }

    function test_Vecteurs_adresseRecupereeAttendue() public view {
        Vector[5] memory v = _vectors();
        for (uint256 i = 0; i < v.length; ++i) {
            bytes memory s = v[i].signature;
            bytes32 r;
            bytes32 ss;
            uint8 sv;
            assembly {
                r := mload(add(s, 32))
                ss := mload(add(s, 64))
                sv := byte(0, mload(add(s, 96)))
            }
            assertEq(ecrecover(vault.hashRequest(v[i].message), sv, r, ss), EXPECTED_SIGNER);
        }
    }

    function _play(uint256 i, uint8 decision, uint8 reason) internal {
        Vector memory v = _vectors()[i];
        vm.warp(v.now_);
        vm.prank(RELAY);
        (uint8 d, uint8 why) = vault.submit(v.message, v.signature);
        assertEq(d, decision, "decision");
        assertEq(why, reason, "motif");
    }

    function test_Vecteur01_paiementFacture() public {
        _play(0, DECISION_ACCEPTED, REASON_NONE);
    }

    function test_Vecteur02_placement() public {
        _play(1, DECISION_ACCEPTED, REASON_NONE);
    }

    function test_Vecteur03_auDessusDuSeuil_auxDeuxBornes() public {
        _play(2, DECISION_HUMAN, REASON_ABOVE_THRESHOLD);
    }

    function test_Vecteur04_expiree() public {
        _play(3, DECISION_REFUSED, REASON_REQUEST_EXPIRED);
    }

    function test_Vecteur05_dureeTropLongue() public {
        _play(4, DECISION_REFUSED, REASON_VALIDITY_WINDOW_INVALID);
    }
}

// =========================================================================
// Invariants (fuzz)
// =========================================================================

/// @notice Suites d'appels aléatoires par les bons rôles, avec signature du client.
contract VaultHandler is Test {
    ArgentVault internal vault;
    uint256 internal pk;
    address internal relay;
    address internal approver;
    address internal guardian;
    address internal owner;
    address internal admission;

    bytes32[] public invoices;
    bytes32[] public placements;
    bytes32[] internal agents;
    bytes32[] internal pendings;

    uint256 public totalFunded;
    uint256 public totalPaid;
    bool public placementBreach; // I3 violé
    mapping(bytes32 => uint256) public paidCount;
    uint256 internal nonce;
    uint256 internal invoiceNonce;

    constructor(
        ArgentVault vault_,
        uint256 pk_,
        address[4] memory roles,
        bytes32[] memory invoices_,
        bytes32[] memory placements_,
        bytes32[] memory agents_,
        uint256 initialFunds
    ) {
        vault = vault_;
        pk = pk_;
        (owner, relay, approver, guardian) = (roles[0], roles[1], roles[2], roles[3]);
        admission = vault_.admission();
        invoices = invoices_;
        placements = placements_;
        agents = agents_;
        totalFunded = initialFunds;
    }

    function invoiceCount() external view returns (uint256) {
        return invoices.length;
    }

    function placementCount() external view returns (uint256) {
        return placements.length;
    }

    function submit(uint256 refSeed, uint256 agentSeed, bool place, bool replay) external {
        bytes32 refId = place ? placements[refSeed % placements.length] : invoices[refSeed % invoices.length];
        bytes32 requestId = replay && nonce > 0 ? keccak256(abi.encode(nonce)) : keccak256(abi.encode(++nonce));
        IArgentVault.Request memory r = IArgentVault.Request({
            requestId: requestId,
            clientId: vault.clientId(),
            agentId: agents[agentSeed % agents.length],
            action: place ? ACTION_PLACE : ACTION_PAY_INVOICE,
            refId: refId,
            issuedAt: uint64(block.timestamp),
            expiresAt: uint64(block.timestamp + 30)
        });
        (uint8 sv, bytes32 sr, bytes32 ss) = vm.sign(pk, vault.hashRequest(r));
        bytes memory sig = abi.encodePacked(sr, ss, sv);
        vm.recordLogs();
        vm.prank(relay);
        vault.submit(r, sig);
        _scan(place);
    }

    function approve(uint256 seed) external {
        if (pendings.length == 0) return;
        bytes32 id = pendings[seed % pendings.length];
        (,,,, uint64 deadline) = vault.pendingApproval(id);
        if (deadline == 0 || vault.vaultPaused()) return;
        (bytes32 agentId, uint8 action,,,) = vault.pendingApproval(id);
        if (vault.agentPaused(agentId)) return;
        vm.recordLogs();
        vm.prank(approver);
        vault.approve(id);
        _scan(action == ACTION_PLACE);
    }

    function refuse(uint256 seed) external {
        if (pendings.length == 0) return;
        bytes32 id = pendings[seed % pendings.length];
        (,,,, uint64 deadline) = vault.pendingApproval(id);
        if (deadline == 0) return;
        vm.prank(approver);
        vault.refuse(id);
    }

    function expire(uint256 seed) external {
        if (pendings.length == 0) return;
        bytes32 id = pendings[seed % pendings.length];
        (,,,, uint64 deadline) = vault.pendingApproval(id);
        if (deadline == 0 || block.timestamp <= deadline) return;
        vault.expire(id);
    }

    function warp(uint256 dt) external {
        vm.warp(block.timestamp + bound(dt, 0, 60));
    }

    function fund(uint256 amount) external {
        amount = bound(amount, 1, 50e15);
        vm.deal(address(this), amount);
        vault.fund{value: amount}();
        totalFunded += amount;
    }

    function registerInvoice(uint256 amount, uint256 seed) external {
        amount = bound(amount, 1, 50e15);
        bytes32 invoiceId = keccak256(abi.encode("F-HANDLER", ++invoiceNonce));
        (bytes32 beneficiaryId,,) = vault.invoice(invoices[seed % invoices.length]);
        vm.prank(admission);
        vault.registerInvoice(invoiceId, beneficiaryId, amount);
        invoices.push(invoiceId);
    }

    function setSafetyReserve(uint256 amount) external {
        vm.prank(owner);
        vault.setSafetyReserve(bound(amount, 0, 100e15));
    }

    function togglePause(bool vaultLevel, uint256 agentSeed) external {
        if (vaultLevel) {
            if (vault.vaultPaused()) {
                vm.prank(owner);
                vault.resumeVault();
            } else {
                vm.prank(guardian);
                vault.pauseVault();
            }
            return;
        }
        bytes32 a = agents[agentSeed % agents.length];
        if (vault.agentPaused(a)) {
            vm.prank(owner);
            vault.resumeAgent(a);
        } else {
            vm.prank(guardian);
            vault.pauseAgent(a);
        }
    }

    function _scan(bool place) internal {
        Vm.Log[] memory logs = vm.getRecordedLogs();
        for (uint256 i = 0; i < logs.length; ++i) {
            if (logs[i].emitter != address(vault)) continue;
            bytes32 topic = logs[i].topics[0];
            if (topic == IArgentVault.Paid.selector) {
                ++paidCount[logs[i].topics[2]];
                totalPaid += abi.decode(logs[i].data, (uint256));
                if (place && vault.cash() < vault.admittedDebts() + vault.safetyReserve()) placementBreach = true;
            } else if (topic == IArgentVault.HoldPlaced.selector) {
                pendings.push(logs[i].topics[1]);
            }
        }
    }
}

contract ArgentVaultInvariantTest is ArgentVaultBase {
    VaultHandler internal handler;

    function setUp() public override {
        super.setUp();
        // Factures et placements supplémentaires, de part et d'autre du seuil (25).
        bytes32[] memory inv = new bytes32[](6);
        bytes32[] memory pla = new bytes32[](4);
        inv[0] = F_001;
        inv[1] = F_002;
        pla[0] = P_020;
        pla[1] = P_030;
        vm.startPrank(ADMISSION);
        for (uint256 i = 2; i < 6; ++i) {
            inv[i] = keccak256(abi.encode("F-INV", i));
            vault.registerInvoice(inv[i], i % 2 == 0 ? B_001 : B_002, (i * 9) * U);
        }
        for (uint256 i = 2; i < 4; ++i) {
            pla[i] = keccak256(abi.encode("P-INV", i));
            vault.registerPlacement(pla[i], B_PLACEMENT, (i * 7) * U);
        }
        vm.stopPrank();

        bytes32[] memory ags = new bytes32[](4);
        (ags[0], ags[1], ags[2], ags[3]) = (A_DEM_1, A_DEM_2, A_TRESO, A_LECT);
        handler = new VaultHandler(vault, clientPk, [OWNER, RELAY, APPROVER, GUARDIAN], inv, pla, ags, 100 * U);
        targetContract(address(handler));
    }

    /// I1 : une facture (ou un placement) n'est payée qu'au plus une fois.
    function invariant_I1_AuPlusUnPaiementParReference() public view {
        for (uint256 i = 0; i < handler.invoiceCount(); ++i) {
            assertLe(handler.paidCount(handler.invoices(i)), 1);
        }
        for (uint256 i = 0; i < handler.placementCount(); ++i) {
            assertLe(handler.paidCount(handler.placements(i)), 1);
        }
    }

    /// La somme payée ne dépasse jamais les fonds reçus ; le cash en est l'exacte différence.
    function invariant_SommePayeeBorneeParLesFondsRecus() public view {
        assertLe(handler.totalPaid(), handler.totalFunded());
        assertEq(vault.cash(), handler.totalFunded() - handler.totalPaid());
    }

    /// I3 : un placement ne fait jamais passer le cash sous dettes plus réserve.
    function invariant_I3_PlacementSousReserve() public view {
        assertFalse(handler.placementBreach());
    }

    /// I4 : le montant bloqué est toujours couvert.
    function invariant_I4_MontantBloqueCouvert() public view {
        assertLe(vault.totalHeld(), vault.cash());
        assertLe(vault.heldPlacements(), vault.totalHeld());
    }

    /// I5 : admittedDebts égale la somme des factures Admitted et Held.
    function invariant_I5_DettesAdmises() public view {
        uint256 sum;
        for (uint256 i = 0; i < handler.invoiceCount(); ++i) {
            (, uint256 amount, IArgentVault.RefStatus s) = vault.invoice(handler.invoices(i));
            if (s == IArgentVault.RefStatus.Admitted || s == IArgentVault.RefStatus.Held) sum += amount;
        }
        assertEq(vault.admittedDebts(), sum);
    }
}
