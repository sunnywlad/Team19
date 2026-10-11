// Diagramme de notre flux et frise d'étapes de la dernière issue. Le chemin
// allumé est celui que la demande a réellement pris, lu dans les données.
import { useId, type ReactNode } from "react";
import type { VaultOrigin } from "../api/types.ts";
import { NODE_LABELS, STEP_STATE_WORDS, type FlowEdge, type FlowNode, type Outcome, type Step, type StepState } from "../domain/flow.ts";
import { formatTime } from "../lib/format.ts";
import { OpaqueId, ToneBadge } from "./atoms.tsx";

type Box = { x: number; y: number; w: number; sub: string };

/** Pilules de la maquette : hauteur fixe, bouts ronds, icône à gauche, sous-titre dessous. */
const H = 48;

const BOXES: Record<Exclude<FlowNode, "paiement">, Box> = {
  agent: { x: 10, y: 116, w: 118, sub: "demandeur" },
  porte: { x: 170, y: 116, w: 170, sub: "détecteur à règles" },
  ia: { x: 382, y: 116, w: 152, sub: "trésorerie, signe" },
  relais: { x: 576, y: 116, w: 122, sub: "file, soumission" },
  contrat: { x: 740, y: 116, w: 130, sub: "décide 0 · 1 · 2" },
  humain: { x: 896, y: 28, w: 200, sub: "cas 1, délai" },
  reponse: { x: 412, y: 262, w: 140, sub: "quarantaine · pause hors chaîne · alerte · rapport" },
};

/** Icônes des nœuds, dessinées dans un carré de 20. */
const NODE_ICONS: Record<FlowNode, ReactNode> = {
  agent: <path d="M10 9.5a3 3 0 1 0 0-6a3 3 0 1 0 0 6M4.5 16.5c.8-3 3-4.5 5.5-4.5s4.7 1.5 5.5 4.5" />,
  porte: <path d="M10 2.5l6 2.3v4.6c0 3.8-2.6 6.4-6 8.1-3.4-1.7-6-4.3-6-8.1V4.8zM7.4 10l1.8 1.8 3.5-3.6" />,
  ia: <path d="M10 3l1.6 4.4L16 9l-4.4 1.6L10 15l-1.6-4.4L4 9l4.4-1.6zM15.5 14l.6 1.6 1.6.6-1.6.6-.6 1.6-.6-1.6-1.6-.6 1.6-.6z" />,
  relais: <path d="M3.5 6h9M3.5 10h13M3.5 14h9M13.5 3.5 16 6l-2.5 2.5M10.5 11.5 13 14l-2.5 2.5" />,
  contrat: <path d="M5.5 2.5h6.5l3 3v12h-9.5zM12 2.5v3h3M8 9.5h5M8 12.5h5M8 15.5h3" />,
  humain: <path d="M6 3h8M6 17h8M7 3c0 4 6 4 6 7s-6 3-6 7M13 3c0 4-6 4-6 7s6 3 6 7" />,
  paiement: <path d="M10 3a7 7 0 1 0 0 14a7 7 0 1 0 0-14M12.3 7.5c-.5-.7-1.3-1-2.3-1-1.4 0-2.3.7-2.3 1.7 0 2.4 4.7 1.2 4.7 3.6 0 1-1 1.7-2.4 1.7-1 0-1.9-.4-2.4-1.1M10 5v1.5M10 13.5V15" />,
  reponse: <path d="M5 13.5V9a5 5 0 0 1 10 0v4.5l1.5 1.5h-13zM8.5 17.5h3" />,
};

/** Libellé du nœud Paiement selon ce que le relais a derrière lui : jamais « réseau de test » pour un faux coffre. */
export function paymentSub(origin: VaultOrigin): string {
  if (origin === "chaine") return "réseau de test";
  if (origin === "faux-coffre") return "faux coffre, aucun fonds";
  if (origin === "sans-objet") return "simulation";
  return "origine non confirmée";
}

const EDGES: Record<FlowEdge, string> = {
  "agent-porte": "M128 140 H166",
  "porte-ia": "M340 140 H378",
  "ia-relais": "M534 140 H572",
  "relais-contrat": "M698 140 H736",
  "contrat-humain": "M870 130 C886 130 876 52 892 52",
  "contrat-paiement": "M870 150 C886 150 876 228 892 228",
  "humain-paiement": "M1070 76 V200",
  "porte-reponse": "M255 190 C255 258 330 286 408 286",
  "contrat-reponse": "M805 190 C805 258 630 286 556 286",
};

const TONES = ["accepte", "humain", "refuse", "bloque", "repos"] as const;

type Props = {
  outcome: Outcome | null;
  origin: VaultOrigin;
  /**
   * Rang de la dernière arrivée, si « outcome » vient d'apparaître dans les
   * données. Chaque nouvelle valeur rejoue l'illumination du chemin ; null :
   * chemin affiché sans animation (ouverture de la page, rien de neuf).
   */
  pulse?: number | null;
};

export function FlowDiagram({ outcome, origin, pulse = null }: Props) {
  const uid = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const captionId = `${uid}-legende`;
  const tone = outcome?.tone ?? null;
  const onPath = (node: FlowNode): boolean => outcome?.nodes.includes(node) ?? false;
  const last = outcome?.nodes.filter((n) => n !== "reponse").at(-1) ?? null;
  const boxes: Record<FlowNode, Box> = { ...BOXES, paiement: { x: 896, y: 204, w: 200, sub: paymentSub(origin) } };

  const node = (id: FlowNode): ReactNode => {
    const box = boxes[id];
    const active = onPath(id);
    const state = active ? (id === last || id === "reponse" ? "fin" : "passe") : "repos";
    return (
      <g
        key={id}
        className={`noeud noeud-${state}${active ? ` ton-${tone} rang-${outcome?.nodes.indexOf(id) ?? 0}` : ""}`}
        data-noeud={id}
        data-etat={active ? "actif" : "repos"}
      >
        <rect x={box.x} y={box.y} width={box.w} height={H} rx={H / 2} />
        <circle className="noeud-pastille" cx={box.x + 25} cy={box.y + H / 2} r="15" />
        <g className="noeud-icone" transform={`translate(${box.x + 15} ${box.y + H / 2 - 10})`}>
          {NODE_ICONS[id]}
        </g>
        <text className="noeud-nom" x={box.x + 48} y={box.y + H / 2 + 5}>
          {NODE_LABELS[id]}
        </text>
        <text className="noeud-sous" x={box.x + box.w / 2} y={box.y + H + 16} textAnchor="middle">
          {box.sub}
        </text>
      </g>
    );
  };

  return (
    <figure
      // Nouvelle clé à chaque arrivée : le tracé est remonté et son animation rejouée, une fois.
      key={pulse === null ? "fixe" : `arrivee-${pulse}`}
      className={pulse === null ? "flux" : "flux flux-nouveau"}
      data-testid="flux"
      data-ton={tone ?? "aucun"}
      data-nouveau={pulse === null ? "false" : "true"}
    >
      <svg
        className="flux-svg"
        viewBox="0 0 1100 336"
        role="img"
        aria-labelledby={captionId}
        focusable="false"
        preserveAspectRatio="xMidYMid meet"
      >
        <defs>
          {TONES.map((t) => (
            <marker key={t} id={`${uid}-fleche-${t}`} className={`fleche ton-${t}`} viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse" markerUnits="userSpaceOnUse">
              <path d="M0 0L10 5L0 10z" />
            </marker>
          ))}
        </defs>
        {(Object.keys(EDGES) as FlowEdge[]).map((edge) => {
          const rank = outcome?.edges.indexOf(edge) ?? -1;
          const active = rank >= 0;
          const t = active && tone ? tone : "repos";
          return (
            <path
              key={edge}
              // Le rang dans le chemin règle le départ du tracé : l'illumination suit le sens de la demande.
              className={`arete ${active ? `arete-active ton-${t} rang-${rank}` : "arete-repos"}`}
              data-arete={edge}
              data-etat={active ? "actif" : "repos"}
              d={EDGES[edge]}
              pathLength="100"
              markerEnd={`url(#${uid}-fleche-${t})`}
            />
          );
        })}
        {/* Tirets clairs qui circulent sur le chemin pris, dans le sens de la demande : décoratifs, le tracé plein porte l'information. */}
        {(outcome?.edges ?? []).map((edge, rank) => (
          <path key={`flot-${edge}`} className={`arete-flot rang-${rank}`} data-flot={edge} d={EDGES[edge]} aria-hidden="true" />
        ))}
        {(Object.keys(boxes) as FlowNode[]).map(node)}
      </svg>
      {pulse !== null && outcome !== null && (
        <p className="visuellement-cache" role="status" data-testid="flux-annonce">
          Nouvelle issue : la demande est {outcome.summary}.
        </p>
      )}
      <figcaption id={captionId} className="flux-legende" data-testid="flux-legende">
        {outcome === null ? (
          <span className="vide">Aucune issue pour l'instant : aucun chemin à montrer.</span>
        ) : (
          <>
            <span className="flux-titre">Dernière issue {outcome.source === "contrat" ? "du contrat" : "à la porte d'entrée"} :</span>{" "}
            <ToneBadge tone={outcome.tone} /> <span className="synthese">la demande est {outcome.summary}</span>
            <span className="discret">
              {" "}
              · chemin : {outcome.nodes.map((n) => NODE_LABELS[n]).join(" → ")}
              {outcome.requestId !== null && (
                <>
                  {" "}
                  · demande <OpaqueId value={outcome.requestId} />
                </>
              )}
            </span>
          </>
        )}
      </figcaption>
    </figure>
  );
}

const STEP_ICONS: Record<StepState, ReactNode> = {
  fait: <path d="M4 10.5l4 4 8-9" />,
  echec: <path d="M5 5l10 10M15 5L5 15" />,
  attente: <path d="M6 3h8M6 17h8M7 3c0 4 6 4 6 7s-6 3-6 7M13 3c0 4-6 4-6 7s6 3 6 7" />,
  "non-atteint": <circle cx="10" cy="10" r="5" />,
  inconnu: <path d="M5 10h10" />,
};

/** Frise d'étapes : coche si le journal l'atteste, croix pour l'étape qui a arrêté la demande. */
export function StepTimeline({ steps }: { steps: Step[] }) {
  return (
    <ol className="frise" aria-label="Étapes de la demande" data-testid="frise">
      {steps.map((step) => (
        <li key={step.key} className={`etape etape-${step.state}`} data-etape={step.key} data-etat={step.state}>
          <span className="etape-icone">
            <svg viewBox="0 0 20 20" width="16" height="16" aria-hidden="true" focusable="false">
              {STEP_ICONS[step.state]}
            </svg>
          </span>
          <span className="etape-nom">{step.label}</span>
          <span className="etape-etat">
            {STEP_STATE_WORDS[step.state]}
            {step.atMs !== null && <> · {formatTime(step.atMs)}</>}
          </span>
        </li>
      ))}
    </ol>
  );
}
