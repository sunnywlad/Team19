// Pastilles d'état : une icône et un mot, la couleur ne porte jamais seule le sens.
import type { IncidentTrigger } from "../api/types.ts";
import { SEVERITY_WORDS, TRIGGER_SEVERITY } from "../domain/labels.ts";
import type { AgentStatus } from "../domain/referentiels.ts";
import type { CaseState } from "../domain/validation.ts";
import { CASE_STATE_WORDS } from "../domain/validation.ts";
import { Icon, type IconName } from "./icons.tsx";

export type Ton = "ok" | "attente" | "refus" | "neutre" | "accent";

export function Pastille({ ton, icon, children, testId }: { ton: Ton; icon?: IconName; children: string; testId?: string }) {
  return (
    <span className={`pastille p-${ton}`} data-testid={testId}>
      {icon && <Icon name={icon} />}
      {children}
    </span>
  );
}

const SEVERITY_TONES = { critique: "refus", eleve: "attente", modere: "neutre" } as const;

/** Gravité indicative : dérivée du déclencheur, et l'infobulle le dit. */
export function SeverityPill({ trigger }: { trigger: IncidentTrigger }) {
  const severity = TRIGGER_SEVERITY[trigger];
  return (
    <span className={`pastille p-${SEVERITY_TONES[severity]}`} title="Gravité indicative, dérivée du déclencheur du rapport" data-testid="gravite">
      {SEVERITY_WORDS[severity]}
    </span>
  );
}

const STATUS: Record<AgentStatus, { ton: Ton; icon: IconName; word: string }> = {
  actif: { ton: "ok", icon: "check", word: "Aucune pause" },
  "pause-hors-chaine": { ton: "refus", icon: "pause", word: "En pause, hors chaîne" },
  "pause-chaine": { ton: "refus", icon: "pause", word: "En pause, sur la chaîne" },
  "pause-deux": { ton: "refus", icon: "pause", word: "En pause, hors chaîne et sur la chaîne" },
};

/** Statut d'un agent. Sans le service de réponse, « aucune pause » ne vaut que pour la chaîne : on le dit. */
export function AgentStatusPill({ status, offchainKnown }: { status: AgentStatus; offchainKnown: boolean }) {
  const s = STATUS[status];
  const word = status === "actif" && !offchainKnown ? "Aucune pause sur la chaîne (hors chaîne : non lu)" : s.word;
  return (
    <Pastille ton={status === "actif" && !offchainKnown ? "neutre" : s.ton} icon={s.icon} testId="statut-agent">
      {word}
    </Pastille>
  );
}

const CASE_TONES: Record<CaseState, { ton: Ton; icon: IconName }> = {
  attente: { ton: "attente", icon: "horloge" },
  valide: { ton: "ok", icon: "check" },
  rejete: { ton: "refus", icon: "x" },
  expire: { ton: "neutre", icon: "horloge" },
};

export function CaseStatePill({ state }: { state: CaseState }) {
  const t = CASE_TONES[state];
  return (
    <Pastille ton={t.ton} icon={t.icon} testId="etat-cas">
      {CASE_STATE_WORDS[state]}
    </Pastille>
  );
}
