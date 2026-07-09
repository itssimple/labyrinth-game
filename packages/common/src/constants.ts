/** Simulation tick rate. All gameplay advances in fixed steps of 1/TICK_RATE seconds. */
export const TICK_RATE = 20;
export const TICK_DT = 1 / TICK_RATE;

/** Bumped on every breaking protocol change; server rejects mismatched clients. */
export const PROTOCOL_VERSION = 1;

/** Movement speeds in tiles per second. */
export const MOVE_SPEED = {
  sneak: 1.5,
  walk: 3.0,
  sprint: 5.0,
} as const;

/** Radius (in tiles) of line-of-sight vision. */
export const VISION_RADIUS = 8;

/** Escape mode: match duration in seconds before the labyrinth "collapses". */
export const MATCH_DURATION_S = 300;

/** Player collision radius in tiles. */
export const PLAYER_RADIUS = 0.35;

export type MazeSize = "tiny" | "small" | "medium" | "large" | "huge";

/** Maze dimensions per size. Odd numbers suit grid maze algorithms. */
export const MAZE_DIMENSIONS: Record<MazeSize, { width: number; height: number }> = {
  tiny: { width: 15, height: 15 },
  small: { width: 25, height: 25 },
  medium: { width: 35, height: 35 },
  large: { width: 51, height: 51 },
  huge: { width: 75, height: 75 },
};

export const MAX_PLAYERS = 16;

/**
 * Player cap per maze size, keeping enough cells per player for stealth and
 * exploration to matter (tiny is ~14 cells/player at 16 players — chaos).
 * The server rejects startMatch when the lobby exceeds the chosen size's cap.
 */
export const MAX_PLAYERS_PER_SIZE: Record<MazeSize, number> = {
  tiny: 2,
  small: 4,
  medium: 8,
  large: 12,
  huge: 16,
};

/** Smallest size that fits a lobby of `playerCount`, or null if none does. */
export function minSizeForPlayers(playerCount: number): MazeSize | null {
  const order: MazeSize[] = ["tiny", "small", "medium", "large", "huge"];
  for (const size of order) {
    if (playerCount <= (MAX_PLAYERS_PER_SIZE[size] ?? 0)) return size;
  }
  return null;
}
