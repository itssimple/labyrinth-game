import { useEffect, useRef, useState } from "react";
import type { GameSession } from "../net/session";
import type { UiState } from "../app/store";
import { VolumeControl } from "./VolumeControl";

/** Formats whole seconds as m:ss. */
function fmtTime(s: number): string {
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return `${m}:${sec.toString().padStart(2, "0")}`;
}

/** Smoothed RTT for the HUD; em dash until the first pong lands. */
function fmtPing(pingMs: number | null): string {
  return pingMs === null ? "— ms" : `${Math.round(pingMs)} ms`;
}

/**
 * Game screen: hosts the Pixi canvas (owned by GameSession) plus a DOM HUD
 * and the chat overlay. Renders coarse state only — gameplay stays in the
 * session/renderer.
 */
export function GameScreen({ session, ui }: { session: GameSession; ui: UiState }) {
  const canvasHost = useRef<HTMLDivElement>(null);
  const [chatOpen, setChatOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const [rosterOpen, setRosterOpen] = useState(false);

  // Mount/unmount the Pixi renderer into our div.
  useEffect(() => {
    const el = canvasHost.current;
    if (el !== null) void session.mountGame(el);
    return () => session.unmountGame();
  }, [session]);

  // Enter opens the chat overlay while playing.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!chatOpen && e.key === "Enter") {
        setChatOpen(true);
        session.setChatOpen(true);
        e.preventDefault();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [chatOpen, session]);

  // Hold Tab -> roster overlay. preventDefault keeps Tab from moving focus
  // out of the game; the overlay never opens while the chat input is up
  // (the chat input also stopPropagation()s its own keys).
  useEffect(() => {
    const onDown = (e: KeyboardEvent) => {
      if (e.key !== "Tab") return;
      e.preventDefault();
      if (!chatOpen && !e.repeat) setRosterOpen(true);
    };
    const onUp = (e: KeyboardEvent) => {
      if (e.key === "Tab") setRosterOpen(false);
    };
    const onBlur = () => setRosterOpen(false);
    window.addEventListener("keydown", onDown);
    window.addEventListener("keyup", onUp);
    window.addEventListener("blur", onBlur);
    return () => {
      window.removeEventListener("keydown", onDown);
      window.removeEventListener("keyup", onUp);
      window.removeEventListener("blur", onBlur);
    };
  }, [chatOpen]);

  const closeChat = () => {
    setChatOpen(false);
    setDraft("");
    session.setChatOpen(false);
  };

  const recentChat = ui.chat.slice(-6);

  return (
    <div className="game-root">
      <div ref={canvasHost} className="game-canvas" />
      <div className="hud">
        <span className="timer">{fmtTime(ui.hud?.remainingS ?? 0)}</span>
        <span className="code">{ui.lobby?.code ?? ""}</span>
        <span className={`conn ${ui.connection}`}>{ui.connection}</span>
        <span className="ping">{fmtPing(ui.pingMs)}</span>
        <span className="fps">{ui.fps !== null ? `${ui.fps} fps` : ""}</span>
        <span style={{ marginLeft: "auto", color: "#666680", fontSize: 11 }}>
          WASD move · Shift sprint · Ctrl/C sneak · Enter chat · Tab players
        </span>
        <VolumeControl audio={session.audio} compact />
      </div>
      {ui.hud?.escaped === true && <div className="escaped-banner">ESCAPED!</div>}
      {rosterOpen && !chatOpen && (
        <div className="roster-overlay">
          <div className="roster-title">players</div>
          <ul>
            {(ui.lobby?.players ?? []).map((p) => (
              <li key={p.playerId}>
                {p.name}
                {p.playerId === ui.selfId && <span className="host-tag">YOU</span>}
                {p.isBot && <span className="host-tag">BOT</span>}
              </li>
            ))}
          </ul>
          <div className="roster-hint">names only — the maze keeps its secrets</div>
        </div>
      )}
      <div className="chat-log">
        {recentChat.map((c) => (
          <div key={c.id} className="line">
            <span className="who">{c.name}:</span> {c.text}
          </div>
        ))}
      </div>
      {chatOpen ? (
        <input
          className="chat-input"
          autoFocus
          maxLength={200}
          placeholder="say something… (Enter to send, Esc to cancel)"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            e.stopPropagation();
            // Keep Tab from tabbing focus away (which would blur-close chat).
            if (e.key === "Tab") e.preventDefault();
            if (e.key === "Enter") {
              session.sendChat(draft);
              closeChat();
            } else if (e.key === "Escape") {
              closeChat();
            }
          }}
          onBlur={closeChat}
        />
      ) : (
        <span className="chat-hint">press Enter to chat</span>
      )}
    </div>
  );
}
