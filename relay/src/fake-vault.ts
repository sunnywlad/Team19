// Faux coffre en mémoire : rejoue les décisions de specs/02 § 5 et § 6 sur un
// état local, bloc par bloc, sans chaîne. Réservé aux tests et à la démo
// hors ligne. Il ne détient ni ne déplace aucun fonds : « cash » est un nombre.
import { createHash } from "node:crypto";
import type { Address } from "viem";
import { ACTION, DECISION, REASON, type ActionName, type Policy } from "./config.ts";
import { recoverRequestSigner, type Domain } from "./signer.ts";
import { toSeconds, type Clock, type Hex, type SignedRequest } from "./types.ts";
import type { EventArgs, SubmitOutcome, VaultClient, VaultEvent, VaultState } from "./vault.ts";

type RefStatus = "Admitted" | "Held" | "Settled" | "Cancelled";
type Ref = { beneficiaryId: Hex; amount: bigint; status: RefStatus };
type Pending = { agentId: Hex; clientId: Hex; action: number; refId: Hex; amount: bigint; deadline: number };

/** Panne simulée du lien vers la chaîne. */
export type Fault =
  | "none"
  /** RPC injoignable : rien ne part. */
  | "down"
  /** La transaction part et s'exécute, mais la réponse se perd. */
  | "lost_reply";

export type FakeVaultInit = {
  clientId: Hex;
  clientSigner: Address;
  domain: Domain;
  policy: Policy;
  clock: Clock;
  cash: bigint;
  safetyReserve: bigint;
  threshold: bigint;
  approvalDelayS: number;
};

export class FakeVault implements VaultClient {
  fault: Fault = "none";
  vaultPaused = false;
  cash: bigint;
  readonly #init: FakeVaultInit;
  readonly #beneficiaries = new Set<Hex>();
  readonly #invoices = new Map<Hex, Ref>();
  readonly #placements = new Map<Hex, Ref>();
  readonly #agents = new Map<Hex, { mandate: number; paused: boolean }>();
  readonly #consumed = new Set<Hex>();
  readonly #pending = new Map<Hex, Pending>();
  readonly #events: VaultEvent[] = [];
  #block = 0n;
  #tx = 0;
  /** Nombre d'appels à submit qui ont atteint le « contrat ». */
  submissions = 0;

  constructor(init: FakeVaultInit) {
    this.#init = init;
    this.cash = init.cash;
  }

  // --- Mise en place (rôles admission, propriétaire, gardien) ---------------

  registerBeneficiary(id: Hex): void {
    this.#beneficiaries.add(id);
  }
  registerInvoice(id: Hex, beneficiaryId: Hex, amount: bigint): void {
    if (!this.#beneficiaries.has(beneficiaryId)) throw new Error("UnknownBeneficiary");
    if (this.#invoices.has(id)) throw new Error("AlreadyRegistered");
    this.#invoices.set(id, { beneficiaryId, amount, status: "Admitted" });
    this.#emitBlock([["InvoiceRegistered", { invoiceId: id, beneficiaryId, amount: amount.toString() }]]);
  }
  registerPlacement(id: Hex, beneficiaryId: Hex, amount: bigint): void {
    if (!this.#beneficiaries.has(beneficiaryId)) throw new Error("UnknownBeneficiary");
    if (this.#placements.has(id)) throw new Error("AlreadyRegistered");
    this.#placements.set(id, { beneficiaryId, amount, status: "Admitted" });
  }
  registerAgent(id: Hex, mandate: ActionName[]): void {
    this.#agents.set(id, { mandate: mandate.reduce((bits, a) => bits | ACTION[a], 0), paused: false });
  }
  pauseAgent(id: Hex): void {
    const agent = this.#agents.get(id);
    if (!agent) throw new Error("UnknownAgent");
    agent.paused = true;
    this.#emitBlock([["AgentPaused", { agentId: id }]]);
  }

  // --- Vues (specs/02 § 4) --------------------------------------------------

  admittedDebts(): bigint {
    let sum = 0n;
    for (const inv of this.#invoices.values()) if (inv.status === "Admitted" || inv.status === "Held") sum += inv.amount;
    return sum;
  }
  totalHeld(): bigint {
    let sum = 0n;
    for (const p of this.#pending.values()) sum += p.amount;
    return sum;
  }
  heldPlacements(): bigint {
    let sum = 0n;
    for (const p of this.#pending.values()) if (p.action === ACTION.PLACE) sum += p.amount;
    return sum;
  }
  placeable(): bigint {
    const value = this.cash - this.admittedDebts() - this.#init.safetyReserve - this.heldPlacements();
    return value > 0n ? value : 0n;
  }
  isConsumed(requestId: Hex): boolean {
    return this.#consumed.has(requestId);
  }

  // --- VaultClient ----------------------------------------------------------

  async agentPaused(agentId: Hex): Promise<boolean> {
    if (this.fault === "down") throw new Error("RPC injoignable (simulé)");
    return this.#agents.get(agentId)?.paused ?? false;
  }

  async blockNumber(): Promise<bigint> {
    if (this.fault === "down") throw new Error("RPC injoignable (simulé)");
    return this.#block;
  }

  async events(fromBlock: bigint, toBlock: bigint): Promise<VaultEvent[]> {
    if (this.fault === "down") throw new Error("RPC injoignable (simulé)");
    return this.#events.filter((e) => e.blockNumber >= fromBlock && e.blockNumber <= toBlock);
  }

  async state(): Promise<VaultState> {
    if (this.fault === "down") throw new Error("RPC injoignable (simulé)");
    return {
      block_number: Number(this.#block),
      block_timestamp: this.#now(),
      cash_wei: this.cash.toString(),
      admitted_debts_wei: this.admittedDebts().toString(),
      safety_reserve_wei: this.#init.safetyReserve.toString(),
      total_held_wei: this.totalHeld().toString(),
      held_placements_wei: this.heldPlacements().toString(),
      placeable_wei: this.placeable().toString(),
      threshold_wei: this.#init.threshold.toString(),
      vault_paused: this.vaultPaused,
    };
  }

  async submit(request: SignedRequest): Promise<SubmitOutcome> {
    if (this.fault === "down") return { kind: "not_sent", cause: "RPC injoignable (simulé)" };
    const txHash = await this.#decide(request);
    if (this.fault === "lost_reply") return { kind: "unknown", cause: "réponse perdue (simulé)", txHash: null };
    return { kind: "sent", txHash };
  }

  // --- Cas 1 (specs/02 § 6) -------------------------------------------------

  approve(requestId: Hex): void {
    const p = this.#need(requestId);
    if (this.vaultPaused) throw new Error("VaultIsPaused");
    if (this.#agents.get(p.agentId)?.paused) throw new Error("AgentIsPaused");
    if (this.#now() > p.deadline) return this.#close(requestId, p, REASON.APPROVAL_TIMEOUT);
    this.#pending.delete(requestId);
    const ref = this.#ref(p.action, p.refId)!;
    ref.status = "Settled";
    this.cash -= p.amount;
    this.#emitBlock([
      this.#decision(requestId, p.agentId, p.clientId, p.action, DECISION.ACCEPTED, REASON.APPROVED, p.refId),
      ["Paid", { requestId, refId: p.refId, beneficiaryId: ref.beneficiaryId, amount: p.amount.toString() }],
    ]);
  }
  refuse(requestId: Hex): void {
    this.#close(requestId, this.#need(requestId), REASON.APPROVAL_REFUSED);
  }
  expire(requestId: Hex): void {
    const p = this.#need(requestId);
    if (this.#now() <= p.deadline) throw new Error("DeadlineNotReached");
    this.#close(requestId, p, REASON.APPROVAL_TIMEOUT);
  }

  /** Avance la chaîne de n blocs vides, pour les confirmations. */
  mine(n = 1): void {
    this.#block += BigInt(n);
  }

  // --- Interne --------------------------------------------------------------

  #now(): number {
    return toSeconds(this.#init.clock());
  }
  #need(requestId: Hex): Pending {
    const p = this.#pending.get(requestId);
    if (!p) throw new Error("NoPendingApproval");
    return p;
  }
  #ref(action: number, refId: Hex): Ref | undefined {
    return action === ACTION.PAY_INVOICE ? this.#invoices.get(refId) : this.#placements.get(refId);
  }
  #close(requestId: Hex, p: Pending, reason: number): void {
    this.#pending.delete(requestId);
    this.#ref(p.action, p.refId)!.status = "Admitted";
    this.#emitBlock([
      this.#decision(requestId, p.agentId, p.clientId, p.action, DECISION.REFUSED, reason, p.refId),
      ["HoldReleased", { requestId, refId: p.refId, amount: p.amount.toString() }],
    ]);
  }
  #decision(requestId: Hex, agentId: Hex, clientId: Hex, action: number, decision: number, reason: number, refId: Hex): [string, EventArgs] {
    return ["Decision", { requestId, agentId, clientId, action, decision, reason, refId }];
  }
  #emitBlock(logs: [string, EventArgs][]): Hex {
    this.#block += 1n;
    this.#tx += 1;
    const txHash = `0x${createHash("sha256").update(`fake-vault/tx/${this.#tx}`).digest("hex")}` as Hex;
    logs.forEach(([name, args], logIndex) => {
      this.#events.push({ name, txHash, logIndex, blockNumber: this.#block, blockTimestamp: this.#now(), args });
    });
    return txHash;
  }

  /** specs/02 § 5 : contrôles dans l'ordre gelé. Renvoie l'empreinte de la transaction. */
  async #decide(r: SignedRequest): Promise<Hex> {
    this.submissions += 1;
    const action = ACTION[r.action] as number;
    const refuse = (reason: number): Hex =>
      this.#emitBlock([this.#decision(r.request_id, r.agent_id, r.client_id, action, DECISION.REFUSED, reason, r.ref_id)]);

    // 1. Signature : n'emporte pas l'identifiant.
    let signer: string | null = null;
    try {
      signer = await recoverRequestSigner(r, this.#init.domain);
    } catch {
      signer = null;
    }
    if (r.client_id !== this.#init.clientId || signer !== this.#init.clientSigner.toLowerCase()) {
      return refuse(REASON.SIGNATURE_INVALID);
    }
    // 2. Rejeu.
    if (this.#consumed.has(r.request_id)) return refuse(REASON.REQUEST_REPLAYED);
    this.#consumed.add(r.request_id);

    // 4 et 5. Fenêtre, puis expiration.
    const now = this.#now();
    const ttl = r.expires_at - r.issued_at;
    if (ttl <= 0 || ttl > this.#init.policy.maxTtlS || r.issued_at > now + this.#init.policy.maxClockSkewS) {
      return refuse(REASON.VALIDITY_WINDOW_INVALID);
    }
    if (now > r.expires_at) return refuse(REASON.REQUEST_EXPIRED);
    // 6 à 8. Pauses et mandat.
    if (this.vaultPaused) return refuse(REASON.VAULT_PAUSED);
    const agent = this.#agents.get(r.agent_id);
    if (!agent || (agent.mandate & action) === 0) return refuse(REASON.AGENT_NOT_AUTHORIZED);
    if (agent.paused) return refuse(REASON.AGENT_PAUSED);
    // 9 à 11. Référence.
    const isInvoice = action === ACTION.PAY_INVOICE;
    const ref = this.#ref(action, r.ref_id);
    if (!ref || ref.status === "Cancelled") return refuse(isInvoice ? REASON.INVOICE_UNKNOWN : REASON.PLACEMENT_UNKNOWN);
    if (ref.status === "Settled") return refuse(isInvoice ? REASON.INVOICE_ALREADY_PAID : REASON.PLACEMENT_ALREADY_EXECUTED);
    if (ref.status === "Held") return refuse(REASON.REF_PENDING_APPROVAL);
    // 12. Disponible.
    if (isInvoice ? ref.amount > this.cash - this.totalHeld() : ref.amount > this.placeable()) {
      return refuse(isInvoice ? REASON.INSUFFICIENT_CASH : REASON.EXCEEDS_PLACEABLE);
    }
    // 13. Seuil : validation humaine, montant bloqué.
    if (ref.amount > this.#init.threshold) {
      ref.status = "Held";
      const deadline = now + this.#init.approvalDelayS;
      this.#pending.set(r.request_id, { agentId: r.agent_id, clientId: r.client_id, action, refId: r.ref_id, amount: ref.amount, deadline });
      return this.#emitBlock([
        this.#decision(r.request_id, r.agent_id, r.client_id, action, DECISION.HUMAN, REASON.ABOVE_THRESHOLD, r.ref_id),
        ["HoldPlaced", { requestId: r.request_id, refId: r.ref_id, amount: ref.amount.toString(), deadline }],
      ]);
    }
    // 14. Accepté.
    ref.status = "Settled";
    this.cash -= ref.amount;
    return this.#emitBlock([
      this.#decision(r.request_id, r.agent_id, r.client_id, action, DECISION.ACCEPTED, REASON.NONE, r.ref_id),
      ["Paid", { requestId: r.request_id, refId: r.ref_id, beneficiaryId: ref.beneficiaryId, amount: ref.amount.toString() }],
    ]);
  }
}
