// Diagramme de notre flux et frise d'étapes de la dernière issue. Le chemin
// allumé est celui que la demande a réellement pris, lu dans les données.
import { useId, type ReactNode } from "react";
import type { VaultOrigin } from "../api/types.ts";
import { NODE_LABELS, STEP_STATE_WORDS, type FlowEdge, type FlowNode, type Outcome, type Step, type StepState } from "../domain/flow.ts";
import { formatTime } from "../lib/format.ts";
import { OpaqueId, ToneBadge } from "./atoms.tsx";

type Box = { x: number; y: number; w: number; h: number; sub: string };

const H = 56;
const W = 120;
const ROW = 82;

const BOXES: Record<Exclude<FlowNode, "paiement">, Box> = {
  agent: { x: 10, y: ROW, w: W, h: H, sub: "demandeur" },
  porte: { x: 170, y: ROW, w: W, h: H, sub: "détecteur à règles" },
  ia: { x: 330, y: ROW, w: W, h: H, sub: "trésorerie, signe" },
  relais: { x: 490, y: ROW, w: W, h: H, sub: "file, soumission" },
  contrat: { x: 650, y: ROW, w: W, h: H, sub: "décide 0 · 1 · 2" },
  humain: { x: 840, y: 22, w: W, h: H, sub: "cas 1, délai" },
  reponse: { x: 350, y: 226, w: 240, h: 52, sub: "quarantaine · pause hors chaîne · alerte · rapport" },
};

/** Libellé du nœud Paiement selon ce que le relais a derrière lui : jamais « réseau de test » pour un faux coffre. */
export function paymentSub(origin: VaultOrigin): string {
  if (origin === "chaine") return "réseau de test";
  if (origin === "faux-coffre") return "faux coffre, aucun fonds";
  if (origin === "sans-objet") return "simulation";
  return "origine non confirmée";
}

const EDGES: Record<FlowEdge, string> = {
  "agent-porte": "M130 110 H166",
  "porte-ia": "M290 110 H326",
  "ia-relais": "M450 110 H486",
  "relais-contrat": "M610 110 H646",
  "contrat-humain": "M770 100 C805 100 805 50 836 50",
  "contrat-paiement": "M770 120 C805 120 805 190 836 190",
  "humain-paiement": "M900 78 V158",
  "porte-reponse": "M230 138 C230 220 290 252 346 252",
  "contrat-reponse": "M710 138 C710 220 650 252 594 252",
};

const TONES = ["accepte", "humain", "refuse", "bloque", "repos"] as const;

type Props = { outcome: Outcome | null; origin: VaultOrigin };

export function FlowDiagram({ outcome, origin }: Props) {
  const uid = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const captionId = `${uid}-legende`;
  const tone = outcome?.tone ?? null;
  const onPath = (node: FlowNode): boolean => outcome?.nodes.includes(node) ?? false;
  const last = outcome?.nodes.filter((n) => n !== "reponse").at(-1) ?? null;
  const boxes: Record<FlowNode, Box> = { ...BOXES, paiement: { x: 840, y: 162, w: W, h: H, sub: paymentSub(origin) } };

  const node = (id: FlowNode): ReactNode => {
    const box = boxes[id];
    const active = onPath(id);
    const state = active ? (id === last || id === "reponse" ? "fin" : "passe") : "repos";
    return (
      <g key={id} className={`noeud noeud-${state} ${active ? `ton-${tone}` : ""}`} data-noeud={id} data-etat={active ? "actif" : "repos"}>
        <rect x={box.x} y={box.y} width={box.w} height={box.h} rx="12" />
        <text className="noeud-nom" x={box.x + box.w / 2} y={box.y + 24} textAnchor="middle">
          {NODE_LABELS[id]}
        </text>
        <text className="noeud-sous" x={box.x + box.w / 2} y={box.y + 42} textAnchor="middle">
          {box.sub}
        </text>
      </g>
    );
  };

  return (
    <figure className="flux" data-testid="flux" data-ton={tone ?? "aucun"}>
      <svg
        className="flux-svg"
        viewBox="0 0 970 290"
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
          const active = outcome?.edges.includes(edge) ?? false;
          const t = active && tone ? tone : "repos";
          return (
            <path
              key={edge}
              className={`arete ${active ? `arete-active ton-${t}` : "arete-repos"}`}
              data-arete={edge}
              data-etat={active ? "actif" : "repos"}
              d={EDGES[edge]}
              pathLength="100"
              markerEnd={`url(#${uid}-fleche-${t})`}
            />
          );
        })}
        {(Object.keys(boxes) as FlowNode[]).map(node)}
      </svg>
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
