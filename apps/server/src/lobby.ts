import { MAX_PLAYERS } from "@labyrinth/common";
import type { LobbyStateMsg, ServerMessage } from "@labyrinth/protocol";
import type { Client } from "./client.js";
import type { Match } from "./match.js";

const CODE_LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
const CODE_LENGTH = 4;

/**
 * A lobby of up to MAX_PLAYERS clients identified by a 4-letter code.
 * The first client (creator) is host; the host slot is promoted on leave.
 */
export class Lobby {
  readonly code: string;
  hostId: string;
  /** Members in join order — this order becomes match slot / spawn order. */
  readonly clients: Client[] = [];
  /** The running match, or null while in the pre-match lobby screen. */
  match: Match | null = null;

  private readonly registry: LobbyRegistry;

  constructor(code: string, host: Client, registry: LobbyRegistry) {
    this.code = code;
    this.hostId = host.playerId;
    this.registry = registry;
    this.clients.push(host);
    host.lobby = this;
  }

  /** True when no further players may join. */
  isFull(): boolean {
    return this.clients.length >= MAX_PLAYERS;
  }

  /** Adds a member (caller must have checked isFull/match) and broadcasts state. */
  add(client: Client): void {
    this.clients.push(client);
    client.lobby = this;
    this.broadcastState();
  }

  /**
   * Removes a member: pulls them out of a running match, promotes a new host
   * if needed, deletes the lobby when it empties, and broadcasts the change.
   */
  remove(client: Client): void {
    const i = this.clients.indexOf(client);
    if (i === -1) return;
    this.clients.splice(i, 1);
    client.lobby = null;
    this.match?.removePlayer(client);

    if (this.clients.length === 0) {
      this.match?.abort();
      this.registry.delete(this);
      return;
    }
    if (this.hostId === client.playerId) {
      const next = this.clients[0];
      if (next) this.hostId = next.playerId;
    }
    this.broadcastState();
  }

  /** Sends `msg` to every member of the lobby. */
  broadcast(msg: ServerMessage): void {
    for (const c of this.clients) c.send(msg);
  }

  /** Broadcasts the current lobbyState to every member. */
  broadcastState(): void {
    const msg: LobbyStateMsg = {
      type: "lobbyState",
      code: this.code,
      hostId: this.hostId,
      players: this.clients.map((c) => ({ playerId: c.playerId, name: c.name, isBot: false })),
    };
    this.broadcast(msg);
  }
}

/**
 * Owns all live lobbies and their codes. Code generation is transport-level
 * (never simulation state), so unseeded randomness is fine here.
 */
export class LobbyRegistry {
  private readonly lobbies = new Map<string, Lobby>();

  /** Creates a new lobby with a unique random 4-letter code; `host` becomes host. */
  create(host: Client): Lobby {
    let code: string;
    do {
      code = "";
      for (let i = 0; i < CODE_LENGTH; i++) {
        code += CODE_LETTERS[Math.floor(Math.random() * CODE_LETTERS.length)];
      }
    } while (this.lobbies.has(code));
    const lobby = new Lobby(code, host, this);
    this.lobbies.set(code, lobby);
    return lobby;
  }

  /** Looks up a lobby by its case-insensitive 4-letter code. */
  get(code: string): Lobby | undefined {
    return this.lobbies.get(code.toUpperCase());
  }

  /** Drops an (empty) lobby from the registry. */
  delete(lobby: Lobby): void {
    this.lobbies.delete(lobby.code);
  }
}
