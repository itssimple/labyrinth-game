import type { MazeGenOptions, PerceivedSound } from "@labyrinth/common";

/**
 * Wire protocol v1: JSON messages over WebSocket, discriminated on `type`.
 * The server is authoritative — clients only ever send intent, never state.
 * TODO: switch to a binary encoding once the message set stabilizes.
 */

// ---------------------------------------------------------------------------
// Client -> Server
// ---------------------------------------------------------------------------

export interface HelloMsg {
  type: "hello";
  protocolVersion: number;
  /** Display name, 1..20 chars; server sanitizes. */
  name: string;
}

export interface CreateLobbyMsg {
  type: "createLobby";
}

export interface JoinLobbyMsg {
  type: "joinLobby";
  /** 4-letter lobby code, case-insensitive. */
  code: string;
}

export interface LeaveLobbyMsg {
  type: "leaveLobby";
}

/** Host only. Starts the match for everyone in the lobby. */
export interface StartMatchMsg {
  type: "startMatch";
  options: MazeGenOptions;
}

/**
 * Player intent for one tick. Server clamps/validates everything.
 * moveX/moveY are each -1, 0 or 1 (direction, not velocity).
 */
export interface InputMsg {
  type: "input";
  seq: number;
  moveX: number;
  moveY: number;
  sprint: boolean;
  sneak: boolean;
}

export interface ChatMsg {
  type: "chat";
  text: string;
}

export type ClientMessage =
  | HelloMsg
  | CreateLobbyMsg
  | JoinLobbyMsg
  | LeaveLobbyMsg
  | StartMatchMsg
  | InputMsg
  | ChatMsg;

// ---------------------------------------------------------------------------
// Server -> Client
// ---------------------------------------------------------------------------

export interface WelcomeMsg {
  type: "welcome";
  playerId: string;
}

export interface ErrorMsg {
  type: "error";
  code:
    | "badProtocolVersion"
    | "badMessage"
    | "lobbyNotFound"
    | "lobbyFull"
    | "notHost"
    | "notInLobby"
    | "matchAlreadyStarted"
    | "tooManyPlayersForSize";
  message: string;
}

export interface LobbyPlayerInfo {
  playerId: string;
  name: string;
}

export interface LobbyStateMsg {
  type: "lobbyState";
  code: string;
  hostId: string;
  players: LobbyPlayerInfo[];
}

/**
 * Match start. The maze is NOT sent — clients regenerate it deterministically
 * from options (same seed => identical maze). This exercises the determinism
 * requirement end to end.
 */
export interface MatchStartMsg {
  type: "matchStart";
  options: MazeGenOptions;
  /** Tick at which the match ends (Escape mode timer). */
  endTick: number;
  /** Index into maze.spawns for this client's player. */
  yourSpawnIndex: number;
}

export interface VisiblePlayerState {
  playerId: string;
  x: number;
  y: number;
}

/**
 * Per-client authoritative snapshot. Contains ONLY what this client is allowed
 * to know: its own state, players inside its vision, cells it currently sees,
 * and confidence-banded sounds. Never leaks hidden positions.
 */
export interface SnapshotMsg {
  type: "snapshot";
  tick: number;
  /** Last input seq the server consumed from this client. */
  ackSeq: number;
  you: { x: number; y: number; escaped: boolean };
  visiblePlayers: VisiblePlayerState[];
  /** Cell indices (row-major) currently in line of sight. */
  visibleCells: number[];
  sounds: PerceivedSound[];
}

export interface MatchEndMsg {
  type: "matchEnd";
  reason: "allEscaped" | "timeUp";
  /** Player ids that reached the exit, in escape order. */
  escaped: string[];
}

export interface ChatBroadcastMsg {
  type: "chatBroadcast";
  playerId: string;
  name: string;
  text: string;
}

export type ServerMessage =
  | WelcomeMsg
  | ErrorMsg
  | LobbyStateMsg
  | MatchStartMsg
  | SnapshotMsg
  | MatchEndMsg
  | ChatBroadcastMsg;
