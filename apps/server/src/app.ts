import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import fastifyStatic from "@fastify/static";
import websocket from "@fastify/websocket";
import { PROTOCOL_VERSION } from "@labyrinth/common";
import Fastify, { type FastifyInstance, type FastifyServerOptions } from "fastify";
import { handleConnection } from "./connection.js";
import { LobbyRegistry } from "./lobby.js";

/** apps/server — this file lives one level below it (src/). */
const APP_DIR = dirname(dirname(fileURLToPath(import.meta.url)));

declare module "fastify" {
  interface FastifyInstance {
    /** The game's lobby registry, exposed for shutdown handling and tests. */
    lobbyRegistry: LobbyRegistry;
  }
}

export interface BuildServerOptions {
  /** Fastify logger config; false (default) keeps tests quiet. */
  logger?: FastifyServerOptions["logger"];
  /**
   * Directory of the built web client to serve at `/`. Overrides the
   * CLIENT_DIST env var (tests use this). When the resolved directory does
   * not exist the server runs WS-only (dev mode).
   */
  clientDist?: string;
}

/**
 * Resolves the client dist directory: explicit override, then CLIENT_DIST
 * env, then `../client-web/dist` relative to apps/server. Relative paths are
 * resolved against the process cwd; the default is anchored to this file via
 * import.meta.url so it works regardless of where the server is started from.
 */
export function resolveClientDist(override?: string): string {
  const raw = override ?? process.env["CLIENT_DIST"];
  if (raw && raw.trim() !== "") return resolve(raw.trim());
  return resolve(APP_DIR, "../client-web/dist");
}

/**
 * Builds the Fastify app: `GET /healthz`, `GET /metrics`, the game WebSocket
 * at `/ws`, and (when the built client exists) the static web client at `/`.
 * Explicit routes always win over the static wildcard, so /healthz, /metrics
 * and /ws keep priority. Listening is left to the caller so tests can bind an
 * ephemeral port.
 */
export async function buildServer(opts: BuildServerOptions = {}): Promise<FastifyInstance> {
  const app = Fastify({ logger: opts.logger ?? false });
  await app.register(websocket, {
    options: { maxPayload: 64 * 1024 },
  });

  const startedAtMs = Date.now();
  const registry = new LobbyRegistry();
  app.decorate("lobbyRegistry", registry);

  app.get("/healthz", async () => ({ ok: true }));

  // Ops counters as plain JSON. TODO: Prometheus exposition format.
  app.get("/metrics", async () => {
    const stats = registry.stats();
    return {
      uptimeS: Math.floor((Date.now() - startedAtMs) / 1000),
      lobbies: stats.lobbies,
      players: stats.players,
      botsInLobbies: stats.botsInLobbies,
      runningMatches: stats.runningMatches,
      protocolVersion: PROTOCOL_VERSION,
    };
  });

  app.get("/ws", { websocket: true }, (socket) => {
    handleConnection(socket, registry);
  });

  // Serve the built web client (single deployable: container = whole game).
  // No SPA fallback needed — the client is a single page.
  const clientDist = resolveClientDist(opts.clientDist);
  if (existsSync(clientDist)) {
    await app.register(fastifyStatic, { root: clientDist });
    app.log.info({ clientDist }, "serving web client");
  } else {
    app.log.info({ clientDist }, "client dist not found — running WS-only (dev mode)");
  }

  return app;
}
