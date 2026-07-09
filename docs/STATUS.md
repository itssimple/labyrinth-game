# Echowake — Project Status

_Last updated: 2026-07-09 (branch `claude/game-init-setup-t67bcw`)._

Where the implementation stands relative to the README (the design document /
source of truth). Everything listed as implemented is covered by tests and the
e2e suites described under Verification.

## Implemented

**Foundation**
- pnpm + Turborepo monorepo: `/apps` (server, client-web) + `/packages`
  (common, math, mazegen, ecs, protocol, bots, content), TypeScript-source
  workspace exports (no build step in dev).
- Module contracts pinned in `docs/CONTRACTS.md`; architecture invariants in
  `CLAUDE.md`. Deterministic core: seeded RNG everywhere, no wall-clock in
  simulation, bit-exact determinism tests (200-tick two-sim comparisons).

**Gameplay (Escape mode, 1–16 players)**
- Deterministic maze generation (5 sizes, 25² → 101², per-size player caps
  2/4/8/12/16 and match durations 3–15 min), materials, spread spawns,
  BFS-far exit.
- Movement (walk/sprint/sneak) with sliding wall collision; escape objective.
- **Directional vision**: server-enforced 120° view cone toward the aim
  direction + 2.5-tile peripheral radius; hearing stays 360°. Aim via mouse /
  gamepad right stick / twin touch sticks (mobile playable).
- **Fog of war with aging memory**: visible / recent / stale / unknown;
  constant-display-object renderer (baked + once-blurred maze textures,
  incremental mask painting) — remembered areas dimmed, desaturated, blurred.
- **Sound is vision**: footsteps/actions propagate via weighted pathfinding
  through walls (material attenuation), confidence-banded (high/medium/low)
  with server-secret jitter (anti-wallhack: band-seeded, intensity quantized);
  rendered as ripples AND synthesized positional audio (zero asset files,
  stereo pan, low-confidence muffling, own-footstep cadence matching the sim).
- **Items & combat v1** (data-driven in `@echowake/content`, injected into the
  sim): melee (fists/sword) with wall-blocking arcs and cooldowns; leather/
  iron armor (protection vs. louder footsteps); soft boots; warding + veil
  charm auras (one-per-direction, no stacking); bandage; noisemaker emitting
  deceptive real-footstep sounds. Deterministic secret-seeded item spawns,
  auto-pickup/drop with hysteresis, death drops inventory, elimination.
- **AI bots**: server-side, same rules/inputs as players, observe only what a
  human client gets (coned vision + banded sounds); frontier exploration,
  escape-when-exit-seen; host add/remove in lobby; never block match end.

**Multiplayer & server**
- Authoritative Fastify/WebSocket server, 20Hz fixed tick; clients send only
  intent. Strict codec as security boundary (length caps, finite numbers,
  fuzz-tested), per-connection rate limiting, protocol version check.
- Lobbies (4-letter codes, host controls, promotion), public lobby browser
  (private by default, host opt-in), chat, ping/pong RTT.
- Per-client snapshots built exclusively from cone-filtered visibility +
  perceived sound — hidden state never leaves the server.
- **Single-container public deployment**: the server serves the built client;
  `docker build && docker run -p 8080:8080` is the whole game. /healthz,
  /metrics, env config, graceful shutdown. See `docs/DEPLOYMENT.md`.

**Client (web)**
- React shell (menu / browse / lobby / game / match end) around a plain-TS
  GameSession; renderer only observes state. Pixi v8.
- HUD: minimap, HP bar, inventory (1-4/Q/Space+click), match timer, ping, FPS,
  hold-Tab roster, exit compass (fog-memory-gated), chat, volume, hit flash,
  ELIMINATED spectate. Runtime server address field (auto same-origin).

**Verification** (all green at last commit)
- ~230 unit/integration tests across 9 workspaces (incl. a real two-client
  combat-to-elimination server test and cone-visibility snapshot tests).
- `pnpm e2e`: real two-browser flows — host/join/move, solo-with-bot,
  public-browse-and-join, HUD/ping/combat assertions, zero console errors.
- `pnpm e2e:docker`: browser smoke against the production container,
  including same-origin WS and sub-second graceful shutdown.
- Three adversarial review rounds: 18 confirmed findings, all fixed (notable:
  bitECS entity-pool server crash, seed-derived item/jitter wallhacks,
  intensity-inversion leak, seed-length CPU DoS).

## Not yet implemented (README items)

- Game modes beyond Escape (Hide & Seek, Infection, LMS, …) — the objective
  system is not yet abstracted; combat/bots groundwork is in place.
- Lobby voting (seed/mode/modifiers); modifiers themselves.
- Ranged weapons, traps, doors as interactive objects, monsters/PvE.
- Persistence (PostgreSQL), Redis, JWT auth/accounts, matchmaking, admin API.
- Voice chat, team chat channels, map sharing between teammates.
- Client prediction/lag compensation; binary protocol.
- Electron (desktop) and Capacitor (Android) wrappers; Steam/Discord.
- Accessibility settings (remappable keys, colorblind modes, UI scaling),
  keybind screen, settings screen beyond volume.
- Modding hooks beyond the data-driven content package (custom maps/modes/AI).

## Polish backlog (from playtesting notes)

- Fog reveal/hide should fade over a few frames (cheap now: interpolate mask
  texel values — the mask pipeline was built with this in mind).
- Detailed player sprites and real textures (current: placeholder shapes and
  material tints). PixiJS-focused skills are planned to support this work.
- Touch controls v2: sprint/sneak/attack gestures on mobile.

## Suggested next milestones

1. Game-mode abstraction + Hide & Seek (hunter bots reusing the sound system).
2. Finetuning pass: fog fades, sprites/textures, screen-shake/particles.
3. Accounts + persistence, then matchmaking/server browser federation.
4. Desktop (Electron) packaging for storefront releases.
