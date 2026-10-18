import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { flushSync } from "react-dom";
import type { ApiClient } from "./api/client.ts";
import { AffichageProvider } from "./components/Affichage.tsx";
import { Banners, EnvironnementPuce, environnementOf, environnementTexte } from "./components/Banners.tsx";
import { FlowPanel } from "./components/FlowPanel.tsx";
import { Icon, type IconName } from "./components/icons.tsx";
import { Recherche } from "./components/Recherche.tsx";
import { loadRelay, loadResponse } from "./data/load.ts";
import { latestIncidents, pendingCases } from "./domain/activity.ts";
import { useAffichage } from "./hooks/useAffichage.ts";
import { ProvenanceContext } from "./hooks/useProvenance.ts";
import { useNow, usePolled } from "./hooks/usePolled.ts";
import { THEME_LABELS, useTheme, type Theme } from "./hooks/useTheme.ts";
import { formatLongDate, unitLegend } from "./lib/format.ts";
import { ApercuView } from "./views/ApercuView.tsx";
import { CampagneView } from "./views/CampagneView.tsx";
import { IncidentView } from "./views/IncidentView.tsx";
import { JournalView } from "./views/JournalView.tsx";
import { PendingView } from "./views/PendingView.tsx";
import { AgentsView, FournisseursView, ReglesView } from "./views/ReferentielsView.tsx";
import type { ViewProps } from "./views/shared.ts";

type Screen = { key: string; label: string; icon: IconName; title: string; lead: string };

/** Les écrans, par groupe, dans l'ordre de la barre latérale. Aucun ne paie, ne met en pause ni n'approuve. */
const GROUPS = [
  {
    title: "Pilotage",
    screens: [
      { key: "apercu", label: "Vue d'ensemble", icon: "apercu", title: "Vue d'ensemble", lead: "Ce que les agents ont demandé, ce que le contrat a décidé, ce qui a été arrêté avant lui." },
      { key: "valider", label: "À valider", icon: "valider", title: "À valider", lead: "Paiements que le contrat a renvoyés à un humain, avec leur échéance. La décision se signe ailleurs." },
      { key: "incidents", label: "Incidents", icon: "incident", title: "Incidents", lead: "Ce que la porte d'entrée ou le contrat ont arrêté, et ce que le service de réponse a fait." },
    ],
  },
  {
    title: "Référentiels",
    screens: [
      { key: "fournisseurs", label: "Fournisseurs", icon: "batiment", title: "Fournisseurs", lead: "Bénéficiaires inscrits au contrat, avec les factures et les paiements qui les citent." },
      { key: "agents", label: "Agents", icon: "agent", title: "Agents", lead: "Agents inscrits au contrat, leur mandat, ce qu'ils ont fait payer ou fait bloquer." },
    ],
  },
  {
    title: "Contrôle",
    screens: [
      { key: "regles", label: "Règles", icon: "regles", title: "Règles", lead: "Ce que le contrat applique à chaque demande, écrit en clair. Les agents ne peuvent pas modifier ces règles." },
      { key: "journal", label: "Piste d'audit", icon: "journal", title: "Piste d'audit", lead: "Journal chaîné du service de réponse : chaque entrée porte l'empreinte de la précédente." },
    ],
  },
  {
    title: "Preuves",
    screens: [
      { key: "campagne", label: "Campagne", icon: "campagne", title: "Campagne de tests", lead: "Résultats figés d'une campagne simulée hors ligne, avec leurs réserves. Rien ici n'est lu en direct." },
    ],
  },
] as const satisfies readonly { title: string; screens: readonly Screen[] }[];

const SCREENS: readonly Screen[] = GROUPS.flatMap((g): readonly Screen[] => g.screens);
type ScreenKey = (typeof GROUPS)[number]["screens"][number]["key"];
const DEFAULT_SCREEN: ScreenKey = "apercu";

/** L'écran vient de l'ancre de l'adresse, comparée à une liste fermée. Sans ancre connue : la vue d'ensemble. */
function screenFromHash(): ScreenKey {
  const wanted = window.location.hash.replace(/^#/, "");
  return (SCREENS.find((s) => s.key === wanted)?.key as ScreenKey | undefined) ?? DEFAULT_SCREEN;
}

/** Icône du thème choisi : demi-disque pour « système », soleil, lune. Le nom du bouton le dit en mots. */
const THEME_ICONS: Record<Theme, IconName> = { systeme: "theme-systeme", clair: "theme-clair", sombre: "theme-sombre" };

/** Marque Veto, en petit : une table ovale frappée d'un V, cinq sièges autour. Dessinée ici, sans ressource externe. */
function BrandMark() {
  return (
    <svg className="marque-svg" viewBox="-350 -180 700 360" width="38" height="20" aria-hidden="true" focusable="false">
      <g className="marque-siege">
        <rect x="-284" y="0" width="68" height="56" rx="9" transform="rotate(-70 -250 30)" />
        <rect x="-184" y="-100" width="68" height="56" rx="9" transform="rotate(-35 -150 -70)" />
        <rect x="-34" y="-130" width="68" height="56" rx="9" />
        <rect x="116" y="-100" width="68" height="56" rx="9" transform="rotate(35 150 -70)" />
        <rect x="216" y="0" width="68" height="56" rx="9" transform="rotate(70 250 30)" />
      </g>
      <ellipse className="marque-fond" cx="0" cy="70" rx="190" ry="78" />
      <path className="marque-trait" d="M -42 34 L 0 110 L 42 34" />
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

/** La console : elle lit, elle n'agit pas. Aucun bouton ici ne déclenche un paiement, une pause ou une approbation. */
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

  const [current, setCurrent] = useState<ScreenKey>(screenFromHash);
  useEffect(() => {
    const onHash = (): void => setCurrent(screenFromHash());
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);
  const show = useCallback(
    (key: ScreenKey): void => {
      const swap = (): void => {
        setCurrent(key);
        window.history.replaceState(null, "", `#${key}`);
      };
      // Transition de vue du navigateur, s'il en a une. Sinon, ou en mouvement réduit : changement sec.
      const still = typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      if (key === current || still || typeof document.startViewTransition !== "function") swap();
      else document.startViewTransition(() => flushSync(swap));
    },
    [current],
  );

  const [theme, nextTheme] = useTheme();
  const [sourcesOpen, setSourcesOpen] = useState(false);
  const provenance = useMemo(() => ({ ouvrirSources: () => setSourcesOpen(true) }), []);
  const [query, setQuery] = useState("");
  const env = environnementOf(view.sources, view.vaultOrigin);

  // Touche « P » : mode présentation pour la vidéo. Navigation masquée, flux agrandi ;
  // bandeaux, étiquettes de provenance et pied restent. Échap en sort.
  const [presenting, setPresenting] = useState(false);
  const togglePresenting = useCallback((next?: boolean): void => {
    setPresenting((was) => {
      const value = next ?? !was;
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
      // Un tiroir ouvert garde Échap pour lui.
      if (document.querySelector("[data-tiroir-ouvert]")) return;
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
  const nav = useRef<HTMLElement>(null);

  /** Flèches, Début et Fin passent d'un écran à l'autre, comme dans une barre d'onglets, en long sur ordinateur, en large sur mobile. */
  const onNavKey = (event: KeyboardEvent<HTMLElement>): void => {
    const index = SCREENS.findIndex((s) => s.key === current);
    const forward = event.key === "ArrowDown" || event.key === "ArrowRight";
    const backward = event.key === "ArrowUp" || event.key === "ArrowLeft";
    const target = forward
      ? (index + 1) % SCREENS.length
      : backward
        ? (index - 1 + SCREENS.length) % SCREENS.length
        : event.key === "Home"
          ? 0
          : event.key === "End"
            ? SCREENS.length - 1
            : -1;
    const screen = SCREENS[target];
    if (!screen) return;
    event.preventDefault();
    show(screen.key as ScreenKey);
    nav.current?.querySelectorAll<HTMLButtonElement>("button[data-ecran]")[target]?.focus();
  };

  // Compteurs de la barre latérale : lus dans les mêmes réponses que les écrans. Rien de lu : pas de pastille.
  const counts: Partial<Record<ScreenKey, number>> = {
    valider: relay.data ? pendingCases(relay.data.decisions, relay.data.events).length : undefined,
    incidents: response.data ? latestIncidents(response.data.incidents).filter((i) => i.report.human_decision === null).length : undefined,
  };
  const screen = SCREENS.find((s) => s.key === current) ?? SCREENS[0]!;

  return (
    <ProvenanceContext.Provider value={provenance}>
    <div className={presenting ? "console mode-presentation" : "console"} data-presentation={presenting ? "oui" : "non"}>
      <button type="button" className="evitement" data-ui="navigation" onClick={() => main.current?.focus()}>
        Aller au contenu
      </button>
      <aside className="laterale" hidden={presenting}>
        <p className="marque">
          <BrandMark />
          <span>Veto</span>
        </p>
        <nav className="nav" aria-label="Écrans" ref={nav} onKeyDown={onNavKey}>
          {GROUPS.map((group) => (
            <div key={group.title} className="nav-groupe" role="group" aria-label={group.title}>
              {group.title !== "Pilotage" && (
                <p className="nav-titre" aria-hidden="true">
                  {group.title}
                </p>
              )}
              {group.screens.map((s) => {
                const count = counts[s.key as ScreenKey];
                return (
                  <button
                    key={s.key}
                    type="button"
                    className="nav-lien"
                    data-ui="navigation"
                    data-ecran={s.key}
                    aria-current={current === s.key ? "page" : undefined}
                    // Une seule étape de tabulation pour la barre : les flèches font le reste.
                    tabIndex={current === s.key ? 0 : -1}
                    onClick={() => show(s.key as ScreenKey)}
                  >
                    <Icon name={s.icon} />
                    <span className="nav-mot">{s.label}</span>
                    {count !== undefined && count > 0 && (
                      <span className="badge" data-testid={`badge-${s.key}`}>
                        <span aria-hidden="true">{count}</span>
                        <span className="visuellement-cache">, {count} {s.key === "valider" ? "en attente" : "ouvert" + (count > 1 ? "s" : "")}</span>
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          ))}
        </nav>
        <div className="laterale-pied">
          <p className="lecture-seule">
            <Icon name="oeil" />
            Lecture seule : aucune clé
          </p>
        </div>
      </aside>

      <div className="principal">
        <header className="barre-haute">
          <Recherche
            events={relay.data?.events ?? null}
            query={query}
            onQuery={setQuery}
            onPick={(item) => {
              setQuery(item.nom);
              show(item.genre === "agent" ? "agents" : "fournisseurs");
            }}
          />
          <EnvironnementPuce view={view} open={sourcesOpen} onToggle={setSourcesOpen} />
          <p className="date" data-testid="date-du-jour">
            {formatLongDate(now)}
          </p>
          <button type="button" className="outil" data-ui="affichage" data-theme-choisi={theme} title={`Thème : ${THEME_LABELS[theme]}`} onClick={nextTheme}>
            <span className="visuellement-cache">Thème : {THEME_LABELS[theme]}</span>
            <Icon name={THEME_ICONS[theme]} />
          </button>
          <button type="button" className="outil outil-texte" data-ui="affichage" aria-keyshortcuts="P" onClick={() => togglePresenting(true)}>
            Présentation <kbd>P</kbd>
          </button>
        </header>

        <div className="contenu">
          <Banners view={view} />
          {presenting ? (
            <main id="contenu" ref={main} tabIndex={-1} aria-label="Mode présentation">
              <div className="presentation-barre">
                <p className="discret">Mode présentation : le flux de la dernière issue, agrandi. Lecture seule, comme le reste.</p>
                <button type="button" className="btn" data-ui="affichage" aria-keyshortcuts="Escape" onClick={() => togglePresenting(false)}>
                  Quitter <kbd>Échap</kbd>
                </button>
              </div>
              <FlowPanel view={view} large />
            </main>
          ) : (
            <main id="contenu" ref={main} tabIndex={-1} aria-label={screen.label}>
              {/* Nouvelle clé à chaque écran : il entre en fondu, une fois. */}
              <div key={current} className="vue">
                <div className="vue-entete">
                  <h1 className="vue-titre">{screen.title}</h1>
                  <p className="vue-chapeau">{screen.lead}</p>
                </div>
                {current === "apercu" && <ApercuView view={view} onOpen={show} />}
                {current === "valider" && <PendingView view={view} />}
                {current === "incidents" && <IncidentView view={view} />}
                {current === "fournisseurs" && <FournisseursView view={view} query={query} onClear={() => setQuery("")} />}
                {current === "agents" && <AgentsView view={view} query={query} onClear={() => setQuery("")} />}
                {current === "regles" && <ReglesView view={view} />}
                {current === "journal" && <JournalView view={view} />}
                {current === "campagne" && <CampagneView />}
              </div>
            </main>
          )}
          <footer className="pied">
            <p className="pied-mention" data-testid="pied-mention">
              {environnementTexte(env)}
            </p>
            <p>
              Cette console n'émet que des lectures (GET) et ne détient aucune clé : elle ne peut ni payer, ni mettre en pause, ni approuver.
              Identifiants opaques abrégés ; libellés d'un référentiel local, jamais envoyés au relais. {unitLegend(unite)}
              {uniteEtat === "indisponible" ? " (unité non déclarée par le proxy local : valeur par défaut)" : ""}.
            </p>
          </footer>
        </div>
      </div>
    </div>
    </ProvenanceContext.Provider>
  );
}
