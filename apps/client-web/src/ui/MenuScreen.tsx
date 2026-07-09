import { useState } from "react";
import type { GameSession } from "../net/session";
import type { UiState } from "../app/store";
import { SERVER_URL_STORAGE_KEY } from "../net/serverUrl";
import { VolumeControl } from "./VolumeControl";

/** Main menu: display name + Host or Join-by-code. */
export function MenuScreen({ session, ui }: { session: GameSession; ui: UiState }) {
  const [name, setName] = useState(() => localStorage.getItem("labyrinth.name") ?? "");
  const [code, setCode] = useState("");
  const [serverAddr, setServerAddr] = useState(
    () => localStorage.getItem(SERVER_URL_STORAGE_KEY) ?? "",
  );

  const remember = (n: string) => {
    setName(n);
    localStorage.setItem("labyrinth.name", n);
  };
  // Persisted raw; resolution/normalization happens at Host/Join time
  // (serverUrl.ts), so edits take effect without a reload. Blank = auto.
  const rememberServer = (v: string) => {
    setServerAddr(v);
    localStorage.setItem(SERVER_URL_STORAGE_KEY, v);
  };
  const nameOk = name.trim().length >= 1 && name.trim().length <= 20;
  const codeOk = /^[A-Za-z]{4}$/.test(code.trim());

  return (
    <div className="screen">
      <div className="panel">
        <h1 className="title">ECHOWAKE</h1>
        <p className="subtitle">escape the maze — sound is vision</p>
        <label className="field">
          name
          <input
            value={name}
            maxLength={20}
            placeholder="your name"
            onChange={(e) => remember(e.target.value)}
            autoFocus
          />
        </label>
        <button disabled={!nameOk} onClick={() => session.host(name)}>
          Host game
        </button>
        <button className="secondary" disabled={!nameOk} onClick={() => session.browsePublic(name)}>
          Browse public games
        </button>
        <div className="row">
          <input
            value={code}
            maxLength={4}
            placeholder="CODE"
            style={{ width: 90, textTransform: "uppercase", letterSpacing: 4 }}
            onChange={(e) => setCode(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && nameOk && codeOk) session.join(name, code);
            }}
          />
          <button disabled={!nameOk || !codeOk} onClick={() => session.join(name, code)} style={{ flex: 1 }}>
            Join game
          </button>
        </div>
        <label className="field">
          server address
          <input
            value={serverAddr}
            placeholder="auto"
            spellCheck={false}
            onChange={(e) => rememberServer(e.target.value)}
          />
        </label>
        <label className="field">
          volume
          <VolumeControl audio={session.audio} />
        </label>
        <p className="error">{ui.error ?? ""}</p>
        <span className={`conn ${ui.connection}`}>
          server: {ui.connection}
          {ui.serverHost !== null ? ` (${ui.serverHost})` : ""}
        </span>
      </div>
    </div>
  );
}
