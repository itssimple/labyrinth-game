import {
  MAX_PLAYERS,
  WALL_E,
  WALL_N,
  WALL_S,
  WALL_W,
  cellIndex,
  type Cell,
  type GridPos,
} from "@labyrinth/common";
import type { Rng } from "./rand.js";

/**
 * Pick MAX_PLAYERS (16) spawn cells spread apart via greedy farthest-point
 * sampling: the first spawn is rng-picked, each subsequent spawn is the cell
 * maximizing its minimum squared Euclidean distance to all chosen spawns
 * (lowest cell index wins ties, so the result is fully deterministic).
 */
export function pickSpawns(width: number, height: number, rng: Rng): GridPos[] {
  const cellCount = width * height;
  const first = rng.int(0, cellCount);
  const spawns: GridPos[] = [{ x: first % width, y: Math.floor(first / width) }];
  /** minDistSq[i] = squared distance from cell i to its nearest chosen spawn. */
  const minDistSq = new Float64Array(cellCount);
  const taken = new Uint8Array(cellCount);
  taken[first] = 1;
  for (let i = 0; i < cellCount; i++) {
    const dx = (i % width) - (spawns[0] as GridPos).x;
    const dy = Math.floor(i / width) - (spawns[0] as GridPos).y;
    minDistSq[i] = dx * dx + dy * dy;
  }

  while (spawns.length < MAX_PLAYERS) {
    let bestIndex = -1;
    let bestDist = -1;
    for (let i = 0; i < cellCount; i++) {
      if (taken[i]) continue;
      const d = minDistSq[i] as number;
      if (d > bestDist) {
        bestDist = d;
        bestIndex = i;
      }
    }
    const spawn = { x: bestIndex % width, y: Math.floor(bestIndex / width) };
    spawns.push(spawn);
    taken[bestIndex] = 1;
    for (let i = 0; i < cellCount; i++) {
      const dx = (i % width) - spawn.x;
      const dy = Math.floor(i / width) - spawn.y;
      const d = dx * dx + dy * dy;
      if (d < (minDistSq[i] as number)) minDistSq[i] = d;
    }
  }
  return spawns;
}

/**
 * BFS distances (in steps through open passages, honoring walls) from a start
 * cell. Unreachable cells get -1 — a correctly generated maze has none.
 */
export function bfsDistances(
  cells: readonly Cell[],
  width: number,
  height: number,
  startX: number,
  startY: number,
): Int32Array {
  const dist = new Int32Array(width * height).fill(-1);
  const queue: number[] = [cellIndex(width, startX, startY)];
  dist[queue[0] as number] = 0;
  let head = 0;
  while (head < queue.length) {
    const index = queue[head++] as number;
    const x = index % width;
    const y = Math.floor(index / width);
    const walls = (cells[index] as Cell).walls;
    const d = dist[index] as number;
    const tryStep = (blocked: number, nx: number, ny: number): void => {
      if (blocked) return;
      const ni = cellIndex(width, nx, ny);
      if (dist[ni] === -1) {
        dist[ni] = d + 1;
        queue.push(ni);
      }
    };
    tryStep(walls & WALL_N, x, y - 1);
    tryStep(walls & WALL_E, x + 1, y);
    tryStep(walls & WALL_S, x, y + 1);
    tryStep(walls & WALL_W, x - 1, y);
  }
  return dist;
}

/**
 * Pick the exit: the BFS-farthest cell from the spawn centroid (walls
 * honored), excluding spawn cells themselves. Lowest cell index wins ties.
 */
export function pickExit(
  cells: readonly Cell[],
  width: number,
  height: number,
  spawns: readonly GridPos[],
): GridPos {
  let sumX = 0;
  let sumY = 0;
  for (const s of spawns) {
    sumX += s.x;
    sumY += s.y;
  }
  const cx = Math.min(width - 1, Math.max(0, Math.round(sumX / spawns.length)));
  const cy = Math.min(height - 1, Math.max(0, Math.round(sumY / spawns.length)));
  const dist = bfsDistances(cells, width, height, cx, cy);

  const spawnSet = new Set(spawns.map((s) => cellIndex(width, s.x, s.y)));
  let bestIndex = -1;
  let bestDist = -1;
  for (let i = 0; i < dist.length; i++) {
    if (spawnSet.has(i)) continue;
    const d = dist[i] as number;
    if (d > bestDist) {
      bestDist = d;
      bestIndex = i;
    }
  }
  return { x: bestIndex % width, y: Math.floor(bestIndex / width) };
}
