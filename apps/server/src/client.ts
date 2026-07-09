import type { ServerMessage } from "@labyrinth/protocol";
import type { Lobby } from "./lobby.js";

/**
 * One connected, hello-authenticated player. Wraps the underlying WebSocket
 * behind `send`/`close` so lobby and match code never touch the transport.
 */
export interface Client {
  /** Random connection identity (crypto UUID) — not simulation state. */
  readonly playerId: string;
  /** Sanitized display name from the hello message. */
  name: string;
  /** The lobby this client is currently in, if any. */
  lobby: Lobby | null;
  /** Encode and send one server message (no-op once the socket is closed). */
  send(msg: ServerMessage): void;
  /** Close the underlying socket. */
  close(code?: number, reason?: string): void;
}
