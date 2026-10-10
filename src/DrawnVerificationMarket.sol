// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.24;

import {VerificationMarketBase} from "./VerificationMarket.sol";
import {VerifierRegistry} from "./VerifierRegistry.sol";
import {Slashing} from "./Slashing.sol";
import {Rewards} from "./Rewards.sol";

/// @title DrawnVerificationMarket
/// @notice Phase 3 : marché cautionné dont le comité de 3 est tiré au sort par demande, à partir du
///         hash d'un bloc postérieur à la création. Mêmes crochets de caution que la phase 2 (verrou au
///         tirage, saisie des absents et partage des frais à la finalisation, déverrouillage à la clôture).
/// @dev Aléa : `blockhash(drawBlock)`, drawBlock = block de création + 1. Biais possible par nos propres
///      validateurs : ce sont eux qui produisent le bloc dont le hash fait l'aléa, à dire au jury.
///      Le demandeur ne peut pas viser un comité : `h` est figé avant que `blockhash(drawBlock)` existe,
///      et le tirage n'est possible qu'à partir de `drawBlock + 1` (test de non-manipulation).
contract DrawnVerificationMarket is VerificationMarketBase {
    // ---------------------------------------------------------------------
    // Erreurs propres au contrat
    // ---------------------------------------------------------------------

    /// @notice Comité de la demande déjà tiré.
    error AlreadyDrawn(uint256 requestId);
    /// @notice Moins de 3 vérificateurs éligibles au moment du tirage.
    error NotEnoughVerifiers(uint256 requestId, uint256 eligible);

    // ---------------------------------------------------------------------
    // Événements propres au contrat
    // ---------------------------------------------------------------------

    /// @notice Hash du bloc de tirage perdu (plus de 256 blocs) : tirage reprogrammé à un nouveau bloc.
    event DrawRescheduled(uint256 indexed requestId, uint256 drawBlock);

    // ---------------------------------------------------------------------
    // Dépendances
    // ---------------------------------------------------------------------

    VerifierRegistry public immutable registry;
    Slashing public immutable slashing;
    Rewards public immutable rewards;

    // ---------------------------------------------------------------------
    // État du tirage
    // ---------------------------------------------------------------------

    /// @notice Bloc dont le hash sert d'aléa ; tirage possible à partir de `drawBlock + 1`.
    mapping(uint256 => uint256) public drawBlock;
    /// @notice Comité tiré, trois adresses ; nulles tant que le tirage n'a pas eu lieu.
    mapping(uint256 => address[3]) private _drawn;
    /// @notice Vrai une fois le comité tiré et les cautions verrouillées.
    mapping(uint256 => bool) public drawn;

    /// @param fee_ frais de demande.
    /// @param commitWindow_ fenêtre de commit.
    /// @param revealWindow_ fenêtre de reveal.
    /// @param contestWindow_ fenêtre de contestation.
    /// @param registry_ registre des cautions.
    /// @param slashing_ contrat de sanctions.
    /// @param rewards_ contrat de partage des frais.
    constructor(
        uint256 fee_,
        uint64 commitWindow_,
        uint64 revealWindow_,
        uint64 contestWindow_,
        VerifierRegistry registry_,
        Slashing slashing_,
        Rewards rewards_
    ) VerificationMarketBase(fee_, commitWindow_, revealWindow_, contestWindow_) {
        registry = registry_;
        slashing = slashing_;
        rewards = rewards_;
    }

    // ---------------------------------------------------------------------
    // Création : pas de comité, pas de verrou, pas d'événement de comité
    // ---------------------------------------------------------------------

    /// @notice Enregistre le bloc de tirage ; ne verrouille rien et n'émet pas CommitteeDrawn.
    function _afterCreate(uint256 requestId) internal override {
        drawBlock[requestId] = block.number + 1;
    }

    // ---------------------------------------------------------------------
    // Tirage au sort
    // ---------------------------------------------------------------------

    /// @notice Tire le comité de 3 d'une demande à partir de `blockhash(drawBlock)`. Appelable par tous.
    /// @dev Reprogramme sans revert si le hash est perdu (> 256 blocs). Verrouille les 3 cautions au tirage.
    function drawCommittee(uint256 requestId) external {
        Request storage r = _requests[requestId];
        if (r.status == Status.None) revert UnknownRequest(requestId);
        if (drawn[requestId]) revert AlreadyDrawn(requestId);

        Status s = _status(requestId);
        if (s != Status.Commit) revert WrongPhase(requestId, Status.Commit, s);

        uint256 db = drawBlock[requestId];
        if (block.number <= db) revert TooEarly(requestId);

        // Hash du bloc perdu (fenêtre de 256 blocs dépassée) : reprogrammer, pas de revert.
        if (block.number > db + 256) {
            uint256 newDrawBlock = block.number + 1;
            drawBlock[requestId] = newDrawBlock;
            emit DrawRescheduled(requestId, newDrawBlock);
            return;
        }

        // Aléa volontairement dérivé d'un hash de bloc : biais possible par nos validateurs, assumé et
        // documenté en tête de contrat. Le demandeur ne peut pas viser un comité (h figé avant drawBlock).
        // forge-lint: disable-next-line(weak-prng)
        bytes32 seed = keccak256(abi.encode(r.h, requestId, blockhash(db)));

        // Éligibles : actifs, != demandeur, non exclus par strikes, part libre suffisante pour un verrou.
        address[] memory active = registry.activeVerifiers();
        uint256 lockBps = registry.lockBps();
        address requester = r.requester;

        address[] memory eligible = new address[](active.length);
        uint256 nEligible = 0;
        // Lectures du registre et de Slashing (nos propres contrats, non réentrants) : boucle assumée,
        // bornée par le nombre de vérificateurs inscrits (quelques dizaines au plus en démo).
        for (uint256 i = 0; i < active.length; i++) {
            address v = active[i];
            if (v == requester) continue;
            // forge-lint: disable-next-line(calls-loop)
            if (!registry.isActive(v)) continue;
            // forge-lint: disable-next-line(calls-loop)
            if (slashing.struckUntil(v) > requestId) continue;
            // forge-lint: disable-next-line(calls-loop)
            uint256 total = registry.total(v);
            // forge-lint: disable-next-line(calls-loop)
            uint256 locked = registry.locked(v);
            uint256 need = (total * lockBps) / 10000;
            if (total - locked < need) continue;
            eligible[nEligible] = v;
            nEligible++;
        }

        if (nEligible < 3) revert NotEnoughVerifiers(requestId, nEligible);

        // Fisher-Yates partiel : 3 indices distincts tirés du pool éligible.
        address[3] memory committee;
        uint256 remaining = nEligible;
        for (uint256 k = 0; k < 3; k++) {
            uint256 idx = uint256(keccak256(abi.encode(seed, k))) % remaining;
            committee[k] = eligible[idx];
            // Retire l'élément tiré : swap avec le dernier encore en jeu.
            eligible[idx] = eligible[remaining - 1];
            remaining--;
        }

        _drawn[requestId] = committee;
        drawn[requestId] = true;

        // Verrou des 3 cautions (le registre revert si une part libre a disparu entre temps).
        registry.lockStake(committee[0], requestId);
        registry.lockStake(committee[1], requestId);
        registry.lockStake(committee[2], requestId);

        address[] memory c = new address[](3);
        c[0] = committee[0];
        c[1] = committee[1];
        c[2] = committee[2];
        // registry est notre propre contrat, non réentrant ; l'événement de comité suit le verrou.
        // forge-lint: disable-next-line(reentrancy-events)
        emit CommitteeDrawn(requestId, c);
    }

    // ---------------------------------------------------------------------
    // Comité tiré
    // ---------------------------------------------------------------------

    /// @notice Comité stocké au tirage ; adresses nulles tant que `drawCommittee` n'a pas eu lieu.
    function _committee(uint256 requestId) internal view override returns (address[3] memory) {
        return _drawn[requestId];
    }

    // ---------------------------------------------------------------------
    // Finalisation et clôture (caution, comme en phase 2)
    // ---------------------------------------------------------------------

    /// @notice Saisit les absents et partage les frais entre les reveals. Demande jamais tirée :
    ///         comité vide, aucun absent constaté, aucune saisie, frais au trésor (liste vide).
    function _afterFinalize(uint256 requestId, uint256 fee_) internal override {
        if (!drawn[requestId]) {
            // Jamais tirée : code 1, aucun VerifierMissed (comité vide), frais au trésor via liste vide.
            rewards.distribute{value: fee_}(requestId, new address[](0));
            return;
        }

        address[3] memory m = _drawn[requestId];

        bool r0 = this.getReveal(requestId, m[0]).revealed;
        bool r1 = this.getReveal(requestId, m[1]).revealed;
        bool r2 = this.getReveal(requestId, m[2]).revealed;

        if (!r0) slashing.slashMissed(requestId, m[0]);
        if (!r1) slashing.slashMissed(requestId, m[1]);
        if (!r2) slashing.slashMissed(requestId, m[2]);

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

    /// @notice Déverrouille les 3 cautions, seulement si le comité a été tiré.
    function _afterClose(uint256 requestId) internal override {
        if (!drawn[requestId]) return;
        address[3] memory m = _drawn[requestId];
        registry.unlockStake(m[0], requestId);
        registry.unlockStake(m[1], requestId);
        registry.unlockStake(m[2], requestId);
    }
}
