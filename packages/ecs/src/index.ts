export {
  createSimulation,
  type PlayerAction,
  type PlayerInput,
  type PlayerState,
  type Simulation,
  type TickResult,
} from "./simulation.js";
// ItemDef is the ecs-side structural contract for INJECTED item definitions
// (@echowake/content's defs satisfy it; the ecs never imports that package).
export { DEFAULT_FISTS, type ItemDef } from "./items.js";
export { computeVisibleCells } from "./vision.js";
export { perceiveSound } from "./sound.js";
