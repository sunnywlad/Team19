// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.24;

import {INativeMinter, NATIVE_MINTER} from "./precompiles/INativeMinter.sol";

/// @title Rewards
/// @notice Phase 2 : partage des frais d'une demande entre les reveals valides, en modèle pull.
/// @dev Chaque reveal valide touche une part égale ; le reste va au trésor. Un bonus optionnel en VETO
///      frais frappé par le précompilé NativeMinter récompense chaque reveal valide.
contract Rewards {
    // ---------------------------------------------------------------------
    // Erreurs propres au contrat
    // ---------------------------------------------------------------------

    error OnlyAdmin(address caller);
    error OnlyMarket(address caller);
    error AlreadySet();
    error ZeroAddress();
    /// @notice claim() sans solde à retirer.
    error NothingToClaim();

    // ---------------------------------------------------------------------
    // Événements
    // ---------------------------------------------------------------------

    event RewardsDistributed(uint256 indexed requestId, uint256 share, uint256 count);
    event Claimed(address indexed account, uint256 amount);
    event MarketSet(address indexed market);

    // ---------------------------------------------------------------------
    // Configuration
    // ---------------------------------------------------------------------

    address public immutable admin;
    address public immutable treasury;
    uint256 public immutable bonus; // VETO frappés par reveal valide, 0 = pas de frappe
    address public market;

    // ---------------------------------------------------------------------
    // État
    // ---------------------------------------------------------------------

    mapping(address => uint256) public claimable;

    // ---------------------------------------------------------------------
    // Construction et réglage unique
    // ---------------------------------------------------------------------

    /// @param treasury_ destinataire du reste et du cas sans reveal.
    /// @param bonus_ montant de VETO frappé par reveal valide (0 pour désactiver).
    constructor(address treasury_, uint256 bonus_) {
        if (treasury_ == address(0)) revert ZeroAddress();
        admin = msg.sender;
        treasury = treasury_;
        bonus = bonus_;
    }

    modifier onlyAdmin() {
        if (msg.sender != admin) revert OnlyAdmin(msg.sender);
        _;
    }

    /// @notice Fixe l'adresse du marché, une seule fois.
    function setMarket(address market_) external onlyAdmin {
        if (market != address(0)) revert AlreadySet();
        if (market_ == address(0)) revert ZeroAddress();
        market = market_;
        emit MarketSet(market_);
    }

    // ---------------------------------------------------------------------
    // Distribution (marché)
    // ---------------------------------------------------------------------

    /// @notice Crédite les frais reçus entre les reveals valides, part égale, reste au trésor.
    ///         Si bonus > 0, frappe `bonus` VETO à chaque reveal valide via le précompilé.
    /// @dev Réservé au marché. Modèle pull : crédit interne, retrait par claim().
    function distribute(uint256 requestId, address[] calldata revealers) external payable {
        if (msg.sender != market) revert OnlyMarket(msg.sender);

        uint256 n = revealers.length;
        if (n == 0) {
            claimable[treasury] += msg.value;
            emit RewardsDistributed(requestId, 0, 0);
            return;
        }

        uint256 share = msg.value / n;
        // Reste = msg.value - share * n ; la division d'abord est voulue (part entière, reste au trésor).
        // forge-lint: disable-next-line(divide-before-multiply)
        uint256 remainder = msg.value - share * n;
        for (uint256 i = 0; i < n; i++) {
            claimable[revealers[i]] += share;
        }
        if (remainder > 0) {
            claimable[treasury] += remainder;
        }

        // Comptabilité close : l'événement précède la frappe (effet externe).
        emit RewardsDistributed(requestId, share, n);

        if (bonus > 0) {
            for (uint256 i = 0; i < n; i++) {
                // frappe par reveal valide, comité de 3 au plus ; registre non réentrant.
                // forge-lint: disable-next-line(calls-loop)
                INativeMinter(NATIVE_MINTER).mintNativeCoin(revealers[i], bonus);
            }
        }
    }

    // ---------------------------------------------------------------------
    // Retrait (pull)
    // ---------------------------------------------------------------------

    /// @notice Retire le solde accumulé. CEI. Revert si rien à retirer.
    function claim() external {
        uint256 amount = claimable[msg.sender];
        if (amount == 0) revert NothingToClaim();
        claimable[msg.sender] = 0;
        emit Claimed(msg.sender, amount);
        (bool ok,) = payable(msg.sender).call{value: amount}("");
        require(ok, "Rewards: claim transfer failed");
    }
}
