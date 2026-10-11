// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.24;

import {IVerifierRegistry} from "./interfaces/IVerifierRegistry.sol";

/// @title VerifierRegistry
/// @notice Phase 2 : inscription des vérificateurs, caution en VETO natif, part bloquée par mission.
/// @dev `admit`/`revoke` par l'admin ; `register`/`exit` par le vérificateur ; `lockStake`/`unlockStake`
///      par le marché ; `slash`/`seize` par le contrat Slashing. CEI sur tous les transferts.
contract VerifierRegistry is IVerifierRegistry {
    // ---------------------------------------------------------------------
    // Erreurs propres au contrat
    // ---------------------------------------------------------------------

    /// @notice Appelant autre que l'admin.
    error OnlyAdmin(address caller);
    /// @notice setMarket / setSlashing appelé deux fois.
    error AlreadySet();
    /// @notice Appelant autre que le contrat Slashing.
    error OnlySlashing(address caller);
    /// @notice Caution libre insuffisante pour bloquer la part demandée.
    error InsufficientFreeStake(address verifier);
    /// @notice Paramètre d'adresse nul au déploiement ou au réglage.
    error ZeroAddress();

    // ---------------------------------------------------------------------
    // Configuration
    // ---------------------------------------------------------------------

    address public immutable admin;
    uint256 public immutable minStakeAmount;
    uint16 public immutable lockBps;
    address public treasury;

    address public market;
    address public slashing;

    // ---------------------------------------------------------------------
    // État
    // ---------------------------------------------------------------------

    mapping(address => bool) public admitted;
    mapping(address => bool) public registered;
    mapping(address => uint256) public total; // caution totale déposée
    mapping(address => uint256) public locked; // somme bloquée toutes missions
    mapping(address => mapping(uint256 => uint256)) public lockedFor; // par (vérificateur, demande)

    address[] private _active;
    mapping(address => uint256) private _activeIndex; // index + 1 dans _active, 0 si absent

    // ---------------------------------------------------------------------
    // Construction et réglages uniques
    // ---------------------------------------------------------------------

    /// @param minStake_ caution minimale pour rester actif.
    /// @param lockBps_ fraction (en bps) de la caution totale bloquée par mission (2000 = 20 %).
    /// @param treasury_ destinataire des cautions saisies.
    constructor(uint256 minStake_, uint16 lockBps_, address treasury_) {
        if (treasury_ == address(0)) revert ZeroAddress();
        admin = msg.sender;
        minStakeAmount = minStake_;
        lockBps = lockBps_;
        treasury = treasury_;
    }

    modifier onlyAdmin() {
        if (msg.sender != admin) revert OnlyAdmin(msg.sender);
        _;
    }

    /// @notice Émis au câblage du marché et du contrat Slashing, et à l'admission d'un vérificateur.
    event MarketSet(address indexed market);
    event SlashingSet(address indexed slashing);
    event VerifierAdmitted(address indexed account, bool admitted);

    /// @notice Fixe l'adresse du marché, une seule fois.
    function setMarket(address market_) external onlyAdmin {
        if (market != address(0)) revert AlreadySet();
        if (market_ == address(0)) revert ZeroAddress();
        market = market_;
        emit MarketSet(market_);
    }

    /// @notice Fixe l'adresse du contrat Slashing, une seule fois.
    function setSlashing(address slashing_) external onlyAdmin {
        if (slashing != address(0)) revert AlreadySet();
        if (slashing_ == address(0)) revert ZeroAddress();
        slashing = slashing_;
        emit SlashingSet(slashing_);
    }

    // ---------------------------------------------------------------------
    // Admission (admin)
    // ---------------------------------------------------------------------

    /// @notice Admet une adresse : condition préalable à `register`.
    function admit(address account) external onlyAdmin {
        if (account == address(0)) revert ZeroAddress();
        admitted[account] = true;
        emit VerifierAdmitted(account, true);
    }

    /// @notice Retire l'admission. N'affecte pas une caution déjà déposée.
    function revoke(address account) external onlyAdmin {
        admitted[account] = false;
        emit VerifierAdmitted(account, false);
    }

    // ---------------------------------------------------------------------
    // Inscription et sortie (vérificateur)
    // ---------------------------------------------------------------------

    /// @notice Dépôt de caution en VETO natif. Premier dépôt < minStake : rejeté. Admission requise.
    function register() external payable {
        if (!admitted[msg.sender]) revert NotAdmitted(msg.sender);
        if (!registered[msg.sender]) {
            if (msg.value < minStakeAmount) revert StakeTooLow(msg.value, minStakeAmount);
            registered[msg.sender] = true;
        }
        total[msg.sender] += msg.value;
        _addActive(msg.sender);
        emit VerifierRegistered(msg.sender, total[msg.sender]);
    }

    /// @notice Sortie et retrait total ; refusée tant qu'une part est bloquée. CEI.
    function exit() external {
        uint256 lockedAmount = locked[msg.sender];
        if (lockedAmount > 0) revert StakeLockedInMission(msg.sender, lockedAmount);

        uint256 amount = total[msg.sender];
        total[msg.sender] = 0;
        registered[msg.sender] = false;
        _removeActive(msg.sender);

        emit VerifierExited(msg.sender, amount);
        if (amount > 0) {
            (bool ok,) = payable(msg.sender).call{value: amount}("");
            require(ok, "VerifierRegistry: refund failed");
        }
    }

    // ---------------------------------------------------------------------
    // Verrou de mission (marché)
    // ---------------------------------------------------------------------

    modifier onlyMarket() {
        if (msg.sender != market) revert OnlyMarket(msg.sender);
        _;
    }

    /// @notice Bloque `total * lockBps / 10000` pour la mission `requestId`. Vérificateur inactif : revert.
    function lockStake(address verifier, uint256 requestId) external onlyMarket {
        if (!isActive(verifier)) revert NotAdmitted(verifier);
        uint256 amount = (total[verifier] * lockBps) / 10000;
        if (total[verifier] - locked[verifier] < amount) revert InsufficientFreeStake(verifier);
        locked[verifier] += amount;
        lockedFor[verifier][requestId] += amount;
        emit StakeLocked(verifier, requestId, amount);
    }

    /// @notice Libère le reste bloqué pour `requestId` (0 accepté).
    function unlockStake(address verifier, uint256 requestId) external onlyMarket {
        uint256 amount = lockedFor[verifier][requestId];
        if (amount > 0) {
            lockedFor[verifier][requestId] = 0;
            locked[verifier] -= amount;
        }
        emit StakeUnlocked(verifier, requestId, amount);
    }

    // ---------------------------------------------------------------------
    // Saisie (Slashing)
    // ---------------------------------------------------------------------

    modifier onlySlashing() {
        if (msg.sender != slashing) revert OnlySlashing(msg.sender);
        _;
    }

    /// @notice Saisit tout le bloqué de `requestId` et l'envoie au trésor.
    function slash(address verifier, uint256 requestId) external onlySlashing {
        uint256 amount = lockedFor[verifier][requestId];
        _seize(verifier, requestId, amount);
    }

    /// @notice Saisit `min(total * bps / 10000, lockedFor)` et l'envoie au trésor.
    /// @dev Extension hors interface : `slash` saisit tout le bloqué, `seize` une fraction plafonnée.
    function seize(address verifier, uint256 requestId, uint16 bps) external onlySlashing returns (uint256) {
        uint256 wanted = (total[verifier] * bps) / 10000;
        uint256 lockedHere = lockedFor[verifier][requestId];
        uint256 amount = wanted < lockedHere ? wanted : lockedHere;
        _seize(verifier, requestId, amount);
        return amount;
    }

    /// @notice Baisse total/locked/lockedFor et envoie au trésor. CEI.
    function _seize(address verifier, uint256 requestId, uint256 amount) private {
        if (amount == 0) {
            emit StakeSlashed(verifier, requestId, 0);
            return;
        }
        total[verifier] -= amount;
        locked[verifier] -= amount;
        lockedFor[verifier][requestId] -= amount;

        emit StakeSlashed(verifier, requestId, amount);
        // treasury est fixé au déploiement par l'admin, pas une destination arbitraire.
        // forge-lint: disable-next-line(arbitrary-send-eth)
        (bool ok,) = payable(treasury).call{value: amount}("");
        require(ok, "VerifierRegistry: treasury transfer failed");
    }

    // ---------------------------------------------------------------------
    // Lecture
    // ---------------------------------------------------------------------

    /// @notice Actif : admis, inscrit, caution totale >= minStake.
    function isActive(address verifier) public view returns (bool) {
        return admitted[verifier] && registered[verifier] && total[verifier] >= minStakeAmount;
    }

    /// @notice Liste des vérificateurs inscrits (ordre non garanti : swap and pop à la sortie).
    function activeVerifiers() external view returns (address[] memory) {
        return _active;
    }

    /// @notice Caution totale et part bloquée d'un vérificateur.
    function stakeOf(address verifier) external view returns (uint256 totalStake, uint256 lockedStake) {
        return (total[verifier], locked[verifier]);
    }

    /// @notice Caution minimale pour rester actif.
    function minStake() external view returns (uint256) {
        return minStakeAmount;
    }

    // ---------------------------------------------------------------------
    // Liste interne (swap and pop)
    // ---------------------------------------------------------------------

    function _addActive(address verifier) private {
        if (_activeIndex[verifier] == 0) {
            _active.push(verifier);
            _activeIndex[verifier] = _active.length; // index + 1
        }
    }

    function _removeActive(address verifier) private {
        uint256 idxPlus1 = _activeIndex[verifier];
        if (idxPlus1 == 0) return;
        uint256 idx = idxPlus1 - 1;
        uint256 lastIdx = _active.length - 1;
        if (idx != lastIdx) {
            address last = _active[lastIdx];
            _active[idx] = last;
            _activeIndex[last] = idx + 1;
        }
        _active.pop();
        _activeIndex[verifier] = 0;
    }
}
