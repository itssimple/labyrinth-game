import { buildServer } from "./app.js";

/**
 * Bootstrap: authoritative labyrinth game server. Fastify on PORT (default
 * 8080) with GET /healthz and the game WebSocket at /ws. See docs/CONTRACTS.md.
 */
async function main(): Promise<void> {
  const port = Number(process.env["PORT"] ?? 8080);
  const app = await buildServer({ logger: true });
  await app.listen({ port, host: "0.0.0.0" });
}

main().catch((err) => {
  console.error("labyrinth server failed to start:", err);
  process.exit(1);
});
