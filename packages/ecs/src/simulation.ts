import {
  MAX_PLAYERS,
  MOVE_SPEED,
  SOUND_INTENSITY,
  TICK_DT,
  type Maze,
  type RawSoundEvent,
  type SoundKind,
} from "@labyrinth/common";
import { Types, addComponent, addEntity, createWorld, defineComponent, removeEntity } from "bitecs";
import { moveCircle } from "./movement.js";
import { FOOTSTEP_INTERVAL_S } from "./tuning.js";

/** Per-tick movement intent for one player (server clamps before applying). */
export interface PlayerInput {
  moveX: number;
  moveY: number;
  sprint: boolean;
  sneak: boolean;
}

/** Authoritative state of one player slot. */
export interface PlayerState {
  x: number;
  y: number;
  escaped: boolean;
}

/** Result of advancing the simulation by one tick. */
export interface TickResult {
  tick: number;
  /** Exact sounds emitted this tick (server-side truth; never sent raw to clients). */
  sounds: RawSoundEvent[];
  /** Player slots that reached the exit this tick. */
  escapes: number[];
}

/** Deterministic fixed-tick simulation (see docs/CONTRACTS.md). */
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

// bitECS component stores. Data is indexed by entity id (globally unique
// across worlds in bitECS 0.3), so multiple concurrent simulations coexist.
const Position = defineComponent({ x: Types.f64, y: Types.f64 });
const InputC = defineComponent({ moveX: Types.f64, moveY: Types.f64, sprint: Types.ui8, sneak: Types.ui8 });
const Runner = defineComponent({ escaped: Types.ui8, stepAcc: Types.f64 });

type MoveMode = keyof typeof MOVE_SPEED;

const FOOTSTEP_KIND: Record<MoveMode, SoundKind> = {
  sneak: "footstep-sneak",
  walk: "footstep-walk",
  sprint: "footstep-sprint",
};

/** Clamp an input axis to [-1, 1]; non-finite values become 0. */
function sanitizeAxis(v: number): number {
  if (!Number.isFinite(v)) return 0;
  return v < -1 ? -1 : v > 1 ? 1 : v;
}

/**
 * Create a deterministic Escape-mode simulation over `maze`. No wall-clock
 * time and no unseeded randomness anywhere: identical inputs produce
 * identical TickResults and player states, on server, client, and bots.
 * Players are iterated in slot order every tick, so join order never makes
 * two instances diverge. Sound emitterId is the player slot (stable across
 * simulation instances, unlike raw entity ids). `seed` is carried for future
 * seeded mechanics; the slice simulation itself is randomness-free.
 */
export function createSimulation(opts: { maze: Maze; seed: string }): Simulation {
  const { maze } = opts;
  const world = createWorld();
  const slots: (number | null)[] = new Array<number | null>(MAX_PLAYERS).fill(null);
  let tick = 0;

  const eidFor = (slot: number): number => {
    const eid = slots[slot];
    if (eid === null || eid === undefined) {
      throw new Error(`@labyrinth/ecs: no player in slot ${slot}`);
    }
    return eid;
  };

  return {
    maze,
    get tick() {
      return tick;
    },

    addPlayer(): number {
      const slot = slots.indexOf(null);
      if (slot === -1) throw new Error("@labyrinth/ecs: simulation is full");
      const spawn = maze.spawns[slot];
      if (!spawn) throw new Error(`@labyrinth/ecs: maze has no spawn for slot ${slot}`);
      const eid = addEntity(world);
      addComponent(world, Position, eid);
      addComponent(world, InputC, eid);
      addComponent(world, Runner, eid);
      // Reset everything explicitly — bitECS recycles entity ids.
      Position.x[eid] = spawn.x + 0.5;
      Position.y[eid] = spawn.y + 0.5;
      InputC.moveX[eid] = 0;
      InputC.moveY[eid] = 0;
      InputC.sprint[eid] = 0;
      InputC.sneak[eid] = 0;
      Runner.escaped[eid] = 0;
      Runner.stepAcc[eid] = 0;
      slots[slot] = eid;
      return slot;
    },

    removePlayer(slot: number): void {
      const eid = eidFor(slot);
      removeEntity(world, eid);
      slots[slot] = null;
    },

    setInput(slot: number, input: PlayerInput): void {
      const eid = eidFor(slot);
      InputC.moveX[eid] = sanitizeAxis(input.moveX);
      InputC.moveY[eid] = sanitizeAxis(input.moveY);
      InputC.sprint[eid] = input.sprint ? 1 : 0;
      InputC.sneak[eid] = input.sneak ? 1 : 0;
    },

    step(): TickResult {
      tick += 1;
      const sounds: RawSoundEvent[] = [];
      const escapes: number[] = [];

      for (let slot = 0; slot < MAX_PLAYERS; slot++) {
        const eid = slots[slot];
        if (eid === null || eid === undefined) continue;
        if (Runner.escaped[eid] === 1) continue; // escaped players stop simulating

        const mx = InputC.moveX[eid] as number;
        const my = InputC.moveY[eid] as number;
        const len = Math.sqrt(mx * mx + my * my);
        // Sneak wins over sprint: holding both means the player intends stealth.
        const mode: MoveMode =
          InputC.sneak[eid] === 1 ? "sneak" : InputC.sprint[eid] === 1 ? "sprint" : "walk";

        const x = Position.x[eid] as number;
        const y = Position.y[eid] as number;
        let nx = x;
        let ny = y;

        if (len > 0) {
          const step = MOVE_SPEED[mode] * TICK_DT;
          ({ x: nx, y: ny } = moveCircle(maze, x, y, (mx / len) * step, (my / len) * step));
          Position.x[eid] = nx;
          Position.y[eid] = ny;

          // Footsteps: distance-moved accumulator, one step per interval of
          // actual (post-collision) distance — sliding along a wall is audible.
          const moved = Math.sqrt((nx - x) * (nx - x) + (ny - y) * (ny - y));
          if (moved > 0) {
            const interval = MOVE_SPEED[mode] * FOOTSTEP_INTERVAL_S[mode];
            let acc = (Runner.stepAcc[eid] as number) + moved;
            while (acc >= interval) {
              acc -= interval;
              const kind = FOOTSTEP_KIND[mode];
              sounds.push({
                kind,
                x: nx,
                y: ny,
                intensity: SOUND_INTENSITY[kind],
                emitterId: slot,
                tick,
              });
            }
            Runner.stepAcc[eid] = acc;
          }
        }

        if (Math.floor(nx) === maze.exit.x && Math.floor(ny) === maze.exit.y) {
          Runner.escaped[eid] = 1;
          escapes.push(slot);
        }
      }

      return { tick, sounds, escapes };
    },

    getPlayerState(slot: number): PlayerState {
      const eid = eidFor(slot);
      return {
        x: Position.x[eid] as number,
        y: Position.y[eid] as number,
        escaped: Runner.escaped[eid] === 1,
      };
    },
  };
}
