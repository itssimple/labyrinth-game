/**
 * Randomness indirection for mazegen — single swap point for the RNG source.
 * All maze generation randomness must flow through here.
 */
export { createRng, hashString, type Rng } from "@echowake/math";
