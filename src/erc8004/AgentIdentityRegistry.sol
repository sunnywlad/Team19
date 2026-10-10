// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.24;

/// @title AgentIdentityRegistry
/// @notice Sous-ensemble d'ERC-8004 (brouillon) sans dépendance : identité d'agent sous la forme d'un
///         jeton ERC-721 minimal non transférable. Les noms de fonctions et d'événements du standard
///         sont conservés (`register`, `setAgentURI`, `setMetadata`/`getMetadata`, `getAgentWallet`,
///         `ownerOf`, `balanceOf`, `tokenURI`, `Transfer`, `Registered`, `MetadataSet`, `URIUpdated`).
/// @dev Adaptations par rapport au standard :
///      - jeton non transférable : l'identité est liée au portefeuille admis, il n'y a pas de marché
///        d'agents, donc `transferFrom` / `approve` / `setApprovalForAll` revert `NonTransferable()` ;
///      - pas d'EIP-712 ni de `setAgentWallet` : `getAgentWallet(agentId)` rend le propriétaire courant,
///        et la clé de métadonnée `agentWallet` est réservée (`ReservedKey()`) ;
///      - une seule identité par adresse (`AlreadyRegistered`), ajout de `agentIdOf(address)`.
contract AgentIdentityRegistry {
    // ---------------------------------------------------------------------
    // Erreurs
    // ---------------------------------------------------------------------

    /// @notice Opération de transfert ou d'approbation : identité non transférable.
    error NonTransferable();
    /// @notice Une seule identité par adresse.
    error AlreadyRegistered(address account);
    /// @notice Agent inexistant.
    error UnknownAgent(uint256 agentId);
    /// @notice Appelant autre que le propriétaire de l'agent.
    error NotAgentOwner(uint256 agentId, address caller);
    /// @notice Clé de métadonnée réservée (`agentWallet`).
    error ReservedKey();
    /// @notice Requête sur l'adresse nulle.
    error ZeroAddress();

    // ---------------------------------------------------------------------
    // Événements (ERC-721 minimal + ERC-8004)
    // ---------------------------------------------------------------------

    /// @notice ERC-721 : émis à la création (mint), de l'adresse nulle vers le propriétaire.
    event Transfer(address indexed from, address indexed to, uint256 indexed tokenId);
    /// @notice ERC-8004 : nouvelle identité enregistrée.
    event Registered(uint256 indexed agentId, string agentURI, address indexed owner);
    /// @notice ERC-8004 : métadonnée posée pour un agent.
    event MetadataSet(uint256 indexed agentId, string key, string value);
    /// @notice ERC-8004 : URI de l'agent mis à jour.
    event URIUpdated(uint256 indexed agentId, string newURI);

    // ---------------------------------------------------------------------
    // État
    // ---------------------------------------------------------------------

    /// @notice Clé réservée : le portefeuille de l'agent est le propriétaire du jeton, pas une métadonnée.
    string internal constant AGENT_WALLET_KEY = "agentWallet";

    /// @notice Dernier agentId attribué ; les identités commencent à 1.
    uint256 public lastAgentId;

    mapping(uint256 => address) private _owner;
    mapping(uint256 => string) private _agentURI;
    mapping(address => uint256) private _agentIdOf; // 0 = aucune identité
    mapping(uint256 => mapping(string => string)) private _metadata;

    // ---------------------------------------------------------------------
    // Enregistrement
    // ---------------------------------------------------------------------

    /// @notice Enregistre une identité pour l'appelant avec un URI. Une seule par adresse.
    /// @return agentId identifiant croissant depuis 1.
    function register(string calldata agentURI) external returns (uint256 agentId) {
        return _register(msg.sender, agentURI);
    }

    /// @notice Enregistre une identité pour l'appelant sans URI.
    /// @return agentId identifiant croissant depuis 1.
    function register() external returns (uint256 agentId) {
        return _register(msg.sender, "");
    }

    function _register(address owner, string memory agentURI) internal returns (uint256 agentId) {
        if (_agentIdOf[owner] != 0) revert AlreadyRegistered(owner);

        agentId = ++lastAgentId;
        _owner[agentId] = owner;
        _agentIdOf[owner] = agentId;
        _agentURI[agentId] = agentURI;

        emit Transfer(address(0), owner, agentId);
        emit Registered(agentId, agentURI, owner);
        // `agentWallet` reflète le propriétaire ; posé comme métadonnée pour le lecteur du standard.
        emit MetadataSet(agentId, AGENT_WALLET_KEY, _toHexString(owner));
    }

    // ---------------------------------------------------------------------
    // URI et métadonnées
    // ---------------------------------------------------------------------

    /// @notice Met à jour l'URI de l'agent ; propriétaire seul.
    function setAgentURI(uint256 agentId, string calldata newURI) external {
        _requireOwner(agentId);
        _agentURI[agentId] = newURI;
        emit URIUpdated(agentId, newURI);
    }

    /// @notice Pose une métadonnée libre ; propriétaire seul. La clé `agentWallet` est réservée.
    function setMetadata(uint256 agentId, string calldata key, string calldata value) external {
        _requireOwner(agentId);
        if (_isReserved(key)) revert ReservedKey();
        _metadata[agentId][key] = value;
        emit MetadataSet(agentId, key, value);
    }

    /// @notice Lit une métadonnée. La clé `agentWallet` rend l'adresse du propriétaire en hexadécimal.
    function getMetadata(uint256 agentId, string calldata key) external view returns (string memory) {
        if (_owner[agentId] == address(0)) revert UnknownAgent(agentId);
        if (_isReserved(key)) return _toHexString(_owner[agentId]);
        return _metadata[agentId][key];
    }

    /// @notice Portefeuille de l'agent : le propriétaire courant du jeton (adaptation, pas de setAgentWallet).
    function getAgentWallet(uint256 agentId) external view returns (address) {
        address owner = _owner[agentId];
        if (owner == address(0)) revert UnknownAgent(agentId);
        return owner;
    }

    /// @notice Identité d'une adresse, 0 si aucune.
    function agentIdOf(address account) external view returns (uint256) {
        return _agentIdOf[account];
    }

    // ---------------------------------------------------------------------
    // Lecture ERC-721 minimale
    // ---------------------------------------------------------------------

    /// @notice Propriétaire du jeton d'identité.
    function ownerOf(uint256 agentId) external view returns (address) {
        address owner = _owner[agentId];
        if (owner == address(0)) revert UnknownAgent(agentId);
        return owner;
    }

    /// @notice Nombre de jetons d'une adresse : 0 ou 1 (une identité par adresse).
    function balanceOf(address owner) external view returns (uint256) {
        if (owner == address(0)) revert ZeroAddress();
        return _agentIdOf[owner] == 0 ? 0 : 1;
    }

    /// @notice URI du jeton (= agentURI).
    function tokenURI(uint256 agentId) external view returns (string memory) {
        if (_owner[agentId] == address(0)) revert UnknownAgent(agentId);
        return _agentURI[agentId];
    }

    // ---------------------------------------------------------------------
    // Non-transférabilité (ERC-721 muet par choix)
    // ---------------------------------------------------------------------

    /// @notice Transfert interdit : identité liée au portefeuille.
    function transferFrom(address, address, uint256) external pure {
        revert NonTransferable();
    }

    /// @notice Transfert interdit : identité liée au portefeuille.
    function safeTransferFrom(address, address, uint256) external pure {
        revert NonTransferable();
    }

    /// @notice Transfert interdit : identité liée au portefeuille.
    function safeTransferFrom(address, address, uint256, bytes calldata) external pure {
        revert NonTransferable();
    }

    /// @notice Approbation interdite : identité non transférable.
    function approve(address, uint256) external pure {
        revert NonTransferable();
    }

    /// @notice Approbation globale interdite : identité non transférable.
    function setApprovalForAll(address, bool) external pure {
        revert NonTransferable();
    }

    // ---------------------------------------------------------------------
    // Interne
    // ---------------------------------------------------------------------

    function _requireOwner(uint256 agentId) internal view {
        address owner = _owner[agentId];
        if (owner == address(0)) revert UnknownAgent(agentId);
        if (msg.sender != owner) revert NotAgentOwner(agentId, msg.sender);
    }

    function _isReserved(string memory key) internal pure returns (bool) {
        return keccak256(bytes(key)) == keccak256(bytes(AGENT_WALLET_KEY));
    }

    /// @notice Adresse en chaîne hexadécimale "0x...", pour exposer `agentWallet` en métadonnée lisible.
    function _toHexString(address account) internal pure returns (string memory) {
        bytes16 hexDigits = "0123456789abcdef";
        bytes20 value = bytes20(account);
        bytes memory out = new bytes(42);
        out[0] = "0";
        out[1] = "x";
        for (uint256 i = 0; i < 20; i++) {
            out[2 + i * 2] = hexDigits[uint8(value[i]) >> 4];
            out[3 + i * 2] = hexDigits[uint8(value[i]) & 0x0f];
        }
        return string(out);
    }
}
