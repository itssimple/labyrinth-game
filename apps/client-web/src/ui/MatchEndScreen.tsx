import type { GameSession } from "../net/session";
import type { UiState } from "../app/store";

/** Match results: reason + escape order, back to the lobby. */
export function MatchEndScreen({ session, ui }: { session: GameSession; ui: UiState }) {
  const result = ui.matchResult;
  if (result === null) return null;
  return (
    <div className="screen">
      <div className="panel">
        <h1 className="title">{result.reason === "allEscaped" ? "ALL ESCAPED" : "TIME UP"}</h1>
        <p className="subtitle">escape order</p>
        {result.escaped.length > 0 ? (
          <ul className="result-list">
            {result.escaped.map((p) => (
              <li key={p.id}>
                {p.name}
                {p.id === ui.selfId && <span className="host-tag">YOU</span>}
              </li>
            ))}
          </ul>
        ) : (
          <p className="muted">nobody escaped the labyrinth…</p>
        )}
        <button onClick={() => session.backToLobby()}>Back to lobby</button>
      </div>
    </div>
  );
}
