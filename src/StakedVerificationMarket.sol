// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.24;

import {VerificationMarket} from "./VerificationMarket.sol";
import {IVerifierRegistry} from "./interfaces/IVerifierRegistry.sol";
import {ISlashing} from "./interfaces/ISlashing.sol";
import {Rewards} from "./Rewards.sol";

/// @title StakedVerificationMarket
/// @notice Phase 2 : marché de phase 1 cautionné. Verrouille la caution des membres à la création,
///         saisit les absents et partage les frais à la finalisation, déverrouille à la clôture.
/// @dev Surcharge les trois crochets de VerificationMarket et lit le comité par `_committee(requestId)`
///      (comité fixe en phase 2). Tous les appels externes visent nos propres contrats et interviennent
///      après tout changement d'état (CEI, hérité de la base).
contract StakedVerificationMarket is VerificationMarket {
    IVerifierRegistry public immutable registry;
    ISlashing public immutable slashing;
    Rewards public immutable rewards;

    /// @param committee comité fixe de 3 (phase 1).
    /// @param fee_ frais de demande.
    /// @param commitWindow_ fenêtre de commit.
    /// @param revealWindow_ fenêtre de reveal.
    /// @param contestWindow_ fenêtre de contestation.
    /// @param registry_ registre des cautions.
    /// @param slashing_ contrat de sanctions.
    /// @param rewards_ contrat de partage des frais.
    constructor(
        address[3] memory committee,
        uint256 fee_,
        uint64 commitWindow_,
        uint64 revealWindow_,
        uint64 contestWindow_,
        IVerifierRegistry registry_,
        ISlashing slashing_,
        Rewards rewards_
    ) VerificationMarket(committee, fee_, commitWindow_, revealWindow_, contestWindow_) {
        registry = registry_;
        slashing = slashing_;
        rewards = rewards_;
    }

    /// @notice Verrouille la part de caution des 3 membres pour la mission.
    ///         Membre inactif : le revert du registre remonte, la demande échoue.
    function _afterCreate(uint256 requestId) internal override {
        address[3] memory m = _committee(requestId);
        registry.lockStake(m[0], requestId);
        registry.lockStake(m[1], requestId);
        registry.lockStake(m[2], requestId);
    }

    /// @notice Saisit chaque membre absent (NoCommit ou NoReveal), puis partage les frais entre les reveals.
    function _afterFinalize(uint256 requestId, uint256 fee_) internal override {
        address[3] memory m = _committee(requestId);

        // Lecture unique de l'état révélé des 3 membres (comité déroulé, pas d'appel externe en boucle).
        bool r0 = this.getReveal(requestId, m[0]).revealed;
        bool r1 = this.getReveal(requestId, m[1]).revealed;
        bool r2 = this.getReveal(requestId, m[2]).revealed;

        // Saisie des absents.
        if (!r0) slashing.slashMissed(requestId, m[0]);
        if (!r1) slashing.slashMissed(requestId, m[1]);
        if (!r2) slashing.slashMissed(requestId, m[2]);

        // Liste des reveals valides, de taille exacte.
        uint256 count_ = (r0 ? 1 : 0) + (r1 ? 1 : 0) + (r2 ? 1 : 0);
        address[] memory revealers = new address[](count_);
        uint256 j = 0;
        if (r0) {
            revealers[j] = m[0];
            j++;
        }
        if (r1) {
            revealers[j] = m[1];
            j++;
        }
        if (r2) {
            revealers[j] = m[2];
            j++;
        }

        rewards.distribute{value: fee_}(requestId, revealers);
    }

    /// @notice Déverrouille la part de caution des 3 membres.
    function _afterClose(uint256 requestId) internal override {
        address[3] memory m = _committee(requestId);
        registry.unlockStake(m[0], requestId);
        registry.unlockStake(m[1], requestId);
        registry.unlockStake(m[2], requestId);
    }
}
