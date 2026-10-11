// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.24;

import {VerificationMarket} from "../../../src/VerificationMarket.sol";

/// @notice Le vrai marché de phase 1, compilé dans le projet de test.
/// Sert aux tests de chaîne inactive : son statut Commit → Reveal est dérivé de
/// block.timestamp, ce que MockMarket (statut stocké) ne reproduit pas.
contract RealMarket is VerificationMarket {
    constructor(
        address[3] memory committee,
        uint256 fee_,
        uint64 commitWindow_,
        uint64 revealWindow_,
        uint64 contestWindow_
    ) VerificationMarket(committee, fee_, commitWindow_, revealWindow_, contestWindow_) {}
}
