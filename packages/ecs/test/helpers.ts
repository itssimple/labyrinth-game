import {
  Material,
  WALL_E,
  WALL_N,
  WALL_S,
  WALL_W,
  cellIndex,
  inBounds,
  type Cell,
  type GridPos,
  type Maze,
} from "@echowake/common";

/**
 * Hand-crafted open-field maze: border walls only, Stone everywhere.
 * Add internal walls with addWall().
 */
export function makeOpenMaze(
  width: number,
  height: number,
  opts?: { spawns?: GridPos[]; exit?: GridPos },
): Maze {
  const cells: Cell[] = [];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let walls = 0;
      if (y === 0) walls |= WALL_N;
      if (y === height - 1) walls |= WALL_S;
      if (x === 0) walls |= WALL_W;
      if (x === width - 1) walls |= WALL_E;
      cells.push({ walls, floor: Material.Stone, wallMaterial: Material.Stone });
    }
  }
  return {
    seed: "test",
    width,
    height,
    cells,
    spawns: opts?.spawns ?? [{ x: 0, y: 0 }],
    exit: opts?.exit ?? { x: width - 1, y: height - 1 },
  };
}

const OPPOSITE: Record<number, number> = {
  [WALL_N]: WALL_S,
  [WALL_S]: WALL_N,
  [WALL_E]: WALL_W,
  [WALL_W]: WALL_E,
};

const DELTA: Record<number, [number, number]> = {
  [WALL_N]: [0, -1],
  [WALL_S]: [0, 1],
  [WALL_E]: [1, 0],
  [WALL_W]: [-1, 0],
};

/** Add a wall to cell (x, y) and the matching wall on its neighbor (consistency). */
export function addWall(maze: Maze, x: number, y: number, flag: number): void {
  const cell = maze.cells[cellIndex(maze.width, x, y)];
  if (!cell) throw new Error("addWall: out of bounds");
  cell.walls |= flag;
  const [dx, dy] = DELTA[flag] ?? [0, 0];
  const nx = x + dx;
  const ny = y + dy;
  if (inBounds(maze, nx, ny)) {
    const neighbor = maze.cells[cellIndex(maze.width, nx, ny)];
    if (neighbor) neighbor.walls |= OPPOSITE[flag] ?? 0;
  }
}
