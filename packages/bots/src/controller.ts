import {
  MOVE_SPEED,
  TICK_DT,
  WALL_E,
  WALL_N,
  WALL_S,
  WALL_W,
  cellIndex,
  type Maze,
  type PerceivedSound,
} from "@echowake/common";
import type { PlayerInput } from "@echowake/ecs";
import { createRng, type Rng } from "@echowake/math";

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

/**
 * Deadzone (in tiles) around a target cell center's axis before the bot stops
 * correcting on that axis. Sized to avoid oscillation: the largest per-axis
 * step is walk speed * TICK_DT = 0.15 straight, or 0.15/√2 ≈ 0.106 when both
 * axes are active (input is normalized). Perpendicular centering always runs
 * diagonally (the path axis stays active), so a single correction step can
 * overshoot the center by at most ~0.106 — landing back inside the deadzone
 * instead of triggering the opposite input next tick. Kept below the doorway
 * clearance (0.5 - PLAYER_RADIUS = 0.15) so a "centered" bot fits through
 * openings.
 */
const CENTER_DEADZONE = MOVE_SPEED.walk * TICK_DT * 0.75;

/** Neighbor deltas in fixed N/E/S/W order with the wall flag blocking each. */
const NEIGHBOR_STEPS: readonly { dx: number; dy: number; wall: number }[] = [
  { dx: 0, dy: -1, wall: WALL_N },
  { dx: 1, dy: 0, wall: WALL_E },
  { dx: 0, dy: 1, wall: WALL_S },
  { dx: -1, dy: 0, wall: WALL_W },
];

function idleInput(): PlayerInput {
  return { moveX: 0, moveY: 0, sprint: false, sneak: false };
}

/**
 * BFS over the maze's cell graph (walls block edges) from `from` to the
 * nearest cell satisfying `isTarget`. Among equally-near targets the choice
 * is a seeded-RNG tie-break. Returns the path as cell indices from the first
 * step up to and including the target (excluding `from`), an empty array when
 * `from` itself is a target, or null when no target is reachable.
 */
function findPath(
  maze: Maze,
  from: number,
  isTarget: (idx: number) => boolean,
  rng: Rng,
): number[] | null {
  const { width, height } = maze;
  const total = width * height;
  const parent = new Int32Array(total).fill(-1);
  const dist = new Int32Array(total).fill(-1);
  const queue: number[] = [from];
  dist[from] = 0;

  let targetDist = -1;
  const candidates: number[] = [];

  for (let head = 0; head < queue.length; head++) {
    const idx = queue[head] as number;
    const d = dist[idx] as number;
    if (targetDist !== -1 && d > targetDist) break; // all nearest targets found
    if (isTarget(idx)) {
      targetDist = d;
      candidates.push(idx);
      continue;
    }
    const x = idx % width;
    const y = (idx - x) / width;
    const walls = maze.cells[idx]?.walls ?? 0;
    for (const step of NEIGHBOR_STEPS) {
      if ((walls & step.wall) !== 0) continue;
      const nx = x + step.dx;
      const ny = y + step.dy;
      if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
      const nIdx = ny * width + nx;
      if (dist[nIdx] !== -1) continue;
      dist[nIdx] = d + 1;
      parent[nIdx] = idx;
      queue.push(nIdx);
    }
  }

  if (candidates.length === 0) return null;
  const target = rng.pick(candidates);
  const path: number[] = [];
  for (let idx = target; idx !== from; idx = parent[idx] as number) {
    path.push(idx);
  }
  return path.reverse();
}

/** True when `a` and `b` are 4-adjacent cells with no wall between them. */
function openAdjacent(maze: Maze, a: number, b: number): boolean {
  const { width } = maze;
  const ax = a % width;
  const ay = (a - ax) / width;
  const bx = b % width;
  const by = (b - bx) / width;
  const walls = maze.cells[a]?.walls ?? 0xf;
  for (const step of NEIGHBOR_STEPS) {
    if (bx - ax === step.dx && by - ay === step.dy) {
      return (walls & step.wall) === 0;
    }
  }
  return false;
}

/**
 * Deterministic v1 bot: explores toward the nearest never-seen cell (BFS over
 * the maze topology, which every client legitimately knows from the broadcast
 * seed), and heads for the exit once the exit cell has appeared in its
 * accumulated vision memory. Acts only through PlayerInput — never touches
 * the simulation. All tie-breaks come from the seeded RNG, so same seed +
 * observation sequence => identical inputs.
 *
 * `seed`: derive per-bot determinism from `${matchSeed}:bot:${slot}`.
 */
export function createBotController(opts: {
  maze: Maze;
  seed: string;
  slot: number;
}): BotController {
  const { maze } = opts;
  const rng = createRng(`${opts.seed}:bot:${opts.slot}`);
  const exitIdx = cellIndex(maze.width, maze.exit.x, maze.exit.y);

  /** Every cell ever seen (fog-of-war memory; only ever grows). */
  const seen = new Set<number>();
  /** Remaining planned route: cell indices ending at the current target. */
  let path: number[] = [];

  const replan = (from: number): number[] => {
    if (seen.has(exitIdx)) {
      return findPath(maze, from, (idx) => idx === exitIdx, rng) ?? [];
    }
    // Explore: nearest cell never seen. In a connected maze this only comes
    // up empty once everything (including the exit) has been seen.
    return findPath(maze, from, (idx) => !seen.has(idx), rng) ?? [];
  };

  return {
    next(obs: BotObservation): PlayerInput {
      for (const idx of obs.visibleCells) seen.add(idx);
      if (obs.escaped) return idleInput();

      const cur = cellIndex(maze.width, Math.floor(obs.x), Math.floor(obs.y));

      // Consume any path steps we have already reached (wall-sliding can skip
      // the head cell diagonally, so scan instead of only checking path[0]).
      const at = path.indexOf(cur);
      if (at !== -1) path.splice(0, at + 1);

      // Re-plan when: exit just became known (retarget), path exhausted
      // (target reached), or the next step no longer follows from where we
      // actually are (collision pushed us off-route).
      const target = path.length > 0 ? (path[path.length - 1] as number) : -1;
      if (seen.has(exitIdx) && target !== exitIdx) {
        path = replan(cur);
      } else if (path.length === 0 || !openAdjacent(maze, cur, path[0] as number)) {
        path = replan(cur);
      }
      if (path.length === 0) return idleInput();

      // Walk toward the next path cell's center.
      const head = path[0] as number;
      const hx = head % maze.width;
      const hy = (head - hx) / maze.width;
      const dx = hx + 0.5 - obs.x;
      const dy = hy + 0.5 - obs.y;
      return {
        moveX: Math.abs(dx) > CENTER_DEADZONE ? Math.sign(dx) : 0,
        moveY: Math.abs(dy) > CENTER_DEADZONE ? Math.sign(dy) : 0,
        sprint: false, // TODO(bots v2): sprint in known-safe corridors
        sneak: false, // TODO(bots v2): sneak near heard sounds
      };
    },
  };
}
