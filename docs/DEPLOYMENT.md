# Deployment — public dedicated server

One deployable: the dedicated server also serves the built web client, so a
single container is the whole game. The contract behind this document lives in
`docs/CONTRACTS.md` ("Deployment (public dedicated server)").

## Build and run the image

From the repo root:

```sh
docker build -t echowake .
docker run -p 8080:8080 echowake
```

That's it — the playable game is now at `http://localhost:8080`.

Notes:

- The image is multi-stage: stage 1 runs `pnpm install` and builds the web
  client with **no** `VITE_SERVER_URL`, so the client connects same-origin —
  i.e. back to whatever host serves it. Stage 2 contains only the server
  workspace (via `pnpm deploy --legacy`), its node_modules, and the built
  client dist. It runs as the non-root `node` user.
- A `HEALTHCHECK` polls `GET /healthz`; `docker ps` shows the container as
  `healthy` once the server answers.
- The server currently runs through `tsx` (TypeScript at runtime). TODO:
  precompile to plain JS and run `node` directly.
- Building behind a TLS-intercepting egress proxy? Pass the proxy CA as a
  BuildKit secret (never baked into the image):
  `docker build --secret id=extra-ca,src=/path/to/ca.pem -t echowake .`

## Environment variables

Config is env-only. All are optional.

| Variable      | Default                                        | Meaning                                                                                             |
| ------------- | ---------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| `PORT`        | `8080`                                         | HTTP/WebSocket listen port.                                                                          |
| `HOST`        | `0.0.0.0`                                      | Listen address (the image sets `0.0.0.0`; bare-metal dev may prefer `127.0.0.1`).                    |
| `CLIENT_DIST` | `../client-web/dist` relative to `apps/server` | Directory of the built web client served at `/`. When it does not exist the server runs WS-only (dev mode). The image sets `/app/client/dist`. |
| `LOG_LEVEL`   | `info`                                         | Fastify/pino logger level (`fatal`…`trace`).                                                         |

Example:

```sh
docker run -p 80:8080 -e LOG_LEVEL=warn echowake
```

## How players connect

Point a browser at `http://<server>:8080` — the container serves the web
client itself, and the client (built without `VITE_SERVER_URL`) automatically
opens its WebSocket same-origin at `ws://<server>:8080/ws` (or `wss://` behind
an HTTPS-terminating reverse proxy; make sure the proxy forwards WebSocket
upgrades on `/ws`). One player hosts a lobby and shares the 4-letter code;
everyone else joins with it.

Players on a client served from elsewhere (e.g. the Vite dev server) can also
enter the server address manually in the main menu "server" field.

## Endpoints

| Route      | Purpose                                                                                                   |
| ---------- | --------------------------------------------------------------------------------------------------------- |
| `/`        | Built web client (only when `CLIENT_DIST` exists).                                                         |
| `/ws`      | Game WebSocket (see `@echowake/protocol`).                                                                |
| `/healthz` | Liveness: `{ "ok": true }`.                                                                                |
| `/metrics` | Ops counters as JSON: `{ uptimeS, lobbies, players, botsInLobbies, runningMatches, protocolVersion }`. TODO: Prometheus exposition format. |

## Shutdown behavior

On `SIGTERM`/`SIGINT` (e.g. `docker stop`) the server ends all running matches
cleanly (releasing simulation entities), closes every player WebSocket, stops
accepting connections, and exits 0. No draining period — restarts are abrupt
for players by design at this stage (TODO: shutdown grace notice).
