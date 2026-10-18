import { useCallback, useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { flushSync } from "react-dom";
import type { ApiClient } from "./api/client.ts";
import { Banners, Freshness } from "./components/Banners.tsx";
import { FlowPanel } from "./components/FlowPanel.tsx";
import { loadRelay, loadResponse } from "./data/load.ts";
import { useNow, usePolled } from "./hooks/usePolled.ts";
import { THEME_LABELS, useTheme, type Theme } from "./hooks/useTheme.ts";
import { AffichageProvider } from "./components/Affichage.tsx";
import { useAffichage } from "./hooks/useAffichage.ts";
import { formatLongDate, unitLegend } from "./lib/format.ts";
import { CampagneView } from "./views/CampagneView.tsx";
import { DecisionsView } from "./views/DecisionsView.tsx";
import { IncidentView } from "./views/IncidentView.tsx";
import { JournalView } from "./views/JournalView.tsx";
import { PendingView } from "./views/PendingView.tsx";
import { SupervisionView } from "./views/SupervisionView.tsx";
import type { ViewProps } from "./views/shared.ts";

const VIEWS = [
  { key: "supervision", label: "Supervision" },
  { key: "decisions", label: "Décisions" },
  { key: "incident", label: "Incidents" },
  { key: "attente", label: "En attente" },
  { key: "campagne", label: "Campagne" },
  { key: "journal", label: "Journal" },
] as const;
type ViewKey = (typeof VIEWS)[number]["key"];

/** L'écran vient de l'ancre de l'adresse, comparée à une liste fermée. Sans ancre connue : Décisions, l'écran de référence. */
function viewFromHash(): ViewKey {
  const wanted = window.location.hash.replace(/^#/, "");
  return VIEWS.find((v) => v.key === wanted)?.key ?? "decisions";
}

/** Le dashboard : il lit, il n'agit pas. Aucun bouton ici ne déclenche un paiement, une pause ou une approbation. */
/** Titre et chapeau de chaque écran : ce qu'il montre, sans rien promettre de plus. */
const HEADINGS: Record<ViewKey, { title: string; lead: string }> = {
  supervision: { title: "Vue d'ensemble", lead: "Le chemin d'une demande, et ce que les autres écrans détaillent, compté." },
  decisions: { title: "Décisions et plaçable", lead: "Ce que le contrat a décidé, lu dans ses événements, et ce qui l'a été avant lui." },
  incident: { title: "Incidents et réponse", lead: "Rapports d'incident, délais mesurés et agents écartés par le service de réponse." },
  attente: { title: "Validation humaine", lead: "Demandes que le contrat a renvoyées à un humain, avec leur échéance." },
  campagne: { title: "Campagne de tests", lead: "Résultats figés d'une campagne simulée hors ligne, avec leurs réserves. Rien ici n'est lu en direct." },
  journal: { title: "Journal d'audit", lead: "Journal chaîné du service de réponse, sa tête et sa dernière vérification." },
};

/** Icône du thème choisi : demi-disque pour « système », soleil, lune. Le nom du bouton le dit en mots. */
const THEME_ICONS: Record<Theme, ReactNode> = {
  systeme: <path d="M10 3a7 7 0 1 0 0 14a7 7 0 1 0 0-14M10 3v14M10 6.5h5.9M10 10h7M10 13.5h5.9" />,
  clair: <path d="M10 6.5a3.5 3.5 0 1 0 0 7a3.5 3.5 0 1 0 0-7M10 2v2M10 16v2M2 10h2M16 10h2M4.3 4.3l1.5 1.5M14.2 14.2l1.5 1.5M4.3 15.7l1.5-1.5M14.2 5.8l1.5-1.5" />,
  sombre: <path d="M16.5 11.5A6.5 6.5 0 0 1 8.5 3.5a6.5 6.5 0 1 0 8 8z" />,
};

/** Marque Veto : une table ovale frappée d'un V, cinq sièges autour. Dessinée ici, sans ressource externe. */
function BrandMark() {
  return (
    <svg className="marque-svg" viewBox="0 0 48 32" width="42" height="28" aria-hidden="true" focusable="false">
      <g className="marque-siege">
        <rect x="21" y="2" width="6" height="6.5" rx="1.2" />
        <rect x="11" y="4" width="6" height="6.5" rx="1.2" transform="rotate(-24 14 7.25)" />
        <rect x="31" y="4" width="6" height="6.5" rx="1.2" transform="rotate(24 34 7.25)" />
        <rect x="1.5" y="16.5" width="5.5" height="7" rx="1.2" />
        <rect x="41" y="16.5" width="5.5" height="7" rx="1.2" />
      </g>
      <ellipse className="marque-fond" cx="24" cy="20" rx="15" ry="8.6" />
      <path className="marque-trait" d="M19.6 16.2 24 24.2l4.4-8" />
    </svg>
  );
}

/** Unité et libellés du proxy local, autour de toute la console. */
export function App({ client }: { client: ApiClient }) {
  return (
    <AffichageProvider client={client}>
      <Console client={client} />
    </AffichageProvider>
  );
}

function Console({ client }: { client: ApiClient }) {
  const { unite, uniteEtat } = useAffichage();
  const relay = usePolled(useCallback((signal: AbortSignal) => loadRelay(client, signal), [client]));
  const vault = usePolled(useCallback((signal: AbortSignal) => client.getVaultState(signal), [client]));
  const response = usePolled(useCallback((signal: AbortSignal) => loadResponse(client, signal), [client]));
  const origin = usePolled(useCallback((signal: AbortSignal) => client.getVaultOrigin(signal), [client]));
  const now = useNow();
  // Sans réponse du proxy local, l'origine du coffre n'est pas confirmée : jamais « chaîne » par défaut.
  const vaultOrigin = origin.data ?? (origin.error === null ? "lecture" : "non-confirme");
  const view: ViewProps = { relay, vault, response, sources: client.sources, vaultOrigin, now };

  const [current, setCurrent] = useState<ViewKey>(viewFromHash);
  useEffect(() => {
    const onHash = (): void => setCurrent(viewFromHash());
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);
  const show = (key: ViewKey): void => {
    const swap = (): void => {
      setCurrent(key);
      window.history.replaceState(null, "", `#${key}`);
    };
    // Transition de vue du navigateur, s'il en a une : l'écran sortant se fond dans
    // l'entrant et le trait de l'onglet glisse. Sinon, ou en mouvement réduit : changement sec.
    const still = typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (key === current || still || typeof document.startViewTransition !== "function") swap();
    else document.startViewTransition(() => flushSync(swap));
  };

  const [theme, nextTheme] = useTheme();

  // Effet e : touche « P », mode présentation pour la vidéo. Nav masquée, diagramme agrandi ;
  // bandeaux, étiquettes de provenance et pied restent. Échap en sort.
  const [presenting, setPresenting] = useState(false);
  const togglePresenting = useCallback((next?: boolean): void => {
    setPresenting((current) => {
      const value = next ?? !current;
      // Plein écran si le navigateur l'accepte ; sinon, la page seule change.
      if (value && !document.fullscreenElement) document.documentElement.requestFullscreen?.().catch(() => undefined);
      if (!value && document.fullscreenElement) document.exitFullscreen?.().catch(() => undefined);
      return value;
    });
  }, []);
  useEffect(() => {
    const onKey = (event: globalThis.KeyboardEvent): void => {
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      const target = event.target;
      if (target instanceof HTMLElement && (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName))) return;
      if (event.key === "p" || event.key === "P") togglePresenting();
      else if (event.key === "Escape") togglePresenting(false);
    };
    // Sortie du plein écran par le navigateur : on quitte aussi le mode présentation.
    const onFullscreen = (): void => {
      if (!document.fullscreenElement) setPresenting(false);
    };
    window.addEventListener("keydown", onKey);
    document.addEventListener("fullscreenchange", onFullscreen);
    return () => {
      window.removeEventListener("keydown", onKey);
      document.removeEventListener("fullscreenchange", onFullscreen);
    };
  }, [togglePresenting]);
  const main = useRef<HTMLElement>(null);
  const tabs = useRef<HTMLElement>(null);

  /** Flèches, Début et Fin passent d'un écran à l'autre, comme dans une barre d'onglets. */
  const onTabKey = (event: KeyboardEvent<HTMLElement>): void => {
    const index = VIEWS.findIndex((v) => v.key === current);
    const target =
      event.key === "ArrowRight"
        ? (index + 1) % VIEWS.length
        : event.key === "ArrowLeft"
          ? (index - 1 + VIEWS.length) % VIEWS.length
          : event.key === "Home"
            ? 0
            : event.key === "End"
              ? VIEWS.length - 1
              : -1;
    const view = VIEWS[target];
    if (!view) return;
    event.preventDefault();
    show(view.key);
    tabs.current?.querySelectorAll("button")[target]?.focus();
  };

  return (
    <div className={presenting ? "page mode-presentation" : "page"} data-presentation={presenting ? "oui" : "non"}>
      <button type="button" className="evitement" data-ui="navigation" onClick={() => main.current?.focus()}>
        Aller au contenu
      </button>
      <header className="entete">
        <div className="cadre entete-barre">
          <div className="marque">
            <BrandMark />
            <h1>Veto</h1>
          </div>
          <nav className="onglets" aria-label="Écrans" ref={tabs} onKeyDown={onTabKey}>
            {VIEWS.map((v) => (
              <button
                key={v.key}
                type="button"
                data-ui="navigation"
                aria-current={current === v.key ? "page" : undefined}
                // Une seule étape de tabulation pour la barre : les flèches font le reste.
                tabIndex={current === v.key ? 0 : -1}
                onClick={() => show(v.key)}
              >
                {v.label}
                {/* Un seul trait, sous l'onglet courant : il glisse d'un onglet à l'autre. */}
                {current === v.key && <span className="onglet-trait" aria-hidden="true" />}
              </button>
            ))}
          </nav>
          <div className="entete-outils">
            <p className="lecture-seule">
              <svg viewBox="0 0 20 20" width="16" height="16" aria-hidden="true" focusable="false">
                <path d="M1.5 10S5 4 10 4s8.5 6 8.5 6-3.5 6-8.5 6-8.5-6-8.5-6zM10 7.5a2.5 2.5 0 1 0 0 5a2.5 2.5 0 1 0 0-5" />
              </svg>
              Lecture seule
            </p>
            <button type="button" className="theme" data-ui="affichage" data-theme-choisi={theme} title={`Thème : ${THEME_LABELS[theme]}`} onClick={nextTheme}>
              <span className="visuellement-cache">Thème : {THEME_LABELS[theme]}</span>
              <svg viewBox="0 0 20 20" width="16" height="16" aria-hidden="true" focusable="false">
                {THEME_ICONS[theme]}
              </svg>
            </button>
            <button type="button" className="presenter" data-ui="affichage" aria-keyshortcuts="P" onClick={() => togglePresenting(true)}>
              Mode présentation <kbd>P</kbd>
            </button>
          </div>
        </div>
      </header>
      {/* Bande d'état : d'où vient chaque famille de données et quand elle a été lue pour la dernière fois. */}
      <div className="etat">
        <div className="cadre etat-barre">
          <Freshness view={view} />
          <p className="etat-date" data-testid="date-du-jour">
            {formatLongDate(now)}
          </p>
        </div>
      </div>
      <div className="cadre contenu">
        <Banners view={view} />
        {presenting ? (
          <main id="contenu" ref={main} tabIndex={-1} aria-label="Mode présentation">
            <div className="presentation-barre">
              <p className="discret">Mode présentation : le flux de la dernière issue, agrandi. Lecture seule, comme le reste.</p>
              <button type="button" className="bouton-sortie" data-ui="affichage" aria-keyshortcuts="Escape" onClick={() => togglePresenting(false)}>
                Quitter <kbd>Échap</kbd>
              </button>
            </div>
            <FlowPanel view={view} large />
          </main>
        ) : (
          <main id="contenu" ref={main} tabIndex={-1} aria-label={VIEWS.find((v) => v.key === current)?.label}>
            {/* Nouvelle clé à chaque écran : il entre en fondu, une fois. */}
            <div key={current} className="vue">
              <div className="vue-entete">
                <h2 className="vue-titre">{HEADINGS[current].title}</h2>
                <p className="vue-chapeau">{HEADINGS[current].lead}</p>
              </div>
              {current === "supervision" && <SupervisionView view={view} />}
              {current === "decisions" && <DecisionsView view={view} />}
              {current === "incident" && <IncidentView view={view} />}
              {current === "journal" && <JournalView view={view} />}
              {current === "attente" && <PendingView view={view} />}
              {current === "campagne" && <CampagneView />}
            </div>
          </main>
        )}
      </div>
      <footer className="pied">
        <div className="cadre pied-haut">
          <p className="pied-marque">
            <BrandMark /> Veto
          </p>
          <p className="pied-mention" data-testid="pied-mention">
            Données fictives · réseau de test
          </p>
        </div>
        <p className="cadre pied-texte">
          Cette page n'émet que des lectures (GET) : elle ne peut ni payer, ni mettre en pause, ni approuver. Identifiants opaques abrégés,
          aucune donnée nominative. {unitLegend(unite)}
          {uniteEtat === "indisponible" ? " (unité non déclarée par le proxy local : valeur par défaut)" : ""}.
        </p>
      </footer>
    </div>
  );
}
