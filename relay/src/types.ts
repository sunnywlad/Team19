import type { ActionName } from "./config.ts";

export type Hex = `0x${string}`;

/** specs/01 § 2, sans la signature. */
export type UnsignedRequest = {
  request_id: Hex;
  client_id: Hex;
  agent_id: Hex;
  action: ActionName;
  ref_id: Hex;
  issued_at: number;
  expires_at: number;
};

/** specs/01 § 2 : la demande signée, telle que la décrit request.schema.json. */
export type SignedRequest = UnsignedRequest & { signature: Hex };

/** Horloge injectable, en millisecondes Unix. */
export type Clock = () => number;
export const systemClock: Clock = () => Date.now();
export const toSeconds = (ms: number): number => Math.floor(ms / 1000);
