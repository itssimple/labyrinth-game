import { randomUUID } from "node:crypto";
import { createBotController, type BotController } from "@echowake/bots";
import {
  MATCH_DURATION_S_PER_SIZE,
  TICK_RATE,
  cellIndex,
  type Maze,
  type MazeGenOptions,
  type PerceivedSound,
  type RawSoundEvent,
} from "@echowake/common";
import { ITEM_DEFS } from "@echowake/content";
import {
  computeVisibleCells,
  createSimulation,
  perceiveSound,
  type PlayerAction,
  type Simulation,
} from "@echowake/ecs";
import { generateMaze } from "@echowake/mazegen";
import { clamp } from "@echowake/math";
import type {
  ActionMsg,
  InputMsg,
  SnapshotMsg,
  VisibleItemState,
  VisiblePlayerState,
} from "@echowake/protocol";
import type { Client } from "./client.js";
import type { Lobby } from "./lobby.js";

/** Per-player bookkeeping between the transport and the simulation. */
interface MatchPlayer {
  client: Client;
  /** Simulation slot == spawn index == lobby join order at match start. */
  slot: number;
  /** Latest validated-but-unapplied input; null means keep previous. */
  pending: InputMsg | null;
  /** Highest input seq received (stale/duplicate inputs are dropped). */
  lastSeq: number;
  /** Seq of the last input actually consumed by the simulation. */
  ackSeq: number;
  /** Highest action seq received (stale/duplicate actions are dropped). */
  lastActionSeq: number;
  /**
   * Validated actions awaiting the next tick. Multiple distinct actions per
   * tick are fine (e.g. use a bandage AND drop something), but at most one
   * attack is ever buffered — cooldowns can't be bypassed by spamming, and
   * the simulation enforces the same rule as a second line of defense.
   */
  pendingActions: PlayerAction[];
}

/**
 * Cap on buffered actions per player per tick — mirrors the simulation's own
 * queue cap so a flood of use/drop messages can't grow memory between ticks.
 */
const MAX_PENDING_ACTIONS = 8;

/** One AI player in this match: a normal sim slot driven by a controller. */
interface MatchBot {
  /** The lobby bot's playerId — bots persist in the lobby across matches. */
  readonly playerId: string;
  /** Simulation slot, assigned after every human (roster order). */
  readonly slot: number;
  readonly controller: BotController;
}

/**
 * One running Escape-mode match for a lobby. The interval loop here is
 * transport pacing only — all game rules live in @echowake/ecs. Snapshots
 * are built strictly from computeVisibleCells + perceiveSound so a client
 * never learns a hidden position or an exact (raw) sound.
 */
export class Match {
  readonly maze: Maze;
  readonly options: MazeGenOptions;
  readonly endTick: number;

  private readonly lobby: Lobby;
  private readonly seed: string;
  /**
   * Secret seed for perceiveSound jitter. The maze seed is broadcast to every
   * client in matchStart, so jitter seeded from it alone could be re-derived
   * by a modified client to recover exact sound origins (a wallhack). The
   * random salt never appears in any outbound message.
   */
  private readonly jitterSeed: string;
  private readonly sim: Simulation;
  private readonly players = new Map<string, MatchPlayer>();
  private readonly bots: MatchBot[] = [];
  /**
   * Sounds emitted on the previous tick, kept for bot observations: a bot
   * "hears" one tick late, exactly like a human client that only learns of a
   * sound from the snapshot sent after the tick that produced it.
   */
  private prevSounds: readonly RawSoundEvent[] = [];
  private readonly escapedIds: string[] = [];
  /** Player ids (humans AND bots) eliminated by combat, in death order. */
  private readonly eliminatedIds: string[] = [];
  private interval: NodeJS.Timeout | null = null;

  /**
   * Generates the maze and simulation from `options` (seed already resolved
   * by the caller) and registers every current lobby member in join order.
   */
  constructor(lobby: Lobby, options: MazeGenOptions) {
    this.lobby = lobby;
    this.options = {
      ...options,
      ...(options.difficulty !== undefined
        ? { difficulty: clamp(options.difficulty, 0, 1) }
        : {}),
    };
    this.seed = options.seed;
    this.jitterSeed = `${this.seed}#${randomUUID()}`;
    this.endTick = MATCH_DURATION_S_PER_SIZE[this.options.size] * TICK_RATE;
    this.maze = generateMaze(this.options);
    // Item definitions are injected here (content -> ecs, never the reverse):
    // the simulation stays moddable while the stock server ships the v1 set.
    this.sim = createSimulation({ maze: this.maze, seed: this.seed, items: ITEM_DEFS });
    for (const client of lobby.clients) {
      const slot = this.sim.addPlayer();
      this.players.set(client.playerId, {
        client,
        slot,
        pending: null,
        lastSeq: -1,
        ackSeq: 0,
        lastActionSeq: -1,
        pendingActions: [],
      });
    }
    // Bots get sim slots after every human, in lobby roster order. They play
    // by the same rules: a normal slot, driven purely through PlayerInput.
    for (const bot of lobby.bots) {
      const slot = this.sim.addPlayer();
      this.bots.push({
        playerId: bot.playerId,
        slot,
        controller: createBotController({ maze: this.maze, seed: this.seed, slot }),
      });
    }
  }

  /** Sends per-player matchStart messages and begins the 20Hz tick loop. */
  start(): void {
    for (const p of this.players.values()) {
      p.client.send({
        type: "matchStart",
        options: this.options,
        endTick: this.endTick,
        yourSpawnIndex: p.slot,
      });
    }
    this.interval = setInterval(() => this.tick(), 1000 / TICK_RATE);
  }

  /** Buffers a validated input; only the latest per tick is applied. */
  handleInput(client: Client, msg: InputMsg): void {
    const p = this.players.get(client.playerId);
    if (!p || msg.seq <= p.lastSeq) return;
    p.lastSeq = msg.seq;
    p.pending = msg;
  }

  /**
   * Buffers a validated action for the next tick. Seq must advance
   * monotonically (its own stream, independent of input seq) so replayed or
   * reordered frames are dropped; at most one attack per tick is buffered —
   * spamming attack cannot bypass weapon cooldowns (the sim enforces both
   * the one-attack rule and the cooldown itself as well).
   */
  handleAction(client: Client, msg: ActionMsg): void {
    const p = this.players.get(client.playerId);
    if (!p || msg.seq <= p.lastActionSeq) return;
    p.lastActionSeq = msg.seq;
    if (p.pendingActions.length >= MAX_PENDING_ACTIONS) return;
    if (msg.action === "attack" && p.pendingActions.some((a) => a.action === "attack")) return;
    p.pendingActions.push({ action: msg.action, slot: msg.slot });
  }

  /** Removes a disconnected/leaving player from the simulation and end-checks. */
  removePlayer(client: Client): void {
    const p = this.players.get(client.playerId);
    if (!p) return;
    this.players.delete(client.playerId);
    this.sim.removePlayer(p.slot);
    if (this.players.size === 0) {
      // Bots never keep a match alive: no humans left => abort.
      this.abort();
      return;
    }
    this.checkHumansResolved();
  }

  /** Removes a bot's simulation slot when the host removes it mid-match. */
  removeBot(playerId: string): void {
    const i = this.bots.findIndex((b) => b.playerId === playerId);
    if (i === -1) return;
    const [bot] = this.bots.splice(i, 1);
    if (bot) this.sim.removePlayer(bot.slot);
  }

  /** Stops the tick loop without broadcasting (e.g. lobby emptied out). */
  abort(): void {
    if (this.interval) clearInterval(this.interval);
    this.interval = null;
    this.releasePlayers();
    if (this.lobby.match === this) this.lobby.match = null;
  }

  private tick(): void {
    // Drive bots first (before human inputs and step). Each live bot observes
    // exactly what a human client would: its own vision via computeVisibleCells
    // and confidence-banded sounds via perceiveSound with the secret jitter
    // seed — never raw simulation state. Sounds are last tick's (see
    // prevSounds): one tick of hearing latency, same as a human client.
    for (const bot of this.bots) {
      const state = this.sim.getPlayerState(bot.slot);
      if (state.escaped || state.dead) continue; // the dead don't wander
      const visibleCells = computeVisibleCells(this.maze, state.x, state.y);
      const sounds: PerceivedSound[] = [];
      for (const raw of this.prevSounds) {
        if (raw.emitterId === bot.slot) continue; // a bot never hears itself
        const heard = perceiveSound(this.maze, this.jitterSeed, raw, state.x, state.y);
        if (heard) sounds.push(heard);
      }
      this.sim.setInput(
        bot.slot,
        bot.controller.next({
          tick: this.sim.tick,
          x: state.x,
          y: state.y,
          escaped: state.escaped,
          visibleCells,
          sounds,
        }),
      );
    }

    // Apply the latest validated input per player; absent = keep previous.
    // Buffered actions are handed to the sim afterwards so an attack swings
    // toward this tick's facing (facing derives from the same tick's input).
    for (const p of this.players.values()) {
      if (p.pending) {
        this.sim.setInput(p.slot, {
          moveX: p.pending.moveX,
          moveY: p.pending.moveY,
          sprint: p.pending.sprint,
          sneak: p.pending.sneak,
        });
        p.ackSeq = p.pending.seq;
        p.pending = null;
      }
      for (const action of p.pendingActions) this.sim.act(p.slot, action);
      p.pendingActions.length = 0;
    }

    const result = this.sim.step();
    this.prevSounds = result.sounds;
    for (const slot of result.escapes) {
      for (const p of this.players.values()) {
        if (p.slot === slot) this.escapedIds.push(p.client.playerId);
      }
      for (const b of this.bots) {
        if (b.slot === slot) this.escapedIds.push(b.playerId);
      }
    }
    // Combat deaths, in death order — humans and bots alike (a bot keeps its
    // lobby playerId, so the match-end screen can name it).
    for (const slot of result.deaths) {
      for (const p of this.players.values()) {
        if (p.slot === slot) this.eliminatedIds.push(p.client.playerId);
      }
      for (const b of this.bots) {
        if (b.slot === slot) this.eliminatedIds.push(b.playerId);
      }
    }

    // Snapshot each player's world through their own vision + hearing only.
    // Dead players are still snapshotted (their frozen view) until match end.
    const floorItems = this.sim.listFloorItems();
    const states = [...this.players.values()].map((p) => ({
      p,
      state: this.sim.getPlayerState(p.slot),
    }));
    // Everyone a snapshot may show: humans and bots alike (bots are just
    // player states to an observer).
    const observable = [
      ...states.map(({ p, state }) => ({ playerId: p.client.playerId, state })),
      ...this.bots.map((b) => ({ playerId: b.playerId, state: this.sim.getPlayerState(b.slot) })),
    ];
    for (const { p, state } of states) {
      const visible = computeVisibleCells(this.maze, state.x, state.y);
      const visiblePlayers: VisiblePlayerState[] = [];
      for (const other of observable) {
        // Escaped and dead players are out of the world — never rendered.
        if (other.playerId === p.client.playerId || other.state.escaped || other.state.dead) {
          continue;
        }
        const cell = cellIndex(
          this.maze.width,
          Math.floor(other.state.x),
          Math.floor(other.state.y),
        );
        if (visible.has(cell)) {
          visiblePlayers.push({
            playerId: other.playerId,
            x: other.state.x,
            y: other.state.y,
          });
        }
      }
      const sounds: PerceivedSound[] = [];
      for (const raw of result.sounds) {
        if (raw.emitterId === p.slot) continue; // never echo your own sounds
        const heard = perceiveSound(this.maze, this.jitterSeed, raw, state.x, state.y);
        if (heard) sounds.push(heard);
      }
      // Floor items are only reported inside this client's line of sight —
      // knowing where loot lies is knowledge, and knowledge must be earned.
      const visibleItems: VisibleItemState[] = [];
      for (const fi of floorItems) {
        const cell = cellIndex(this.maze.width, Math.floor(fi.x), Math.floor(fi.y));
        if (visible.has(cell)) {
          visibleItems.push({ id: fi.id, item: fi.item, x: fi.x, y: fi.y });
        }
      }
      const snapshot: SnapshotMsg = {
        type: "snapshot",
        tick: result.tick,
        ackSeq: p.ackSeq,
        you: { x: state.x, y: state.y, escaped: state.escaped, hp: state.hp, dead: state.dead },
        inventory: state.inventory,
        visibleItems,
        visiblePlayers,
        visibleCells: [...visible],
        sounds,
      };
      p.client.send(snapshot);
    }

    if (this.checkHumansResolved()) return;
    if (result.tick >= this.endTick) this.end("timeUp");
  }

  /**
   * Ends the match if every still-connected HUMAN player is resolved —
   * escaped OR dead. Bots are deliberately not consulted: they never keep a
   * match alive. (Dead humans don't block the end either; they only spectate
   * their frozen view until everyone else is done.)
   */
  private checkHumansResolved(): boolean {
    if (this.interval === null || this.players.size === 0) return false;
    for (const p of this.players.values()) {
      const state = this.sim.getPlayerState(p.slot);
      if (!state.escaped && !state.dead) return false;
    }
    this.end("allEscaped");
    return true;
  }

  private end(reason: "allEscaped" | "timeUp"): void {
    if (this.interval) clearInterval(this.interval);
    this.interval = null;
    this.releasePlayers();
    this.lobby.broadcast({
      type: "matchEnd",
      reason,
      escaped: [...this.escapedIds],
      eliminated: [...this.eliminatedIds],
    });
    this.lobby.match = null;
    // Back to the pre-match lobby screen.
    this.lobby.broadcastState();
  }

  /**
   * Releases every remaining player's simulation entity. bitECS keeps a
   * module-global entity-id pool shared across all worlds, so any entity not
   * removed here leaks its id forever — after enough matches the server would
   * crash with "max entities reached".
   */
  private releasePlayers(): void {
    for (const p of this.players.values()) this.sim.removePlayer(p.slot);
    this.players.clear();
    for (const b of this.bots) this.sim.removePlayer(b.slot);
    this.bots.length = 0;
  }
}
