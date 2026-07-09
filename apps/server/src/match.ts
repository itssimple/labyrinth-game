import { randomUUID } from "node:crypto";
import {
  MATCH_DURATION_S_PER_SIZE,
  TICK_RATE,
  cellIndex,
  type Maze,
  type MazeGenOptions,
  type PerceivedSound,
} from "@labyrinth/common";
import {
  computeVisibleCells,
  createSimulation,
  perceiveSound,
  type Simulation,
} from "@labyrinth/ecs";
import { generateMaze } from "@labyrinth/mazegen";
import { clamp } from "@labyrinth/math";
import type { InputMsg, SnapshotMsg, VisiblePlayerState } from "@labyrinth/protocol";
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
}

/**
 * One running Escape-mode match for a lobby. The interval loop here is
 * transport pacing only — all game rules live in @labyrinth/ecs. Snapshots
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
  private readonly escapedIds: string[] = [];
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
    this.sim = createSimulation({ maze: this.maze, seed: this.seed });
    for (const client of lobby.clients) {
      const slot = this.sim.addPlayer();
      this.players.set(client.playerId, {
        client,
        slot,
        pending: null,
        lastSeq: -1,
        ackSeq: 0,
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

  /** Removes a disconnected/leaving player from the simulation and end-checks. */
  removePlayer(client: Client): void {
    const p = this.players.get(client.playerId);
    if (!p) return;
    this.players.delete(client.playerId);
    this.sim.removePlayer(p.slot);
    if (this.players.size === 0) {
      this.abort();
      return;
    }
    this.checkAllEscaped();
  }

  /** Stops the tick loop without broadcasting (e.g. lobby emptied out). */
  abort(): void {
    if (this.interval) clearInterval(this.interval);
    this.interval = null;
    this.releasePlayers();
    if (this.lobby.match === this) this.lobby.match = null;
  }

  private tick(): void {
    // Apply the latest validated input per player; absent = keep previous.
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
    }

    const result = this.sim.step();
    for (const slot of result.escapes) {
      for (const p of this.players.values()) {
        if (p.slot === slot) this.escapedIds.push(p.client.playerId);
      }
    }

    // Snapshot each player's world through their own vision + hearing only.
    const states = [...this.players.values()].map((p) => ({
      p,
      state: this.sim.getPlayerState(p.slot),
    }));
    for (const { p, state } of states) {
      const visible = computeVisibleCells(this.maze, state.x, state.y);
      const visiblePlayers: VisiblePlayerState[] = [];
      for (const other of states) {
        if (other.p === p || other.state.escaped) continue;
        const cell = cellIndex(
          this.maze.width,
          Math.floor(other.state.x),
          Math.floor(other.state.y),
        );
        if (visible.has(cell)) {
          visiblePlayers.push({
            playerId: other.p.client.playerId,
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
      const snapshot: SnapshotMsg = {
        type: "snapshot",
        tick: result.tick,
        ackSeq: p.ackSeq,
        you: { x: state.x, y: state.y, escaped: state.escaped },
        visiblePlayers,
        visibleCells: [...visible],
        sounds,
      };
      p.client.send(snapshot);
    }

    if (this.checkAllEscaped()) return;
    if (result.tick >= this.endTick) this.end("timeUp");
  }

  /** Ends the match if every still-connected player has escaped. */
  private checkAllEscaped(): boolean {
    if (this.interval === null || this.players.size === 0) return false;
    for (const p of this.players.values()) {
      if (!this.sim.getPlayerState(p.slot).escaped) return false;
    }
    this.end("allEscaped");
    return true;
  }

  private end(reason: "allEscaped" | "timeUp"): void {
    if (this.interval) clearInterval(this.interval);
    this.interval = null;
    this.releasePlayers();
    this.lobby.broadcast({ type: "matchEnd", reason, escaped: [...this.escapedIds] });
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
  }
}
