import { useEffect, useState } from "react";

export const THEMES = ["systeme", "clair", "sombre"] as const;
export type Theme = (typeof THEMES)[number];
export const THEME_LABELS: Record<Theme, string> = { systeme: "système", clair: "clair", sombre: "sombre" };

const KEY = "argent-intelligent.theme";
const ATTRIBUTE: Record<Theme, string | null> = { systeme: null, clair: "light", sombre: "dark" };

function stored(): Theme {
  try {
    const value = window.localStorage.getItem(KEY);
    return THEMES.find((t) => t === value) ?? "systeme";
  } catch {
    return "systeme";
  }
}

/** Thème clair, sombre, ou celui du système. Seule préférence gardée dans le navigateur. */
export function useTheme(): [Theme, () => void] {
  const [theme, setTheme] = useState<Theme>(stored);
  useEffect(() => {
    const value = ATTRIBUTE[theme];
    if (value === null) document.documentElement.removeAttribute("data-theme");
    else document.documentElement.setAttribute("data-theme", value);
    try {
      window.localStorage.setItem(KEY, theme);
    } catch {
      // Stockage indisponible : le thème vaut pour cette session seulement.
    }
  }, [theme]);
  const next = (): void => setTheme((current) => THEMES[(THEMES.indexOf(current) + 1) % THEMES.length] ?? "systeme");
  return [theme, next];
}
