import { useUi } from "../app/store";
import type { GameSession } from "../net/session";
import { GameScreen } from "./GameScreen";
import { LobbyScreen } from "./LobbyScreen";
import { MatchEndScreen } from "./MatchEndScreen";
import { MenuScreen } from "./MenuScreen";

/** Top-level screen switch driven by the session's coarse UI state. */
export function App({ session }: { session: GameSession }) {
  const ui = useUi(session.store);
  switch (ui.screen) {
    case "menu":
      return <MenuScreen session={session} ui={ui} />;
    case "lobby":
      return <LobbyScreen session={session} ui={ui} />;
    case "game":
      return <GameScreen session={session} ui={ui} />;
    case "end":
      return <MatchEndScreen session={session} ui={ui} />;
  }
}
