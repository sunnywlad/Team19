// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.24;

import {Script, console} from "forge-std/Script.sol";
import {VerifierRegistry} from "../src/VerifierRegistry.sol";
import {Slashing} from "../src/Slashing.sol";
import {Rewards} from "../src/Rewards.sol";
import {StakedVerificationMarket} from "../src/StakedVerificationMarket.sol";
import {IVerifierRegistry} from "../src/interfaces/IVerifierRegistry.sol";
import {ISlashing} from "../src/interfaces/ISlashing.sol";

/// @notice Déploie la phase 2 complète et câble les contrats entre eux.
/// @dev La clé privée est passée en ligne de commande, jamais dans le code. Le déployeur est le trésor et l'admin.
///      Les vérificateurs ne sont pas inscrits ici : ils signent eux-mêmes `register`.
contract DeployPhase2 is Script {
    /// @notice Paramètres de déploiement, regroupés pour tenir sur la pile.
    struct Params {
        address[3] committee;
        uint256 fee;
        uint64 commitWindow;
        uint64 revealWindow;
        uint64 contestWindow;
        uint256 minStake;
        uint16 lockBps;
        uint8 strikeLimit;
        uint256 exclusionRequests;
        uint256 bonus;
    }

    function _params() internal view returns (Params memory p) {
        p.committee[0] = vm.envOr("COMMITTEE_0", address(0x70997970C51812dc3A010C7d01b50e0d17dc79C8));
        p.committee[1] = vm.envOr("COMMITTEE_1", address(0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC));
        p.committee[2] = vm.envOr("COMMITTEE_2", address(0x90F79bf6EB2c4f870365E785982E1f101E93b906));
        p.fee = vm.envOr("FEE", uint256(1 ether));
        p.commitWindow = uint64(vm.envOr("COMMIT_WINDOW", uint256(180)));
        p.revealWindow = uint64(vm.envOr("REVEAL_WINDOW", uint256(60)));
        p.contestWindow = uint64(vm.envOr("CONTEST_WINDOW", uint256(600)));
        p.minStake = vm.envOr("MIN_STAKE", uint256(100 ether));
        p.lockBps = uint16(vm.envOr("LOCK_BPS", uint256(2000)));
        p.strikeLimit = uint8(vm.envOr("STRIKE_LIMIT", uint256(3)));
        p.exclusionRequests = vm.envOr("EXCLUSION_REQUESTS", uint256(10));
        p.bonus = vm.envOr("BONUS", uint256(1 ether));
    }

    function run()
        public
        returns (VerifierRegistry registry, Slashing slashing, Rewards rewards, StakedVerificationMarket market)
    {
        Params memory p = _params();

        vm.startBroadcast();

        address deployer = msg.sender;

        // 1. Registre : trésor = déployeur.
        registry = new VerifierRegistry(p.minStake, p.lockBps, deployer);

        // 2. Slashing : le marché n'existe pas encore, fixé plus bas par setMarket.
        slashing = new Slashing(registry, p.strikeLimit, p.exclusionRequests);

        // 3. Rewards : trésor = déployeur.
        rewards = new Rewards(deployer, p.bonus);

        // 4. Marché cautionné : connaît ses trois dépendances dès la construction.
        market = new StakedVerificationMarket(
            p.committee,
            p.fee,
            p.commitWindow,
            p.revealWindow,
            p.contestWindow,
            IVerifierRegistry(address(registry)),
            ISlashing(address(slashing)),
            rewards
        );

        // 5. Câblage réciproque.
        registry.setMarket(address(market));
        registry.setSlashing(address(slashing));
        slashing.setMarket(address(market));
        rewards.setMarket(address(market));

        // 6. Admission du comité de test (les vérificateurs s'inscrivent eux-mêmes).
        registry.admit(p.committee[0]);
        registry.admit(p.committee[1]);
        registry.admit(p.committee[2]);

        vm.stopBroadcast();

        console.log("VerifierRegistry        :", address(registry));
        console.log("Slashing                :", address(slashing));
        console.log("Rewards                 :", address(rewards));
        console.log("StakedVerificationMarket:", address(market));
        console.log("Treasury / admin        :", deployer);
    }
}
