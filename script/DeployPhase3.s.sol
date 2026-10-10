// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.24;

import {Script, console} from "forge-std/Script.sol";
import {VerifierRegistry} from "../src/VerifierRegistry.sol";
import {Slashing} from "../src/Slashing.sol";
import {Rewards} from "../src/Rewards.sol";
import {DrawnVerificationMarket} from "../src/DrawnVerificationMarket.sol";

/// @notice Déploie la phase 3 : marché à comité tiré, câblé à Registry, Slashing, Rewards.
/// @dev La clé privée est passée en ligne de commande, jamais dans le code. Le déployeur est le trésor et l'admin.
///      Chemin nominal : pile neuve complète, puis admission de 4 candidats (les vérificateurs s'inscrivent eux-mêmes).
///      `setMarket` est à usage unique sur Registry, Slashing et Rewards : une pile déjà déployée ne peut pas
///      être recâblée vers un nouveau marché, donc fournir REGISTRY / SLASHING / REWARDS fait échouer le script.
contract DeployPhase3 is Script {
    /// @notice Fourniture d'adresses existantes non supportée : `setMarket` est à usage unique.
    error ReuseNotSupported();

    /// @notice Paramètres de déploiement, regroupés pour tenir sur la pile.
    struct Params {
        uint256 fee;
        uint64 commitWindow;
        uint64 revealWindow;
        uint64 contestWindow;
        uint256 minStake;
        uint16 lockBps;
        uint8 strikeLimit;
        uint256 exclusionRequests;
        uint256 bonus;
        address[4] candidates;
    }

    function _params() internal view returns (Params memory p) {
        p.fee = vm.envOr("FEE", uint256(1 ether));
        p.commitWindow = uint64(vm.envOr("COMMIT_WINDOW", uint256(180)));
        p.revealWindow = uint64(vm.envOr("REVEAL_WINDOW", uint256(60)));
        p.contestWindow = uint64(vm.envOr("CONTEST_WINDOW", uint256(600)));
        p.minStake = vm.envOr("MIN_STAKE", uint256(100 ether));
        p.lockBps = uint16(vm.envOr("LOCK_BPS", uint256(2000)));
        p.strikeLimit = uint8(vm.envOr("STRIKE_LIMIT", uint256(3)));
        p.exclusionRequests = vm.envOr("EXCLUSION_REQUESTS", uint256(10));
        p.bonus = vm.envOr("BONUS", uint256(1 ether));
        // Candidats = index anvil 1 à 4, pour avoir 4 inscrits possibles (comité de 3 tiré parmi eux).
        p.candidates[0] = vm.envOr("CANDIDATE_1", address(0x70997970C51812dc3A010C7d01b50e0d17dc79C8));
        p.candidates[1] = vm.envOr("CANDIDATE_2", address(0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC));
        p.candidates[2] = vm.envOr("CANDIDATE_3", address(0x90F79bf6EB2c4f870365E785982E1f101E93b906));
        p.candidates[3] = vm.envOr("CANDIDATE_4", address(0x15d34AAf54267DB7D7c367839AAf71A00a2C6A65));
    }

    function run()
        public
        returns (VerifierRegistry registry, Slashing slashing, Rewards rewards, DrawnVerificationMarket market)
    {
        // `setMarket` étant à usage unique, une pile déjà câblée ne peut pas accueillir un nouveau marché :
        // fournir une seule de ces adresses est une erreur, le chemin nominal déploie une pile neuve.
        address existingRegistry = vm.envOr("REGISTRY", address(0));
        address existingSlashing = vm.envOr("SLASHING", address(0));
        address existingRewards = vm.envOr("REWARDS", address(0));
        if (existingRegistry != address(0) || existingSlashing != address(0) || existingRewards != address(0)) {
            console.log("Reuse d'une pile existante impossible : setMarket est a usage unique sur Registry/Slashing/Rewards.");
            console.log("Deployez une pile neuve en ne fournissant ni REGISTRY, ni SLASHING, ni REWARDS.");
            revert ReuseNotSupported();
        }

        Params memory p = _params();

        vm.startBroadcast();

        address deployer = msg.sender;

        // 1. Registre : trésor = déployeur.
        registry = new VerifierRegistry(p.minStake, p.lockBps, deployer);

        // 2. Slashing : le marché n'existe pas encore, fixé plus bas par setMarket.
        slashing = new Slashing(registry, p.strikeLimit, p.exclusionRequests);

        // 3. Rewards : trésor = déployeur.
        rewards = new Rewards(deployer, p.bonus);

        // 4. Marché à comité tiré : sans comité, connaît ses trois dépendances dès la construction.
        market = new DrawnVerificationMarket(
            p.fee, p.commitWindow, p.revealWindow, p.contestWindow, registry, slashing, rewards
        );

        // 5. Câblage réciproque (setMarket à usage unique).
        registry.setMarket(address(market));
        registry.setSlashing(address(slashing));
        slashing.setMarket(address(market));
        rewards.setMarket(address(market));

        // 6. Admission de 4 candidats (les vérificateurs s'inscrivent eux-mêmes ensuite).
        registry.admit(p.candidates[0]);
        registry.admit(p.candidates[1]);
        registry.admit(p.candidates[2]);
        registry.admit(p.candidates[3]);

        vm.stopBroadcast();

        console.log("VerifierRegistry        :", address(registry));
        console.log("Slashing                :", address(slashing));
        console.log("Rewards                 :", address(rewards));
        console.log("DrawnVerificationMarket :", address(market));
        console.log("Treasury / admin        :", deployer);
        console.log("Candidat 1              :", p.candidates[0]);
        console.log("Candidat 2              :", p.candidates[1]);
        console.log("Candidat 3              :", p.candidates[2]);
        console.log("Candidat 4              :", p.candidates[3]);
    }
}
