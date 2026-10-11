// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.24;

import {INativeMinter} from "../../src/precompiles/INativeMinter.sol";

/// @title MockNativeMinter
/// @notice Faux précompilé NativeMinter pour les tests Foundry.
/// @dev On ne peut pas frapper de la monnaie native depuis un contrat de test.
///      Choix documenté : ce mock est préalimenté par `vm.deal` (le test crédite son solde),
///      puis `mintNativeCoin` transfère réellement les VETO à `to`, reproduisant l'effet de solde
///      du vrai précompilé. En plus, chaque appel est enregistré (`minted`, `totalMintedTo`),
///      ce qui permet aux tests d'assurer soit le solde reçu, soit les appels passés.
///      Pose : `vm.etch(NATIVE_MINTER, address(new MockNativeMinter).code)` puis
///      `vm.deal(NATIVE_MINTER, provision)`.
contract MockNativeMinter is INativeMinter {
    /// @notice Journal des appels : destinataire puis montant, dans l'ordre.
    struct Call {
        address to;
        uint256 amount;
    }

    Call[] public minted;
    mapping(address => uint256) public totalMintedTo;

    /// @notice Reproduit la frappe : transfère depuis le solde préalloué, et journalise.
    function mintNativeCoin(address to, uint256 amount) external {
        minted.push(Call(to, amount));
        totalMintedTo[to] += amount;
        if (amount > 0) {
            // Solde fourni par vm.deal dans le test ; échoue si la provision est insuffisante.
            (bool ok,) = payable(to).call{value: amount}("");
            require(ok, "MockNativeMinter: transfer failed");
        }
    }

    /// @notice Nombre d'appels enregistrés.
    function mintedCount() external view returns (uint256) {
        return minted.length;
    }

    /// @notice Permet au mock de recevoir la provision via vm.deal (pas de transfert entrant réel).
    receive() external payable {}
}
