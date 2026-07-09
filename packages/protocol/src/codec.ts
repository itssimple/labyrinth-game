import type { MazeGenOptions, MazeSize } from "@echowake/common";
import type {
  ChatMsg,
  ClientMessage,
  HelloMsg,
  InputMsg,
  JoinLobbyMsg,
  RemoveBotMsg,
  ServerMessage,
  StartMatchMsg,
} from "./messages.js";

/** Maximum display-name length accepted from clients. */
const NAME_MAX = 20;
/** Maximum chat message length accepted from clients. */
const CHAT_MAX = 200;
/** Lobby code: exactly 4 ASCII letters, case-insensitive. */
const LOBBY_CODE_RE = /^[A-Za-z]{4}$/;
/** Maximum maze seed length accepted from clients (seeds are hashed per tick). */
const SEED_MAX = 64;
/** Maximum number of maze modifiers accepted from clients. */
const MODIFIERS_MAX = 8;
/** Maximum length of a single maze modifier accepted from clients. */
const MODIFIER_MAX = 32;
/** Maximum playerId length accepted from clients (server ids are UUIDs, 36). */
const PLAYER_ID_MAX = 64;

/** The five valid maze sizes; must stay in sync with MazeSize in @echowake/common. */
const MAZE_SIZES: ReadonlySet<string> = new Set<MazeSize>([
  "tiny",
  "small",
  "medium",
  "large",
  "huge",
]);

/** Server message discriminators — membership check only (trusting decode). */
const SERVER_TYPES: ReadonlySet<string> = new Set([
  "welcome",
  "error",
  "lobbyState",
  "matchStart",
  "snapshot",
  "matchEnd",
  "chatBroadcast",
  "pong",
  "lobbyList",
]);

/** True if v is a plain non-null, non-array object. */
function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** True if v is a finite number (rejects NaN, Infinity — e.g. JSON "1e999"). */
function isFiniteNumber(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

/** True if v is a movement direction component: exactly -1, 0 or 1. */
function isDirComponent(v: unknown): v is -1 | 0 | 1 {
  return v === -1 || v === 0 || v === 1;
}

/**
 * Validates untrusted MazeGenOptions structure. Returns a freshly built object
 * (unknown extra properties are stripped) or null when malformed.
 */
function decodeMazeGenOptions(v: unknown): MazeGenOptions | null {
  if (!isRecord(v)) return null;
  const { seed, size, difficulty, modifiers } = v;
  if (typeof seed !== "string" || seed.length > SEED_MAX) return null;
  if (typeof size !== "string" || !MAZE_SIZES.has(size)) return null;

  const out: MazeGenOptions = { seed, size: size as MazeSize };

  if (difficulty !== undefined) {
    if (!isFiniteNumber(difficulty)) return null;
    out.difficulty = difficulty;
  }
  if (modifiers !== undefined) {
    if (!Array.isArray(modifiers) || modifiers.length > MODIFIERS_MAX) return null;
    for (const m of modifiers) {
      if (typeof m !== "string" || m.length > MODIFIER_MAX) return null;
    }
    out.modifiers = modifiers as string[];
  }
  return out;
}

/**
 * Encodes any protocol message to its JSON wire form.
 * Pure and deterministic — output depends only on the input object.
 */
export function encodeMessage(msg: ClientMessage | ServerMessage): string {
  return JSON.stringify(msg);
}

/**
 * Decodes and strictly validates an untrusted client message.
 *
 * This is a security boundary: every field is structurally checked by hand.
 * Returns null on anything malformed — invalid JSON, unknown `type`,
 * missing/mistyped fields, non-finite numbers, out-of-range values, oversized
 * strings. On success a fresh object is returned with only the known fields
 * (unknown extra properties from the wire are stripped).
 */
export function decodeClientMessage(raw: string): ClientMessage | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!isRecord(parsed)) return null;

  switch (parsed["type"]) {
    case "hello": {
      const { protocolVersion, name } = parsed;
      if (!isFiniteNumber(protocolVersion) || !Number.isInteger(protocolVersion)) return null;
      if (typeof name !== "string" || name.length < 1 || name.length > NAME_MAX) return null;
      const msg: HelloMsg = { type: "hello", protocolVersion, name };
      return msg;
    }
    case "createLobby":
      return { type: "createLobby" };
    case "joinLobby": {
      const { code } = parsed;
      if (typeof code !== "string" || !LOBBY_CODE_RE.test(code)) return null;
      const msg: JoinLobbyMsg = { type: "joinLobby", code };
      return msg;
    }
    case "leaveLobby":
      return { type: "leaveLobby" };
    case "startMatch": {
      const options = decodeMazeGenOptions(parsed["options"]);
      if (options === null) return null;
      const msg: StartMatchMsg = { type: "startMatch", options };
      return msg;
    }
    case "input": {
      const { seq, moveX, moveY, sprint, sneak } = parsed;
      if (!isFiniteNumber(seq)) return null;
      if (!isDirComponent(moveX) || !isDirComponent(moveY)) return null;
      if (typeof sprint !== "boolean" || typeof sneak !== "boolean") return null;
      const msg: InputMsg = { type: "input", seq, moveX, moveY, sprint, sneak };
      return msg;
    }
    case "chat": {
      const { text } = parsed;
      if (typeof text !== "string" || text.length > CHAT_MAX) return null;
      const msg: ChatMsg = { type: "chat", text };
      return msg;
    }
    case "addBot":
      return { type: "addBot" };
    case "ping": {
      const { t } = parsed;
      if (!isFiniteNumber(t)) return null;
      return { type: "ping", t };
    }
    case "setLobbyPublic": {
      const { isPublic } = parsed;
      if (typeof isPublic !== "boolean") return null;
      return { type: "setLobbyPublic", isPublic };
    }
    case "listLobbies":
      return { type: "listLobbies" };
    case "removeBot": {
      const { playerId } = parsed;
      if (typeof playerId !== "string" || playerId.length < 1 || playerId.length > PLAYER_ID_MAX)
        return null;
      const msg: RemoveBotMsg = { type: "removeBot", playerId };
      return msg;
    }
    default:
      // Unknown discriminator (including tricks like "__proto__").
      return null;
  }
}

/**
 * Decodes a server message on the client side. The server is trusted, so this
 * only checks that the payload is a JSON object with a known `type`; field
 * contents are not re-validated. Returns null on invalid JSON or unknown type.
 */
export function decodeServerMessage(raw: string): ServerMessage | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!isRecord(parsed)) return null;
  const type = parsed["type"];
  if (typeof type !== "string" || !SERVER_TYPES.has(type)) return null;
  return parsed as unknown as ServerMessage;
}
