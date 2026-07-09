/**
 * Server-URL resolution per docs/CONTRACTS.md "Deployment" — pure and
 * DOM-free so it is unit-testable: the page location and env value are
 * injected, never read from globals here (see socket.ts for the browser
 * wrapper).
 */

/** The subset of `window.location` this module needs. */
export interface PageLocation {
  /** e.g. "http:" or "https:". */
  protocol: string;
  /** hostname[:port], e.g. "example.com:9000" (no port when default). */
  host: string;
  /** Port as a string, "" when the scheme default (80/443). */
  port: string;
}

/** localStorage key for the manual "server address" field (blank = auto). */
export const SERVER_URL_STORAGE_KEY = "labyrinth.serverUrl";

/** Only the vite dev server (5173) counts as dev — preview (4173) does not. */
const VITE_DEV_PORT = "5173";

/** Priority 4: dev fallback. */
const DEV_FALLBACK_URL = "ws://localhost:8080/ws";

function pageWsScheme(pageProtocol: string): "ws" | "wss" {
  return pageProtocol === "https:" ? "wss" : "ws";
}

/**
 * Normalizes a manual server address to a WebSocket URL, or null when blank.
 *
 * - "ws://…" / "wss://…" pass through unchanged.
 * - "http://…" / "https://…" have their scheme mapped to ws/wss.
 * - Bare "host" or "host:port" becomes `ws(s)://host[:port]/ws`, scheme
 *   matching the page (https ⇒ wss).
 */
export function normalizeServerUrl(input: string, pageProtocol: string): string | null {
  const trimmed = input.trim();
  if (trimmed.length === 0) return null;
  if (/^wss?:\/\//i.test(trimmed)) return trimmed;
  const httpish = /^(https?):\/\/(.*)$/i.exec(trimmed);
  if (httpish !== null) {
    const scheme = httpish[1]?.toLowerCase() === "https" ? "wss" : "ws";
    return `${scheme}://${httpish[2] ?? ""}`;
  }
  const bare = trimmed.replace(/\/+$/, "");
  return `${pageWsScheme(pageProtocol)}://${bare}/ws`;
}

/**
 * Resolves the game-server WebSocket URL, in contract priority order:
 *
 * 1. `manual` — the menu "server address" field (normalized; blank = skip).
 * 2. `env` — VITE_SERVER_URL build-time override (dev/e2e only).
 * 3. Same-origin, when the page was NOT served by the vite dev server
 *    (port !== 5173): `wss://host/ws` on https, else `ws://host/ws`.
 * 4. Dev fallback `ws://localhost:8080/ws`.
 */
export function resolveServerUrl(
  manual: string | null | undefined,
  env: string | null | undefined,
  loc: PageLocation,
): string {
  const fromManual = manual == null ? null : normalizeServerUrl(manual, loc.protocol);
  if (fromManual !== null) return fromManual;
  if (env != null && env.length > 0) return env;
  if (loc.port !== VITE_DEV_PORT) return `${pageWsScheme(loc.protocol)}://${loc.host}/ws`;
  return DEV_FALLBACK_URL;
}

/** host[:port] of a ws(s) URL, for display ("server: connected (example.com)"). */
export function serverUrlHost(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}
