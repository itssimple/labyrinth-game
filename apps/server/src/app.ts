import websocket from "@fastify/websocket";
import Fastify, { type FastifyInstance } from "fastify";
import { handleConnection } from "./connection.js";
import { LobbyRegistry } from "./lobby.js";

/**
 * Builds the Fastify app: `GET /healthz` and the game WebSocket at `/ws`.
 * Listening is left to the caller so tests can bind an ephemeral port.
 */
export async function buildServer(opts: { logger?: boolean } = {}): Promise<FastifyInstance> {
  const app = Fastify({ logger: opts.logger ?? false });
  await app.register(websocket, {
    options: { maxPayload: 64 * 1024 },
  });

  app.get("/healthz", async () => ({ ok: true }));

  const registry = new LobbyRegistry();
  app.get("/ws", { websocket: true }, (socket) => {
    handleConnection(socket, registry);
  });

  return app;
}
