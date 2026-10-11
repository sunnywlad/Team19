// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.24;

import {IVerificationMarket} from "./IVerificationMarket.sol";

/// @title ISlashing
/// @notice Interface figée en phase 0, construite en phase 2 : trois fautes, et aucune autre (docs/piste-A.md § 1).
/// @dev Le désaccord avec la majorité n'est jamais une faute.
interface ISlashing {
    /// @notice NoCommit : 1 %. NoReveal : commit sans reveal valide, 5 %.
    /// PredicateViolation : vote ou motif contredit par un prédicat sur Facts, 20 %, sur contestation.
    enum Fault {
        NoCommit,
        NoReveal,
        PredicateViolation
    }

    event ContestOpened(uint256 indexed requestId, address indexed verifier, address indexed challenger);
    event ContestResolved(uint256 indexed requestId, address indexed verifier, bool upheld);
    event VerifierSlashed(uint256 indexed requestId, address indexed verifier, Fault fault, uint256 amount);
    /// @notice 3 strikes : exclusion du tirage pour un nombre de demandes fixé.
    event VerifierStruck(address indexed verifier, uint8 strikes);

    error NotAllowedToContest(address caller);
    error ContestWindowClosed(uint256 requestId);
    error HashMismatch(uint256 requestId);
    error NoViolation(uint256 requestId, address verifier);

    /// @notice Sanctionne NoCommit et NoReveal, constatés par le marché (VerifierMissed). Appelable par tous.
    function slashMissed(uint256 requestId, address verifier) external;

    /// @notice Contestation pendant Contest. Le contrat vérifie hashOf(facts, contentHash) == h,
    /// puis évalue les prédicats contre le vote et les motifs révélés du vérificateur.
    /// Réservé aux adresses de la TxAllowList (de fait, toute adresse qui peut écrire).
    function contest(uint256 requestId, address verifier, IVerificationMarket.Facts calldata facts, bytes32 contentHash)
        external
        returns (bool upheld);

    function strikesOf(address verifier) external view returns (uint8);
}
