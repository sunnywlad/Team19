// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.24;

import {AgentIdentityRegistry} from "./AgentIdentityRegistry.sol";

/// @title AgentValidationRegistry
/// @notice Sous-ensemble d'ERC-8004 (brouillon) sans dépendance : demandes de validation d'un agent et
///         réponses du validateur désigné. Noms de fonctions et d'événements du standard conservés
///         (`validationRequest`, `validationResponse`, `getValidationStatus`, `getSummary`,
///         `getAgentValidations`, `getValidatorRequests`, `ValidationRequest`, `ValidationResponse`).
/// @dev Adaptation : la moyenne de `getSummary` est une moyenne entière (division euclidienne).
contract AgentValidationRegistry {
    // ---------------------------------------------------------------------
    // Erreurs
    // ---------------------------------------------------------------------

    error AlreadyInitialized();
    error ZeroAddress();
    error UnknownAgent(uint256 agentId);
    /// @notice Appelant autre que le propriétaire de l'agent.
    error NotAgentOwner(uint256 agentId, address caller);
    /// @notice `requestHash` déjà demandé.
    error RequestExists(bytes32 requestHash);
    /// @notice Aucune demande pour ce `requestHash`.
    error UnknownRequest(bytes32 requestHash);
    /// @notice Appelant autre que le validateur désigné.
    error NotValidator(bytes32 requestHash, address caller);
    /// @notice `response` au-delà de 100.
    error ResponseTooLarge(uint8 response);

    // ---------------------------------------------------------------------
    // Événements du standard
    // ---------------------------------------------------------------------

    /// @notice ERC-8004 : demande de validation déposée.
    event ValidationRequest(
        bytes32 indexed requestHash,
        address indexed validatorAddress,
        uint256 indexed agentId,
        string requestURI
    );
    /// @notice ERC-8004 : réponse du validateur désigné.
    event ValidationResponse(
        bytes32 indexed requestHash,
        address indexed validatorAddress,
        uint8 response,
        string responseURI,
        bytes32 responseHash,
        string tag
    );

    // ---------------------------------------------------------------------
    // Types
    // ---------------------------------------------------------------------

    struct Validation {
        address validatorAddress;
        uint256 agentId;
        bool responded;
        uint8 response;
        string tag;
    }

    // ---------------------------------------------------------------------
    // État
    // ---------------------------------------------------------------------

    AgentIdentityRegistry public identityRegistry;
    bool private _initialized;

    mapping(bytes32 => Validation) private _validations;
    mapping(uint256 => bytes32[]) private _agentValidations; // agentId -> requestHashes
    mapping(address => bytes32[]) private _validatorRequests; // validateur -> requestHashes

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
    // Demande et réponse
    // ---------------------------------------------------------------------

    /// @notice Demande une validation d'un agent par un validateur donné. Propriétaire de l'agent seul.
    function validationRequest(
        address validatorAddress,
        uint256 agentId,
        string calldata requestURI,
        bytes32 requestHash
    ) external {
        address owner = identityRegistry.getAgentWallet(agentId);
        if (owner == address(0)) revert UnknownAgent(agentId);
        if (msg.sender != owner) revert NotAgentOwner(agentId, msg.sender);
        if (_validations[requestHash].validatorAddress != address(0)) revert RequestExists(requestHash);

        _validations[requestHash] =
            Validation({validatorAddress: validatorAddress, agentId: agentId, responded: false, response: 0, tag: ""});
        _agentValidations[agentId].push(requestHash);
        _validatorRequests[validatorAddress].push(requestHash);

        emit ValidationRequest(requestHash, validatorAddress, agentId, requestURI);
    }

    /// @notice Réponse du validateur désigné d'une demande. `response <= 100`.
    function validationResponse(
        bytes32 requestHash,
        uint8 response,
        string calldata responseURI,
        bytes32 responseHash,
        string calldata tag
    ) external {
        Validation storage v = _validations[requestHash];
        if (v.validatorAddress == address(0)) revert UnknownRequest(requestHash);
        if (msg.sender != v.validatorAddress) revert NotValidator(requestHash, msg.sender);
        if (response > 100) revert ResponseTooLarge(response);

        v.responded = true;
        v.response = response;
        v.tag = tag;

        emit ValidationResponse(requestHash, v.validatorAddress, response, responseURI, responseHash, tag);
    }

    // ---------------------------------------------------------------------
    // Lecture
    // ---------------------------------------------------------------------

    /// @notice État d'une demande de validation. `validatorAddress == address(0)` si aucune demande.
    function getValidationStatus(bytes32 requestHash) external view returns (Validation memory) {
        return _validations[requestHash];
    }

    /// @notice Moyenne entière des réponses d'un agent, filtrées par `tag` (chaîne vide = pas de filtre).
    /// @return count nombre de réponses agrégées.
    /// @return average moyenne entière des réponses (0 si aucune).
    function getSummary(uint256 agentId, address[] calldata validators, string calldata tag)
        external
        view
        returns (uint64 count, uint8 average)
    {
        bytes32 wantTag = keccak256(bytes(tag));
        bytes32 emptyTag = keccak256(bytes(""));
        bool filterValidators = validators.length > 0;

        uint256 sum = 0;
        bytes32[] storage hashes = _agentValidations[agentId];
        for (uint256 i = 0; i < hashes.length; i++) {
            Validation storage v = _validations[hashes[i]];
            if (!v.responded) continue;
            if (wantTag != emptyTag && keccak256(bytes(v.tag)) != wantTag) continue;
            if (filterValidators && !_contains(validators, v.validatorAddress)) continue;
            count++;
            sum += v.response;
        }
        if (count == 0) return (0, 0);
        // Moyenne entière (adaptation) ; chaque réponse tient dans [0, 100], la moyenne aussi.
        // cast uint8 sûr : sum / count <= 100 < 256.
        // forge-lint: disable-next-line(unsafe-typecast)
        average = uint8(sum / count);
        return (count, average);
    }

    /// @notice Tous les `requestHash` d'un agent.
    function getAgentValidations(uint256 agentId) external view returns (bytes32[] memory) {
        return _agentValidations[agentId];
    }

    /// @notice Tous les `requestHash` adressés à un validateur.
    function getValidatorRequests(address validatorAddress) external view returns (bytes32[] memory) {
        return _validatorRequests[validatorAddress];
    }

    // ---------------------------------------------------------------------
    // Interne
    // ---------------------------------------------------------------------

    function _contains(address[] calldata list, address target) internal pure returns (bool) {
        for (uint256 i = 0; i < list.length; i++) {
            if (list[i] == target) return true;
        }
        return false;
    }
}
