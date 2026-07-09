import { Material, cellIndex, type Cell, type MaterialId } from "@labyrinth/common";
import type { Rng } from "./rand.js";

/** Side length (in cells) of a material region. */
const REGION_SIZE = 8;

/** Non-default materials that may appear as patches. */
const PATCH_MATERIALS: readonly MaterialId[] = [
  Material.Wood,
  Material.Metal,
  Material.Grass,
  Material.Sand,
  Material.Water,
];

/** Stone by default; ~40% of regions get a patch material. */
function rollMaterial(rng: Rng): MaterialId {
  return rng.next() < 0.6 ? Material.Stone : rng.pick(PATCH_MATERIALS);
}

/**
 * Assign `floor` and `wallMaterial` per rectangular region, deterministically
 * from `rng`. Regions are visited row-major so the same rng sequence always
 * paints the same maze.
 */
export function assignMaterials(cells: Cell[], width: number, height: number, rng: Rng): void {
  const regionsX = Math.ceil(width / REGION_SIZE);
  const regionsY = Math.ceil(height / REGION_SIZE);
  for (let ry = 0; ry < regionsY; ry++) {
    for (let rx = 0; rx < regionsX; rx++) {
      const wallMaterial = rollMaterial(rng);
      const floor = rollMaterial(rng);
      const xEnd = Math.min((rx + 1) * REGION_SIZE, width);
      const yEnd = Math.min((ry + 1) * REGION_SIZE, height);
      for (let y = ry * REGION_SIZE; y < yEnd; y++) {
        for (let x = rx * REGION_SIZE; x < xEnd; x++) {
          const cell = cells[cellIndex(width, x, y)] as Cell;
          cell.wallMaterial = wallMaterial;
          cell.floor = floor;
        }
      }
    }
  }
}
