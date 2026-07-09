import {
  MAZE_DIMENSIONS,
  Material,
  WALL_E,
  WALL_N,
  WALL_S,
  WALL_W,
  type Cell,
  type Maze,
  type MazeGenOptions,
} from "@labyrinth/common";
// TODO(integration): rand.js re-exports a private fallback until
// @labyrinth/math is implemented — see src/rand.ts.
import { createRng, hashString } from "./rand.js";
import { carveLoops, carvePerfectMaze } from "./carve.js";
import { assignMaterials } from "./materials.js";
import { pickExit, pickSpawns } from "./place.js";

const ALL_WALLS = WALL_N | WALL_E | WALL_S | WALL_W;

/** Sub-seed for one generation phase: seed + purpose, mixed via hashString. */
function subSeed(base: string, purpose: string): string {
  return `${hashString(`${base}:${purpose}`)}`;
}

/**
 * Deterministically generate a labyrinth from options: deep-equal output for
 * equal options, forever.
 *
 * - Perfect maze via recursive backtracker, then extra loops carved:
 *   roughly `(1 - difficulty) * 8%` of interior walls removed (default
 *   difficulty 0.5).
 * - Wall consistency: neighboring cells always agree on shared walls; border
 *   walls are always present.
 * - Materials assigned per region (Stone default, patches of others).
 * - 16 spawns spread apart (greedy farthest-point) and an exit far from the
 *   spawn centroid (BFS-farthest cell).
 */
export function generateMaze(options: MazeGenOptions): Maze {
  const { width, height } = MAZE_DIMENSIONS[options.size];
  const difficulty = Math.min(1, Math.max(0, options.difficulty ?? 0.5));
  // Reserved modifiers must influence generation deterministically.
  const modifiers = options.modifiers ?? [];
  const base = modifiers.length > 0 ? `${options.seed}#${modifiers.join(",")}` : options.seed;

  const cells: Cell[] = [];
  for (let i = 0; i < width * height; i++) {
    cells.push({ walls: ALL_WALLS, floor: Material.Stone, wallMaterial: Material.Stone });
  }

  carvePerfectMaze(cells, width, height, createRng(subSeed(base, "carve")));
  carveLoops(cells, width, height, difficulty, createRng(subSeed(base, "loops")));
  assignMaterials(cells, width, height, createRng(subSeed(base, "materials")));
  const spawns = pickSpawns(width, height, createRng(subSeed(base, "spawns")));
  const exit = pickExit(cells, width, height, spawns);

  return { seed: options.seed, width, height, cells, spawns, exit };
}
