// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.24;

/// @title INativeMinter
/// @notice Précompilé Avalanche Subnet-EVM pour frapper la monnaie native (VETO).
/// @dev Adresse figée du précompilé : 0x0200000000000000000000000000000000000001.
///      L'appelant doit être autorisé par la ContractNativeMinter config du L1 (hors de ce dépôt).
///      En test, on remplace cette adresse par un faux via vm.etch (voir test/mocks/MockNativeMinter.sol).
interface INativeMinter {
    /// @notice Frappe `amount` de monnaie native au profit de `to`.
    function mintNativeCoin(address to, uint256 amount) external;
}

// Adresse canonique du précompilé NativeMinter sur un Subnet-EVM.
address constant NATIVE_MINTER = 0x0200000000000000000000000000000000000001;
