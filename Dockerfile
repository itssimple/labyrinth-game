# Single deployable: the dedicated game server plus the built web client it
# serves at / — `docker run -p 8080:8080` is the whole game. See
# docs/DEPLOYMENT.md for usage and environment variables.
#
# Building behind a TLS-intercepting egress proxy? Provide the proxy CA as a
# BuildKit secret (it is only mounted during the network-using step, never
# baked into the image):
#   docker build --secret id=extra-ca,src=/path/to/ca.pem -t labyrinth-game .

# ---- Stage 1: install workspace + build the web client ---------------------
FROM node:22-alpine AS build
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
WORKDIR /repo

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json turbo.json ./
COPY packages ./packages
COPY apps ./apps

# corepack activates the pnpm version pinned in package.json#packageManager.
# The optional extra-ca secret covers corepack's pnpm download and the
# registry fetches; without the secret the system roots are used as normal.
RUN --mount=type=secret,id=extra-ca,target=/run/secrets/extra-ca.crt,required=false \
    if [ -s /run/secrets/extra-ca.crt ]; then \
      export NODE_EXTRA_CA_CERTS=/run/secrets/extra-ca.crt; \
      export npm_config_cafile=/run/secrets/extra-ca.crt; \
    fi; \
    corepack enable && pnpm install --frozen-lockfile

# Deliberately NO VITE_SERVER_URL: the client then connects same-origin
# (ws(s)://<host>/ws), i.e. back to this very container.
RUN pnpm --filter @labyrinth/client-web build

# Self-contained server directory: package sources + node_modules with all
# workspace deps copied in (they export TypeScript directly; tsx loads them).
# The extra-ca secret is mounted here too: legacy deploy re-resolves package
# metadata from the registry (the store only caches tarballs, so --offline is
# not possible), and behind a TLS-intercepting egress proxy those requests
# stall forever without the proxy CA.
RUN --mount=type=secret,id=extra-ca,target=/run/secrets/extra-ca.crt,required=false \
    if [ -s /run/secrets/extra-ca.crt ]; then \
      export NODE_EXTRA_CA_CERTS=/run/secrets/extra-ca.crt; \
      export npm_config_cafile=/run/secrets/extra-ca.crt; \
    fi; \
    pnpm --filter @labyrinth/server deploy --legacy /out/server

# ---- Stage 2: runtime -------------------------------------------------------
FROM node:22-alpine
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=8080 \
    CLIENT_DIST=/app/client/dist
WORKDIR /app

COPY --from=build --chown=node:node /out/server ./
COPY --from=build --chown=node:node /repo/apps/client-web/dist ./client/dist

USER node
EXPOSE 8080

# busybox wget ships with alpine; /healthz answers {"ok":true} when live.
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD wget -qO- "http://127.0.0.1:${PORT}/healthz" || exit 1

# TODO: precompile to plain JS (tsc or esbuild) and run `node` directly —
# running via tsx is acceptable for v1 but pays a startup transpile cost.
CMD ["node_modules/.bin/tsx", "src/main.ts"]
