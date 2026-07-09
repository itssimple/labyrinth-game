import type { Maze, PerceivedSound } from "@echowake/common";
import { FogMemory } from "./fog";
import { Interpolator, RemotePlayers } from "./interp";
import { ItemMemory } from "./items";

/**
 * Plain-TS state for one running match, owned by GameSession and read by the
 * Pixi renderer every frame. React never touches this object.
 */
export interface MatchView {
  readonly maze: Maze;
  readonly endTick: number;
  readonly spawnIndex: number;
  readonly fog: FogMemory;
  /** Floor-item memory: live items + remembered ghosts ("knowledge ages"). */
  readonly items: ItemMemory;
  readonly you: Interpolator;
  readonly others: RemotePlayers;
  /** Perceived sounds not yet turned into ripples (drained by the renderer). */
  soundQueue: PerceivedSound[];
  /** Set when fog memory changed; renderer clears it after redrawing. */
  fogDirty: boolean;
  /** Tick of the most recent snapshot. */
  latestTick: number;
  escaped: boolean;
  /**
   * Your current facing (unit vector) as last derived from local input —
   * aim source if any, else movement direction. Presentation only: it drives
   * the little direction indicator on your sprite; the server keeps its own
   * authoritative facing for the view cone.
   */
  localFacing: { x: number; y: number } | null;
}

/** Builds the match view for a fresh match, seeding "you" at your spawn. */
export function createMatchView(maze: Maze, endTick: number, spawnIndex: number): MatchView {
  const you = new Interpolator();
  const spawn = maze.spawns[spawnIndex];
  if (spawn !== undefined) you.push(spawn.x + 0.5, spawn.y + 0.5, 0);
  return {
    maze,
    endTick,
    spawnIndex,
    fog: new FogMemory(maze.width * maze.height),
    items: new ItemMemory(maze.width),
    you,
    others: new RemotePlayers(),
    soundQueue: [],
    fogDirty: true,
    latestTick: 0,
    escaped: false,
    localFacing: null,
  };
}
