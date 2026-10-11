// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.24;

import {Script, console} from "forge-std/Script.sol";
import {ArgentVault} from "../src/ArgentVault.sol";

/// @notice Déploie ArgentVault : cinq rôles, le client et son signataire. Rien d'autre :
///         ni paramètre, ni agent, ni facture, ni approvisionnement (voir demo/seed.mjs).
/// @dev Chaînes cibles : anvil (31337) et le L1 de démo Team19 (Subnet-EVM, chainId 191919,
///      jeton natif VETO). Toute autre chaîne est refusée.
///
///      Variables (noms de .env.example) : clés de TEST uniquement, jamais écrites dans le
///      dépôt. Chaque adresse de rôle est dérivée de sa clé ; seule celle du propriétaire signe.
///        OWNER_PRIVATE_KEY       propriétaire, déployeur (seule clé qui diffuse)
///        ADMISSION_PRIVATE_KEY   admission
///        RELAYER                 relais
///        APPROVER_PRIVATE_KEY    approbateur
///        GUARDIAN_PRIVATE_KEY    gardien
///        CLIENT_SIGNER           signataire du client
///        CLIENT_ID               facultatif, défaut C-DEMO (specs/examples/fixtures.json),
///                                le même défaut que relay/
///
///      Contraintes du L1 191919 :
///      - TxAllowList active : le déployeur (propriétaire) et chaque rôle qui écrit
///        (admission, relais, approbateur, gardien) doivent être admis par l'admin du L1
///        AVANT le déploiement, sinon leurs transactions sont rejetées.
///      - Un bloc n'est produit qu'à chaque transaction : block.timestamp n'avance pas sans
///        trafic. L'expiration d'une demande et l'échéance d'un cas 1 ne sont constatées
///        qu'au bloc suivant.
///
///      Usage local :
///        forge script script/DeployArgentVault.s.sol --rpc-url http://127.0.0.1:8545 --broadcast
contract DeployArgentVault is Script {
    uint256 internal constant ANVIL = 31337;
    uint256 internal constant TEAM19_L1 = 191919;

    /// @dev C-DEMO de specs/examples/fixtures.json.
    bytes32 internal constant DEFAULT_CLIENT_ID = 0xce665c932b8b6adb314bf6ba6b5561b528027ce19de675f4c3136d7f91bf23a8;

    function run() external returns (ArgentVault vault) {
        require(block.chainid == ANVIL || block.chainid == TEAM19_L1, "chaine non prise en charge");

        uint256 ownerKey = vm.envUint("OWNER_PRIVATE_KEY");
        address admission = vm.addr(vm.envUint("ADMISSION_PRIVATE_KEY"));
        address relay = vm.addr(vm.envUint("RELAYER"));
        address approver = vm.addr(vm.envUint("APPROVER_PRIVATE_KEY"));
        address guardian = vm.addr(vm.envUint("GUARDIAN_PRIVATE_KEY"));
        address clientSigner = vm.addr(vm.envUint("CLIENT_SIGNER"));
        bytes32 clientId = vm.envOr("CLIENT_ID", DEFAULT_CLIENT_ID);

        vm.startBroadcast(ownerKey);
        vault = new ArgentVault(vm.addr(ownerKey), admission, relay, approver, guardian, clientId, clientSigner);
        vm.stopBroadcast();

        console.log("ArgentVault", address(vault));
        console.log("chainId", block.chainid);
    }
}
