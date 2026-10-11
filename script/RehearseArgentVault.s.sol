// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.24;

import {Script, console} from "forge-std/Script.sol";
import {ArgentVault} from "../src/ArgentVault.sol";
import "../specs/contract/IArgentVault.sol";

/// @notice Répétition d'ArgentVault sur le L1 Team19 (Subnet-EVM, chainId 191919), sur la
///         chaîne réelle : chaque appel est une transaction, chaque signature EIP-712 est
///         calculée pour 191919 et pour l'adresse du coffre.
/// @dev Deux temps, séparés par l'attente du délai d'approbation (le L1 ne produit un bloc
///      qu'à chaque transaction : block.timestamp ne bouge pas sans trafic).
///
///        run()     paramètres, agent, bénéficiaire, deux factures, fund ;
///                  R1 décision 2 (F-001 payée) ; R2 décision 1 puis refuse ;
///                  R3 décision 1, laissée en attente pour expire.
///        (attente > APPROVAL_DELAY, puis une transaction neutre pour faire avancer la chaîne)
///        finish()  expire(R3) ; R4 décision 1 puis approve (F-002 payée) ;
///                  rejeu de R1 ; R5 à signature invalide, non consommée ;
///                  pauseVault puis resumeVault.
///
///      Une seule répétition par coffre neuf : run() refuse un coffre déjà approvisionné.
///      Avant run(), envoyer aussi une transaction neutre si le dernier bloc a plus de
///      quelques minutes : la simulation de forge prend l'horodatage du dernier bloc, et
///      issuedAt en dépend (fenêtre MAX_TTL de 300 s).
///
///      Variables : VAULT_ADDRESS, puis les clés de TEST de DeployArgentVault.s.sol
///      (OWNER_PRIVATE_KEY, ADMISSION_PRIVATE_KEY, RELAYER, APPROVER_PRIVATE_KEY,
///      GUARDIAN_PRIVATE_KEY, CLIENT_SIGNER), fournies à l'exécution, jamais écrites.
///
///      Usage :
///        forge script script/RehearseArgentVault.s.sol --rpc-url <RPC> --broadcast --slow
///        forge script script/RehearseArgentVault.s.sol --sig "finish()" --rpc-url <RPC> --broadcast --slow
contract RehearseArgentVault is Script {
    uint256 internal constant TEAM19_L1 = 191919;

    // Monde de specs/examples/fixtures.json : 1 unité = 10^15 wei.
    uint256 internal constant UNIT = 1e15;
    uint256 internal constant CASH = 100 * UNIT;
    uint256 internal constant F001_AMOUNT = 10 * UNIT; // sous le seuil : décision 2
    uint256 internal constant F002_AMOUNT = 30 * UNIT; // au-dessus du seuil : décision 1
    uint256 internal constant THRESHOLD = 25 * UNIT;
    uint256 internal constant SAFETY_RESERVE = 40 * UNIT;
    uint64 internal constant APPROVAL_DELAY = 30; // secondes
    uint64 internal constant TTL = 300; // MAX_TTL

    bytes32 internal constant A_DEM_1 = 0x4c399b1cfd777c598778cfcdefdea719b040cc331ac368cba4957cb221ab7376;
    bytes32 internal constant B_001 = 0x33ffa397770ec2817195fde557898e4c16950c03357f8460e0b908a8679c1f2c;
    bytes32 internal constant F_001 = 0x0665d8d815dfef587a495604ca870d4b3f510bfaabe41553ad691024b8d4b49c;
    bytes32 internal constant F_002 = 0x6caf3d2be4cf3cd29da1a2c49da20583230f10e51e083d953fb70778efa0ce3e;

    bytes32 internal constant DOMAIN_TYPEHASH =
        keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)");
    bytes32 internal constant REQUEST_TYPEHASH = keccak256(
        "Request(bytes32 requestId,bytes32 clientId,bytes32 agentId,uint8 action,bytes32 refId,uint64 issuedAt,uint64 expiresAt)"
    );

    ArgentVault internal vault;
    uint256 internal ownerKey;
    uint256 internal admissionKey;
    uint256 internal relayKey;
    uint256 internal approverKey;
    uint256 internal guardianKey;
    uint256 internal clientKey;

    // ------------------------------------------------------------------
    // Premier temps
    // ------------------------------------------------------------------

    function run() external {
        _load();
        require(vault.cash() == 0 && vault.beneficiary(B_001) == address(0), "coffre deja repete");
        address payable b001 = beneficiaryAccount();
        uint256 b001Before = b001.balance;

        vm.startBroadcast(ownerKey);
        vault.setThreshold(THRESHOLD);
        vault.setSafetyReserve(SAFETY_RESERVE);
        vault.setApprovalDelay(APPROVAL_DELAY);
        vault.registerAgent(A_DEM_1, ACTION_PAY_INVOICE);
        vm.stopBroadcast();

        vm.startBroadcast(admissionKey);
        vault.registerBeneficiary(B_001, b001);
        vault.registerInvoice(F_001, B_001, F001_AMOUNT);
        vault.registerInvoice(F_002, B_001, F002_AMOUNT);
        vm.stopBroadcast();

        vm.broadcast(ownerKey);
        vault.fund{value: CASH}();

        // R1 : F-001, 10 ≤ seuil 25, cash 100 : décision 2, paiement natif.
        IArgentVault.Request memory r1 = _request(1, F_001);
        _submitExpect(r1, _sign(clientKey, r1), DECISION_ACCEPTED, REASON_NONE, "R1");
        require(b001.balance - b001Before == F001_AMOUNT, "R1 : solde du beneficiaire");

        // R2 : F-002, 30 > seuil 25 : décision 1, puis refus de l'approbateur.
        IArgentVault.Request memory r2 = _request(2, F_002);
        _submitExpect(r2, _sign(clientKey, r2), DECISION_HUMAN, REASON_ABOVE_THRESHOLD, "R2");
        vm.broadcast(approverKey);
        vault.refuse(requestId(2));

        // R3 : F-002 redevenue due : décision 1, laissée en attente pour expire (finish).
        IArgentVault.Request memory r3 = _request(3, F_002);
        _submitExpect(r3, _sign(clientKey, r3), DECISION_HUMAN, REASON_ABOVE_THRESHOLD, "R3");

        console.log("coffre", address(vault));
        console.log("beneficiaire B-001", b001);
        console.log("solde B-001 (wei)", b001.balance);
        console.log("cash (wei)", vault.cash());
        (,,,, uint64 deadline) = vault.pendingApproval(requestId(3));
        console.log("echeance R3", deadline);
        console.log("issuedAt R1", r1.issuedAt);
    }

    // ------------------------------------------------------------------
    // Second temps, après l'échéance de R3
    // ------------------------------------------------------------------

    function finish() external {
        _load();
        address payable b001 = beneficiaryAccount();
        (,,,, uint64 deadline) = vault.pendingApproval(requestId(3));
        require(deadline != 0, "R3 absente");
        require(block.timestamp > deadline, "echeance de R3 non atteinte : transaction neutre d'abord");

        // R3 : délai dépassé, expire ouverte à tous (ici le gardien, qui ne fait que refuser).
        vm.broadcast(guardianKey);
        vault.expire(requestId(3));

        // R4 : F-002, nouvelle demande, décision 1 puis approbation et paiement.
        uint256 b001Before = b001.balance;
        IArgentVault.Request memory r4 = _request(4, F_002);
        _submitExpect(r4, _sign(clientKey, r4), DECISION_HUMAN, REASON_ABOVE_THRESHOLD, "R4");
        vm.broadcast(approverKey);
        vault.approve(requestId(4));
        require(b001.balance - b001Before == F002_AMOUNT, "R4 : solde du beneficiaire");

        // Rejeu de R1, signature valide : REQUEST_REPLAYED.
        // issuedAt de R1 : imprimé par run(), passé par REPLAY_ISSUED_AT (demande identique).
        IArgentVault.Request memory r1 = _request(1, F_001);
        r1.issuedAt = uint64(vm.envUint("REPLAY_ISSUED_AT"));
        r1.expiresAt = r1.issuedAt + TTL;
        _submitExpect(r1, _sign(clientKey, r1), DECISION_REFUSED, REASON_REQUEST_REPLAYED, "rejeu R1");

        // R5 : signée par une autre clé que le signataire du client : refus, non consommée.
        IArgentVault.Request memory r5 = _request(5, F_001);
        _submitExpect(r5, _sign(relayKey, r5), DECISION_REFUSED, REASON_SIGNATURE_INVALID, "R5");
        require(!vault.isConsumed(requestId(5)), "R5 consommee");

        vm.broadcast(guardianKey);
        vault.pauseVault();
        require(vault.vaultPaused(), "pause");
        vm.broadcast(ownerKey);
        vault.resumeVault();
        require(!vault.vaultPaused(), "reprise");

        console.log("solde B-001 (wei)", b001.balance);
        console.log("cash (wei)", vault.cash());
        console.log("admittedDebts (wei)", vault.admittedDebts());
        console.log("totalHeld (wei)", vault.totalHeld());
        console.log("placeable (wei)", vault.placeable());
    }

    // ------------------------------------------------------------------
    // Valeurs relues par le shell
    // ------------------------------------------------------------------

    /// @notice Identifiant de la n-ième demande, propre à ce coffre : reproductible entre
    ///         run() et finish(), distinct d'un coffre à l'autre.
    function requestId(uint256 n) public view returns (bytes32) {
        return keccak256(abi.encode("Team19/vault-l1/request", address(vault), n));
    }

    /// @notice Adresse de paiement de B-001 : sans clé connue, solde de départ nul.
    function beneficiaryAccount() public pure returns (address payable) {
        return payable(address(uint160(uint256(keccak256("Team19/vault-l1/B-001")))));
    }

    // ------------------------------------------------------------------
    // Interne
    // ------------------------------------------------------------------

    function _load() internal {
        require(block.chainid == TEAM19_L1, "L1 191919 seulement");
        vault = ArgentVault(vm.envAddress("VAULT_ADDRESS"));
        ownerKey = vm.envUint("OWNER_PRIVATE_KEY");
        admissionKey = vm.envUint("ADMISSION_PRIVATE_KEY");
        relayKey = vm.envUint("RELAYER");
        approverKey = vm.envUint("APPROVER_PRIVATE_KEY");
        guardianKey = vm.envUint("GUARDIAN_PRIVATE_KEY");
        clientKey = vm.envUint("CLIENT_SIGNER");
        require(vm.addr(ownerKey) == vault.owner(), "cle du proprietaire");
        require(vm.addr(relayKey) == vault.relay(), "cle du relais");
        require(vm.addr(clientKey) == vault.clientSigner(), "cle du signataire");
    }

    function _request(uint256 n, bytes32 refId) internal view returns (IArgentVault.Request memory r) {
        uint64 issuedAt = uint64(block.timestamp);
        r = IArgentVault.Request({
            requestId: requestId(n),
            clientId: vault.clientId(),
            agentId: A_DEM_1,
            action: ACTION_PAY_INVOICE,
            refId: refId,
            issuedAt: issuedAt,
            expiresAt: issuedAt + TTL
        });
    }

    /// @dev Empreinte EIP-712 recalculée ici, pour 191919 et l'adresse du coffre, puis
    ///      comparée à celle du contrat : une divergence arrête le script.
    function _digest(IArgentVault.Request memory r) internal view returns (bytes32) {
        bytes32 domain =
            keccak256(abi.encode(DOMAIN_TYPEHASH, keccak256("ArgentVault"), keccak256("1"), TEAM19_L1, address(vault)));
        require(domain == vault.domainSeparator(), "domaine EIP-712");
        bytes32 structHash = keccak256(
            abi.encode(REQUEST_TYPEHASH, r.requestId, r.clientId, r.agentId, r.action, r.refId, r.issuedAt, r.expiresAt)
        );
        bytes32 digest = keccak256(abi.encodePacked(hex"1901", domain, structHash));
        require(digest == vault.hashRequest(r), "empreinte EIP-712");
        return digest;
    }

    function _sign(uint256 key, IArgentVault.Request memory r) internal view returns (bytes memory) {
        (uint8 v, bytes32 rr, bytes32 s) = vm.sign(key, _digest(r));
        return abi.encodePacked(rr, s, v);
    }

    /// @dev Soumet par le relais et exige l'issue attendue. La simulation de forge précède
    ///      la diffusion : une issue différente arrête le script avant tout envoi. L'issue
    ///      réelle sur la chaîne est relue ensuite par cast (événements Decision).
    function _submitExpect(
        IArgentVault.Request memory r,
        bytes memory sig,
        uint8 wantDecision,
        uint8 wantReason,
        string memory label
    ) internal {
        vm.broadcast(relayKey);
        (uint8 d, uint8 why) = vault.submit(r, sig);
        require(d == wantDecision && why == wantReason, label);
        console.log(label, d, why);
    }
}
