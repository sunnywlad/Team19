// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.24;

/// @title IVerifierRegistry
/// @notice Interface figée en phase 0, construite en phase 2 : inscription, caution VETO, part bloquée par mission.
/// @dev En phase 1, VerificationMarket utilise un comité fixe et n'appelle pas ce registre.
interface IVerifierRegistry {
    event VerifierRegistered(address indexed verifier, uint256 stake);
    event VerifierExited(address indexed verifier, uint256 stakeReturned);
    event StakeLocked(address indexed verifier, uint256 indexed requestId, uint256 amount);
    event StakeUnlocked(address indexed verifier, uint256 indexed requestId, uint256 amount);
    event StakeSlashed(address indexed verifier, uint256 indexed requestId, uint256 amount);

    error NotAdmitted(address account);
    error StakeTooLow(uint256 sent, uint256 required);
    error StakeLockedInMission(address verifier, uint256 locked);
    error OnlyMarket(address caller);

    /// @notice Inscription d'un vérificateur admis par l'équipe, caution en VETO natif (msg.value).
    function register() external payable;

    /// @notice Sortie et retrait de la caution, refusés tant qu'une part est bloquée.
    function exit() external;

    /// @notice Réservé à VerificationMarket : bloque une part de caution pour la durée d'une mission.
    function lockStake(address verifier, uint256 requestId) external;

    /// @notice Réservé à VerificationMarket : débloque la part en fin de mission sans faute.
    function unlockStake(address verifier, uint256 requestId) external;

    /// @notice Réservé à Slashing : saisit la part bloquée.
    function slash(address verifier, uint256 requestId) external;

    function isActive(address verifier) external view returns (bool);

    function activeVerifiers() external view returns (address[] memory);

    function stakeOf(address verifier) external view returns (uint256 total, uint256 locked);

    function minStake() external view returns (uint256);
}
