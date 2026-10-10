// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.24;

import {Script, console} from "forge-std/Script.sol";
import {VerificationMarket} from "../src/VerificationMarket.sol";

/// @notice Déploie VerificationMarket avec le comité de test (index 1, 2, 3) et les fenêtres de démo.
/// @dev Surcharges par variables d'environnement ; la clé privée est passée en ligne de commande, jamais dans le code.
contract DeployVerificationMarket is Script {
    function run() public returns (VerificationMarket market) {
        address[3] memory committee;
        committee[0] = vm.envOr("COMMITTEE_0", address(0x70997970C51812dc3A010C7d01b50e0d17dc79C8));
        committee[1] = vm.envOr("COMMITTEE_1", address(0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC));
        committee[2] = vm.envOr("COMMITTEE_2", address(0x90F79bf6EB2c4f870365E785982E1f101E93b906));

        uint256 fee = vm.envOr("FEE", uint256(1 ether));
        uint64 commitWindow = uint64(vm.envOr("COMMIT_WINDOW", uint256(180)));
        uint64 revealWindow = uint64(vm.envOr("REVEAL_WINDOW", uint256(60)));
        uint64 contestWindow = uint64(vm.envOr("CONTEST_WINDOW", uint256(600)));

        vm.startBroadcast();
        market = new VerificationMarket(committee, fee, commitWindow, revealWindow, contestWindow);
        vm.stopBroadcast();

        console.log("VerificationMarket deploye a:", address(market));
    }
}
