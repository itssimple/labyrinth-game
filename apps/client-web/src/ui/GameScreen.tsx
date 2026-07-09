import { useEffect, useRef, useState } from "react";
import type { GameSession } from "../net/session";
import type { UiState } from "../app/store";

/** Formats whole seconds as m:ss. */
function fmtTime(s: number): string {
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return `${m}:${sec.toString().padStart(2, "0")}`;
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
        <span style={{ marginLeft: "auto", color: "#666680", fontSize: 11 }}>
          WASD move · Shift sprint · Ctrl/C sneak · Enter chat
        </span>
      </div>
      {ui.hud?.escaped === true && <div className="escaped-banner">ESCAPED!</div>}
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
