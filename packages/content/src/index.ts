// Data-driven item definitions (see docs/CONTRACTS.md "Items, combat & auras").
// The ecs NEVER imports this package — definitions are injected into
// createSimulation so mods can replace or extend them without touching game
// code (moddability pillar). Definitions are validated at module load so a
// malformed mod fails loudly instead of corrupting a match.
export {
  FISTS,
  ITEM_DEFS,
  itemDef,
  validateItemDef,
  validateItemDefs,
  type ItemDef,
  type ItemKind,
} from "./items.js";
