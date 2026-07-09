import type { ClientMessage, ServerMessage } from "@labyrinth/protocol";
import { decodeServerMessage, encodeMessage } from "@labyrinth/protocol";

export type SocketStatus = "connecting" | "open" | "closed";

export interface SocketHandlers {
  onMessage(msg: ServerMessage): void;
  onStatus(status: SocketStatus): void;
}

/**
 * Thin WebSocket wrapper: encodes outbound messages with the protocol codec
 * and decodes/drops-malformed inbound ones. Transport only — no game logic.
 */
export class GameSocket {
  private readonly ws: WebSocket;
  private closedByUs = false;

  constructor(url: string, handlers: SocketHandlers) {
    this.ws = new WebSocket(url);
    handlers.onStatus("connecting");
    this.ws.onopen = () => handlers.onStatus("open");
    this.ws.onclose = () => {
      if (!this.closedByUs) handlers.onStatus("closed");
    };
    this.ws.onmessage = (ev: MessageEvent) => {
      if (typeof ev.data !== "string") return;
      const msg = decodeServerMessage(ev.data);
      if (msg !== null) handlers.onMessage(msg);
    };
  }

  /** True while the underlying socket is open. */
  get isOpen(): boolean {
    return this.ws.readyState === WebSocket.OPEN;
  }

  /** Encodes and sends a client message; silently dropped when not open. */
  send(msg: ClientMessage): void {
    if (this.isOpen) this.ws.send(encodeMessage(msg));
  }

  /** Closes the socket without emitting a "closed" status (intentional). */
  close(): void {
    this.closedByUs = true;
    this.ws.close();
  }
}

/** Resolves the game server WebSocket URL (VITE_SERVER_URL override). */
export function serverUrl(): string {
  const fromEnv = import.meta.env.VITE_SERVER_URL as string | undefined;
  return fromEnv && fromEnv.length > 0 ? fromEnv : "ws://localhost:8080/ws";
}
