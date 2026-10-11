// Bandeau d'état : ce que l'œil lit en premier. Quatre faits, chacun avec son
// mot d'état, son icône et la provenance de sa source. Rien n'est déduit :
// une valeur absente s'écrit « Non mesuré ».
import type { ReactNode } from "react";
import type { TagSource } from "../api/types.ts";
import { PAGE_LIMIT } from "../api/client.ts";
import { isPositiveWei, paidTotal, pauseCount } from "../domain/cockpit.ts";
import { isStale } from "../hooks/poller.ts";
import { vaultFed, type ViewProps } from "../views/shared.ts";
import { Amount, SourceTag } from "./atoms.tsx";
import { Icon, type IconName } from "./icons.tsx";
import { Rolling } from "./Rolling.tsx";

/** Sens réservé des trois accents : sain (sarcelle), attente humaine (moutarde), veto (orange brûlé). */
export type Tone = "sain" | "attente" | "veto" | "neutre" | "inconnu";

const TONE_ICONS: Record<Tone, IconName> = { sain: "passe", attente: "attente", veto: "veto", neutre: "non-atteint", inconnu: "inconnu" };

type Cell = {
  key: string;
  label: string;
  icon: IconName;
  value: ReactNode;
  /** Valeur brute, pour que le chiffre roule quand elle change. */
  raw: string;
  tone: Tone;
  state: string;
  note: ReactNode;
  sources: TagSource[];
  stale: boolean;
};

const NOT_MEASURED = <span className="indisponible">Non mesuré</span>;

export function StatusStrip({ view }: { view: ViewProps }) {
  const { relay, vault, response, sources, vaultOrigin, now } = view;
  const relayTag = vaultFed(sources.relay, vaultOrigin);
  const vaultTag = vaultFed(sources.vault, vaultOrigin);

  const events = relay.data?.events ?? null;
  const paid = events === null ? null : paidTotal(events, events.length >= PAGE_LIMIT);
  const paidPositive = paid === null ? null : isPositiveWei(paid.wei);

  const held = vault.data?.total_held_wei ?? null;
  const heldPositive = isPositiveWei(held);

  const pauses = pauseCount(response.data?.pausedAgents ?? null, events);
  const pauseTotal = pauses.offchain === null && pauses.onchain === null ? null : (pauses.offchain ?? 0) + (pauses.onchain ?? 0);

  const vaultPaused = vault.data?.vault_paused ?? null;

  const cells: Cell[] = [
    {
      key: "sorti",
      label: "Montant sorti",
      icon: "sortie",
      raw: paid?.wei ?? "—",
      value: relay.data === null ? "—" : paid === null ? NOT_MEASURED : <Amount wei={paid.wei} />,
      tone: paidPositive === null ? "inconnu" : paidPositive ? "sain" : "neutre",
      state: paidPositive === null ? "non mesuré" : paidPositive ? "payé" : "rien n'est sorti",
      note:
        paid === null
          ? relay.data === null
            ? "lecture en cours"
            : `lecture tronquée à ${PAGE_LIMIT} événements`
          : `${paid.payments} paiement${paid.payments > 1 ? "s" : ""} (événements Paid)`,
      sources: [relayTag],
      stale: isStale(relay, now),
    },
    {
      key: "bloque",
      label: "Montant bloqué",
      icon: "bloque",
      raw: held ?? "—",
      value: vault.data === null ? "—" : <Amount wei={held} missing="Non mesuré" />,
      tone: heldPositive === null ? "inconnu" : heldPositive ? "attente" : "neutre",
      state: heldPositive === null ? "non mesuré" : heldPositive ? "attend un humain" : "aucun",
      note: "cas en attente de validation, lu dans le coffre",
      sources: [vaultTag],
      stale: isStale(vault, now),
    },
    {
      key: "pauses",
      label: "Agents en pause",
      icon: "pause",
      raw: String(pauseTotal),
      value: pauseTotal === null ? "—" : <span className="nombre">{pauseTotal}</span>,
      tone: pauseTotal === null ? "inconnu" : pauseTotal > 0 ? "veto" : "neutre",
      state: pauseTotal === null ? "non mesuré" : pauseTotal > 0 ? "écartés" : "aucun",
      note: (
        <>
          {pauses.offchain === null ? "—" : pauses.offchain} hors chaîne · {pauses.onchain === null ? "—" : pauses.onchain} sur la chaîne
        </>
      ),
      sources: [sources.response, relayTag],
      stale: isStale(response, now) || isStale(relay, now),
    },
    {
      key: "coffre",
      label: "Coffre",
      icon: "coffre",
      raw: String(vaultPaused),
      value: vault.data === null ? "—" : vaultPaused === null ? NOT_MEASURED : <span className="mot-etat">{vaultPaused ? "En pause" : "Ouvert"}</span>,
      tone: vaultPaused === null ? "inconnu" : vaultPaused ? "veto" : "sain",
      state: vaultPaused === null ? "non mesuré" : vaultPaused ? "aucune sortie possible" : "pas en pause",
      note: "vue vaultPaused du coffre",
      sources: [vaultTag],
      stale: isStale(vault, now),
    },
  ];

  return (
    <section className="etat" aria-labelledby="titre-etat">
      <h2 id="titre-etat" className="visuellement-cache">
        État du coffre
      </h2>
      <dl className="etat-liste">
        {cells.map((c) => (
          <div key={c.key} className={`etat-case ton-${c.tone}${c.stale ? " perime" : ""}`} data-testid={`etat-${c.key}`} data-ton={c.tone}>
            <dt>
              <Icon name={c.icon} size={18} />
              {c.label}
            </dt>
            <dd className="etat-valeur">
              <Rolling value={c.raw}>{c.value}</Rolling>
            </dd>
            <dd className="etat-mot">
              <Icon name={TONE_ICONS[c.tone]} />
              {c.state}
            </dd>
            <dd className="etat-note">
              {c.note}
              {c.stale && " · périmé"}{" "}
              {[...new Set(c.sources)].map((s) => (
                <SourceTag key={s} source={s} />
              ))}
            </dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
