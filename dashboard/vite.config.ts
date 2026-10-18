/// <reference types="vitest/config" />
// Serveur local du dashboard. Trois rôles, tous côté serveur :
//   1. servir la page sur 127.0.0.1 uniquement ;
//   2. relayer /api/* vers les API (le navigateur ne connaît ni leurs URLs ni
//      un éventuel jeton, et l'API du relais n'a pas d'en-têtes CORS) ;
//   3. poser la politique CSP et refuser toute méthode autre que GET ;
//   4. dire à la page, par GET /api/local/mode, ce que le relais a derrière
//      lui : un contrat ou un faux coffre. Lu ici dans RELAY_VAULT_MODE, à
//      chaque lancement : la valeur n'est pas écrite dans le bundle ;
//   5. servir le référentiel de libellés (GET /api/local/libelles, fichier
//      LIBELLES_FILE) et l'unité d'affichage (GET /api/local/unite,
//      UNITE_SYMBOLE et UNITE_DECIMALES). Ni l'un ni l'autre ne part au relais
//      ni sur la chaîne : ils ne servent qu'à l'affichage.
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { dirname, isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, loadEnv, type Plugin, type ProxyOptions } from "vite";

const HOST = "127.0.0.1";
const root = dirname(fileURLToPath(import.meta.url));

function apiUrl(name: string, raw: string | undefined, fallback: string): string {
  const value = raw === undefined || raw.trim() === "" ? fallback : raw.trim();
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    // Le message nomme la variable, jamais sa valeur.
    throw new Error(`variable d'environnement invalide : ${name} n'est pas une URL`);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error(`variable d'environnement invalide : ${name} doit être en http(s)`);
  return url.origin;
}

function csp(dev: { nonce: string } | null): string {
  const style = dev ? `'self' 'nonce-${dev.nonce}'` : "'self'";
  return [
    "default-src 'none'",
    "script-src 'self'",
    `style-src ${style}`,
    "img-src 'self'",
    "font-src 'self'",
    // 'self' couvre aussi le canal de rechargement de Vite (WebSocket de même origine).
    "connect-src 'self'",
    "base-uri 'none'",
    "form-action 'none'",
    "frame-ancestors 'none'",
  ].join("; ");
}

function securityHeaders(policy: string): Record<string, string> {
  return {
    "content-security-policy": policy,
    "x-content-type-options": "nosniff",
    "x-frame-options": "DENY",
    "referrer-policy": "no-referrer",
    "cross-origin-opener-policy": "same-origin",
    "cross-origin-resource-policy": "same-origin",
    "permissions-policy": "camera=(), microphone=(), geolocation=(), payment=()",
  };
}

type Next = (error?: unknown) => void;

/** Lecture seule jusque dans le proxy : aucune autre méthode que GET ne sort d'ici. */
function readOnly(req: IncomingMessage, res: ServerResponse, next: Next): void {
  if (req.method === "GET" || req.method === "HEAD") return next();
  res.writeHead(405, { allow: "GET, HEAD", "content-type": "application/json; charset=utf-8" });
  res.end(JSON.stringify({ error: "method_not_allowed" }));
}

export type VaultMode = "fake" | "chain" | "unknown";
export const LOCAL_MODE_PATH = "/api/local/mode";

/** RELAY_VAULT_MODE : « fake » ou « chain ». Toute autre valeur, ou rien : inconnu, jamais « chain » par défaut. */
export function vaultModeFrom(raw: string | undefined): VaultMode {
  const value = (raw ?? "").trim();
  return value === "fake" || value === "chain" ? value : "unknown";
}

/** Sert le mode du coffre à la page. Ce n'est pas une réponse du relais : son API n'a aucun champ de plus. */
export function localMode(vault: VaultMode): (req: IncomingMessage, res: ServerResponse, next: Next) => void {
  return (req, res, next) => {
    if ((req.url ?? "").split("?")[0] !== LOCAL_MODE_PATH) return next();
    res.writeHead(200, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff" });
    res.end(JSON.stringify({ vault }));
  };
}

export const LOCAL_LIBELLES_PATH = "/api/local/libelles";
export const LOCAL_UNITE_PATH = "/api/local/unite";
export const DEFAULT_LIBELLES_FILE = "fixtures/libelles.json";

export type Unite = { symbole: string; decimales: number };
/** Sans déclaration : « u » et 15 décimales, l'unité du monde de test (specs/examples/fixtures.json). Jamais « € » par défaut. */
export const DEFAULT_UNITE: Unite = { symbole: "u", decimales: 15 };

/** UNITE_SYMBOLE et UNITE_DECIMALES. Une valeur absente ou mal formée retombe sur le défaut, sans message qui la recopie. */
export function uniteFrom(symbole: string | undefined, decimales: string | undefined): Unite {
  const s = (symbole ?? "").trim();
  const d = (decimales ?? "").trim();
  return {
    symbole: /^[A-Za-z€]{1,4}$/.test(s) ? s : DEFAULT_UNITE.symbole,
    decimales: /^\d{1,2}$/.test(d) && Number(d) <= 30 ? Number(d) : DEFAULT_UNITE.decimales,
  };
}

/** Chemin du référentiel : LIBELLES_FILE, relatif au dossier du dashboard s'il n'est pas absolu. */
export function libellesFile(raw: string | undefined): string {
  const value = (raw ?? "").trim() || DEFAULT_LIBELLES_FILE;
  return isAbsolute(value) ? value : resolve(root, value);
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff" });
  res.end(JSON.stringify(body));
}

/**
 * Sert le référentiel de libellés tel qu'il est écrit dans le fichier, relu à
 * chaque demande. La page le valide contre schemas/local-libelles.schema.json
 * avant d'en afficher quoi que ce soit. Fichier absent ou illisible : 503, et la
 * page affiche les identifiants abrégés. Le message ne nomme pas le chemin.
 */
export function localLibelles(file: string): (req: IncomingMessage, res: ServerResponse, next: Next) => void {
  return (req, res, next) => {
    if ((req.url ?? "").split("?")[0] !== LOCAL_LIBELLES_PATH) return next();
    let body: unknown;
    try {
      body = JSON.parse(readFileSync(file, "utf8"));
    } catch {
      return sendJson(res, 503, { error: "libelles_indisponibles" });
    }
    sendJson(res, 200, body);
  };
}

export function localUnite(unite: Unite): (req: IncomingMessage, res: ServerResponse, next: Next) => void {
  return (req, res, next) => {
    if ((req.url ?? "").split("?")[0] !== LOCAL_UNITE_PATH) return next();
    sendJson(res, 200, unite);
  };
}

type Local = { vault: VaultMode; libelles: string; unite: Unite };

function hardening(local: Local): Plugin {
  const use = (server: { middlewares: { use: (handler: (req: IncomingMessage, res: ServerResponse, next: Next) => void) => void } }): void => {
    server.middlewares.use(readOnly);
    server.middlewares.use(localMode(local.vault));
    server.middlewares.use(localLibelles(local.libelles));
    server.middlewares.use(localUnite(local.unite));
  };
  return {
    name: "argent-intelligent:lecture-seule-et-csp",
    configureServer(server) {
      use(server);
    },
    configurePreviewServer(server) {
      use(server);
    },
    // La page construite porte aussi la politique : elle reste en place quel que soit le serveur.
    transformIndexHtml: {
      order: "post",
      handler(html, ctx) {
        if (ctx.server) return html;
        const policy = csp(null).replace("; frame-ancestors 'none'", "");
        return html.replace("<head>", `<head>\n    <meta http-equiv="Content-Security-Policy" content="${policy}" />`);
      },
    },
  };
}

export default defineConfig(({ mode, command, isPreview }) => {
  const env = { ...loadEnv(mode, root, ""), ...process.env };
  const fixtures = apiUrl("FIXTURES_API_URL", env.FIXTURES_API_URL, `http://${HOST}:8788`);
  const simulation = env.DASHBOARD_MODE === "simulation";
  const relay = apiUrl("RELAY_API_URL", env.RELAY_API_URL, `http://${HOST}:8787`);
  const responseSet = !simulation && (env.RESPONSE_API_URL ?? "").trim() !== "";
  const response = responseSet ? apiUrl("RESPONSE_API_URL", env.RESPONSE_API_URL, fixtures) : null;
  const token = (env.RESPONSE_API_TOKEN ?? "").trim();

  const upstream = (prefix: string, target: string, headers: Record<string, string> = {}): ProxyOptions => ({
    target,
    changeOrigin: true,
    headers,
    rewrite: (path) => path.slice(prefix.length) || "/",
  });
  const proxy: Record<string, ProxyOptions> = {
    "/api/relay": upstream("/api/relay", relay),
    "/api/simulation": upstream("/api/simulation", fixtures),
    // Le jeton éventuel est ajouté ici, côté serveur : il n'atteint jamais le navigateur.
    ...(response ? { "/api/reponse": upstream("/api/reponse", response, token ? { authorization: `Bearer ${token}` } : {}) } : {}),
  };

  const devPort = 5173;
  const nonce = randomBytes(16).toString("base64");

  return {
    root,
    plugins: [
      hardening({
        vault: vaultModeFrom(env.RELAY_VAULT_MODE),
        libelles: libellesFile(env.LIBELLES_FILE),
        unite: uniteFrom(env.UNITE_SYMBOLE, env.UNITE_DECIMALES),
      }),
    ],
    // Aucune variable d'environnement n'entre dans le bundle : ce préfixe n'est porté par aucune.
    envPrefix: "DASHBOARD_PUBLIC_",
    define: {
      __DASHBOARD_CONFIG__: JSON.stringify({
        mode: simulation ? "simulation" : "reel",
        vaultFromRelay: !simulation && env.RELAY_HAS_VAULT === "1",
        responseAvailable: responseSet,
      }),
    },
    // Le nonce ne sert qu'aux styles que Vite injecte en développement.
    html: command === "serve" && !isPreview ? { cspNonce: nonce } : {},
    server: {
      host: HOST,
      port: devPort,
      strictPort: true,
      proxy,
      headers: securityHeaders(csp({ nonce })),
      fs: { strict: true, allow: [root] },
    },
    preview: { host: HOST, port: 4173, strictPort: true, proxy, headers: securityHeaders(csp(null)) },
    build: { target: "es2022", sourcemap: false, assetsInlineLimit: 0 },
    test: {
      environment: "jsdom",
      include: ["test/**/*.test.{ts,tsx}"],
      setupFiles: ["test/setup.ts"],
      restoreMocks: true,
    },
  };
});
