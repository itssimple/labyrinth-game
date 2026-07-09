import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { botName } from "@echowake/bots";
import {
  MAX_HP,
  MOVE_SPEED,
  PROTOCOL_VERSION,
  TICK_DT,
  TICK_RATE,
  WALL_E,
  WALL_N,
  WALL_S,
  WALL_W,
  cellIndex,
  type Maze,
} from "@echowake/common";
import { FISTS, ITEM_DEFS } from "@echowake/content";
import { computeVisibleCells, createSimulation } from "@echowake/ecs";
import { generateMaze } from "@echowake/mazegen";
import {
  encodeMessage,
  type ClientMessage,
  type LobbyStateMsg,
  type MatchStartMsg,
  type ServerMessage,
  type SnapshotMsg,
} from "@echowake/protocol";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildServer } from "../src/app.js";

/**
 * Integration tests: real Fastify server on an ephemeral port, real WebSocket
 * clients (Node 22 global WebSocket), full hello -> lobby -> match flow.
 */

// Fixed seed whose tiny maze has spawns 0 and 1 mutually out of sight
// (verified: spawn1's cell is not in computeVisibleCells from spawn0).
const TEST_SEED = "itest-1";

let app: FastifyInstance;
let wsUrl: string;
let httpUrl: string;

beforeAll(async () => {
  app = await buildServer();
  await app.listen({ port: 0, host: "127.0.0.1" });
  const addr = app.server.address();
  if (addr === null || typeof addr === "string") throw new Error("no port");
  httpUrl = `http://127.0.0.1:${addr.port}`;
  wsUrl = `ws://127.0.0.1:${addr.port}/ws`;
});

afterAll(async () => {
  await app.close();
});

/** Small promise-queue WebSocket client for driving the protocol in tests. */
class TestClient {
  private readonly ws: WebSocket;
  private readonly queue: ServerMessage[] = [];
  private notify: (() => void) | null = null;
  readonly closed: Promise<void>;

  private constructor(ws: WebSocket) {
    this.ws = ws;
    this.ws.addEventListener("message", (ev) => {
      this.queue.push(JSON.parse(String(ev.data)) as ServerMessage);
      this.notify?.();
    });
    this.closed = new Promise((resolve) => {
      this.ws.addEventListener("close", () => resolve());
    });
  }

  static async connect(): Promise<TestClient> {
    const ws = new WebSocket(wsUrl);
    await new Promise<void>((resolve, reject) => {
      ws.addEventListener("open", () => resolve());
      ws.addEventListener("error", () => reject(new Error("ws connect failed")));
    });
    return new TestClient(ws);
  }

  send(msg: ClientMessage): void {
    this.ws.send(encodeMessage(msg));
  }

  /** Sends a raw (possibly malformed) frame, bypassing the codec. */
  sendRaw(raw: string): void {
    this.ws.send(raw);
  }

  /** Dequeues messages until one of `type` arrives (discarding others). */
  async next<T extends ServerMessage["type"]>(
    type: T,
    timeoutMs = 3000,
  ): Promise<Extract<ServerMessage, { type: T }>> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const i = this.queue.findIndex((m) => m.type === type);
      if (i !== -1) {
        const [msg] = this.queue.splice(i, 1);
        return msg as Extract<ServerMessage, { type: T }>;
      }
      const remaining = deadline - Date.now();
      if (remaining <= 0) throw new Error(`timed out waiting for "${type}"`);
      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, remaining);
        this.notify = () => {
          clearTimeout(timer);
          this.notify = null;
          resolve();
        };
      });
    }
  }

  close(): void {
    this.ws.close();
  }
}

/** Connects and completes the hello/welcome handshake. */
async function connectPlayer(name: string): Promise<{ client: TestClient; playerId: string }> {
  const client = await TestClient.connect();
  client.send({ type: "hello", protocolVersion: PROTOCOL_VERSION, name });
  const welcome = await client.next("welcome");
  return { client, playerId: welcome.playerId };
}

describe("healthz", () => {
  it("responds with { ok: true }", async () => {
    const res = await fetch(`${httpUrl}/healthz`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });
});

describe("metrics", () => {
  it("reports the ops counters shape and reflects lobby membership", async () => {
    const host = await connectPlayer("Metrics");
    host.client.send({ type: "createLobby" });
    await host.client.next("lobbyState");
    host.client.send({ type: "addBot" });
    await host.client.next("lobbyState");

    const res = await fetch(`${httpUrl}/metrics`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, number>;
    expect(Object.keys(body).sort()).toEqual([
      "botsInLobbies",
      "lobbies",
      "players",
      "protocolVersion",
      "runningMatches",
      "uptimeS",
    ]);
    expect(body["protocolVersion"]).toBe(PROTOCOL_VERSION);
    expect(body["uptimeS"]).toBeGreaterThanOrEqual(0);
    expect(body["lobbies"]).toBeGreaterThanOrEqual(1);
    expect(body["players"]).toBeGreaterThanOrEqual(1);
    expect(body["botsInLobbies"]).toBeGreaterThanOrEqual(1);
    expect(typeof body["runningMatches"]).toBe("number");

    host.client.close();
    await host.client.closed;
  });
});

describe("static client serving", () => {
  it("serves CLIENT_DIST at / while /healthz and /metrics keep working", async () => {
    const dist = mkdtempSync(join(tmpdir(), "labyrinth-dist-"));
    writeFileSync(join(dist, "index.html"), "<!doctype html><title>labyrinth</title>");
    const staticApp = await buildServer({ clientDist: dist });
    try {
      await staticApp.listen({ port: 0, host: "127.0.0.1" });
      const addr = staticApp.server.address();
      if (addr === null || typeof addr === "string") throw new Error("no port");
      const base = `http://127.0.0.1:${addr.port}`;

      const index = await fetch(`${base}/`);
      expect(index.status).toBe(200);
      expect(await index.text()).toContain("labyrinth");

      // Explicit routes keep priority over static files.
      expect(await (await fetch(`${base}/healthz`)).json()).toEqual({ ok: true });
      expect((await fetch(`${base}/metrics`)).status).toBe(200);
    } finally {
      await staticApp.close();
      rmSync(dist, { recursive: true, force: true });
    }
  });

  it("runs WS-only when the client dist does not exist", async () => {
    const wsOnly = await buildServer({ clientDist: "/nonexistent/labyrinth-dist" });
    try {
      await wsOnly.listen({ port: 0, host: "127.0.0.1" });
      const addr = wsOnly.server.address();
      if (addr === null || typeof addr === "string") throw new Error("no port");
      const base = `http://127.0.0.1:${addr.port}`;
      expect((await fetch(`${base}/`)).status).toBe(404);
      expect(await (await fetch(`${base}/healthz`)).json()).toEqual({ ok: true });
    } finally {
      await wsOnly.close();
    }
  });
});

describe("handshake", () => {
  it("rejects a bad protocol version with an error and closes", async () => {
    const client = await TestClient.connect();
    client.send({ type: "hello", protocolVersion: PROTOCOL_VERSION + 999, name: "old" });
    const err = await client.next("error");
    expect(err.code).toBe("badProtocolVersion");
    await client.closed;
  });

  it("rejects malformed frames and non-hello first messages", async () => {
    const client = await TestClient.connect();
    client.sendRaw("{not json");
    const err = await client.next("error");
    expect(err.code).toBe("badMessage");
    await client.closed;

    const client2 = await TestClient.connect();
    client2.send({ type: "createLobby" });
    const err2 = await client2.next("error");
    expect(err2.code).toBe("badMessage");
    await client2.closed;
  });
});

describe("lobby and match flow", () => {
  it("runs hello -> createLobby -> join -> startMatch -> snapshots with fog-of-war", async () => {
    const host = await connectPlayer("Host");
    const guest = await connectPlayer("Guest");

    host.client.send({ type: "createLobby" });
    const lobby1 = await host.client.next("lobbyState");
    expect(lobby1.code).toMatch(/^[A-Z]{4}$/);
    expect(lobby1.hostId).toBe(host.playerId);
    expect(lobby1.players).toHaveLength(1);

    guest.client.send({ type: "joinLobby", code: lobby1.code.toLowerCase() });
    const lobby2: LobbyStateMsg = await guest.client.next("lobbyState");
    expect(lobby2.players.map((p) => p.playerId)).toEqual([host.playerId, guest.playerId]);
    // Host sees the join too.
    const hostLobby2 = await host.client.next("lobbyState");
    expect(hostLobby2.players).toHaveLength(2);

    // Non-host cannot start.
    guest.client.send({ type: "startMatch", options: { seed: TEST_SEED, size: "tiny" } });
    expect((await guest.client.next("error")).code).toBe("notHost");

    host.client.send({ type: "startMatch", options: { seed: TEST_SEED, size: "tiny" } });
    const startHost: MatchStartMsg = await host.client.next("matchStart");
    const startGuest: MatchStartMsg = await guest.client.next("matchStart");
    expect(startHost.options.seed).toBe(TEST_SEED);
    expect(startHost.endTick).toBeGreaterThan(0);
    expect([startHost.yourSpawnIndex, startGuest.yourSpawnIndex].sort()).toEqual([0, 1]);

    // Chat during the match, sanitized.
    guest.client.send({ type: "chat", text: "  hi  there  " });
    const chat = await host.client.next("chatBroadcast");
    expect(chat).toMatchObject({ playerId: guest.playerId, name: "Guest", text: "hi there" });

    const snap: SnapshotMsg = await host.client.next("snapshot");
    // Shape of an authoritative snapshot.
    expect(typeof snap.tick).toBe("number");
    expect(typeof snap.ackSeq).toBe("number");
    expect(typeof snap.you.x).toBe("number");
    expect(typeof snap.you.y).toBe("number");
    expect(snap.you.escaped).toBe(false);
    expect(Array.isArray(snap.visiblePlayers)).toBe(true);
    expect(Array.isArray(snap.sounds)).toBe(true);
    expect(snap.visibleCells.length).toBeGreaterThan(0);

    // Client-side determinism: regenerating the maze from options matches the
    // server, and the guest (idle at spawn 1, out of the host's line of sight)
    // must be absent from the host's snapshot — fog of war never leaks.
    const maze = generateMaze(startHost.options);
    const hostSpawn = maze.spawns[startHost.yourSpawnIndex]!;
    expect(snap.you.x).toBeCloseTo(hostSpawn.x + 0.5, 5);
    expect(snap.you.y).toBeCloseTo(hostSpawn.y + 0.5, 5);
    const guestSpawn = maze.spawns[startGuest.yourSpawnIndex]!;
    const guestCell = cellIndex(maze.width, guestSpawn.x, guestSpawn.y);
    const hostVision = computeVisibleCells(maze, snap.you.x, snap.you.y);
    expect(hostVision.has(guestCell)).toBe(false); // precondition for the seed
    expect(snap.visibleCells).not.toContain(guestCell);
    expect(snap.visiblePlayers).toHaveLength(0);

    // Every reported visible player must stand in a visible cell (no leaks).
    for (const p of snap.visiblePlayers) {
      const cell = cellIndex(maze.width, Math.floor(p.x), Math.floor(p.y));
      expect(snap.visibleCells).toContain(cell);
    }

    // Input is applied: north is open from spawn 0 in this maze, so the host
    // moves and the input seq is acked.
    const mover = startHost.yourSpawnIndex === 0 ? host : guest;
    const startY = startHost.yourSpawnIndex === 0 ? snap.you.y : maze.spawns[0]!.y + 0.5;
    mover.client.send({ type: "input", seq: 7, moveX: 0, moveY: -1, sprint: false, sneak: false });
    let moved: SnapshotMsg | null = null;
    for (let i = 0; i < 20; i++) {
      const s = await mover.client.next("snapshot");
      if (s.ackSeq === 7 && s.you.y < startY - 0.05) {
        moved = s;
        break;
      }
    }
    expect(moved).not.toBeNull();

    // The moving (walking) player emits footsteps; their own snapshots never
    // echo their own sounds back.
    const after = await mover.client.next("snapshot");
    expect(after.sounds).toHaveLength(0);

    // Disconnecting the guest keeps the match running for the host.
    guest.client.close();
    const afterLeave = await host.client.next("snapshot");
    expect(afterLeave.visiblePlayers).toHaveLength(0);

    host.client.close();
  });

  it("generates a seed when the host sends an empty one", async () => {
    const host = await connectPlayer("Solo");
    host.client.send({ type: "createLobby" });
    await host.client.next("lobbyState");
    host.client.send({ type: "startMatch", options: { seed: "", size: "tiny" } });
    const start = await host.client.next("matchStart");
    expect(start.options.seed.length).toBeGreaterThan(0);
    await host.client.next("snapshot");
    host.client.close();
  });

  it("rejects joining an unknown lobby", async () => {
    const p = await connectPlayer("Lost");
    p.client.send({ type: "joinLobby", code: "ZZZZ" });
    expect((await p.client.next("error")).code).toBe("lobbyNotFound");
    p.client.close();
  });
});

describe("latency ping", () => {
  it("echoes t back verbatim in a pong", async () => {
    const p = await connectPlayer("Pinger");
    // Not in any lobby on purpose: ping works for any hello'd client and
    // never touches lobby/match logic. Fractional t must survive verbatim.
    p.client.send({ type: "ping", t: 12345.678 });
    const pong = await p.client.next("pong");
    expect(pong.t).toBe(12345.678);
    p.client.close();
    await p.client.closed;
  });
});

describe("public lobby browser", () => {
  it("host toggles setLobbyPublic and lobbyState.isPublic reflects it for everyone", async () => {
    const host = await connectPlayer("PubHost");
    const guest = await connectPlayer("PubGuest");

    host.client.send({ type: "createLobby" });
    const lobby1 = await host.client.next("lobbyState");
    expect(lobby1.isPublic).toBe(false); // private by default

    guest.client.send({ type: "joinLobby", code: lobby1.code });
    await guest.client.next("lobbyState");
    await host.client.next("lobbyState");

    // Non-host may not toggle visibility.
    guest.client.send({ type: "setLobbyPublic", isPublic: true });
    expect((await guest.client.next("error")).code).toBe("notHost");

    host.client.send({ type: "setLobbyPublic", isPublic: true });
    expect((await host.client.next("lobbyState")).isPublic).toBe(true);
    expect((await guest.client.next("lobbyState")).isPublic).toBe(true);

    host.client.send({ type: "setLobbyPublic", isPublic: false });
    expect((await host.client.next("lobbyState")).isPublic).toBe(false);
    expect((await guest.client.next("lobbyState")).isPublic).toBe(false);

    // Not in a lobby at all => notInLobby.
    const loner = await connectPlayer("PubLoner");
    loner.client.send({ type: "setLobbyPublic", isPublic: true });
    expect((await loner.client.next("error")).code).toBe("notInLobby");

    host.client.close();
    guest.client.close();
    loner.client.close();
  });

  it("listLobbies returns only public lobbies, joinable first then by playerCount", async () => {
    // Lobby A: 2 humans + 1 bot, public. Lobby B: 1 human, public. C: private.
    const hostA = await connectPlayer("HostA");
    const guestA = await connectPlayer("GuestA");
    const hostB = await connectPlayer("HostB");
    const hostC = await connectPlayer("HostC");
    const browser = await connectPlayer("Browser"); // hello'd, never in a lobby

    hostA.client.send({ type: "createLobby" });
    const lobbyA = await hostA.client.next("lobbyState");
    guestA.client.send({ type: "joinLobby", code: lobbyA.code });
    await guestA.client.next("lobbyState");
    hostA.client.send({ type: "addBot" });
    await hostA.client.next("lobbyState");
    hostA.client.send({ type: "setLobbyPublic", isPublic: true });
    await hostA.client.next("lobbyState");

    hostB.client.send({ type: "createLobby" });
    const lobbyB = await hostB.client.next("lobbyState");
    hostB.client.send({ type: "setLobbyPublic", isPublic: true });
    await hostB.client.next("lobbyState");

    hostC.client.send({ type: "createLobby" });
    const lobbyC = await hostC.client.next("lobbyState");

    browser.client.send({ type: "listLobbies" });
    const list1 = await browser.client.next("lobbyList");
    expect(list1.lobbies.length).toBeLessThanOrEqual(50);
    // The private lobby's code must never leak into the browser.
    expect(list1.lobbies.some((l) => l.code === lobbyC.code)).toBe(false);
    const a1 = list1.lobbies.find((l) => l.code === lobbyA.code);
    const b1 = list1.lobbies.find((l) => l.code === lobbyB.code);
    expect(a1).toEqual({
      code: lobbyA.code,
      hostName: "HostA",
      playerCount: 2, // humans only — the bot is counted separately
      botCount: 1,
      inMatch: false,
    });
    expect(b1).toEqual({
      code: lobbyB.code,
      hostName: "HostB",
      playerCount: 1,
      botCount: 0,
      inMatch: false,
    });
    // Both joinable => bigger lobby first.
    expect(list1.lobbies.indexOf(a1!)).toBeLessThan(list1.lobbies.indexOf(b1!));

    // Mid-match lobbies stay listed (inMatch: true) but sort after joinable ones.
    hostA.client.send({ type: "startMatch", options: { seed: "browser-itest", size: "small" } });
    await hostA.client.next("matchStart");
    browser.client.send({ type: "listLobbies" });
    const list2 = await browser.client.next("lobbyList");
    const a2 = list2.lobbies.find((l) => l.code === lobbyA.code);
    const b2 = list2.lobbies.find((l) => l.code === lobbyB.code);
    expect(a2?.inMatch).toBe(true);
    expect(b2?.inMatch).toBe(false);
    expect(list2.lobbies.indexOf(b2!)).toBeLessThan(list2.lobbies.indexOf(a2!));

    hostA.client.close();
    guestA.client.close();
    hostB.client.close();
    hostC.client.close();
    browser.client.close();
  });
});

/** BFS shortest path of cell indices from `from` to `to` (excluding `from`). */
function bfsPath(maze: Maze, from: number, to: number): number[] {
  const steps = [
    { dx: 0, dy: -1, wall: WALL_N },
    { dx: 1, dy: 0, wall: WALL_E },
    { dx: 0, dy: 1, wall: WALL_S },
    { dx: -1, dy: 0, wall: WALL_W },
  ];
  const { width, height } = maze;
  const parent = new Int32Array(width * height).fill(-2);
  parent[from] = -1;
  const queue = [from];
  for (let head = 0; head < queue.length; head++) {
    const idx = queue[head]!;
    if (idx === to) break;
    const x = idx % width;
    const y = (idx - x) / width;
    const walls = maze.cells[idx]!.walls;
    for (const s of steps) {
      if ((walls & s.wall) !== 0) continue;
      const nx = x + s.dx;
      const ny = y + s.dy;
      if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
      const n = ny * width + nx;
      if (parent[n] !== -2) continue;
      parent[n] = idx;
      queue.push(n);
    }
  }
  const path: number[] = [];
  for (let idx = to; idx !== from; idx = parent[idx]!) {
    if (idx < 0) throw new Error("no path");
    path.push(idx);
  }
  return path.reverse();
}

describe("bots", () => {
  it("host adds/removes bots; non-host addBot and bad removeBot ids are rejected", async () => {
    const host = await connectPlayer("BotHost");
    const guest = await connectPlayer("BotGuest");

    host.client.send({ type: "createLobby" });
    const lobby1 = await host.client.next("lobbyState");

    host.client.send({ type: "addBot" });
    const withBot = await host.client.next("lobbyState");
    expect(withBot.players).toHaveLength(2);
    const bot = withBot.players.find((p) => p.isBot);
    expect(bot).toBeDefined();
    expect(bot!.name).toBe(botName(0)); // lowest unused name index
    expect(bot!.playerId).not.toBe(host.playerId);

    guest.client.send({ type: "joinLobby", code: lobby1.code });
    const guestView = await guest.client.next("lobbyState");
    expect(guestView.players.filter((p) => p.isBot)).toHaveLength(1);
    await host.client.next("lobbyState");

    // Only the host may manage bots.
    guest.client.send({ type: "addBot" });
    expect((await guest.client.next("error")).code).toBe("notHost");

    // Unknown ids and non-bot (human) ids are both rejected.
    host.client.send({ type: "removeBot", playerId: guest.playerId });
    expect((await host.client.next("error")).code).toBe("badMessage");
    host.client.send({ type: "removeBot", playerId: "not-a-real-id" });
    expect((await host.client.next("error")).code).toBe("badMessage");

    host.client.send({ type: "removeBot", playerId: bot!.playerId });
    const without = await host.client.next("lobbyState");
    expect(without.players).toHaveLength(2);
    expect(without.players.some((p) => p.isBot)).toBe(false);

    host.client.close();
    guest.client.close();
  });

  it("runs a solo human + bot match on small without crashing over 60 ticks", async () => {
    const host = await connectPlayer("SoloWithBot");
    host.client.send({ type: "createLobby" });
    await host.client.next("lobbyState");
    host.client.send({ type: "addBot" });
    await host.client.next("lobbyState");

    // "small" (cap 4), not tiny: the bot must fit alongside the human with
    // room for the maze to be big enough to exercise real exploration.
    host.client.send({ type: "startMatch", options: { seed: "bot-itest-1", size: "small" } });
    const start: MatchStartMsg = await host.client.next("matchStart");
    expect(start.yourSpawnIndex).toBe(0); // humans get sim slots before bots

    // Structural liveness: snapshots keep flowing with monotonically
    // advancing ticks and finite positions while the bot plays. (Seeing the
    // bot or hearing it is not reliable on a fresh maze — don't assert it.)
    const first: SnapshotMsg = await host.client.next("snapshot");
    expect(Number.isFinite(first.you.x)).toBe(true);
    let prev = first;
    while (prev.tick < first.tick + 60) {
      const snap: SnapshotMsg = await host.client.next("snapshot", 5000);
      expect(snap.tick).toBeGreaterThan(prev.tick);
      expect(Number.isFinite(snap.you.x)).toBe(true);
      expect(Number.isFinite(snap.you.y)).toBe(true);
      prev = snap;
    }

    host.client.close();
  }, 20000);

  it("ends allEscaped when the only human escapes while a bot is still alive", async () => {
    // Seed chosen so spawn 0 is only a few cells from the exit on tiny
    // (search over generateMaze outputs) — keeps this real-time test fast.
    const seed = "bot-escape-27";
    const host = await connectPlayer("Runner");
    host.client.send({ type: "createLobby" });
    await host.client.next("lobbyState");
    host.client.send({ type: "addBot" });
    const roster = await host.client.next("lobbyState");
    const botId = roster.players.find((p) => p.isBot)!.playerId;

    // 1 human + 1 bot = 2 members: exactly tiny's cap.
    host.client.send({ type: "startMatch", options: { seed, size: "tiny" } });
    const start: MatchStartMsg = await host.client.next("matchStart");
    expect(start.yourSpawnIndex).toBe(0);

    // Regenerate the maze from the broadcast options (what a real client
    // does) and walk the human along the BFS path to the exit.
    const maze = generateMaze(start.options);
    const spawn = maze.spawns[0]!;
    const exitIdx = cellIndex(maze.width, maze.exit.x, maze.exit.y);
    let path = bfsPath(maze, cellIndex(maze.width, spawn.x, spawn.y), exitIdx);
    expect(path.length).toBeGreaterThan(0);

    // Same deadzone reasoning as the bot controller: below a walk-speed step
    // so steering never oscillates around a cell center.
    const deadzone = MOVE_SPEED.walk * TICK_DT * 0.75;
    let seq = 1;
    for (let i = 0; i < 400; i++) {
      const snap: SnapshotMsg = await host.client.next("snapshot", 5000);
      if (snap.you.escaped) break;
      const cur = cellIndex(maze.width, Math.floor(snap.you.x), Math.floor(snap.you.y));
      const reached = path.indexOf(cur);
      if (reached !== -1) path = path.slice(reached + 1);
      const target = path[0] ?? exitIdx;
      const dx = (target % maze.width) + 0.5 - snap.you.x;
      const dy = Math.floor(target / maze.width) + 0.5 - snap.you.y;
      host.client.send({
        type: "input",
        seq: seq++,
        moveX: Math.abs(dx) > deadzone ? Math.sign(dx) : 0,
        moveY: Math.abs(dy) > deadzone ? Math.sign(dy) : 0,
        sprint: false,
        sneak: false,
      });
    }

    // The bot is (almost certainly) still wandering, yet the match ends: end
    // conditions consider humans only.
    const end = await host.client.next("matchEnd", 10000);
    expect(end.reason).toBe("allEscaped");
    expect(end.escaped).toContain(host.playerId);

    // Bots persist in the lobby across matches.
    const lobbyAfter = await host.client.next("lobbyState");
    expect(lobbyAfter.players.some((p) => p.playerId === botId && p.isBot)).toBe(true);

    host.client.close();
  }, 30000);
});

describe("items and combat", () => {
  it("rejects malformed action messages at the codec boundary", async () => {
    const p = await connectPlayer("Fumbler");
    p.client.sendRaw(JSON.stringify({ type: "action", seq: 1, action: "teleport" }));
    expect((await p.client.next("error")).code).toBe("badMessage");
    p.client.sendRaw(JSON.stringify({ type: "action", seq: 2, action: "use", slot: 9 }));
    expect((await p.client.next("error")).code).toBe("badMessage");
    p.client.sendRaw(JSON.stringify({ type: "action", seq: "x", action: "attack" }));
    expect((await p.client.next("error")).code).toBe("badMessage");
    p.client.close();
    await p.client.closed;
  });

  it("snapshots report floor items exactly when they are in line of sight", async () => {
    // Search for a tiny seed where, from spawn 0, at least one floor item is
    // visible AND at least one is hidden — the interesting case on both sides.
    // Ground truth comes from a local simulation with the same maze/seed/defs:
    // item spawning is deterministic, so it matches the server's exactly.
    let found: {
      seed: string;
      truth: { id: number; item: string; x: number; y: number }[];
    } | null = null;
    for (let i = 0; i < 2000 && !found; i++) {
      const seed = `items-itest-${i}`;
      const maze = generateMaze({ seed, size: "tiny" });
      const spawn = maze.spawns[0]!;
      const vis = computeVisibleCells(maze, spawn.x + 0.5, spawn.y + 0.5);
      const truth = createSimulation({ maze, seed, items: ITEM_DEFS }).listFloorItems();
      const inLos = truth.filter((fi) =>
        vis.has(cellIndex(maze.width, Math.floor(fi.x), Math.floor(fi.y))),
      );
      if (inLos.length > 0 && inLos.length < truth.length) found = { seed, truth };
    }
    expect(found).not.toBeNull();

    const host = await connectPlayer("Looter");
    host.client.send({ type: "createLobby" });
    await host.client.next("lobbyState");
    host.client.send({ type: "startMatch", options: { seed: found!.seed, size: "tiny" } });
    const start = await host.client.next("matchStart");
    expect(start.yourSpawnIndex).toBe(0);

    const snap: SnapshotMsg = await host.client.next("snapshot");
    // Combat state is live from tick 1.
    expect(snap.you.hp).toBe(MAX_HP);
    expect(snap.you.dead).toBe(false);
    expect(snap.inventory).toEqual([null, null, null, null]);

    // visibleItems must be EXACTLY the ground-truth floor items whose cell is
    // in this client's visibleCells — nothing hidden leaks, nothing seen is
    // missing (ids included: both sims assign them deterministically).
    const visible = new Set(snap.visibleCells);
    const maze = generateMaze(start.options);
    const expected = found!.truth
      .filter((fi) => visible.has(cellIndex(maze.width, Math.floor(fi.x), Math.floor(fi.y))))
      .sort((a, b) => a.id - b.id);
    const actual = [...snap.visibleItems].sort((a, b) => a.id - b.id);
    expect(actual).toEqual(expected);
    expect(expected.length).toBeGreaterThan(0);
    expect(expected.length).toBeLessThan(found!.truth.length); // some stay hidden

    host.client.close();
    await host.client.closed;
  });

  it("melee combat: hp drops, cooldowns resist spam, death eliminates, dead spectate", async () => {
    const seed = "combat-itest-1";
    const attacker = await connectPlayer("Attacker");
    const victim = await connectPlayer("Victim");
    attacker.client.send({ type: "createLobby" });
    const lobby = await attacker.client.next("lobbyState");
    victim.client.send({ type: "joinLobby", code: lobby.code });
    await victim.client.next("lobbyState");
    await attacker.client.next("lobbyState");

    attacker.client.send({ type: "startMatch", options: { seed, size: "tiny" } });
    const startA: MatchStartMsg = await attacker.client.next("matchStart");
    const startV: MatchStartMsg = await victim.client.next("matchStart");
    expect(startA.yourSpawnIndex).toBe(0); // humans get slots in join order
    expect(startV.yourSpawnIndex).toBe(1);

    // Spawns 0 and 1 are farthest-point sampled (never adjacent), so drive the
    // attacker to the idle victim along the BFS path of the regenerated maze.
    const maze = generateMaze(startA.options);
    const spawnA = maze.spawns[0]!;
    const spawnV = maze.spawns[1]!;
    const victimCell = cellIndex(maze.width, spawnV.x, spawnV.y);
    let path = bfsPath(maze, cellIndex(maze.width, spawnA.x, spawnA.y), victimCell);
    expect(path.length).toBeGreaterThan(0);

    // The weakest weapon (fists) has the shortest cooldown, so consecutive
    // observed hp drops can never be closer than this many ticks — no matter
    // how hard the attacker spams "attack".
    const minCooldownTicks = Math.round((FISTS.cooldownS ?? 0) * TICK_RATE);
    expect(minCooldownTicks).toBeGreaterThan(1);

    let inputSeq = 1;
    let actionSeq = 1;
    let lastHp = MAX_HP;
    const hpEvents: { tick: number; hp: number }[] = [];
    /** Reads one snapshot from each client (keeps both queues drained/paced). */
    const readBoth = async (): Promise<{ a: SnapshotMsg; v: SnapshotMsg }> => {
      const a: SnapshotMsg = await attacker.client.next("snapshot", 5000);
      const v: SnapshotMsg = await victim.client.next("snapshot", 5000);
      if (v.you.hp !== lastHp) {
        hpEvents.push({ tick: v.tick, hp: v.you.hp });
        lastHp = v.you.hp;
      }
      return { a, v };
    };
    const sendInput = (moveX: number, moveY: number, sprint: boolean): void => {
      attacker.client.send({ type: "input", seq: inputSeq++, moveX, moveY, sprint, sneak: false });
    };
    /** Steer toward (tx, ty) with per-axis deadzone. */
    const steer = (a: SnapshotMsg, tx: number, ty: number, deadzone: number, sprint: boolean) => {
      const dx = tx - a.you.x;
      const dy = ty - a.you.y;
      sendInput(
        Math.abs(dx) > deadzone ? Math.sign(dx) : 0,
        Math.abs(dy) > deadzone ? Math.sign(dy) : 0,
        sprint,
      );
    };

    // Phase 1: sprint along the path and park at the CENTER of the cell next
    // to the victim (open passage between them => in melee range, clear LOS).
    // We deliberately never enter the victim's cell: with both players frozen
    // and facing locked, hits become deterministic instead of oscillation luck.
    const neighborCell = path.length >= 2
      ? path[path.length - 2]!
      : cellIndex(maze.width, spawnA.x, spawnA.y);
    const parkX = (neighborCell % maze.width) + 0.5;
    const parkY = Math.floor(neighborCell / maze.width) + 0.5;
    let approach = path.slice(0, -1); // everything up to (excluding) the victim's cell
    const walkDeadzone = MOVE_SPEED.walk * TICK_DT * 0.75;
    const sprintDeadzone = MOVE_SPEED.sprint * TICK_DT * 0.75;
    let parked = false;
    for (let i = 0; i < 700 && !parked; i++) {
      const { a } = await readBoth();
      const cur = cellIndex(maze.width, Math.floor(a.you.x), Math.floor(a.you.y));
      if (
        cur === neighborCell &&
        Math.abs(a.you.x - parkX) < walkDeadzone &&
        Math.abs(a.you.y - parkY) < walkDeadzone
      ) {
        parked = true;
        break;
      }
      const reached = approach.indexOf(cur);
      if (reached !== -1) approach = approach.slice(reached + 1);
      const target = approach[0] ?? neighborCell;
      const tx = (target % maze.width) + 0.5;
      const ty = Math.floor(target / maze.width) + 0.5;
      // Sprint between cells, walk (tighter deadzone) to settle on the last one.
      const sprint = target !== neighborCell;
      steer(a, tx, ty, sprint ? sprintDeadzone : walkDeadzone, sprint);
    }
    expect(parked).toBe(true);
    sendInput(0, 0, false); // freeze (in-flight steering drains within a tick)
    await readBoth();

    // Face-pulse + attack burst: one movement tick toward the victim locks the
    // attacker's facing on them, then a frozen attack burst (one action every
    // other tick — well inside the rate limit; cooldown >> 2 ticks anyway)
    // must land a hit. Re-pulse each cycle in case in-flight drift misaligned.
    let firstHit: { tick: number; hp: number } | null = null;
    for (let cycle = 0; cycle < 8 && !firstHit; cycle++) {
      let { a, v } = await readBoth();
      steer(a, v.you.x, v.you.y, 0.05, false); // face the victim + creep closer
      ({ a, v } = await readBoth());
      sendInput(0, 0, false); // stop; facing stays on the victim
      for (let i = 0; i < 30 && !firstHit; i++) {
        ({ a, v } = await readBoth());
        if (v.you.hp < MAX_HP) {
          firstHit = { tick: v.tick, hp: v.you.hp };
          break;
        }
        if (i % 2 === 0) {
          attacker.client.send({ type: "action", seq: actionSeq++, action: "attack" });
        }
      }
    }
    expect(firstHit).not.toBeNull();

    // Phase 2: stale/duplicate action seqs must be dropped — "attack" frames
    // keep arriving for 40 ticks (far beyond any weapon cooldown, attacker
    // still in melee range, facing the victim) yet hp must not move.
    for (let i = 0; i < 40; i++) {
      await readBoth();
      if (i % 2 === 0) {
        attacker.client.send({ type: "action", seq: 1, action: "attack" }); // duplicate
        attacker.client.send({ type: "action", seq: 0, action: "attack" }); // stale
      }
    }
    expect(lastHp).toBe(firstHit!.hp);

    // Phase 3: legitimate attack spam until the victim dies. Geometry is
    // frozen (nobody has moved since the first hit), so every off-cooldown
    // swing connects. The victim must be visible to the attacker while alive
    // (adjacent open cell), then vanish from visiblePlayers once dead.
    let dead = false;
    let sawVictimAlive = false;
    for (let i = 0; i < 700 && !dead; i++) {
      const { a, v } = await readBoth();
      if (v.you.dead) {
        dead = true;
        break;
      }
      if (a.visiblePlayers.some((pp) => pp.playerId === victim.playerId)) sawVictimAlive = true;
      if (i % 2 === 0) {
        attacker.client.send({ type: "action", seq: actionSeq++, action: "attack" });
      }
    }
    expect(dead).toBe(true);
    expect(lastHp).toBe(0);
    expect(sawVictimAlive).toBe(true);

    // Every observed hp change is a strict drop, and drops are spaced at
    // least one weapon cooldown apart — spam never bypassed the cooldown.
    expect(hpEvents.length).toBeGreaterThanOrEqual(2);
    for (let i = 1; i < hpEvents.length; i++) {
      expect(hpEvents[i]!.hp).toBeLessThan(hpEvents[i - 1]!.hp);
      expect(hpEvents[i]!.tick - hpEvents[i - 1]!.tick).toBeGreaterThanOrEqual(minCooldownTicks);
    }

    // Dead players keep receiving snapshots (their frozen view) until the end.
    let prevTick = hpEvents[hpEvents.length - 1]!.tick;
    for (let i = 0; i < 3; i++) {
      const v: SnapshotMsg = await victim.client.next("snapshot", 5000);
      expect(v.you.dead).toBe(true);
      expect(v.you.hp).toBe(0);
      expect(v.tick).toBeGreaterThan(prevTick);
      prevTick = v.tick;
    }

    // The corpse is not a player: dead victim never appears in visiblePlayers.
    const deathTick = prevTick;
    let afterKill: SnapshotMsg;
    do {
      afterKill = await attacker.client.next("snapshot", 5000);
    } while (afterKill.tick < deathTick);
    expect(afterKill.visiblePlayers.some((pp) => pp.playerId === victim.playerId)).toBe(false);

    // Match end condition counts dead humans as resolved: once the attacker
    // disconnects, the only connected human is dead => the match ends, and
    // matchEnd names the victim in `eliminated` (death order).
    attacker.client.close();
    const end = await victim.client.next("matchEnd", 5000);
    expect(end.reason).toBe("allEscaped");
    expect(end.escaped).toEqual([]);
    expect(end.eliminated).toEqual([victim.playerId]);

    victim.client.close();
    await victim.client.closed;
  }, 90000);
});
