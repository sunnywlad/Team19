// Bouchon de l'IA du client : construit la demande de specs/01 et la signe en
// EIP-712. La clé vient de l'environnement (CLIENT_SIGNER) ; elle n'est ni
// écrite ni journalisée.
import { hashTypedData, recoverTypedDataAddress, type Address } from "viem";
import { privateKeyToAccount, type PrivateKeyAccount } from "viem/accounts";
import { ACTION, EIP712_NAME, EIP712_VERSION, type ActionName, type Policy } from "./config.ts";
import { toSeconds, type Clock, type Hex, type SignedRequest, type UnsignedRequest } from "./types.ts";

export type Domain = { name: string; version: string; chainId: number; verifyingContract: Address };

export function domainFor(chainId: number, verifyingContract: Address): Domain {
  return { name: EIP712_NAME, version: EIP712_VERSION, chainId, verifyingContract };
}

// Ordre et types gelés : ils entrent dans l'empreinte du type (specs/01 § 5).
export const REQUEST_TYPES = {
  Request: [
    { name: "requestId", type: "bytes32" },
    { name: "clientId", type: "bytes32" },
    { name: "agentId", type: "bytes32" },
    { name: "action", type: "uint8" },
    { name: "refId", type: "bytes32" },
    { name: "issuedAt", type: "uint64" },
    { name: "expiresAt", type: "uint64" },
  ],
} as const;

export type RequestStruct = {
  requestId: Hex;
  clientId: Hex;
  agentId: Hex;
  action: number;
  refId: Hex;
  issuedAt: bigint;
  expiresAt: bigint;
};

/** Passage du JSON (snake_case, action en texte) à la structure signée. */
export function toStruct(request: UnsignedRequest): RequestStruct {
  return {
    requestId: request.request_id,
    clientId: request.client_id,
    agentId: request.agent_id,
    action: ACTION[request.action],
    refId: request.ref_id,
    issuedAt: BigInt(request.issued_at),
    expiresAt: BigInt(request.expires_at),
  };
}

function typedData(request: UnsignedRequest, domain: Domain) {
  return { domain, types: REQUEST_TYPES, primaryType: "Request", message: toStruct(request) } as const;
}

/** Empreinte à signer : keccak256(0x1901 ‖ domaine ‖ structure). */
export function requestDigest(request: UnsignedRequest, domain: Domain): Hex {
  return hashTypedData(typedData(request, domain));
}

export async function recoverRequestSigner(request: SignedRequest, domain: Domain): Promise<Address> {
  const address = await recoverTypedDataAddress({ ...typedData(request, domain), signature: request.signature });
  return address.toLowerCase() as Address;
}

export type RequestIntent = { request_id: Hex; agent_id: Hex; action: ActionName; ref_id: Hex; ttlS?: number };

export class ClientSigner {
  readonly #account: PrivateKeyAccount;
  readonly #domain: Domain;
  readonly #clientId: Hex;
  readonly #clock: Clock;
  readonly #policy: Policy;

  constructor(privateKey: Hex, clientId: Hex, domain: Domain, policy: Policy, clock: Clock) {
    this.#account = privateKeyToAccount(privateKey);
    this.#clientId = clientId;
    this.#domain = domain;
    this.#policy = policy;
    this.#clock = clock;
  }

  /** Adresse publique du signataire : c'est clientSigner() côté contrat. */
  get address(): Address {
    return this.#account.address.toLowerCase() as Address;
  }

  get domain(): Domain {
    return this.#domain;
  }

  build(intent: RequestIntent): UnsignedRequest {
    const ttl = intent.ttlS ?? this.#policy.demoTtlS;
    if (!Number.isInteger(ttl) || ttl <= 0 || ttl > this.#policy.maxTtlS) {
      throw new RangeError(`durée de vie hors bornes : ${ttl} s`);
    }
    const issuedAt = toSeconds(this.#clock());
    return {
      request_id: intent.request_id,
      client_id: this.#clientId,
      agent_id: intent.agent_id,
      action: intent.action,
      ref_id: intent.ref_id,
      issued_at: issuedAt,
      expires_at: issuedAt + ttl,
    };
  }

  async sign(request: UnsignedRequest): Promise<SignedRequest> {
    const signature = await this.#account.signTypedData(typedData(request, this.#domain));
    return { ...request, signature: signature.toLowerCase() as Hex };
  }

  async emit(intent: RequestIntent): Promise<SignedRequest> {
    return this.sign(this.build(intent));
  }
}
