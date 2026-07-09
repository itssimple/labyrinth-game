import { useSyncExternalStore } from "react";
import type { LobbyPlayerInfo } from "@labyrinth/protocol";

export type Screen = "menu" | "lobby" | "game" | "end";
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
}

export interface HudView {
  /** Whole seconds left until endTick (from ticks, not wall clock). */
  remainingS: number;
  escaped: boolean;
}

export interface MatchResultView {
  reason: "allEscaped" | "timeUp";
  /** Escape order, names resolved from the last lobby roster. */
  escaped: { id: string; name: string }[];
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
