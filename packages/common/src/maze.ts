import type { MazeSize } from "./constants.js";

/** Wall bitmask flags for a cell. A set bit means the wall exists. */
export const WALL_N = 1;
export const WALL_E = 2;
export const WALL_S = 4;
export const WALL_W = 8;

export const Material = {
  Stone: 0,
  Wood: 1,
  Metal: 2,
  Water: 3,
  Grass: 4,
  Sand: 5,
} as const;
export type MaterialId = (typeof Material)[keyof typeof Material];

export interface GridPos {
  x: number;
  y: number;
}

export interface Cell {
  /** Bitmask of WALL_N | WALL_E | WALL_S | WALL_W. */
  walls: number;
  /** Floor material — drives footstep sound emission. */
  floor: MaterialId;
  /** Wall material — drives sound attenuation through this cell's walls. */
  wallMaterial: MaterialId;
}

/**
 * A generated labyrinth. Cells are stored row-major (index = y * width + x).
 * Must be fully reproducible from MazeGenOptions alone.
 */
export interface Maze {
  seed: string;
  width: number;
  height: number;
  cells: Cell[];
  /** Spawn points, spread apart; one per player slot in join order. */
  spawns: GridPos[];
  /** The escape exit (Escape game mode objective). */
  exit: GridPos;
}

export interface MazeGenOptions {
  seed: string;
  size: MazeSize;
  /** 0..1 — higher difficulty carves fewer loops (more dead ends). */
  difficulty?: number;
  /** Reserved for future modifiers; must affect generation deterministically. */
  modifiers?: string[];
}

export function cellIndex(width: number, x: number, y: number): number {
  return y * width + x;
}

export function inBounds(maze: Pick<Maze, "width" | "height">, x: number, y: number): boolean {
  return x >= 0 && y >= 0 && x < maze.width && y < maze.height;
}
