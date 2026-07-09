import { randomUUID } from "node:crypto";
import { MAX_PLAYERS_PER_SIZE, PROTOCOL_VERSION } from "@labyrinth/common";
import {
  decodeClientMessage,
  encodeMessage,
  type ClientMessage,
  type ErrorMsg,
  type ServerMessage,
} from "@labyrinth/protocol";
import type { WebSocket } from "ws";
import type { Client } from "./client.js";
import type { LobbyRegistry } from "./lobby.js";
import { Match } from "./match.js";

/** Strips control characters and trims; the codec already bounds lengths. */
function sanitizeText(s: string): string {
  return s.replace(/[\u0000-\u001f\u007f]/g, "").trim();
}

/**
 * Wires one raw WebSocket into the game: enforces the hello/welcome handshake
 * (protocol version check), then dispatches decoded messages to lobby/match
 * logic. Every inbound frame goes through decodeClientMessage — raw JSON is
 * never parsed here.
 */
export function handleConnection(socket: WebSocket, registry: LobbyRegistry): void {
  let client: Client | null = null;

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
        if (lobby.clients.length > sizeCap) {
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
        const match = new Match(lobby, { ...msg.options, seed });
        lobby.match = match;
        match.start();
        return;
      }
      case "input": {
        c.lobby?.match?.handleInput(c, msg);
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
