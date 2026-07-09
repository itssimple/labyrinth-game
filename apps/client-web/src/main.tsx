import { createRoot } from "react-dom/client";
import { GameSession } from "./net/session";
import { App } from "./ui/App";
import "./ui/styles.css";

// One session for the lifetime of the page. It owns the socket, match state
// and Pixi renderer; React only renders the shell around it.
const session = new GameSession();

createRoot(document.getElementById("root")!).render(<App session={session} />);
