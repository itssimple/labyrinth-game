import { PROTOCOL_VERSION, TICK_RATE, type MazeSize } from "@labyrinth/common";
import { generateMaze } from "@labyrinth/mazegen";
import type {
  ClientMessage,
  LobbyStateMsg,
  MatchEndMsg,
  MatchStartMsg,
  ServerMessage,
  SnapshotMsg,
} from "@labyrinth/protocol";
import { UiStore, type ChatEntry } from "../app/store";
import { InputTracker } from "../game/input";
import { GameRenderer } from "../game/renderer";
import { createMatchView, type MatchView } from "../game/state";
import { GameSocket, serverUrl, type SocketStatus } from "./socket";

const LOBBY_CODE_RE = /^[A-Za-z]{4}$/;
const CHAT_KEEP = 50;

/**
 * Owns everything React must not: the WebSocket, the match state (snapshot
 * buffer, fog memory, sound queue) and the Pixi renderer lifecycle. React
 * screens observe only the coarse UiStore and call the intent methods below.
 */
export class GameSession {
  readonly store = new UiStore();
  readonly keyboard = new InputTracker();

  private socket: GameSocket | null = null;
  private welcomed = false;
  private myName = "";
  private pendingAction: ClientMessage | null = null;
  private match: MatchView | null = null;
  private renderer: GameRenderer | null = null;
  private mountToken = 0;
  private inputTimer: ReturnType<typeof setInterval> | null = null;
  private inputSeq = 0;
  private chatSeq = 0;
  private readonly nameById = new Map<string, string>();

  // -- intents from React ---------------------------------------------------

  /** Hosts a new lobby (connects + hello first if needed). */
  host(name: string): void {
    this.begin(name, { type: "createLobby" });
  }

  /** Joins an existing lobby by 4-letter code. */
  join(name: string, code: string): void {
    const trimmed = code.trim();
    if (!LOBBY_CODE_RE.test(trimmed)) {
      this.store.set({ error: "Lobby code must be 4 letters." });
      return;
    }
    this.begin(name, { type: "joinLobby", code: trimmed.toUpperCase() });
  }

  /** Leaves the current lobby and returns to the main menu. */
  leaveLobby(): void {
    this.socket?.send({ type: "leaveLobby" });
    this.store.set({ screen: "menu", lobby: null, error: null });
  }

  /** Host only: asks the server to start the match (server picks the seed). */
  startMatch(size: MazeSize): void {
    this.socket?.send({ type: "startMatch", options: { seed: "", size } });
  }

  /** Sends a chat message (trimmed, clamped to protocol limit). */
  sendChat(text: string): void {
    const t = text.trim().slice(0, 200);
    if (t.length > 0) this.socket?.send({ type: "chat", text: t });
  }

  /** From the match-end screen: back to the (already reset) lobby. */
  backToLobby(): void {
    const { lobby } = this.store.get();
    this.store.set({ screen: lobby !== null ? "lobby" : "menu", matchResult: null, hud: null });
  }

  /** Chat overlay open/closed — movement keys go idle while typing. */
  setChatOpen(open: boolean): void {
    this.keyboard.enabled = !open;
  }

  // -- connection -----------------------------------------------------------

  private begin(name: string, action: ClientMessage): void {
    const clean = name.trim().slice(0, 20);
    if (clean.length === 0) {
      this.store.set({ error: "Enter a name first." });
      return;
    }
    this.myName = clean;
    this.store.set({ error: null });
    if (this.socket !== null && this.socket.isOpen && this.welcomed) {
      this.socket.send(action);
      return;
    }
    this.pendingAction = action;
    this.socket?.close();
    this.welcomed = false;
    this.socket = new GameSocket(serverUrl(), {
      onMessage: (msg) => this.onMessage(msg),
      onStatus: (status) => this.onStatus(status),
    });
  }

  private onStatus(status: SocketStatus): void {
    if (status === "connecting") {
      this.store.set({ connection: "connecting" });
      return;
    }
    if (status === "open") {
      this.store.set({ connection: "connected" });
      this.socket?.send({ type: "hello", protocolVersion: PROTOCOL_VERSION, name: this.myName });
      return;
    }
    // Lost the server: drop all transient state, back to the menu.
    this.stopInputLoop();
    this.match = null;
    this.socket = null;
    this.welcomed = false;
    this.store.set({
      connection: "disconnected",
      screen: "menu",
      lobby: null,
      hud: null,
      matchResult: null,
      error: "Connection to server lost.",
    });
  }

  // -- server messages ------------------------------------------------------

  private onMessage(msg: ServerMessage): void {
    switch (msg.type) {
      case "welcome": {
        this.welcomed = true;
        this.store.set({ selfId: msg.playerId });
        if (this.pendingAction !== null) {
          this.socket?.send(this.pendingAction);
          this.pendingAction = null;
        }
        break;
      }
      case "error":
        this.store.set({ error: msg.message });
        break;
      case "lobbyState":
        this.onLobbyState(msg);
        break;
      case "matchStart":
        this.onMatchStart(msg);
        break;
      case "snapshot":
        this.onSnapshot(msg);
        break;
      case "matchEnd":
        this.onMatchEnd(msg);
        break;
      case "chatBroadcast": {
        const entry: ChatEntry = { id: ++this.chatSeq, name: msg.name, text: msg.text };
        const chat = [...this.store.get().chat, entry].slice(-CHAT_KEEP);
        this.store.set({ chat });
        break;
      }
    }
  }

  private onLobbyState(msg: LobbyStateMsg): void {
    this.nameById.clear();
    for (const p of msg.players) this.nameById.set(p.playerId, p.name);
    const screen = this.store.get().screen;
    this.store.set({
      lobby: { code: msg.code, hostId: msg.hostId, players: msg.players },
      // Entering/staying in the lobby, unless mid-game or reading results.
      screen: screen === "menu" ? "lobby" : screen,
    });
  }

  private onMatchStart(msg: MatchStartMsg): void {
    // Deterministic: regenerate the exact maze the server generated.
    const maze = generateMaze(msg.options);
    this.match = createMatchView(maze, msg.endTick, msg.yourSpawnIndex);
    this.inputSeq = 0;
    this.keyboard.enabled = true;
    this.store.set({
      screen: "game",
      matchResult: null,
      chat: [],
      hud: { remainingS: Math.ceil(msg.endTick / TICK_RATE), escaped: false },
      error: null,
    });
    this.startInputLoop();
  }

  private onSnapshot(msg: SnapshotMsg): void {
    const match = this.match;
    if (match === null) return;
    const recvMs = performance.now();
    match.latestTick = msg.tick;
    match.you.push(msg.you.x, msg.you.y, recvMs);
    match.others.update(msg.visiblePlayers, msg.tick, recvMs);
    match.fog.update(msg.visibleCells, msg.tick / TICK_RATE);
    match.fogDirty = true;
    if (msg.sounds.length > 0) match.soundQueue.push(...msg.sounds);
    match.escaped = msg.you.escaped;

    const remainingS = Math.max(0, Math.ceil((match.endTick - msg.tick) / TICK_RATE));
    const hud = this.store.get().hud;
    if (hud === null || hud.remainingS !== remainingS || hud.escaped !== match.escaped) {
      this.store.set({ hud: { remainingS, escaped: match.escaped } });
    }
  }

  private onMatchEnd(msg: MatchEndMsg): void {
    this.stopInputLoop();
    this.match = null;
    this.store.set({
      screen: "end",
      hud: null,
      matchResult: {
        reason: msg.reason,
        escaped: msg.escaped.map((id) => ({ id, name: this.nameById.get(id) ?? "???" })),
      },
    });
  }

  // -- input loop (transport pacing only; gameplay stays server-side) --------

  private startInputLoop(): void {
    this.stopInputLoop();
    this.inputTimer = setInterval(() => {
      if (this.match === null || this.store.get().screen !== "game") return;
      const sample = this.keyboard.read();
      this.socket?.send({ type: "input", seq: ++this.inputSeq, ...sample });
    }, 1000 / TICK_RATE);
  }

  private stopInputLoop(): void {
    if (this.inputTimer !== null) {
      clearInterval(this.inputTimer);
      this.inputTimer = null;
    }
  }

  // -- renderer lifecycle (called by the Game screen's mount effect) ---------

  /** Mounts the Pixi canvas for the current match into `container`. */
  async mountGame(container: HTMLElement): Promise<void> {
    const match = this.match;
    if (match === null) return;
    const token = ++this.mountToken;
    this.keyboard.attach();
    const renderer = await GameRenderer.create(container, match);
    if (token !== this.mountToken || this.match !== match) {
      renderer.destroy(); // unmounted (or match ended) while init was pending
      return;
    }
    this.renderer = renderer;
  }

  /** Unmounts and destroys the Pixi renderer. */
  unmountGame(): void {
    this.mountToken++;
    this.keyboard.detach();
    this.keyboard.enabled = true;
    this.renderer?.destroy();
    this.renderer = null;
  }
}
