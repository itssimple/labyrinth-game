import { randomUUID } from "node:crypto";
import { botName } from "@labyrinth/bots";
import { MAX_PLAYERS } from "@labyrinth/common";
import type { LobbyStateMsg, ServerMessage } from "@labyrinth/protocol";
import type { Client } from "./client.js";
import type { Match } from "./match.js";

const CODE_LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
const CODE_LENGTH = 4;

/** An AI player owned by the lobby. Persists across matches until removed. */
export interface LobbyBot {
  /** Random connection-style identity, like a human's (not simulation state). */
  readonly playerId: string;
  readonly name: string;
  /** botName() index; freed on removal so the lowest unused name is reused. */
  readonly nameIndex: number;
}

/**
 * A lobby of up to MAX_PLAYERS members (clients + bots) identified by a
 * 4-letter code. The first client (creator) is host; the host slot is
 * promoted on leave.
 */
export class Lobby {
  readonly code: string;
  hostId: string;
  /** Members in join order — this order becomes match slot / spawn order. */
  readonly clients: Client[] = [];
  /** AI players; in match slot order they come after every human. */
  readonly bots: LobbyBot[] = [];
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

  /** Total roster size — humans and bots both occupy player slots. */
  get memberCount(): number {
    return this.clients.length + this.bots.length;
  }

  /** True when no further players (human or bot) may join. */
  isFull(): boolean {
    return this.memberCount >= MAX_PLAYERS;
  }

  /**
   * Adds one AI bot (caller must have checked host + isFull) named with the
   * lowest botName index not already in use, and broadcasts the change.
   */
  addBot(): LobbyBot {
    const used = new Set(this.bots.map((b) => b.nameIndex));
    let nameIndex = 0;
    while (used.has(nameIndex)) nameIndex++;
    const bot: LobbyBot = { playerId: randomUUID(), name: botName(nameIndex), nameIndex };
    this.bots.push(bot);
    this.broadcastState();
    return bot;
  }

  /**
   * Removes the bot with `playerId` (also from a running match) and
   * broadcasts the change. False when the id is not a bot in this lobby.
   */
  removeBot(playerId: string): boolean {
    const i = this.bots.findIndex((b) => b.playerId === playerId);
    if (i === -1) return false;
    this.bots.splice(i, 1);
    this.match?.removeBot(playerId);
    this.broadcastState();
    return true;
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
      players: [
        ...this.clients.map((c) => ({ playerId: c.playerId, name: c.name, isBot: false })),
        ...this.bots.map((b) => ({ playerId: b.playerId, name: b.name, isBot: true })),
      ],
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

  /** Snapshot of all live lobbies (safe to remove lobbies while iterating). */
  all(): Lobby[] {
    return [...this.lobbies.values()];
  }

  /** Aggregate counters for GET /metrics. */
  stats(): { lobbies: number; players: number; botsInLobbies: number; runningMatches: number } {
    let players = 0;
    let botsInLobbies = 0;
    let runningMatches = 0;
    for (const lobby of this.lobbies.values()) {
      players += lobby.clients.length;
      botsInLobbies += lobby.bots.length;
      if (lobby.match) runningMatches++;
    }
    return { lobbies: this.lobbies.size, players, botsInLobbies, runningMatches };
  }

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
