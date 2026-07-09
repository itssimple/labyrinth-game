import { PROTOCOL_VERSION, TICK_RATE, type MazeSize } from "@echowake/common";
import { generateMaze } from "@echowake/mazegen";
import type {
  ClientMessage,
  LobbyStateMsg,
  MatchEndMsg,
  MatchStartMsg,
  ServerMessage,
  SnapshotMsg,
} from "@echowake/protocol";
import { UiStore, type ChatEntry } from "../app/store";
import { AudioEngine } from "../audio/engine";
import { FootstepCadence, type MoveMode } from "../audio/spatial";
import { InputTracker } from "../game/input";
import { GameRenderer } from "../game/renderer";
import { createMatchView, type MatchView } from "../game/state";
import { PING_INTERVAL_MS, smoothPing } from "./ping";
import { serverUrlHost } from "./serverUrl";
import { GameSocket, serverUrl, type SocketStatus } from "./socket";

const LOBBY_CODE_RE = /^[A-Za-z]{4}$/;
const CHAT_KEEP = 50;
/** Hard cap on queued-but-unrendered sounds (hidden tabs stop draining). */
const SOUND_QUEUE_MAX = 64;

/**
 * Owns everything React must not: the WebSocket, the match state (snapshot
 * buffer, fog memory, sound queue) and the Pixi renderer lifecycle. React
 * screens observe only the coarse UiStore and call the intent methods below.
 */
export class GameSession {
  readonly store = new UiStore();
  readonly keyboard = new InputTracker();
  /** Presentation-only synthesized audio; unlocked by the first menu gesture. */
  readonly audio = new AudioEngine();

  private socket: GameSocket | null = null;
  private welcomed = false;
  private myName = "";
  private pendingAction: ClientMessage | null = null;
  private match: MatchView | null = null;
  private renderer: GameRenderer | null = null;
  private mountToken = 0;
  private inputTimer: ReturnType<typeof setInterval> | null = null;
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private inputSeq = 0;
  private chatSeq = 0;
  private readonly nameById = new Map<string, string>();
  /** Own-footstep bookkeeping (audio only): cadence + last snapshot position. */
  private readonly footsteps = new FootstepCadence();
  private lastYou: { x: number; y: number } | null = null;

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

  /** Opens the public lobby browser (connects + hello first if needed). */
  browsePublic(name: string): void {
    if (name.trim().length === 0) {
      this.store.set({ error: "Enter a name first." });
      return;
    }
    this.store.set({ screen: "browse", lobbyList: null });
    this.begin(name, { type: "listLobbies" });
  }

  /** Re-requests the public lobby list (browse screen's Refresh). */
  refreshLobbies(): void {
    this.socket?.send({ type: "listLobbies" });
  }

  /** Joins a lobby picked in the browser (name was set when browsing began). */
  joinFromBrowser(code: string): void {
    this.join(this.myName, code);
  }

  /** Back from the browse screen to the main menu. */
  leaveBrowse(): void {
    this.store.set({ screen: "menu", error: null });
  }

  /** Host only: lists (or unlists) the lobby in the public browser. */
  setLobbyPublic(isPublic: boolean): void {
    this.socket?.send({ type: "setLobbyPublic", isPublic });
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

  /** Host only: asks the server to add an AI bot to the lobby. */
  addBot(): void {
    this.socket?.send({ type: "addBot" });
  }

  /** Host only: asks the server to remove the bot with this playerId. */
  removeBot(playerId: string): void {
    this.socket?.send({ type: "removeBot", playerId });
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
    // Host/Join/Browse clicks are user gestures — the one moment the browser
    // lets us create/resume the AudioContext (autoplay policy).
    this.audio.unlock();
    if (this.socket !== null && this.socket.isOpen && this.welcomed) {
      this.socket.send(action);
      return;
    }
    this.pendingAction = action;
    // Intentional close suppresses the "closed" status callback, so stop the
    // ping loop here; the new socket's "open" restarts it.
    this.stopPingLoop();
    this.socket?.close();
    this.welcomed = false;
    // Resolved at Host/Join time (not module load) so editing the menu's
    // server-address field takes effect without a page reload.
    const url = serverUrl();
    this.store.set({ serverHost: serverUrlHost(url) });
    this.socket = new GameSocket(url, {
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
      // hello was just written to the (ordered) socket, so pings can never
      // arrive at the server before it — safe to start probing right away.
      this.startPingLoop();
      return;
    }
    // Lost the server: drop all transient state, back to the menu.
    this.stopInputLoop();
    this.stopPingLoop();
    this.match = null;
    this.socket = null;
    this.welcomed = false;
    this.store.set({
      connection: "disconnected",
      screen: "menu",
      lobby: null,
      lobbyList: null,
      pingMs: null,
      fps: null,
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
      case "lobbyList":
        this.store.set({ lobbyList: msg.lobbies });
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
      case "pong": {
        // RTT from the echoed send timestamp; smoothed (EMA) for the HUD.
        const rtt = performance.now() - msg.t;
        this.store.set({ pingMs: smoothPing(this.store.get().pingMs, rtt) });
        break;
      }
      case "chatBroadcast": {
        const entry: ChatEntry = { id: ++this.chatSeq, name: msg.name, text: msg.text };
        const chat = [...this.store.get().chat, entry].slice(-CHAT_KEEP);
        this.store.set({ chat });
        break;
      }
    }
  }

  private onLobbyState(msg: LobbyStateMsg): void {
    // Upsert, never clear: players who leave mid-match (e.g. after escaping)
    // must still resolve to a name on the match-end screen.
    for (const p of msg.players) this.nameById.set(p.playerId, p.name);
    const screen = this.store.get().screen;
    this.store.set({
      lobby: {
        code: msg.code,
        hostId: msg.hostId,
        players: msg.players,
        isPublic: msg.isPublic,
      },
      // Entering/staying in the lobby, unless mid-game or reading results.
      screen: screen === "menu" || screen === "browse" ? "lobby" : screen,
    });
  }

  private onMatchStart(msg: MatchStartMsg): void {
    // Deterministic: regenerate the exact maze the server generated.
    const maze = generateMaze(msg.options);
    this.match = createMatchView(maze, msg.endTick, msg.yourSpawnIndex);
    this.inputSeq = 0;
    this.footsteps.reset();
    this.lastYou = null;
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
    if (msg.sounds.length > 0) {
      // Bound the queue: a hidden tab pauses the renderer (rAF) while
      // snapshots keep arriving, so drop sounds older than a second and cap
      // the backlog — refocusing must not flood thousands of ripples.
      const minTick = msg.tick - TICK_RATE;
      const queue = match.soundQueue.filter((s) => s.tick >= minTick);
      queue.push(...msg.sounds);
      match.soundQueue = queue.length > SOUND_QUEUE_MAX ? queue.slice(-SOUND_QUEUE_MAX) : queue;
    }
    match.escaped = msg.you.escaped;
    this.hearOwnFootsteps(msg.you);

    const remainingS = Math.max(0, Math.ceil((match.endTick - msg.tick) / TICK_RATE));
    const hud = this.store.get().hud;
    if (hud === null || hud.remainingS !== remainingS || hud.escaped !== match.escaped) {
      this.store.set({ hud: { remainingS, escaped: match.escaped } });
    }
  }

  /**
   * Synthesizes your own footsteps from snapshot `you` movement (the server
   * never echoes your own sounds back). Same distance cadence as the
   * simulation's footstep emission; mode from the held keys (sneak wins over
   * sprint, exactly like the sim). Presentation only.
   */
  private hearOwnFootsteps(you: SnapshotMsg["you"]): void {
    const prev = this.lastYou;
    this.lastYou = { x: you.x, y: you.y };
    if (prev === null || you.escaped) return;
    const sample = this.keyboard.read();
    const mode: MoveMode = sample.sneak ? "sneak" : sample.sprint ? "sprint" : "walk";
    const steps = this.footsteps.advance(Math.hypot(you.x - prev.x, you.y - prev.y), mode);
    for (let i = 0; i < steps; i++) this.audio.playOwnFootstep(mode);
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

  // -- latency probing (transport-level; never touches gameplay state) -------

  /** Pings every PING_INTERVAL_MS from connect; RTT lands in store.pingMs. */
  private startPingLoop(): void {
    this.stopPingLoop();
    const ping = () => this.socket?.send({ type: "ping", t: performance.now() });
    ping(); // immediate first probe so the HUD fills in fast
    this.pingTimer = setInterval(ping, PING_INTERVAL_MS);
  }

  private stopPingLoop(): void {
    if (this.pingTimer !== null) {
      clearInterval(this.pingTimer);
      this.pingTimer = null;
    }
  }

  // -- renderer lifecycle (called by the Game screen's mount effect) ---------

  /** Mounts the Pixi canvas for the current match into `container`. */
  async mountGame(container: HTMLElement): Promise<void> {
    const match = this.match;
    if (match === null) return;
    const token = ++this.mountToken;
    this.keyboard.attach();
    const renderer = await GameRenderer.create(container, match, this.audio, {
      onFps: (fps) => this.store.set({ fps }),
    });
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
    this.store.set({ fps: null }); // no renderer, no frame rate
  }
}
