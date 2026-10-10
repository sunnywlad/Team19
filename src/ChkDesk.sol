// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.24;

import {INativeMinter, NATIVE_MINTER} from "./precompiles/INativeMinter.sol";

/// @title ChkDesk
/// @notice Guichet d'émission de CHK : un opérateur frappe des CHK pour un client payé hors chaîne.
/// @dev La frappe passe par le précompilé NativeMinter. Le client doit par ailleurs être admis sur
///      la TxAllowList par l'admin du L1, hors de ce contrat.
contract ChkDesk {
    // ---------------------------------------------------------------------
    // Erreurs propres au contrat
    // ---------------------------------------------------------------------

    error OnlyOperator(address caller);
    error OnlyAdmin(address caller);
    error ZeroAddress();
    error ZeroAmount();
    /// @notice Référence de paiement déjà créditée.
    error PaymentAlreadyCredited(bytes32 paymentRef);

    // ---------------------------------------------------------------------
    // Événements
    // ---------------------------------------------------------------------

    event Credited(address indexed client, uint256 amount, bytes32 indexed paymentRef);
    event OperatorSet(address indexed operator, bool allowed);

    // ---------------------------------------------------------------------
    // Configuration et état
    // ---------------------------------------------------------------------

    address public immutable admin;
    mapping(address => bool) public isOperator;
    mapping(bytes32 => bool) public credited; // référence de paiement déjà utilisée

    constructor() {
        admin = msg.sender;
        isOperator[msg.sender] = true;
        emit OperatorSet(msg.sender, true);
    }

    modifier onlyAdmin() {
        if (msg.sender != admin) revert OnlyAdmin(msg.sender);
        _;
    }

    /// @notice Ajoute ou retire un opérateur.
    function setOperator(address operator, bool allowed) external onlyAdmin {
        if (operator == address(0)) revert ZeroAddress();
        // OperatorSet est émis juste après ; le linter ne reconnaît pas l'événement personnalisé.
        // forge-lint: disable-next-line(missing-events-access-control)
        isOperator[operator] = allowed;
        emit OperatorSet(operator, allowed);
    }

    /// @notice Frappe `amount` CHK au client pour un paiement hors chaîne identifié par `paymentRef`.
    ///         Référence rejouée : revert. Opérateur seul.
    function credit(address client, uint256 amount, bytes32 paymentRef) external {
        if (!isOperator[msg.sender]) revert OnlyOperator(msg.sender);
        if (client == address(0)) revert ZeroAddress();
        if (amount == 0) revert ZeroAmount();
        if (credited[paymentRef]) revert PaymentAlreadyCredited(paymentRef);

        credited[paymentRef] = true;
        emit Credited(client, amount, paymentRef);
        INativeMinter(NATIVE_MINTER).mintNativeCoin(client, amount);
    }
}
