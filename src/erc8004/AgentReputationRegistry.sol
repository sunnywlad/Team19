// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.24;

import {AgentIdentityRegistry} from "./AgentIdentityRegistry.sol";

/// @title AgentReputationRegistry
/// @notice Sous-ensemble d'ERC-8004 (brouillon) sans dépendance : retours de réputation sur un agent.
///         Noms de fonctions et d'événements du standard conservés (`giveFeedback`, `revokeFeedback`,
///         `readFeedback`, `getLastIndex`, `getClients`, `getSummary`, `NewFeedback`).
/// @dev Adaptations par rapport au standard :
///      - `getSummary` n'agrège que les valeurs à `valueDecimals == 0`, les autres sont ignorées ;
///      - pas d'`appendResponse` (le fil de réponses du standard n'est pas repris).
contract AgentReputationRegistry {
    // ---------------------------------------------------------------------
    // Erreurs
    // ---------------------------------------------------------------------

    error AlreadyInitialized();
    error ZeroAddress();
    error UnknownAgent(uint256 agentId);
    /// @notice `valueDecimals` au-delà de 18.
    error DecimalsTooLarge(uint8 valueDecimals);
    /// @notice Le propriétaire d'un agent ne peut pas se noter lui-même.
    error SelfFeedback(uint256 agentId);
    /// @notice Index de retour inexistant.
    error UnknownFeedback(uint256 agentId, address client, uint256 index);
    /// @notice `getSummary` appelé avec une liste de clients vide.
    error NoClients();

    // ---------------------------------------------------------------------
    // Événement du standard
    // ---------------------------------------------------------------------

    /// @notice ERC-8004 : nouveau retour déposé.
    /// @dev Adaptation de forme : les champs textuels et le hash du retour sont regroupés dans la struct
    ///      `FeedbackData` (un tuple ABI). Sans l'optimiseur et sans viaIR, émettre dix champs à plat
    ///      dépasse la pile de l'encodeur ; le nom d'événement du standard est conservé.
    event NewFeedback(uint256 indexed agentId, address indexed client, uint256 index, FeedbackData data);

    /// @notice Retour révoqué.
    event FeedbackRevoked(uint256 indexed agentId, address indexed client, uint256 index);

    // ---------------------------------------------------------------------
    // Types
    // ---------------------------------------------------------------------

    struct Feedback {
        int128 value;
        uint8 valueDecimals;
        bool isRevoked;
        string tag1;
        string tag2;
    }

    /// @notice Charge utile du retour, telle qu'émise dans `NewFeedback` (tuple ABI).
    struct FeedbackData {
        int128 value;
        uint8 valueDecimals;
        string tag1;
        string tag2;
        string endpoint;
        string feedbackURI;
        bytes32 feedbackHash;
    }

    // ---------------------------------------------------------------------
    // État
    // ---------------------------------------------------------------------

    AgentIdentityRegistry public identityRegistry;
    bool private _initialized;

    // (agent, client) -> index (depuis 1) -> retour
    mapping(uint256 => mapping(address => mapping(uint256 => Feedback))) private _feedback;
    // (agent, client) -> dernier index posé
    mapping(uint256 => mapping(address => uint256)) private _lastIndex;
    // agent -> liste des clients ayant posé au moins un retour
    mapping(uint256 => address[]) private _clients;
    mapping(uint256 => mapping(address => bool)) private _isClient;

    // ---------------------------------------------------------------------
    // Initialisation
    // ---------------------------------------------------------------------

    /// @notice Branche le registre d'identité, une seule fois.
    function initialize(address identityRegistry_) external {
        if (_initialized) revert AlreadyInitialized();
        if (identityRegistry_ == address(0)) revert ZeroAddress();
        identityRegistry = AgentIdentityRegistry(identityRegistry_);
        _initialized = true;
    }

    /// @notice Adresse du registre d'identité branché.
    function getIdentityRegistry() external view returns (address) {
        return address(identityRegistry);
    }

    // ---------------------------------------------------------------------
    // Dépôt et révocation
    // ---------------------------------------------------------------------

    /// @notice Dépose un retour sur un agent. Donneur = `msg.sender`, distinct du propriétaire de l'agent.
    /// @dev Adaptation de forme : les champs sont passés dans une struct calldata `FeedbackData` plutôt
    ///      qu'à plat. Sans l'optimiseur ni viaIR, décoder quatre `string` calldata à plat dépasse la pile ;
    ///      la struct n'expose qu'un pointeur. Les champs et le nom `giveFeedback` du standard sont conservés.
    /// @return index index du retour pour ce couple (agent, client), depuis 1.
    function giveFeedback(uint256 agentId, FeedbackData calldata data) external returns (uint256 index) {
        address owner = _ownerOrRevert(agentId);
        if (data.valueDecimals > 18) revert DecimalsTooLarge(data.valueDecimals);
        if (msg.sender == owner) revert SelfFeedback(agentId);
        return _record(agentId, data);
    }

    /// @notice Écrit le retour, met à jour l'index et la liste des clients, émet `NewFeedback`.
    function _record(uint256 agentId, FeedbackData calldata data) private returns (uint256 index) {
        index = ++_lastIndex[agentId][msg.sender];
        Feedback storage f = _feedback[agentId][msg.sender][index];
        f.value = data.value;
        f.valueDecimals = data.valueDecimals;
        f.tag1 = data.tag1;
        f.tag2 = data.tag2;

        if (!_isClient[agentId][msg.sender]) {
            _isClient[agentId][msg.sender] = true;
            _clients[agentId].push(msg.sender);
        }

        emit NewFeedback(agentId, msg.sender, index, data);
    }

    /// @notice Révoque un retour déposé par l'appelant.
    function revokeFeedback(uint256 agentId, uint256 index) external {
        Feedback storage f = _feedback[agentId][msg.sender][index];
        if (index == 0 || index > _lastIndex[agentId][msg.sender]) {
            revert UnknownFeedback(agentId, msg.sender, index);
        }
        f.isRevoked = true;
        emit FeedbackRevoked(agentId, msg.sender, index);
    }

    // ---------------------------------------------------------------------
    // Lecture
    // ---------------------------------------------------------------------

    /// @notice Lit un retour (agent, client, index).
    function readFeedback(uint256 agentId, address client, uint256 index)
        external
        view
        returns (int128 value, uint8 valueDecimals, bool isRevoked, string memory tag1, string memory tag2)
    {
        if (index == 0 || index > _lastIndex[agentId][client]) {
            revert UnknownFeedback(agentId, client, index);
        }
        Feedback storage f = _feedback[agentId][client][index];
        return (f.value, f.valueDecimals, f.isRevoked, f.tag1, f.tag2);
    }

    /// @notice Dernier index posé par un client pour un agent (0 si aucun).
    function getLastIndex(uint256 agentId, address client) external view returns (uint256) {
        return _lastIndex[agentId][client];
    }

    /// @notice Liste des clients ayant noté un agent.
    function getClients(uint256 agentId) external view returns (address[] memory) {
        return _clients[agentId];
    }

    /// @notice Agrège les retours non révoqués des `clients` donnés, filtrés par tags (chaîne vide = pas
    ///         de filtre), aux seules valeurs à `valueDecimals == 0`.
    /// @return count nombre de retours agrégés.
    /// @return summaryValue somme des `value` retenus.
    /// @return summaryDecimals toujours 0 (adaptation : seule la décimale 0 est agrégée).
    function getSummary(uint256 agentId, address[] calldata clients, string calldata tag1, string calldata tag2)
        external
        view
        returns (uint64 count, int256 summaryValue, uint8 summaryDecimals)
    {
        if (clients.length == 0) revert NoClients();

        for (uint256 c = 0; c < clients.length; c++) {
            (uint64 cCount, int256 cValue) = _aggregateClient(agentId, clients[c], tag1, tag2);
            count += cCount;
            summaryValue += cValue;
        }
        return (count, summaryValue, 0);
    }

    /// @notice Agrège les retours non révoqués, à décimale 0, filtrés par tags, pour un seul client.
    /// @dev Isolé de `getSummary` pour limiter les variables vives (stack too deep sans viaIR).
    function _aggregateClient(uint256 agentId, address client, string calldata tag1, string calldata tag2)
        private
        view
        returns (uint64 count, int256 summaryValue)
    {
        bool filterTag1 = bytes(tag1).length != 0;
        bool filterTag2 = bytes(tag2).length != 0;
        uint256 last = _lastIndex[agentId][client];
        for (uint256 i = 1; i <= last; i++) {
            Feedback storage f = _feedback[agentId][client][i];
            if (f.isRevoked) continue;
            if (f.valueDecimals != 0) continue;
            if (filterTag1 && keccak256(bytes(f.tag1)) != keccak256(bytes(tag1))) continue;
            if (filterTag2 && keccak256(bytes(f.tag2)) != keccak256(bytes(tag2))) continue;
            count++;
            summaryValue += int256(f.value);
        }
    }

    // ---------------------------------------------------------------------
    // Interne
    // ---------------------------------------------------------------------

    function _ownerOrRevert(uint256 agentId) internal view returns (address owner) {
        owner = identityRegistry.getAgentWallet(agentId);
        if (owner == address(0)) revert UnknownAgent(agentId);
    }
}
