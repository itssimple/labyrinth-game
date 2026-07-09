# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Source of Truth

`README.md` is the combined project overview, game design document, and architecture specification. **Read it before writing code.** If code and README conflict, the README wins. If you change gameplay, networking, or architecture, update the README in the same change.

## What This Project Is

A multiplayer-first, top-down pixel-art labyrinth game (working title "Labyrinth Game"): procedurally generated mazes, fog of war, and visualized sound propagation ("sound is vision") with stealth and social-deduction elements. MIT-licensed, intended for eventual commercial release across web, desktop (Electron), and Android (Capacitor).

## Tech Stack (decided, do not swap without discussion)

- **Language:** TypeScript everywhere (client, server, shared packages)
- **Rendering:** PixiJS; UI shell in React
- **ECS:** bitECS preferred (a simple, deterministic custom ECS is acceptable)
- **Server:** Node.js + Fastify, WebSocket transport, authoritative server — clients are never trusted
- **Persistence:** PostgreSQL; Redis cache; JWT auth
- **Monorepo layout:** `/apps` (client-web, client-desktop, client-mobile, server, shared, tools) and `/packages` (common, network, protocol, assets, math, ecs), docs in `/docs`

There is no build tooling committed yet. When scaffolding lands (package manager, build/test/lint commands), record the exact commands in this file.

## Architecture Invariants

These are the load-bearing decisions from the README; violating them breaks the design:

1. **Simulation is separate from presentation.** Gameplay lives in the ECS; the renderer only observes ECS state and never owns gameplay state. No gameplay logic in Pixi display objects or React components.
2. **Determinism.** Same seed + game mode + size + difficulty + modifiers must always produce the identical labyrinth and, wherever practical, identical simulation. No `Math.random()` in simulation code — use seeded RNG passed in explicitly. Avoid wall-clock time in gameplay logic.
3. **Authoritative server.** All gameplay-affecting decisions validate on the server. Client-side prediction/interpolation is presentation-level convenience, never authority.
4. **Shared simulation code.** Bots, single-player, and dedicated servers all run the same game rules — never fork gameplay logic per platform.
5. **Sound is a first-class system, not an effect.** Sound events carry volume, frequency profile, max travel distance, and material interaction; propagation uses pathfinding through the maze (walls attenuate), and what players *see* of a sound is confidence-banded (high/medium/low) — sound must never act as a wallhack.
6. **Knowledge ages.** Fog of war distinguishes currently visible / recently explored / previously explored / unknown; remembered map data goes stale rather than staying authoritative.
7. **Moddability.** Custom maps, modes, items, AI, textures, and sounds must be possible without editing core game code — keep content data-driven.

## Development Rules (from README)

- Keep commits small; explain important decisions in commit messages.
- Never silently change networking or rewrite architecture without explanation.
- Prefer explicit TODOs over half-finished implementations.
- Never invent game mechanics without documenting them in the README.
- Priorities in order: fun gameplay → maintainability → multiplayer correctness → performance → graphics. Never sacrifice architecture to ship a feature faster.
- Avoid global state, giant files/classes, and circular dependencies; favor composition and dependency injection.
