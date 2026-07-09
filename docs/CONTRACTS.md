# Module Contracts — Vertical Slice v1

This document fixes the API surface between packages so they can be developed
independently. **Do not change a contract without updating this file and every
consumer.** Shared types live in `@echowake/common` and
`@echowake/protocol` — import them, never redeclare them.

Scope of the slice: Escape mode, 1–16 players, deterministic maze, fog of war
with aging memory, visualized confidence-banded sound, authoritative server,
WebSocket transport. No combat, no items, no bots yet (all are TODOs).

Positions are in **tile units** (floats); a player at (3.5, 2.5) stands at the
center of cell (3, 2). Cells are row-major: `index = y * width + x`.

## @echowake/math

Pure, dependency-free, fully deterministic. No `Math.random()`, no `Date`.

```ts
export interface Rng {
  /** Next float in [0, 1). */
  next(): number;
  /** Integer in [min, max) — max exclusive. */
  int(min: number, max: number): number;
  /** Uniform pick. Throws on empty array. */
  pick<T>(items: readonly T[]): T;
  /** Fisher–Yates shuffle; returns a new array, input untouched. */
  shuffle<T>(items: readonly T[]): T[];
}

/** Same seed string => identical sequence, forever. (e.g. mulberry32 over a string hash) */
export function createRng(seed: string): Rng;

/** Deterministic 32-bit hash of a string (for sub-seeding: hash(`${seed}:${purpose}`)). */
export function hashString(s: string): number;

/** Integer grid cells on the line from (x0,y0) to (x1,y1), inclusive (Bresenham). */
export function gridLine(x0: number, y0: number, x1: number, y1: number): { x: number; y: number }[];

export function clamp(v: number, min: number, max: number): number;
export function distSq(x0: number, y0: number, x1: number, y1: number): number;
```

Tests must prove: same seed → same sequence; known-answer regression for one
seed; gridLine symmetry and endpoint inclusion.

## @echowake/mazegen

```ts
import type { Maze, MazeGenOptions } from "@echowake/common";

/** Deterministic: deep-equal output for equal options. */
export function generateMaze(options: MazeGenOptions): Maze;
```

Requirements:

- Perfect maze (every cell reachable) via recursive backtracker (or similar),
  then carve extra loops: roughly `(1 - difficulty) * 8%` of walls removed,
  default difficulty 0.5. All randomness from `createRng` seeded off
  `options.seed` (+ sub-purposes via `hashString`).
- Wall consistency: neighbors always agree (cell's E wall set ⇔ neighbor's W wall set).
  Border walls always present.
- Materials: assign `wallMaterial`/`floor` per region deterministically
  (Stone default; patches of Wood/Metal/Grass/Sand/Water are fine, keep simple).
- `spawns`: 16 positions spread apart (maximize pairwise distance greedily).
- `exit`: far from spawn[0] (e.g. BFS-farthest cell from the spawn centroid).
- Tests: same seed deep-equal; different seeds differ; full connectivity (BFS);
  wall consistency; correct dimensions per size.

## @echowake/ecs

Deterministic fixed-tick simulation shared by server (authority) and any future
client prediction/bots. bitECS preferred; a simple custom ECS is acceptable.
No wall-clock time, no `Math.random()` — all randomness seeded.

```ts
import type { Maze, PerceivedSound, RawSoundEvent } from "@echowake/common";

export interface PlayerInput { moveX: number; moveY: number; sprint: boolean; sneak: boolean }
export interface PlayerState { x: number; y: number; escaped: boolean }
export interface TickResult {
  tick: number;
  /** Exact sounds emitted this tick (server-side truth; never sent raw to clients). */
  sounds: RawSoundEvent[];
  /** Player slots that reached the exit this tick. */
  escapes: number[];
}

export interface Simulation {
  readonly maze: Maze;
  readonly tick: number;
  /** Adds a player at maze.spawns[slot]; slot = join order 0..15. Returns slot. */
  addPlayer(): number;
  removePlayer(slot: number): void;
  setInput(slot: number, input: PlayerInput): void;
  /** Advances exactly one tick (TICK_DT). */
  step(): TickResult;
  getPlayerState(slot: number): PlayerState;
}

export function createSimulation(opts: { maze: Maze; seed: string }): Simulation;

/** Cell indices visible from (x, y) within VISION_RADIUS, walls block LOS (use gridLine, stop at first wall crossing). */
export function computeVisibleCells(maze: Maze, x: number, y: number): Set<number>;

/**
 * How `listener` perceives `sound`, or null if inaudible.
 * - Distance = BFS path distance through the maze honoring walls (never plain Euclidean through walls).
 * - Each wall crossed attenuates by material (Stone heavy, Wood medium, Metal light/resonant, open passage none).
 * - effective intensity >= 0.6 → "high" (exact position, tight radius)
 *   >= 0.25 → "medium" (position jittered ~1.5 tiles)
 *   > threshold → "low" (position jittered ~4 tiles), else null.
 * - Jitter must be deterministic: seed from (matchSeed, sound.tick, sound.emitterId).
 *   The maze seed is public (broadcast in matchStart), so the server passes a
 *   secret per-match salt as `matchSeed` — never the public seed, and the salt
 *   is never sent to clients — otherwise a modified client could re-derive the
 *   jitter and recover exact sound origins (a wallhack).
 */
export function perceiveSound(
  maze: Maze,
  matchSeed: string,
  sound: RawSoundEvent,
  listenerX: number,
  listenerY: number,
): PerceivedSound | null;
```

Simulation rules:

- Movement: input dir normalized, speed from MOVE_SPEED (sneak/walk/sprint),
  integrate `pos += dir * speed * TICK_DT`. Collision: circle (PLAYER_RADIUS)
  vs cell walls — slide along walls, never tunnel. Players do not collide with
  each other (slice simplification, TODO).
- Sound emission: a moving player emits a footstep every ~0.45s of movement
  (sprint ~0.3s, sneak ~0.7s) with kind/intensity from SOUND_INTENSITY.
  Track per-player distance-moved accumulators, tick-based, deterministic.
- Escape: a player whose position is inside the exit cell gets `escaped = true`
  once, reported in TickResult.escapes; escaped players stop simulating.
- Tests: determinism (two sims, same inputs → identical positions after 200
  ticks); wall collision (cannot cross a wall); vision blocked by walls;
  sound attenuation drops across walls; escape triggers.

## @echowake/protocol

Message types already exist in `src/messages.ts` (do not redesign). Add
`src/codec.ts`:

```ts
export function encodeMessage(msg: ClientMessage | ServerMessage): string; // JSON
/** Strict structural validation of untrusted input; null on anything malformed. */
export function decodeClientMessage(raw: string): ClientMessage | null;
/** Trusting decode for client use. */
export function decodeServerMessage(raw: string): ServerMessage | null;
```

`decodeClientMessage` is a security boundary: hand-written checks (no deps),
clamp string lengths (name ≤ 20, chat ≤ 200, code = 4 alpha, maze seed ≤ 64,
maze modifiers ≤ 8 entries of ≤ 32 chars each — the seed is hashed every tick
and echoed to all clients, so unbounded values are a DoS vector), reject
unknown `type`, ensure numbers are finite, moveX/moveY ∈ {-1, 0, 1}. Tests:
round-trip every message type; fuzz garbage inputs return null.

## @echowake/bots

Server-side AI players. **Bots use the same rules as players** (README): a bot
occupies a normal simulation slot and acts ONLY by producing `PlayerInput` —
it must never mutate the simulation directly. Fully deterministic: same seed +
maze + observation sequence => identical inputs (no Math.random/Date).

```ts
import type { Maze, PerceivedSound } from "@echowake/common";
import type { PlayerInput } from "@echowake/ecs";

/** What a bot is allowed to know each tick — the same view a human client gets. */
export interface BotObservation {
  tick: number;
  x: number;
  y: number;
  escaped: boolean;
  /** Cell indices currently in line of sight (server-computed, as for humans). */
  visibleCells: ReadonlySet<number>;
  /** Sounds as this bot perceives them (confidence-banded, like a human client). */
  sounds: readonly PerceivedSound[];
}

export interface BotController {
  next(obs: BotObservation): PlayerInput;
}

/** seed: derive per-bot determinism from `${matchSeed}:bot:${slot}`. */
export function createBotController(opts: {
  maze: Maze;
  seed: string;
  slot: number;
}): BotController;

/** Deterministic friendly bot display name for lobby index i ("Bot Juno" etc). */
export function botName(i: number): string;
```

Behavior v1 (keep simple, it's a testing partner, not a challenge):

- Knows the maze topology (legitimate — every client regenerates it from the
  broadcast seed) but NOT live state: it only "knows" the exit once the exit
  cell has appeared in its accumulated visibleCells memory.
- Explore: remember all cells ever seen; pathfind (BFS honoring walls) to the
  nearest never-seen cell; re-plan when the target is reached or unreachable.
  Tie-breaks and any wandering choices come from the seeded RNG.
- Escape: once the exit cell has been seen, pathfind to it and walk there.
- Movement: emit moveX/moveY ∈ {-1,0,1} toward the next path cell's center;
  walk speed (no sprint/sneak in v1 — TODO: sneak near heard sounds).
- Tests: determinism (two controllers, same seed/obs => same inputs over 100+
  ticks); a bot in a small maze reaches the exit within a generous tick budget
  when fed real computeVisibleCells observations; never emits values outside
  the PlayerInput contract.

## @echowake/server (apps/server)

Fastify on port **8080** (`PORT` env overrides): `GET /healthz` → `{ ok: true }`;
WebSocket at `/ws` via @fastify/websocket.

Flow: client connects → must send `hello` first (validate PROTOCOL_VERSION,
else `error` + close) → `welcome` with a random playerId (crypto UUID is fine —
connection identity is not simulation state). Lobby: `createLobby` makes a
4-letter code, creator is host; `joinLobby` (≤ MAX_PLAYERS); broadcast
`lobbyState` on every change; host `startMatch` → generate maze from options
(server picks the seed if the host's is empty), `createSimulation`, send
`matchStart` (yourSpawnIndex = join order), run `setInterval` loop at TICK_RATE.
`endTick` comes from `MATCH_DURATION_S_PER_SIZE[options.size] * TICK_RATE` —
bigger labyrinths get more time.
Bots: host-only `addBot` adds an AI player (server assigns playerId + botName;
reject beyond MAX_PLAYERS with `lobbyFull`); host-only `removeBot` removes one
(`badMessage` if the id isn't a bot in this lobby). Bots appear in lobbyState
with `isBot: true`, count toward MAX_PLAYERS_PER_SIZE at startMatch, get sim
slots in roster order, and are driven each tick by @echowake/bots controllers
fed the same per-player view humans get (computeVisibleCells + perceiveSound
with the secret jitter salt) BEFORE sim.step(). Bots appear in snapshots'
visiblePlayers and emit sounds like anyone else. Their escapes join
matchEnd.escaped. Match end/abort conditions consider HUMAN players only —
bots never keep a match alive (all humans escaped => allEscaped even if bots
remain; all humans gone => abort). Bots are removed from the lobby only by
removeBot or lobby deletion, and persist across matches.
`startMatch` must also enforce `MAX_PLAYERS_PER_SIZE` from @echowake/common:
if the lobby has more players than the chosen size allows, reply
`error: "tooManyPlayersForSize"` and do not start.
Per tick: apply latest input per player (server clamps values; stale/absent
input = keep previous), `step()`, then per client build `SnapshotMsg` using
`computeVisibleCells` (visiblePlayers = others whose cell ∈ your visibleCells;
players who have escaped are omitted from everyone's visiblePlayers) and
`perceiveSound` for each TickResult sound (skip your own sounds). Send
snapshots every tick (JSON is fine for the slice). Match ends when all
non-disconnected players escaped or `tick >= endTick` → `matchEnd`, lobby
returns to pre-match state. Disconnects remove the player. Chat broadcasts to
the lobby, sanitized.

The interval loop is transport pacing only — all game logic stays inside
`@echowake/ecs`. Keep files small: `main.ts`, `lobby.ts`, `match.ts`,
`connection.ts` or similar.

## @echowake/client-web (apps/client-web)

React shell (screens) + PixiJS canvas (game). React never owns gameplay state.

Screens: **Main menu** (name input, Host / Join) → **Lobby** (code display,
player list, host picks size + Start; sizes whose `MAX_PLAYERS_PER_SIZE` cap is
below the current roster are disabled with the cap shown, e.g. "tiny — max 2";
host also gets "Add bot" (sends `addBot`) and a remove control per bot row
(sends `removeBot`); bot rows show a BOT tag via `isBot`) → **Game** → **Match end** (escape order,
back to lobby). Server URL: `ws://localhost:8080/ws` (override via
`VITE_SERVER_URL`).

Game rendering (Pixi):

- On `matchStart`, run `generateMaze(options)` locally — identical to server's.
- Tile layer: floor tinted by material; walls as lines/rects. Simple pixel
  look, crisp edges (`roundPixels`), camera follows player, ~32px per tile.
- Fog of war overlay per cell from client-side memory: Visible (full bright) /
  Recent (dimmed) / Stale (heavily dimmed, desaturated) / Unknown (black).
  Update memory from each snapshot's `visibleCells`; age Visible→Recent→Stale
  by FOG_RECENT_AFTER_S / FOG_STALE_AFTER_S.
- You: colored circle/sprite at snapshot position, interpolated between the
  last two snapshots. Visible other players likewise.
- Sounds: each PerceivedSound spawns an expanding ripple ring at (x, y) —
  high confidence: bright, sharp, small; medium: softer, blurrier; low: large,
  diffuse, faint. Fade out over ~1s.
- Minimap: small corner overlay of remembered cells + you + exit if seen.
- Exit cell: distinct color when visible/remembered.
- HUD: match timer (from endTick), lobby code, connection state, "ESCAPED!" banner.

Input: WASD/arrows move, Shift = sprint, Ctrl or C = sneak. Send `input` (with
incrementing seq) at TICK_RATE while in game. Chat: Enter opens a small
overlay, sends `chat`.

Suggested layout: `src/net/` (socket wrapper), `src/game/` (Pixi renderer, fog
memory, ripples), `src/ui/` (React screens), `src/main.tsx` (wiring).

## Deployment (public dedicated server)

One deployable: the dedicated server also serves the built web client, so a
single container is the whole game.

Server (apps/server):

- `@fastify/static` serves `CLIENT_DIST` (env; default: `../client-web/dist`
  relative to apps/server, only if it exists) at `/`. `/healthz`, `/metrics`
  and `/ws` keep priority over static files. No SPA fallback needed (single
  page). When CLIENT_DIST is absent the server runs WS-only (dev mode).
- Config via env only (document in docs/DEPLOYMENT.md): `PORT` (8080), `HOST`
  (0.0.0.0), `CLIENT_DIST`, `LOG_LEVEL` (fastify logger level, default info).
- `GET /metrics`: JSON `{ uptimeS, lobbies, players, botsInLobbies,
  runningMatches, protocolVersion }`. (Prometheus format is a later TODO.)
- Graceful shutdown: on SIGTERM/SIGINT, broadcast a server `error`
  ("serverShutdown" is NOT a new code — reuse "badMessage") is unnecessary;
  simply stop accepting connections, end all matches (release entities!),
  close sockets, then `app.close()`. Exit 0.
- Dockerfile at repo root, multi-stage: (1) pnpm install + vite build of
  client-web with no VITE_SERVER_URL (same-origin default), (2) runtime image
  with only what the server needs, running as non-root, `EXPOSE 8080`,
  HEALTHCHECK on /healthz. `docker build .` then `docker run -p 8080:8080`
  serves the playable game at http://localhost:8080.

Client (apps/client-web) server-URL resolution, in priority order:

1. Manual address from the main menu "server" field (persisted to
   localStorage; blank = auto).
2. `VITE_SERVER_URL` build-time override (dev/e2e only).
3. Same-origin when the page was NOT served by the vite dev server (i.e. not
   port 5173): `wss://host/ws` when https, else `ws://host/ws`.
4. Dev fallback `ws://localhost:8080/ws`.

## Out of scope for the slice (leave TODOs, do not implement)

Bots/AI, combat, items/equipment, voice, prediction & lag compensation, binary
protocol, persistence (PostgreSQL/Redis), auth (JWT), Electron/Capacitor
wrappers, modding hooks, matchmaking, metrics/admin API.
