// lib/hash.ts — contentHashOf, hashOf, commitmentOf

import { keccak256, encodeAbiParameters } from 'viem';
import type { Hex } from 'viem';
import type { Facts } from './payload.ts';

// contentHashOf : keccak256 des octets bruts du payload
export function contentHashOf(bytes: Buffer): Hex {
  return keccak256(new Uint8Array(bytes));
}

// hashOf : keccak256(abi.encode(facts, contentHash))
// Correspond à IVerificationMarket.hashOf()
export function hashOf(facts: Facts, contentHash: Hex): Hex {
  return keccak256(
    encodeAbiParameters(
      [
        {
          type: 'tuple',
          components: [
            { name: 'amount',       type: 'uint256' },
            { name: 'currency',     type: 'bytes3'  },
            { name: 'beneficiaryId', type: 'bytes32' },
            { name: 'referenceId',  type: 'bytes32' },
          ],
        },
        { type: 'bytes32' },
      ],
      [
        {
          amount:        facts.amount,
          currency:      facts.currency,
          beneficiaryId: facts.beneficiaryId,
          referenceId:   facts.referenceId,
        },
        contentHash,
      ],
    ),
  );
}

// commitmentOf : keccak256(abi.encode(chainId, market, requestId, verifier, vote, reasons, detailHash, salt))
// Correspond à IVerificationMarket.commitmentOf()
export function commitmentOf(params: {
  chainId: bigint;
  market: Hex;
  requestId: bigint;
  verifier: Hex;
  vote: number;      // uint8 — 0/1/2
  reasons: number;   // uint16 masque de bits
  detailHash: Hex;
  salt: Hex;
}): Hex {
  return keccak256(
    encodeAbiParameters(
      [
        { type: 'uint256' }, // chainId
        { type: 'address' }, // market
        { type: 'uint256' }, // requestId
        { type: 'address' }, // verifier
        { type: 'uint8'   }, // vote
        { type: 'uint16'  }, // reasons
        { type: 'bytes32' }, // detailHash
        { type: 'bytes32' }, // salt
      ],
      [
        params.chainId,
        params.market,
        params.requestId,
        params.verifier,
        params.vote,
        params.reasons,
        params.detailHash,
        params.salt,
      ],
    ),
  );
}
