import { buildServer } from "./app.js";

/**
 * Bootstrap: authoritative labyrinth game server. Fastify on PORT (default
 * 8080) with GET /healthz, GET /metrics, the game WebSocket at /ws, and the
 * built web client at / when CLIENT_DIST exists. Config is env-only — see
 * docs/DEPLOYMENT.md: PORT, HOST, CLIENT_DIST, LOG_LEVEL.
 */
async function main(): Promise<void> {
  const port = Number(process.env["PORT"] ?? 8080);
  const host = process.env["HOST"] ?? "0.0.0.0";
  const level = process.env["LOG_LEVEL"] ?? "info";
  const app = await buildServer({ logger: { level } });
  await app.listen({ port, host });

  // Graceful shutdown (SIGTERM from Docker/orchestrators, SIGINT from ^C):
  // end every running match first — Match.abort() stops the tick loop and
  // releases the bitECS entities (module-global id pool, see
  // Match.releasePlayers) — then close all player sockets, stop accepting
  // connections via app.close(), and exit 0.
  let shuttingDown = false;
  const shutdown = (signal: NodeJS.Signals): void => {
    if (shuttingDown) return;
    shuttingDown = true;
    app.log.info({ signal }, "shutting down");
    for (const lobby of app.lobbyRegistry.all()) {
      lobby.match?.abort();
      for (const client of [...lobby.clients]) {
        client.close(1001, "server shutting down");
      }
    }
    app.close().then(
      () => process.exit(0),
      (err) => {
        app.log.error(err, "error during shutdown");
        process.exit(1);
      },
    );
  };
  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
}

main().catch((err) => {
  console.error("labyrinth server failed to start:", err);
  process.exit(1);
});
