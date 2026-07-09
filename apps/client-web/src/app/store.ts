import { useSyncExternalStore } from "react";
import type { LobbyPlayerInfo, PublicLobbyInfo } from "@echowake/protocol";

export type Screen = "menu" | "browse" | "lobby" | "game" | "end";
export type ConnectionState = "disconnected" | "connecting" | "connected";

export interface ChatEntry {
  id: number;
  name: string;
  text: string;
}

export interface LobbyView {
  code: string;
  hostId: string;
  players: LobbyPlayerInfo[];
  /** True when the host has listed the lobby in the public browser. */
  isPublic: boolean;
}

export interface HudView {
  /** Whole seconds left until endTick (from ticks, not wall clock). */
  remainingS: number;
  escaped: boolean;
  /** Your hit points from the latest snapshot (0..MAX_HP). */
  hp: number;
  /** True once eliminated — the HUD shows ELIMINATED and input goes dead. */
  dead: boolean;
  /** Inventory slot contents (item definition ids), null = empty. */
  inventory: (string | null)[];
  /** Slot highlighted in the HUD; keys 1-4 select, Q drops it. */
  selectedSlot: number;
  /** Increments every time hp drops — React keys the red edge flash off it. */
  hpFlashSeq: number;
}

export interface MatchResultView {
  reason: "allEscaped" | "timeUp";
  /** Escape order, names resolved from the last lobby roster. */
  escaped: { id: string; name: string }[];
  /** Combat eliminations in death order, names resolved the same way. */
  eliminated: { id: string; name: string }[];
}

/** Coarse UI state — the ONLY game-adjacent data React ever sees. */
export interface UiState {
  screen: Screen;
  connection: ConnectionState;
  /** host[:port] of the resolved server URL, once a connection was attempted. */
  serverHost: string | null;
  error: string | null;
  selfId: string | null;
  lobby: LobbyView | null;
  /** Public lobby browser contents; null = no lobbyList received yet. */
  lobbyList: PublicLobbyInfo[] | null;
  /** Exponentially smoothed round-trip time in ms; null before the first pong. */
  pingMs: number | null;
  /** Renderer frames per second (rolling ~1s window); null while not in a match. */
  fps: number | null;
  hud: HudView | null;
  chat: ChatEntry[];
  matchResult: MatchResultView | null;
}

const INITIAL: UiState = {
  screen: "menu",
  connection: "disconnected",
  serverHost: null,
  error: null,
  selfId: null,
  lobby: null,
  lobbyList: null,
  pingMs: null,
  fps: null,
  hud: null,
  chat: [],
  matchResult: null,
};

/**
 * Minimal external store for useSyncExternalStore — no gameplay data lives
 * here, only coarse screen/lobby/result state the React shell renders.
 */
export class UiStore {
  private state: UiState = INITIAL;
  private listeners = new Set<() => void>();

  /** Current immutable snapshot. */
  get = (): UiState => this.state;

  /** Shallow-merges a patch and notifies subscribers. */
  set(patch: Partial<UiState>): void {
    this.state = { ...this.state, ...patch };
    for (const fn of this.listeners) fn();
  }

  /** Subscribe for useSyncExternalStore; returns unsubscribe. */
  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };
}

/** React hook: subscribe a component to the coarse UI state. */
export function useUi(store: UiStore): UiState {
  return useSyncExternalStore(store.subscribe, store.get, store.get);
}
