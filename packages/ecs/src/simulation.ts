import {
  INVENTORY_SLOTS,
  MAX_HP,
  MAX_PLAYERS,
  MELEE_HALF_ARC,
  MELEE_RANGE,
  MOVE_SPEED,
  SOUND_INTENSITY,
  TICK_DT,
  TICK_RATE,
  type Maze,
  type RawSoundEvent,
  type SoundKind,
} from "@echowake/common";
import { clamp, distSq } from "@echowake/math";
import { Types, addComponent, addEntity, createWorld, defineComponent, removeEntity } from "bitecs";
import { bestWeapon, inventoryMul, planItemSpawns, type ItemDef } from "./items.js";
import { moveCircle } from "./movement.js";
import { DROP_RELOCK_RELEASE_RANGE, FOOTSTEP_INTERVAL_S, PICKUP_RANGE } from "./tuning.js";
import { hasLineOfSight } from "./vision.js";

/** Per-tick movement intent for one player (server clamps before applying). */
export interface PlayerInput {
  moveX: number;
  moveY: number;
  sprint: boolean;
  sneak: boolean;
}

/** A queued one-shot action; `slot` addresses an inventory slot for use/drop. */
export type PlayerAction = { action: "attack" | "use" | "drop"; slot?: number };

/**
 * Authoritative state of one player slot.
 *
 * Backward compatibility: a simulation created WITHOUT the `items` option
 * returns only `{ x, y, escaped }` from getPlayerState (the pre-combat shape);
 * the combat fields are present whenever `items` was provided (the server
 * always provides it).
 */
export interface PlayerState {
  x: number;
  y: number;
  escaped: boolean;
  hp: number;
  dead: boolean;
  /** Unit vector of the last nonzero move direction (defaults to +x). */
  facingX: number;
  facingY: number;
  /** Item def ids, INVENTORY_SLOTS long; null = empty slot. */
  inventory: (string | null)[];
}

/** Result of advancing the simulation by one tick. */
export interface TickResult {
  tick: number;
  /** Exact sounds emitted this tick (server-side truth; never sent raw to clients). */
  sounds: RawSoundEvent[];
  /** Player slots that reached the exit this tick. */
  escapes: number[];
  /** Connected melee hits this tick (post-mitigation damage). */
  hits: { attacker: number; target: number; damage: number }[];
  /** Player slots that died this tick (reported exactly once). */
  deaths: number[];
  /** Floor items auto-picked this tick. */
  pickups: { slot: number; item: string }[];
}

/** Deterministic fixed-tick simulation (see docs/CONTRACTS.md). */
export interface Simulation {
  readonly maze: Maze;
  readonly tick: number;
  /** Adds a player at maze.spawns[slot]; slot = join order 0..15. Returns slot. */
  addPlayer(): number;
  removePlayer(slot: number): void;
  setInput(slot: number, input: PlayerInput): void;
  /**
   * Queue an action, applied on the next step(). Multiple distinct actions
   * per tick are allowed; at most one attack is applied per tick.
   */
  act(slot: number, action: PlayerAction): void;
  /** Advances exactly one tick (TICK_DT). */
  step(): TickResult;
  getPlayerState(slot: number): PlayerState;
  /** Items currently on the floor (for snapshots). */
  listFloorItems(): { id: number; item: string; x: number; y: number }[];
}

// bitECS component stores. Data is indexed by entity id (globally unique
// across worlds in bitECS 0.3), so multiple concurrent simulations coexist.
const Position = defineComponent({ x: Types.f64, y: Types.f64 });
const InputC = defineComponent({ moveX: Types.f64, moveY: Types.f64, sprint: Types.ui8, sneak: Types.ui8 });
const Runner = defineComponent({ escaped: Types.ui8, stepAcc: Types.f64 });

type MoveMode = keyof typeof MOVE_SPEED;

const FOOTSTEP_KIND: Record<MoveMode, SoundKind> = {
  sneak: "footstep-sneak",
  walk: "footstep-walk",
  sprint: "footstep-sprint",
};

/** Clamp an input axis to [-1, 1]; non-finite values become 0. */
function sanitizeAxis(v: number): number {
  if (!Number.isFinite(v)) return 0;
  return v < -1 ? -1 : v > 1 ? 1 : v;
}

/** Per-slot combat/item state (strings can't live in bitECS stores). */
interface CombatSlot {
  hp: number;
  dead: boolean;
  facingX: number;
  facingY: number;
  /** Next tick at which an attack is allowed. */
  attackReadyTick: number;
  inventory: (string | null)[];
  /** Actions queued via act(), drained every step. */
  queue: PlayerAction[];
}

interface FloorItemRec {
  id: number;
  item: string;
  x: number;
  y: number;
  /** Slot that just dropped this item (blocked from re-pickup until it walks away); -1 = none. */
  lockSlot: number;
}

/** A placed noisemaker: emits fake footstep-walk sounds on a fixed schedule. */
interface NoisemakerRec {
  x: number;
  y: number;
  emitterId: number;
  intervalTicks: number;
  nextTick: number;
  endTick: number;
}

const MAX_ACTION_QUEUE = 8;

/**
 * Create a deterministic Escape-mode simulation over `maze`. No wall-clock
 * time and no unseeded randomness anywhere: identical inputs produce
 * identical TickResults and player states, on server, client, and bots.
 * Players are iterated in slot order every tick, so join order never makes
 * two instances diverge. Sound emitterId is the player slot (stable across
 * simulation instances, unlike raw entity ids); noisemakers get emitter ids
 * >= MAX_PLAYERS so they are indistinguishable-by-kind but never collide.
 *
 * `items` (injected item definitions — the ecs never imports
 * @echowake/content) enables the combat/item systems and seeds deterministic
 * floor item spawns. Omitted => no items and no combat: byte-for-byte the
 * pre-items behavior.
 */
export function createSimulation(opts: {
  maze: Maze;
  seed: string;
  items?: readonly ItemDef[];
}): Simulation {
  const { maze } = opts;
  const world = createWorld();
  const slots: (number | null)[] = new Array<number | null>(MAX_PLAYERS).fill(null);
  let tick = 0;

  const itemsEnabled = opts.items !== undefined;
  const defs = new Map<string, ItemDef>((opts.items ?? []).map((d) => [d.id, d]));
  const combat: (CombatSlot | null)[] = new Array<CombatSlot | null>(MAX_PLAYERS).fill(null);
  const floor: FloorItemRec[] = [];
  let nextFloorId = 1;
  if (itemsEnabled && opts.items) {
    for (const p of planItemSpawns(maze, opts.items, opts.seed)) {
      floor.push({ id: nextFloorId++, item: p.item, x: p.x, y: p.y, lockSlot: -1 });
    }
  }
  const noisemakers: NoisemakerRec[] = [];
  let nextNoiseEmitterId = MAX_PLAYERS;

  const eidFor = (slot: number): number => {
    const eid = slots[slot];
    if (eid === null || eid === undefined) {
      throw new Error(`@echowake/ecs: no player in slot ${slot}`);
    }
    return eid;
  };

  /** Player is present, alive and still in the match (not escaped). */
  const isActive = (slot: number): boolean => {
    const eid = slots[slot];
    if (eid === null || eid === undefined) return false;
    if (Runner.escaped[eid] === 1) return false;
    return !(combat[slot]?.dead ?? false);
  };

  /**
   * Strongest single aura multiplier of `key` at position (x, y): the lowest
   * value among charms carried by active players whose aura radius covers the
   * position (bearer included). Auras never stack with each other — one aura,
   * the strongest, applies (README / CONTRACTS).
   */
  const strongestAuraMul = (
    x: number,
    y: number,
    key: "damageTakenMul" | "emittedSoundMul",
  ): number => {
    let mul = 1;
    for (let s = 0; s < MAX_PLAYERS; s++) {
      if (!isActive(s)) continue;
      const cs = combat[s];
      const eid = slots[s];
      if (!cs || eid === null || eid === undefined) continue;
      const bx = Position.x[eid] as number;
      const by = Position.y[eid] as number;
      for (const id of cs.inventory) {
        if (id === null) continue;
        const aura = defs.get(id)?.aura;
        const v = aura?.[key];
        if (aura === undefined || v === undefined) continue;
        if (distSq(x, y, bx, by) <= aura.radius * aura.radius && v < mul) mul = v;
      }
    }
    return mul;
  };

  /** Drop the whole inventory on the floor at (x, y) — death, no re-pickup lock. */
  const dropAllInventory = (cs: CombatSlot, x: number, y: number): void => {
    for (let i = 0; i < cs.inventory.length; i++) {
      const id = cs.inventory[i];
      if (id === null || id === undefined) continue;
      floor.push({ id: nextFloorId++, item: id, x, y, lockSlot: -1 });
      cs.inventory[i] = null;
    }
  };

  return {
    maze,
    get tick() {
      return tick;
    },

    addPlayer(): number {
      const slot = slots.indexOf(null);
      if (slot === -1) throw new Error("@echowake/ecs: simulation is full");
      const spawn = maze.spawns[slot];
      if (!spawn) throw new Error(`@echowake/ecs: maze has no spawn for slot ${slot}`);
      const eid = addEntity(world);
      addComponent(world, Position, eid);
      addComponent(world, InputC, eid);
      addComponent(world, Runner, eid);
      // Reset everything explicitly — bitECS recycles entity ids.
      Position.x[eid] = spawn.x + 0.5;
      Position.y[eid] = spawn.y + 0.5;
      InputC.moveX[eid] = 0;
      InputC.moveY[eid] = 0;
      InputC.sprint[eid] = 0;
      InputC.sneak[eid] = 0;
      Runner.escaped[eid] = 0;
      Runner.stepAcc[eid] = 0;
      combat[slot] = {
        hp: MAX_HP,
        dead: false,
        facingX: 1,
        facingY: 0,
        attackReadyTick: 0,
        inventory: new Array<string | null>(INVENTORY_SLOTS).fill(null),
        queue: [],
      };
      slots[slot] = eid;
      return slot;
    },

    removePlayer(slot: number): void {
      const eid = eidFor(slot);
      removeEntity(world, eid);
      slots[slot] = null;
      combat[slot] = null;
    },

    setInput(slot: number, input: PlayerInput): void {
      const eid = eidFor(slot);
      InputC.moveX[eid] = sanitizeAxis(input.moveX);
      InputC.moveY[eid] = sanitizeAxis(input.moveY);
      InputC.sprint[eid] = input.sprint ? 1 : 0;
      InputC.sneak[eid] = input.sneak ? 1 : 0;
    },

    act(slot: number, action: PlayerAction): void {
      eidFor(slot); // same occupied-slot contract as setInput
      if (!itemsEnabled) return; // combat/items disabled: no behavior change
      const cs = combat[slot];
      if (!cs || cs.queue.length >= MAX_ACTION_QUEUE) return;
      cs.queue.push({ action: action.action, slot: action.slot });
    },

    step(): TickResult {
      tick += 1;
      const sounds: RawSoundEvent[] = [];
      const escapes: number[] = [];
      const hits: TickResult["hits"] = [];
      const deaths: number[] = [];
      const pickups: TickResult["pickups"] = [];

      // --- Phase 1 (items mode): facing, then queued actions, slot order. ---
      if (itemsEnabled) {
        for (let slot = 0; slot < MAX_PLAYERS; slot++) {
          const eid = slots[slot];
          const cs = combat[slot];
          if (eid === null || eid === undefined || !cs) continue;
          if (!isActive(slot)) {
            cs.queue.length = 0; // dead/escaped players cannot act
            continue;
          }
          // Facing = last nonzero move direction (defaults to +x).
          const mx = InputC.moveX[eid] as number;
          const my = InputC.moveY[eid] as number;
          const len = Math.sqrt(mx * mx + my * my);
          if (len > 0) {
            cs.facingX = mx / len;
            cs.facingY = my / len;
          }
        }
        for (let slot = 0; slot < MAX_PLAYERS; slot++) {
          const eid = slots[slot];
          const cs = combat[slot];
          if (eid === null || eid === undefined || !cs) continue;
          if (!isActive(slot)) {
            cs.queue.length = 0;
            continue;
          }
          let attacked = false;
          for (const action of cs.queue) {
            if (action.action === "attack") {
              if (attacked) continue; // at most one attack applied per tick
              attacked = true;
              attack(slot, eid, cs);
            } else if (action.action === "use") {
              use(eid, cs, action.slot);
            } else if (action.action === "drop") {
              drop(slot, eid, cs, action.slot);
            }
          }
          cs.queue.length = 0;
        }
      }

      // --- Phase 2: movement, footsteps, escape (slot order). ---
      for (let slot = 0; slot < MAX_PLAYERS; slot++) {
        const eid = slots[slot];
        if (eid === null || eid === undefined) continue;
        if (Runner.escaped[eid] === 1) continue; // escaped players stop simulating
        const cs = combat[slot];
        if (cs?.dead) continue; // dead players stop simulating

        const mx = InputC.moveX[eid] as number;
        const my = InputC.moveY[eid] as number;
        const len = Math.sqrt(mx * mx + my * my);
        // Sneak wins over sprint: holding both means the player intends stealth.
        const mode: MoveMode =
          InputC.sneak[eid] === 1 ? "sneak" : InputC.sprint[eid] === 1 ? "sprint" : "walk";

        const x = Position.x[eid] as number;
        const y = Position.y[eid] as number;
        let nx = x;
        let ny = y;

        if (len > 0) {
          const step = MOVE_SPEED[mode] * TICK_DT;
          ({ x: nx, y: ny } = moveCircle(maze, x, y, (mx / len) * step, (my / len) * step));
          Position.x[eid] = nx;
          Position.y[eid] = ny;

          // Footsteps: distance-moved accumulator, one step per interval of
          // actual (post-collision) distance — sliding along a wall is audible.
          const moved = Math.sqrt((nx - x) * (nx - x) + (ny - y) * (ny - y));
          if (moved > 0) {
            const interval = MOVE_SPEED[mode] * FOOTSTEP_INTERVAL_S[mode];
            // Carried armor/boots multipliers stack multiplicatively.
            const footMul =
              itemsEnabled && cs ? inventoryMul(cs.inventory, defs, "footstepMul") : 1;
            let acc = (Runner.stepAcc[eid] as number) + moved;
            while (acc >= interval) {
              acc -= interval;
              const kind = FOOTSTEP_KIND[mode];
              sounds.push({
                kind,
                x: nx,
                y: ny,
                intensity: SOUND_INTENSITY[kind] * footMul,
                emitterId: slot,
                tick,
              });
            }
            Runner.stepAcc[eid] = acc;
          }
        }

        if (Math.floor(nx) === maze.exit.x && Math.floor(ny) === maze.exit.y) {
          Runner.escaped[eid] = 1;
          escapes.push(slot);
        }
      }

      // --- Phase 3 (items mode): auto-pickup within PICKUP_RANGE. ---
      if (itemsEnabled) {
        // Release drop-locks whose owner has left (or is gone/dead/escaped).
        const release2 = DROP_RELOCK_RELEASE_RANGE * DROP_RELOCK_RELEASE_RANGE;
        for (const fi of floor) {
          if (fi.lockSlot === -1) continue;
          const oe = slots[fi.lockSlot];
          if (
            !isActive(fi.lockSlot) ||
            oe === null ||
            oe === undefined ||
            distSq(fi.x, fi.y, Position.x[oe] as number, Position.y[oe] as number) > release2
          ) {
            fi.lockSlot = -1;
          }
        }
        const pickup2 = PICKUP_RANGE * PICKUP_RANGE;
        for (let slot = 0; slot < MAX_PLAYERS; slot++) {
          const eid = slots[slot];
          const cs = combat[slot];
          if (eid === null || eid === undefined || !cs || !isActive(slot)) continue;
          const px = Position.x[eid] as number;
          const py = Position.y[eid] as number;
          for (let i = 0; i < floor.length; ) {
            const fi = floor[i] as FloorItemRec;
            if (fi.lockSlot === slot || distSq(px, py, fi.x, fi.y) > pickup2) {
              i += 1;
              continue;
            }
            const free = cs.inventory.indexOf(null);
            if (free === -1) break; // no free slot => items stay on the floor
            cs.inventory[free] = fi.item;
            floor.splice(i, 1);
            pickups.push({ slot, item: fi.item });
            sounds.push({
              kind: "pickup",
              x: px,
              y: py,
              intensity: SOUND_INTENSITY.pickup,
              emitterId: slot,
              tick,
            });
          }
        }

        // --- Phase 4: noisemakers emit fake walking footsteps on schedule. ---
        for (let i = 0; i < noisemakers.length; ) {
          const nm = noisemakers[i] as NoisemakerRec;
          if (tick >= nm.nextTick && nm.nextTick <= nm.endTick) {
            sounds.push({
              kind: "footstep-walk", // exactly a real walking step — deception by design
              x: nm.x,
              y: nm.y,
              intensity: SOUND_INTENSITY["footstep-walk"],
              emitterId: nm.emitterId,
              tick,
            });
            nm.nextTick += nm.intervalTicks;
          }
          if (nm.nextTick > nm.endTick) {
            noisemakers.splice(i, 1);
          } else {
            i += 1;
          }
        }

        // --- Phase 5: veil auras dampen every sound ORIGINATING in radius; ---
        // final intensity is always clamped to [0, 1] (armor can push it up).
        for (const snd of sounds) {
          const veil = strongestAuraMul(snd.x, snd.y, "emittedSoundMul");
          snd.intensity = clamp(snd.intensity * veil, 0, 1);
        }
      }

      return { tick, sounds, escapes, hits, deaths, pickups };

      /** Melee swing: nearest target in range/arc with wall-free LOS. */
      function attack(slot: number, eid: number, cs: CombatSlot): void {
        if (tick < cs.attackReadyTick) return; // still on cooldown: swing ignored
        const weapon = bestWeapon(cs.inventory, defs);
        cs.attackReadyTick = tick + Math.max(1, Math.round((weapon.cooldownS ?? 1) * TICK_RATE));
        const ax = Position.x[eid] as number;
        const ay = Position.y[eid] as number;
        sounds.push({
          kind: "melee-swing",
          x: ax,
          y: ay,
          intensity: SOUND_INTENSITY["melee-swing"],
          emitterId: slot,
          tick,
        });

        const range2 = MELEE_RANGE * MELEE_RANGE;
        const cosArc = Math.cos(MELEE_HALF_ARC);
        let target = -1;
        let targetEid = -1;
        let bestD2 = Number.POSITIVE_INFINITY;
        for (let t = 0; t < MAX_PLAYERS; t++) {
          if (t === slot || !isActive(t)) continue; // dead/escaped cannot be hit
          const te = slots[t];
          if (te === null || te === undefined) continue;
          const tx = Position.x[te] as number;
          const ty = Position.y[te] as number;
          const d2 = distSq(ax, ay, tx, ty);
          if (d2 > range2 || d2 >= bestD2) continue; // only the nearest is hit
          if (d2 > 0) {
            const dot = (cs.facingX * (tx - ax) + cs.facingY * (ty - ay)) / Math.sqrt(d2);
            if (dot < cosArc - 1e-12) continue; // outside the swing arc
          }
          if (
            !hasLineOfSight(maze, Math.floor(ax), Math.floor(ay), Math.floor(tx), Math.floor(ty))
          ) {
            continue; // walls block melee
          }
          target = t;
          targetEid = te;
          bestD2 = d2;
        }
        if (target === -1) return;

        const tcs = combat[target] as CombatSlot;
        const tx = Position.x[targetEid] as number;
        const ty = Position.y[targetEid] as number;
        // Damage pipeline: weapon x target's carried armor x strongest warding
        // aura covering the TARGET's position (auras do not stack).
        let damage = weapon.damage ?? 0;
        damage *= inventoryMul(tcs.inventory, defs, "damageTakenMul");
        damage *= strongestAuraMul(tx, ty, "damageTakenMul");
        tcs.hp -= damage;
        hits.push({ attacker: slot, target, damage });
        sounds.push({
          kind: "melee-hit",
          x: tx,
          y: ty,
          intensity: SOUND_INTENSITY["melee-hit"],
          emitterId: target,
          tick,
        });
        if (tcs.hp <= 0) {
          tcs.hp = 0;
          tcs.dead = true;
          deaths.push(target); // reported exactly once — dead players are skipped
          dropAllInventory(tcs, tx, ty);
        }
      }

      /** Use a consumable from an inventory slot; anything else is a no-op. */
      function use(eid: number, cs: CombatSlot, invSlot: number | undefined): void {
        if (!isValidInvSlot(invSlot)) return;
        const id = cs.inventory[invSlot];
        if (id === null || id === undefined) return;
        const def = defs.get(id);
        if (!def || def.kind !== "consumable") return; // use on non-consumable: no-op
        if (def.healHp !== undefined) {
          cs.hp = Math.min(MAX_HP, cs.hp + def.healHp);
          cs.inventory[invSlot] = null;
        } else if (def.noisemaker !== undefined) {
          cs.inventory[invSlot] = null;
          const intervalTicks = Math.max(1, Math.round(def.noisemaker.intervalS * TICK_RATE));
          noisemakers.push({
            x: Position.x[eid] as number,
            y: Position.y[eid] as number,
            emitterId: nextNoiseEmitterId++,
            intervalTicks,
            nextTick: tick + intervalTicks,
            endTick: tick + Math.round(def.noisemaker.durationS * TICK_RATE),
          });
        }
      }

      /** Drop an inventory slot's item to the floor at the player's position. */
      function drop(slot: number, eid: number, cs: CombatSlot, invSlot: number | undefined): void {
        if (!isValidInvSlot(invSlot)) return;
        const id = cs.inventory[invSlot];
        if (id === null || id === undefined) return;
        cs.inventory[invSlot] = null;
        floor.push({
          id: nextFloorId++,
          item: id,
          x: Position.x[eid] as number,
          y: Position.y[eid] as number,
          lockSlot: slot, // dropper must walk away before it can re-pick it
        });
      }
    },

    getPlayerState(slot: number): PlayerState {
      const eid = eidFor(slot);
      const base = {
        x: Position.x[eid] as number,
        y: Position.y[eid] as number,
        escaped: Runner.escaped[eid] === 1,
      };
      if (!itemsEnabled) {
        // Backward compatibility: without the `items` option the pre-combat
        // state shape is preserved exactly (callers deep-equal against it).
        return base as PlayerState;
      }
      const cs = combat[slot] as CombatSlot;
      return {
        ...base,
        hp: cs.hp,
        dead: cs.dead,
        facingX: cs.facingX,
        facingY: cs.facingY,
        inventory: [...cs.inventory],
      };
    },

    listFloorItems(): { id: number; item: string; x: number; y: number }[] {
      return floor.map(({ id, item, x, y }) => ({ id, item, x, y }));
    },
  };
}

function isValidInvSlot(v: number | undefined): v is number {
  return typeof v === "number" && Number.isInteger(v) && v >= 0 && v < INVENTORY_SLOTS;
}
