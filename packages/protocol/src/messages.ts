import type { MazeGenOptions, PerceivedSound } from "@echowake/common";

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
 * aimX/aimY: view/aim direction (mouse, right stick, or touch stick) —
 * finite floats, normalized server-side; absent or zero-length = keep the
 * previous aim (movement direction as the initial fallback).
 */
export interface InputMsg {
  type: "input";
  seq: number;
  moveX: number;
  moveY: number;
  aimX?: number;
  aimY?: number;
  sprint: boolean;
  sneak: boolean;
}

export interface ChatMsg {
  type: "chat";
  text: string;
}

/** Host only. Adds one AI bot to the lobby; the server names it. */
export interface AddBotMsg {
  type: "addBot";
}

/** Host only. Removes the bot with this playerId from the lobby. */
export interface RemoveBotMsg {
  type: "removeBot";
  playerId: string;
}

/** Latency probe; the server echoes `t` back verbatim in a pong. */
export interface PingMsg {
  type: "ping";
  /** Client-chosen timestamp/counter; opaque to the server. */
  t: number;
}

/** Host only. Lists (or unlists) the lobby in the public lobby browser. */
export interface SetLobbyPublicMsg {
  type: "setLobbyPublic";
  isPublic: boolean;
}

/** Requests the current public lobby list. */
export interface ListLobbiesMsg {
  type: "listLobbies";
}

/**
 * A discrete in-match action (as opposed to continuous movement input).
 * attack: melee swing toward facing (slot ignored); use/drop target an
 * inventory slot 0..3. Server validates everything (cooldowns, ownership).
 */
export interface ActionMsg {
  type: "action";
  seq: number;
  action: "attack" | "use" | "drop";
  slot?: number;
}

export type ClientMessage =
  | HelloMsg
  | CreateLobbyMsg
  | JoinLobbyMsg
  | LeaveLobbyMsg
  | StartMatchMsg
  | InputMsg
  | ChatMsg
  | AddBotMsg
  | RemoveBotMsg
  | PingMsg
  | SetLobbyPublicMsg
  | ListLobbiesMsg
  | ActionMsg;

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
  /** AI bots occupy player slots and count toward every player cap. */
  isBot: boolean;
}

export interface LobbyStateMsg {
  type: "lobbyState";
  code: string;
  hostId: string;
  players: LobbyPlayerInfo[];
  /** True when the host has listed this lobby in the public browser. */
  isPublic: boolean;
}

/** Echo of a client ping; `t` is returned verbatim for RTT measurement. */
export interface PongMsg {
  type: "pong";
  t: number;
}

/** One entry in the public lobby browser. Only public lobbies appear. */
export interface PublicLobbyInfo {
  code: string;
  hostName: string;
  playerCount: number;
  botCount: number;
  /** Mid-match lobbies are shown but cannot be joined yet. */
  inMatch: boolean;
}

export interface LobbyListMsg {
  type: "lobbyList";
  lobbies: PublicLobbyInfo[];
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
/** An item lying in the maze, inside this client's line of sight. */
export interface VisibleItemState {
  /** Server-side item instance id (stable while it lies there). */
  id: number;
  /** Item definition id from @echowake/content (e.g. "rusty-sword"). */
  item: string;
  x: number;
  y: number;
}

export interface SnapshotMsg {
  type: "snapshot";
  tick: number;
  /** Last input seq the server consumed from this client. */
  ackSeq: number;
  you: { x: number; y: number; escaped: boolean; hp: number; dead: boolean };
  /** Inventory slots (item definition ids), null = empty. Yours only. */
  inventory: (string | null)[];
  visiblePlayers: VisiblePlayerState[];
  /** Items currently in line of sight. */
  visibleItems: VisibleItemState[];
  /** Cell indices (row-major) currently in line of sight. */
  visibleCells: number[];
  sounds: PerceivedSound[];
}

export interface MatchEndMsg {
  type: "matchEnd";
  reason: "allEscaped" | "timeUp";
  /** Player ids that reached the exit, in escape order. */
  escaped: string[];
  /** Player ids eliminated by combat, in death order. */
  eliminated: string[];
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
  | ChatBroadcastMsg
  | PongMsg
  | LobbyListMsg;
