// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.24;

// EXPÉRIMENTAL : comité cinq, registres/sanctions/récompenses officiels inchangés.

import {VerificationMarketFiveBase} from "./VerificationMarketFive.sol";
import {VerifierRegistry} from "../VerifierRegistry.sol";
import {Slashing} from "../Slashing.sol";
import {Rewards} from "../Rewards.sol";
import {AgentIdentityRegistry} from "../erc8004/AgentIdentityRegistry.sol";
import {AgentReputationRegistry} from "../erc8004/AgentReputationRegistry.sol";
import {AgentValidationRegistry} from "../erc8004/AgentValidationRegistry.sol";

/// @title DrawnVerificationMarketFive
/// @notice Phase 3 : marché cautionné dont le comité de 5 est tiré au sort par demande, à partir du
///         hash d'un bloc postérieur à la création. Mêmes crochets de caution que la phase 2 (verrou au
///         tirage, saisie des absents et partage des frais à la finalisation, déverrouillage à la clôture).
/// @dev Aléa : `blockhash(drawBlock)`, drawBlock = block de création + 1. Biais possible par nos propres
///      validateurs : ce sont eux qui produisent le bloc dont le hash fait l'aléa, à dire au jury.
///      Le demandeur ne peut pas viser un comité : `h` est figé avant que `blockhash(drawBlock)` existe,
///      et le tirage n'est possible qu'à partir de `drawBlock + 1` (test de non-manipulation).
contract DrawnVerificationMarketFive is VerificationMarketFiveBase {
    // ---------------------------------------------------------------------
    // Erreurs propres au contrat
    // ---------------------------------------------------------------------

    /// @notice Comité de la demande déjà tiré.
    error AlreadyDrawn(uint256 requestId);
    /// @notice Moins de 5 vérificateurs éligibles au moment du tirage.
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
    /// @notice Comité tiré, cinq adresses ; nulles tant que le tirage n'a pas eu lieu.
    mapping(uint256 => address[5]) private _drawn;
    /// @notice Vrai une fois le comité tiré et les cautions verrouillées.
    mapping(uint256 => bool) public drawn;

    // ---------------------------------------------------------------------
    // Branchement ERC-8004 (facultatif, jamais bloquant pour finalize)
    // ---------------------------------------------------------------------

    /// @notice setErc8004 appelé deux fois.
    error Erc8004AlreadySet();
    /// @notice Appelant autre que l'admin pour setErc8004.
    error OnlyErc8004Admin(address caller);
    /// @notice Appel réservé au contrat lui-même (crochet ERC-8004 de finalize).
    error OnlySelf(address caller);

    /// @notice Émis au câblage des trois registres ERC-8004 (adresses nulles = branchement désactivé).
    event Erc8004Set(address identity, address reputation, address validation);

    /// @notice Admin autorisé à brancher les registres : fixé au déployeur à la construction.
    address public immutable erc8004Admin;
    /// @notice Vrai une fois `setErc8004` appelé (adresses nulles comprises : désactive le branchement).
    bool public erc8004Set;

    AgentIdentityRegistry public identityRegistry;
    AgentReputationRegistry public reputationRegistry;
    AgentValidationRegistry public validationRegistry;

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
    ) VerificationMarketFiveBase(fee_, commitWindow_, revealWindow_, contestWindow_) {
        registry = registry_;
        slashing = slashing_;
        rewards = rewards_;
        erc8004Admin = msg.sender;
    }

    // ---------------------------------------------------------------------
    // Création : pas de comité, pas de verrou, pas d'événement de comité
    // ---------------------------------------------------------------------

    /// @notice Enregistre le bloc de tirage ; ne verrouille rien et n'émet pas CommitteeDrawn.
    function _afterCreate(uint256 requestId) internal override {
        drawBlock[requestId] = block.number + 1;
    }

    // ---------------------------------------------------------------------
    // Branchement ERC-8004 (admin, une seule fois)
    // ---------------------------------------------------------------------

    /// @notice Branche les trois registres ERC-8004, admin seul, une seule fois. Adresses nulles
    ///         autorisées : le branchement reste alors désactivé (finalize ne touche à aucun registre).
    /// @dev Le branchement ne doit jamais faire échouer finalize ; voir `_notifyErc8004` / `pokeErc8004`.
    function setErc8004(address identity, address reputation, address validation) external {
        if (msg.sender != erc8004Admin) revert OnlyErc8004Admin(msg.sender);
        if (erc8004Set) revert Erc8004AlreadySet();
        erc8004Set = true;
        identityRegistry = AgentIdentityRegistry(identity);
        reputationRegistry = AgentReputationRegistry(reputation);
        validationRegistry = AgentValidationRegistry(validation);
        emit Erc8004Set(identity, reputation, validation);
    }

    // ---------------------------------------------------------------------
    // Tirage au sort
    // ---------------------------------------------------------------------

    /// @notice Tire le comité de 5 d'une demande à partir de `blockhash(drawBlock)`. Appelable par tous.
    /// @dev Reprogramme sans revert si le hash est perdu (> 256 blocs). Verrouille les 5 cautions au tirage.
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

        if (nEligible < 5) revert NotEnoughVerifiers(requestId, nEligible);

        // Fisher-Yates partiel : 5 indices distincts tirés du pool éligible.
        address[5] memory committee;
        uint256 remaining = nEligible;
        for (uint256 k = 0; k < 5; k++) {
            uint256 idx = uint256(keccak256(abi.encode(seed, k))) % remaining;
            committee[k] = eligible[idx];
            // Retire l'élément tiré : swap avec le dernier encore en jeu.
            eligible[idx] = eligible[remaining - 1];
            remaining--;
        }

        _drawn[requestId] = committee;
        drawn[requestId] = true;

        _lockAndEmit(requestId, committee);
    }

    /// @dev Crochet séparé pour conserver la compilation sans viaIR.
    function _lockAndEmit(uint256 requestId, address[5] memory committee) private {
        // Verrou des 5 cautions (le registre revert si une part libre a disparu entre temps).
        address[] memory c = new address[](5);
        for (uint256 i = 0; i < 5; i++) {
            registry.lockStake(committee[i], requestId);
            c[i] = committee[i];
        }
        // registry est notre propre contrat, non réentrant ; l'événement de comité suit le verrou.
        // forge-lint: disable-next-line(reentrancy-events)
        emit CommitteeDrawn(requestId, c);
    }

    // ---------------------------------------------------------------------
    // Comité tiré
    // ---------------------------------------------------------------------

    /// @notice Comité stocké au tirage ; adresses nulles tant que `drawCommittee` n'a pas eu lieu.
    function _committee(uint256 requestId) internal view override returns (address[5] memory) {
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
            _notifyErc8004(requestId);
            return;
        }

        address[5] memory m = _drawn[requestId];

        uint256 count_;
        for (uint256 i = 0; i < 5; i++) {
            if (_reveal[requestId][m[i]].revealed) count_++;
            else slashing.slashMissed(requestId, m[i]);
        }
        address[] memory revealers = new address[](count_);
        uint256 j;
        for (uint256 i = 0; i < 5; i++) {
            if (_reveal[requestId][m[i]].revealed) revealers[j++] = m[i];
        }

        rewards.distribute{value: fee_}(requestId, revealers);
        _notifyErc8004(requestId);
    }

    // ---------------------------------------------------------------------
    // Crochet ERC-8004 : jamais bloquant pour finalize
    // ---------------------------------------------------------------------

    /// @notice Notifie les registres ERC-8004 après finalize, sans jamais pouvoir faire échouer finalize.
    /// @dev Garantie par un unique `try` sur un auto-appel externe : branchement désactivé, identité
    ///      absente, demande de validation absente ou revert d'un registre, tout est absorbé par le
    ///      `catch`. Le `try` sur `this.pokeErc8004` isole aussi d'éventuelles révisions d'état du crochet.
    function _notifyErc8004(uint256 requestId) internal {
        if (!erc8004Set) return;
        if (address(reputationRegistry) == address(0) && address(validationRegistry) == address(0)) return;
        // Auto-appel externe isolé : aucune branche du crochet ne peut remonter jusqu'à finalize.
        try this.pokeErc8004(requestId) {} catch {}
    }

    /// @notice Crochet ERC-8004 exécuté en auto-appel ; réservé au contrat lui-même.
    /// @dev Pour chaque membre tiré ayant une identité : `giveFeedback` +1/-1 selon le reveal. Si une
    ///      demande de validation désigne ce marché comme validateur du hash de la demande : `validationResponse`
    ///      (code 2 -> 100, 1 -> 50, 0 -> 0). Chaque appel est protégé par son propre `try` pour qu'un échec
    ///      isolé (un seul agent, une seule réponse) n'empêche pas les autres notifications.
    function pokeErc8004(uint256 requestId) external {
        if (msg.sender != address(this)) revert OnlySelf(msg.sender);

        Request storage r = _requests[requestId];

        // 1. Réputation : +1 pour un membre ayant révélé, -1 sinon, seulement s'il a une identité.
        if (address(reputationRegistry) != address(0) && drawn[requestId]) {
            address[5] memory m = _drawn[requestId];
            for (uint256 i = 0; i < 5; i++) {
                _feedbackFor(requestId, m[i]);
            }
        }

        // 2. Validation : réponse chiffrée du code, si une demande désigne ce marché comme validateur.
        if (address(validationRegistry) != address(0)) {
            _validationFor(r.h, r.code);
        }
    }

    /// @notice Dépose un retour de réputation pour un membre ayant une identité ; isolé par try.
    function _feedbackFor(uint256 requestId, address member) private {
        if (member == address(0)) return;
        if (address(identityRegistry) == address(0)) return;
        // identityRegistry est notre propre contrat ; boucle de 5 membres au plus, non réentrante.
        // forge-lint: disable-next-line(calls-loop)
        uint256 agentId = identityRegistry.agentIdOf(member);
        if (agentId == 0) return;
        int128 value = _reveal[requestId][member].revealed ? int128(1) : int128(-1);
        AgentReputationRegistry.FeedbackData memory data = AgentReputationRegistry.FeedbackData({
            value: value,
            valueDecimals: 0,
            tag1: "reveal",
            tag2: "",
            endpoint: "",
            feedbackURI: "",
            feedbackHash: bytes32(0)
        });
        // reputationRegistry est notre propre contrat ; appel isolé par try, boucle de 5 membres au plus.
        // forge-lint: disable-next-line(calls-loop)
        try reputationRegistry.giveFeedback(agentId, data) {} catch {}
    }

    /// @notice Répond à la demande de validation si ce marché en est le validateur désigné ; isolé par try.
    function _validationFor(bytes32 h, Code code) private {
        AgentValidationRegistry.Validation memory v = validationRegistry.getValidationStatus(h);
        if (v.validatorAddress != address(this)) return;
        uint8 response = code == Code.Accept ? 100 : (code == Code.HumanReview ? 50 : 0);
        try validationRegistry.validationResponse(h, response, "", bytes32(0), "final") {} catch {}
    }

    /// @notice Déverrouille les 5 cautions, seulement si le comité a été tiré.
    function _afterClose(uint256 requestId) internal override {
        if (!drawn[requestId]) return;
        address[5] memory m = _drawn[requestId];
        for (uint256 i = 0; i < 5; i++) {
            registry.unlockStake(m[i], requestId);
        }
    }
}
