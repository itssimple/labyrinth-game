import {
  cellIndex,
  inBounds,
  type Maze,
  type PerceivedSound,
  type RawSoundEvent,
  type SoundConfidence,
} from "@labyrinth/common";
import { clamp, createRng } from "@labyrinth/math";
import {
  SOUND_FALLOFF_PER_TILE,
  SOUND_JITTER_TILES,
  SOUND_MIN_AUDIBLE,
  WALL_ATTENUATION,
} from "./tuning.js";
import { wallBetween } from "./walls.js";

/**
 * Cheapest propagation cost (intensity lost) from cell (sx, sy) to cell
 * (tx, ty): BFS-style shortest path over the cell grid where stepping to a
 * 4-neighbor costs SOUND_FALLOFF_PER_TILE, plus the from-cell's wall-material
 * attenuation when the step crosses a wall (sound leaks through walls, it is
 * just muffled). Implemented as Dijkstra with a binary heap and a fixed
 * neighbor order — fully deterministic. Returns null if every path costs
 * more than `budget` (inaudible), pruning the search early.
 */
function propagationCost(
  maze: Maze,
  sx: number,
  sy: number,
  tx: number,
  ty: number,
  budget: number,
): number | null {
  const w = maze.width;
  const start = cellIndex(w, sx, sy);
  const target = cellIndex(w, tx, ty);
  if (start === target) return 0;

  const dist = new Float64Array(w * maze.height).fill(Infinity);
  dist[start] = 0;

  // Binary min-heap with lazy deletion (stale entries skipped on pop).
  const heapCost: number[] = [0];
  const heapIdx: number[] = [start];
  const push = (c: number, i: number): void => {
    heapCost.push(c);
    heapIdx.push(i);
    let j = heapCost.length - 1;
    while (j > 0) {
      const p = (j - 1) >> 1;
      if ((heapCost[p] as number) <= (heapCost[j] as number)) break;
      const tc = heapCost[p] as number;
      heapCost[p] = heapCost[j] as number;
      heapCost[j] = tc;
      const ti = heapIdx[p] as number;
      heapIdx[p] = heapIdx[j] as number;
      heapIdx[j] = ti;
      j = p;
    }
  };
  const pop = (): { c: number; i: number } | null => {
    const n = heapCost.length;
    if (n === 0) return null;
    const c = heapCost[0] as number;
    const i = heapIdx[0] as number;
    const lc = heapCost.pop() as number;
    const li = heapIdx.pop() as number;
    if (n > 1) {
      heapCost[0] = lc;
      heapIdx[0] = li;
      let j = 0;
      for (;;) {
        const l = 2 * j + 1;
        const r = l + 1;
        let m = j;
        if (l < heapCost.length && (heapCost[l] as number) < (heapCost[m] as number)) m = l;
        if (r < heapCost.length && (heapCost[r] as number) < (heapCost[m] as number)) m = r;
        if (m === j) break;
        const tc = heapCost[m] as number;
        heapCost[m] = heapCost[j] as number;
        heapCost[j] = tc;
        const ti = heapIdx[m] as number;
        heapIdx[m] = heapIdx[j] as number;
        heapIdx[j] = ti;
        j = m;
      }
    }
    return { c, i };
  };

  const DX = [0, 1, 0, -1];
  const DY = [-1, 0, 1, 0];

  for (;;) {
    const top = pop();
    if (top === null) return null;
    const { c, i } = top;
    if (c > (dist[i] as number)) continue; // stale heap entry
    if (i === target) return c;
    const x = i % w;
    const y = (i - x) / w;
    const material = maze.cells[i]?.wallMaterial ?? 0;
    for (let d = 0; d < 4; d++) {
      const nx = x + (DX[d] as number);
      const ny = y + (DY[d] as number);
      if (!inBounds(maze, nx, ny)) continue;
      let edge = SOUND_FALLOFF_PER_TILE;
      if (wallBetween(maze, x, y, nx, ny)) edge += WALL_ATTENUATION[material] ?? 0.5;
      const nc = c + edge;
      if (nc > budget) continue;
      const ni = cellIndex(w, nx, ny);
      if (nc < (dist[ni] as number)) {
        dist[ni] = nc;
        push(nc, ni);
      }
    }
  }
}

/**
 * How a listener at (listenerX, listenerY) perceives `sound`, or null if
 * inaudible. Distance is BFS path distance through the maze honoring walls
 * (never plain Euclidean through walls); each wall crossed attenuates by its
 * material. Effective intensity maps to a confidence band:
 * >= 0.6 → "high" (exact position), >= 0.25 → "medium" (~1.5 tile jitter),
 * > SOUND_MIN_AUDIBLE → "low" (~4 tile jitter), otherwise null.
 * Jitter is deterministic, seeded from (matchSeed, sound.tick,
 * sound.emitterId) — every listener agrees on the (jittered) origin, and
 * replays reproduce it exactly. Note: emitterId of simulation footsteps is
 * the player slot, which is stable across sim instances.
 */
export function perceiveSound(
  maze: Maze,
  matchSeed: string,
  sound: RawSoundEvent,
  listenerX: number,
  listenerY: number,
): PerceivedSound | null {
  const sx = Math.floor(sound.x);
  const sy = Math.floor(sound.y);
  const lx = Math.floor(listenerX);
  const ly = Math.floor(listenerY);
  if (!inBounds(maze, sx, sy) || !inBounds(maze, lx, ly)) return null;

  const budget = sound.intensity - SOUND_MIN_AUDIBLE;
  if (budget <= 0) return null;
  const cost = propagationCost(maze, sx, sy, lx, ly, budget);
  if (cost === null) return null;
  const intensity = sound.intensity - cost;
  if (intensity <= SOUND_MIN_AUDIBLE) return null;

  let confidence: SoundConfidence;
  let x = sound.x;
  let y = sound.y;
  if (intensity >= 0.6) {
    confidence = "high";
  } else {
    confidence = intensity >= 0.25 ? "medium" : "low";
    const radius =
      confidence === "medium" ? SOUND_JITTER_TILES.medium : SOUND_JITTER_TILES.low;
    const rng = createRng(`${matchSeed}:${sound.tick}:${sound.emitterId}`);
    x = clamp(x + (rng.next() * 2 - 1) * radius, 0, maze.width);
    y = clamp(y + (rng.next() * 2 - 1) * radius, 0, maze.height);
  }

  return { kind: sound.kind, x, y, confidence, intensity, tick: sound.tick };
}
