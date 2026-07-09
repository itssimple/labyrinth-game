import { randomUUID } from "node:crypto";
import { MAX_PLAYERS_PER_SIZE, PROTOCOL_VERSION } from "@echowake/common";
import {
  decodeClientMessage,
  encodeMessage,
  type ClientMessage,
  type ErrorMsg,
  type ServerMessage,
} from "@echowake/protocol";
import type { WebSocket } from "ws";
import type { Client } from "./client.js";
import type { LobbyRegistry } from "./lobby.js";
import { Match } from "./match.js";

/** Strips control characters and trims; the codec already bounds lengths. */
function sanitizeText(s: string): string {
  return s.replace(/[\u0000-\u001f\u007f]/g, "").trim();
}

// Inbound rate limit (token bucket, per connection): the capacity/refill sit
// comfortably above the 20Hz input cadence plus chat, but stop message floods
// and lobby-code brute forcing. Wall clock is fine at this transport boundary
// — it never touches simulation state.
const RATE_CAPACITY = 40;
const RATE_REFILL_PER_S = 30;
/** A connection that keeps flooding (this many dropped messages) is closed. */
const RATE_DROP_LIMIT = 200;

/**
 * Wires one raw WebSocket into the game: enforces the hello/welcome handshake
 * (protocol version check), then dispatches decoded messages to lobby/match
 * logic. Every inbound frame goes through decodeClientMessage — raw JSON is
 * never parsed here.
 */
export function handleConnection(socket: WebSocket, registry: LobbyRegistry): void {
  let client: Client | null = null;
  let tokens = RATE_CAPACITY;
  let lastRefillMs = Date.now();
  let dropped = 0;

  /** Takes one rate-limit token (refilling by elapsed time); false = drop. */
  const takeToken = (): boolean => {
    const now = Date.now();
    tokens = Math.min(tokens + ((now - lastRefillMs) / 1000) * RATE_REFILL_PER_S, RATE_CAPACITY);
    lastRefillMs = now;
    if (tokens < 1) return false;
    tokens -= 1;
    return true;
  };

  const send = (msg: ServerMessage): void => {
    if (socket.readyState === socket.OPEN) socket.send(encodeMessage(msg));
  };
  const sendError = (code: ErrorMsg["code"], message: string): void => {
    send({ type: "error", code, message });
  };

  const handleHello = (msg: Extract<ClientMessage, { type: "hello" }>): void => {
    if (client) {
      sendError("badMessage", "hello already received");
      return;
    }
    if (msg.protocolVersion !== PROTOCOL_VERSION) {
      sendError(
        "badProtocolVersion",
        `server speaks protocol ${PROTOCOL_VERSION}, client sent ${msg.protocolVersion}`,
      );
      socket.close(1002, "protocol version mismatch");
      return;
    }
    const name = sanitizeText(msg.name).slice(0, 20) || "Player";
    client = {
      playerId: randomUUID(),
      name,
      lobby: null,
      send,
      close: (code?: number, reason?: string) => socket.close(code, reason),
    };
    send({ type: "welcome", playerId: client.playerId });
  };

  const handleMessage = (c: Client, msg: ClientMessage): void => {
    switch (msg.type) {
      case "hello":
        sendError("badMessage", "hello already received");
        return;
      case "ping": {
        // Latency probe: echo `t` verbatim, immediately, before any
        // lobby/match dispatch. `t` is opaque to the server (the client
        // computes RTT from it); the rate limiter above still applies.
        send({ type: "pong", t: msg.t });
        return;
      }
      case "createLobby": {
        c.lobby?.remove(c);
        const lobby = registry.create(c);
        lobby.broadcastState();
        return;
      }
      case "joinLobby": {
        const lobby = registry.get(msg.code);
        if (!lobby) {
          sendError("lobbyNotFound", `no lobby with code ${msg.code.toUpperCase()}`);
          return;
        }
        if (lobby.match) {
          sendError("matchAlreadyStarted", "that lobby is mid-match");
          return;
        }
        if (lobby.isFull()) {
          sendError("lobbyFull", "that lobby is full");
          return;
        }
        c.lobby?.remove(c);
        lobby.add(c);
        return;
      }
      case "leaveLobby": {
        if (!c.lobby) {
          sendError("notInLobby", "you are not in a lobby");
          return;
        }
        c.lobby.remove(c);
        return;
      }
      case "startMatch": {
        const lobby = c.lobby;
        if (!lobby) {
          sendError("notInLobby", "you are not in a lobby");
          return;
        }
        if (lobby.hostId !== c.playerId) {
          sendError("notHost", "only the host can start the match");
          return;
        }
        if (lobby.match) {
          sendError("matchAlreadyStarted", "the match is already running");
          return;
        }
        const sizeCap = MAX_PLAYERS_PER_SIZE[msg.options.size];
        if (lobby.memberCount > sizeCap) {
          sendError(
            "tooManyPlayersForSize",
            `${msg.options.size} supports at most ${sizeCap} players`,
          );
          return;
        }
        // Empty host seed => server picks one. crypto randomness is fine at
        // this boundary: the resulting string becomes the shared deterministic
        // input for maze generation and simulation on server and clients.
        const seed = msg.options.seed.trim() || randomUUID();
        // Safety net: an exception while building/starting the match must
        // never escape the message handler and kill the whole process.
        try {
          const match = new Match(lobby, { ...msg.options, seed });
          lobby.match = match;
          match.start();
        } catch {
          lobby.match?.abort();
          lobby.match = null;
          sendError("badMessage", "failed to start match");
        }
        return;
      }
      case "input": {
        c.lobby?.match?.handleInput(c, msg);
        return;
      }
      case "addBot": {
        const lobby = c.lobby;
        if (!lobby) {
          sendError("notInLobby", "you are not in a lobby");
          return;
        }
        if (lobby.hostId !== c.playerId) {
          sendError("notHost", "only the host can add bots");
          return;
        }
        if (lobby.isFull()) {
          sendError("lobbyFull", "the lobby is full");
          return;
        }
        lobby.addBot();
        return;
      }
      case "removeBot": {
        const lobby = c.lobby;
        if (!lobby) {
          sendError("notInLobby", "you are not in a lobby");
          return;
        }
        if (lobby.hostId !== c.playerId) {
          sendError("notHost", "only the host can remove bots");
          return;
        }
        if (!lobby.removeBot(msg.playerId)) {
          sendError("badMessage", "that id is not a bot in this lobby");
        }
        return;
      }
      case "setLobbyPublic": {
        const lobby = c.lobby;
        if (!lobby) {
          sendError("notInLobby", "you are not in a lobby");
          return;
        }
        if (lobby.hostId !== c.playerId) {
          sendError("notHost", "only the host can list the lobby publicly");
          return;
        }
        lobby.setPublic(msg.isPublic);
        return;
      }
      case "listLobbies": {
        // Any hello'd client may browse — it only ever exposes lobbies whose
        // hosts opted into the public list; private codes stay secret.
        send({ type: "lobbyList", lobbies: registry.listPublic() });
        return;
      }
      case "chat": {
        if (!c.lobby) {
          sendError("notInLobby", "you are not in a lobby");
          return;
        }
        const text = sanitizeText(msg.text);
        if (!text) return;
        c.lobby.broadcast({
          type: "chatBroadcast",
          playerId: c.playerId,
          name: c.name,
          text,
        });
        return;
      }
    }
  };

  socket.on("message", (data: Buffer | ArrayBuffer | Buffer[]) => {
    if (!takeToken()) {
      dropped++;
      if (dropped >= RATE_DROP_LIMIT) {
        sendError("badMessage", "rate limit exceeded");
        socket.close(1008, "rate limit exceeded");
      }
      return;
    }
    const msg = decodeClientMessage(data.toString());
    if (!msg) {
      sendError("badMessage", "malformed message");
      if (!client) socket.close(1002, "malformed message before hello");
      return;
    }
    if (!client) {
      if (msg.type !== "hello") {
        sendError("badMessage", "hello must be the first message");
        socket.close(1002, "hello required");
        return;
      }
      handleHello(msg);
      return;
    }
    handleMessage(client, msg);
  });

  socket.on("close", () => {
    client?.lobby?.remove(client);
  });

  socket.on("error", () => {
    // Transport errors are followed by "close"; nothing else to do here.
  });
}
