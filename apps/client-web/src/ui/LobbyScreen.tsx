import { useState } from "react";
import { MAX_PLAYERS, MAX_PLAYERS_PER_SIZE, MAZE_DIMENSIONS, type MazeSize } from "@echowake/common";
import type { GameSession } from "../net/session";
import type { UiState } from "../app/store";

const SIZES = Object.keys(MAZE_DIMENSIONS) as MazeSize[];

/** Lobby: code display, live roster, host-only size picker + Start. */
export function LobbyScreen({ session, ui }: { session: GameSession; ui: UiState }) {
  const [size, setSize] = useState<MazeSize>("medium");
  const lobby = ui.lobby;
  if (lobby === null) return null;
  const isHost = ui.selfId !== null && ui.selfId === lobby.hostId;

  return (
    <div className="screen">
      <div className="panel">
        <p className="subtitle">share this code with friends</p>
        <div className="lobby-code">{lobby.code}</div>
        <ul className="player-list">
          {lobby.players.map((p) => (
            <li key={p.playerId}>
              {p.name}
              {p.playerId === lobby.hostId && <span className="host-tag">HOST</span>}
              {p.playerId === ui.selfId && <span className="host-tag">YOU</span>}
              {p.isBot && <span className="host-tag">BOT</span>}
              {p.isBot && isHost && (
                <button
                  className="remove-bot"
                  title="Remove bot"
                  aria-label={`Remove ${p.name}`}
                  onClick={() => session.removeBot(p.playerId)}
                >
                  ✕
                </button>
              )}
            </li>
          ))}
        </ul>
        <p className="muted">
          {lobby.players.length} player{lobby.players.length === 1 ? "" : "s"}
        </p>
        {isHost ? (
          <>
            <label className="row checkbox">
              <input
                type="checkbox"
                checked={lobby.isPublic}
                onChange={(e) => session.setLobbyPublic(e.target.checked)}
              />
              List publicly
            </label>
            <label className="field">
              maze size
              <select value={size} onChange={(e) => setSize(e.target.value as MazeSize)}>
                {SIZES.map((s) => (
                  <option key={s} value={s} disabled={lobby.players.length > MAX_PLAYERS_PER_SIZE[s]}>
                    {s} ({MAZE_DIMENSIONS[s].width}x{MAZE_DIMENSIONS[s].height}, max{" "}
                    {MAX_PLAYERS_PER_SIZE[s]} players)
                  </option>
                ))}
              </select>
            </label>
            <button
              className="secondary"
              disabled={lobby.players.length >= MAX_PLAYERS}
              onClick={() => session.addBot()}
            >
              Add bot
            </button>
            <button
              disabled={lobby.players.length > MAX_PLAYERS_PER_SIZE[size]}
              onClick={() => session.startMatch(size)}
            >
              Start match
            </button>
          </>
        ) : (
          <p className="muted">waiting for the host to start…</p>
        )}
        <button className="secondary" onClick={() => session.leaveLobby()}>
          Leave lobby
        </button>
        <p className="error">{ui.error ?? ""}</p>
        <span className={`conn ${ui.connection}`}>
          server: {ui.connection}
          {ui.serverHost !== null ? ` (${ui.serverHost})` : ""}
          {ui.pingMs !== null ? ` · ${Math.round(ui.pingMs)} ms` : ""}
        </span>
      </div>
    </div>
  );
}
