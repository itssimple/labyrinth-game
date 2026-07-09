import type { UiState } from "../app/store";
import type { GameSession } from "../net/session";

/**
 * Public lobby browser: lobbies whose hosts opted in via "List publicly".
 * Mid-match lobbies stay visible but cannot be joined (server enforces the
 * matchAlreadyStarted rule; the disabled button just mirrors it).
 */
export function BrowseScreen({ session, ui }: { session: GameSession; ui: UiState }) {
  const list = ui.lobbyList;
  return (
    <div className="screen">
      <div className="panel">
        <h1 className="title">PUBLIC GAMES</h1>
        <p className="subtitle">games listed by their hosts</p>
        {list === null ? (
          <p className="muted">loading…</p>
        ) : list.length === 0 ? (
          <p className="muted">no public games right now</p>
        ) : (
          <ul className="lobby-browser">
            {list.map((l) => (
              <li key={l.code}>
                <span className="host-name">{l.hostName}</span>
                <span className="counts">
                  {l.playerCount} player{l.playerCount === 1 ? "" : "s"}
                  {l.botCount > 0 ? ` + ${l.botCount} bot${l.botCount === 1 ? "" : "s"}` : ""}
                </span>
                {l.inMatch && <span className="in-match">IN MATCH</span>}
                <button
                  disabled={l.inMatch}
                  title={l.inMatch ? "This game is already running" : `Join ${l.hostName}'s game`}
                  onClick={() => session.joinFromBrowser(l.code)}
                >
                  Join
                </button>
              </li>
            ))}
          </ul>
        )}
        <button className="secondary" onClick={() => session.refreshLobbies()}>
          Refresh
        </button>
        <button className="secondary" onClick={() => session.leaveBrowse()}>
          Back
        </button>
        <p className="error">{ui.error ?? ""}</p>
        <span className={`conn ${ui.connection}`}>
          server: {ui.connection}
          {ui.serverHost !== null ? ` (${ui.serverHost})` : ""}
        </span>
      </div>
    </div>
  );
}
