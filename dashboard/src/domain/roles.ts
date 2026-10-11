// Rôles et mandats, lus dans ce que les API servent déjà. Les adresses des
// rôles du contrat (owner(), approver()…) ne sont servies par aucune API du
// dashboard : elles restent « non disponible ». Les pouvoirs de chaque rôle
// sont ceux de l'interface gelée (specs/contract/IArgentVault.sol), recopiés.
import type { RelayEvent } from "../api/types.ts";
import { chainPausedAgents, newestFirst } from "./activity.ts";

export const CONTRACT_ROLES: { key: string; label: string; powers: string; limit: string }[] = [
  { key: "owner", label: "Propriétaire", powers: "inscrit les agents et leur mandat, règle la réserve, le seuil et le délai d'approbation", limit: "seul rôle qui lève une pause ; ne désigne aucune destination de fonds" },
  { key: "admission", label: "Admission", powers: "inscrit les bénéficiaires, les factures et les placements", limit: "une inscription ne se modifie pas" },
  { key: "relay", label: "Relais", powers: "soumet les demandes signées par le client", limit: "ne décide rien : le contrat décide sur son propre état" },
  { key: "approver", label: "Approbateur", powers: "approuve ou refuse un cas en attente (décision 1)", limit: "ne paie que le montant bloqué, au bénéficiaire inscrit" },
  { key: "guardian", label: "Gardien", powers: "met en pause le coffre ou un agent", limit: "ne peut que bloquer" },
  { key: "client", label: "Signataire du client", powers: "signe les demandes de l'IA du client", limit: "l'agent ne fournit que des identifiants" },
];

export type AgentMandate = { agentId: string; mandate: number | null; actions: string[]; unknownBits: boolean; paused: boolean; blockNumber: number };

const ACTIONS: [number, string][] = [
  [1, "payer une facture"],
  [2, "placer"],
];

/** Mandats inscrits : dernier AgentRegistered de chaque agent. Mandat illisible : null, jamais 0. */
export function agentMandates(events: RelayEvent[]): AgentMandate[] {
  const paused = new Set(chainPausedAgents(events).map((p) => p.agentId));
  const seen = new Map<string, AgentMandate>();
  for (const e of newestFirst(events)) {
    if (e.name !== "AgentRegistered") continue;
    const agentId = e.args.agentId;
    if (typeof agentId !== "string" || seen.has(agentId)) continue;
    const raw = e.args.mandate;
    const mandate = typeof raw === "number" && Number.isInteger(raw) && raw >= 0 && raw <= 255 ? raw : typeof raw === "string" && /^[0-9]{1,3}$/.test(raw) ? Number(raw) : null;
    const actions = mandate === null ? [] : ACTIONS.filter(([bit]) => (mandate & bit) !== 0).map(([, label]) => label);
    seen.set(agentId, { agentId, mandate, actions, unknownBits: mandate !== null && (mandate & ~3) !== 0, paused: paused.has(agentId), blockNumber: e.block_number });
  }
  return [...seen.values()];
}
