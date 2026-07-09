#!/usr/bin/env node
/**
 * Single-container production smoke test for the public dedicated server.
 *
 * Run from the repo root: `pnpm e2e:docker` (or `node tools/e2e-docker.mjs`).
 * Prerequisite: the image must exist — build it first with
 * `docker build -t echowake:dev .` (override via E2E_DOCKER_IMAGE).
 *
 * What it proves (docs/CONTRACTS.md "Deployment (public dedicated server)"):
 *
 * 1. `docker run -p 8098:8080` serves the WHOLE game: /healthz and /metrics
 *    answer, and the built web client loads at /.
 * 2. Same-origin server-URL resolution: the client was built with NO
 *    VITE_SERVER_URL, so a browser page at http://127.0.0.1:8098 must open
 *    its WebSocket back to ws://127.0.0.1:8098/ws — asserted via the menu's
 *    connection indicator showing "connected (127.0.0.1:8098)".
 * 3. Gameplay end-to-end inside the container: host a lobby, add a bot,
 *    start a tiny match, Pixi canvas appears, HUD timer counts down, zero
 *    console errors.
 * 4. Graceful shutdown: `docker stop` must exit the container promptly with
 *    exit code 0 (SIGTERM handled), never 137 after the grace-period kill.
 *
 * Exit code 0 + "DOCKER SMOKE PASS" on success; non-zero with details
 * otherwise. Only the container started here is stopped/removed.
 */

import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { setTimeout as sleep } from "node:timers/promises";
import { promisify } from "node:util";
import { chromium } from "playwright-core";

const execFileP = promisify(execFile);

const IMAGE = process.env.E2E_DOCKER_IMAGE ?? "echowake:dev";
const HOST_PORT = Number(process.env.E2E_DOCKER_PORT ?? 8098);
const CONTAINER = `echowake-e2e-docker-${process.pid}`;
const BASE_URL = `http://127.0.0.1:${HOST_PORT}`;
/** docker stop grace period (s); a graceful exit must beat it by a wide margin. */
const STOP_GRACE_S = 10;
/** A prompt graceful exit: well under the grace period, not a 137-after-timeout. */
const STOP_PROMPT_MS = 8000;

let containerStarted = false;
let browser = null;

function log(msg) {
  console.log(`[docker-smoke] ${msg}`);
}

async function docker(...args) {
  const { stdout } = await execFileP("docker", args, { timeout: 120_000 });
  return stdout.trim();
}

// ---------------------------------------------------------------------------
// Helpers (same shapes as tools/e2e-smoke.mjs)
// ---------------------------------------------------------------------------

async function waitForHttp(url, { timeoutMs, check }) {
  const deadline = Date.now() + timeoutMs;
  let lastErr = "no attempt made";
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url);
      if (res.ok && (check === undefined || (await check(res)))) return;
      lastErr = `HTTP ${res.status}`;
    } catch (err) {
      lastErr = String(err?.cause ?? err);
    }
    await sleep(250);
  }
  throw new Error(`timed out waiting for ${url} (${lastErr})`);
}

function findChromium() {
  const preferred = "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
  if (fs.existsSync(preferred)) return preferred;
  const base = "/opt/pw-browsers";
  const candidates = [];
  for (const dir of fs.existsSync(base) ? fs.readdirSync(base) : []) {
    if (!dir.startsWith("chromium")) continue;
    for (const sub of ["chrome-linux/chrome", "chrome-linux/headless_shell"]) {
      const p = path.join(base, dir, sub);
      if (fs.existsSync(p)) candidates.push(p);
    }
  }
  candidates.sort((a, b) =>
    a.endsWith("/chrome") === b.endsWith("/chrome") ? b.localeCompare(a) : a.endsWith("/chrome") ? -1 : 1,
  );
  if (candidates.length === 0) throw new Error(`no chromium found under ${base}`);
  return candidates[0];
}

function watchErrors(page, label, sink) {
  page.on("console", (msg) => {
    if (msg.type() === "error") {
      const loc = msg.location();
      sink.push(`[${label}] console.error: ${msg.text()}${loc?.url ? ` (${loc.url})` : ""}`);
    }
  });
  page.on("pageerror", (err) => {
    sink.push(`[${label}] pageerror: ${err.message}`);
  });
}

/** Parses "m:ss" HUD timer text into whole seconds. */
function parseTimer(text) {
  const m = /^(\d+):(\d{2})$/.exec(text.trim());
  if (!m) throw new Error(`HUD timer text ${JSON.stringify(text)} is not m:ss`);
  return Number(m[1]) * 60 + Number(m[2]);
}

async function dumpContainerLogs() {
  try {
    const { stdout, stderr } = await execFileP("docker", ["logs", "--tail", "60", CONTAINER], {
      timeout: 15_000,
    });
    console.error(`\n----- container logs (last 60 lines) -----\n${stdout}${stderr}`);
  } catch {
    /* container may already be gone */
  }
}

async function cleanup() {
  try {
    if (browser) await browser.close();
  } catch {
    /* ignore */
  }
  browser = null;
  if (containerStarted) {
    containerStarted = false;
    try {
      await docker("rm", "-f", CONTAINER);
    } catch {
      /* already removed */
    }
  }
}

let cleanedUp = false;
async function cleanupOnce() {
  if (cleanedUp) return;
  cleanedUp = true;
  await cleanup();
}

for (const sig of ["SIGINT", "SIGTERM"]) {
  process.on(sig, () => {
    void cleanupOnce().then(() => process.exit(130));
  });
}

// ---------------------------------------------------------------------------
// The smoke test
// ---------------------------------------------------------------------------

async function main() {
  // 0. The image must exist (built separately — see file header).
  try {
    await docker("image", "inspect", "--format", "{{.Id}}", IMAGE);
  } catch {
    throw new Error(`image ${IMAGE} not found — build it first: docker build -t ${IMAGE} .`);
  }

  // 1. Run the container, mapping HOST_PORT -> 8080.
  log(`starting container ${CONTAINER} from ${IMAGE} on :${HOST_PORT} ...`);
  await docker("run", "-d", "--name", CONTAINER, "-p", `127.0.0.1:${HOST_PORT}:8080`, IMAGE);
  containerStarted = true;

  // 2. /healthz and /metrics must answer (explicit routes beat static files).
  await waitForHttp(`${BASE_URL}/healthz`, {
    timeoutMs: 60_000,
    check: async (res) => (await res.json())?.ok === true,
  });
  const metrics = await (await fetch(`${BASE_URL}/metrics`)).json();
  for (const key of ["uptimeS", "lobbies", "players", "botsInLobbies", "runningMatches", "protocolVersion"]) {
    if (typeof metrics[key] !== "number") {
      throw new Error(`/metrics is missing numeric ${key}: ${JSON.stringify(metrics)}`);
    }
  }
  log(`container healthy; /metrics ok (protocolVersion ${metrics.protocolVersion})`);

  // 3. One browser page against the container-served client.
  const executablePath = findChromium();
  log(`launching chromium: ${executablePath}`);
  browser = await chromium.launch({ executablePath, headless: true });
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  const consoleErrors = [];
  watchErrors(page, "player", consoleErrors);

  // 4. Menu must render from the container's static files.
  await page.goto(`${BASE_URL}/`, { waitUntil: "domcontentloaded" });
  await page.getByPlaceholder("your name").waitFor({ timeout: 15_000 });
  log("menu rendered from container-served client");

  // 5. Host a lobby. The image is built with NO VITE_SERVER_URL and this
  //    fresh context has no manual server address, so the socket must
  //    resolve same-origin — the indicator proves the connection succeeded
  //    against ws://127.0.0.1:8098/ws.
  await page.getByPlaceholder("your name").fill("dana");
  await page.getByRole("button", { name: "Host game" }).click();
  await page.locator(".lobby-code").waitFor({ timeout: 15_000 });
  const code = (await page.locator(".lobby-code").textContent())?.trim() ?? "";
  if (!/^[A-Z]{4}$/.test(code)) throw new Error(`bad lobby code read from DOM: ${JSON.stringify(code)}`);
  const conn = ((await page.locator(".conn").textContent()) ?? "").trim();
  if (!conn.includes("connected")) {
    throw new Error(`connection indicator does not show connected: ${JSON.stringify(conn)}`);
  }
  if (!conn.includes(`127.0.0.1:${HOST_PORT}`)) {
    throw new Error(
      `connection indicator does not show the same-origin host 127.0.0.1:${HOST_PORT}: ${JSON.stringify(conn)}`,
    );
  }
  log(`hosted lobby ${code}; connection indicator: "${conn}" (same-origin OK)`);

  // 6. Add a bot; roster must show 2 entries, exactly one tagged BOT.
  await page.getByRole("button", { name: "Add bot" }).click();
  await page
    .waitForFunction(() => document.querySelectorAll(".player-list li").length === 2, undefined, {
      timeout: 10_000,
    })
    .catch(async () => {
      const n = await page.locator(".player-list li").count();
      throw new Error(`roster shows ${n} entries after Add bot, expected 2`);
    });
  const botTagCount = await page.locator(".player-list li .host-tag", { hasText: /^BOT$/ }).count();
  if (botTagCount !== 1) throw new Error(`expected exactly 1 BOT tag in roster, found ${botTagCount}`);
  log("roster shows 2 entries, one tagged BOT");

  // 7. Start a tiny match; the Pixi canvas must appear.
  await page.locator("select").selectOption("tiny");
  await page.getByRole("button", { name: "Start match" }).click();
  await page
    .locator(".game-canvas canvas")
    .waitFor({ timeout: 20_000 })
    .catch(async () => {
      const err = await page.locator(".error").first().textContent().catch(() => null);
      throw new Error(`never reached the game screen (Pixi canvas missing)${err ? `; UI error: ${err}` : ""}`);
    });
  log("game canvas appeared");

  // 8. HUD timer must count down (match ticking inside the container).
  const timer = page.locator(".hud .timer");
  await timer.waitFor({ timeout: 10_000 });
  const t0 = parseTimer((await timer.textContent()) ?? "");
  const deadline = Date.now() + 8000;
  let t1 = t0;
  while (Date.now() < deadline) {
    t1 = parseTimer((await timer.textContent()) ?? "");
    if (t1 < t0) break;
    await sleep(200);
  }
  if (!(t1 < t0)) throw new Error(`match timer is not counting down (stuck at ${t0}s) — match not running?`);
  log(`match running: timer ${t0}s -> ${t1}s`);

  // 9. The match must have registered in /metrics while running.
  const midMetrics = await (await fetch(`${BASE_URL}/metrics`)).json();
  if (midMetrics.runningMatches !== 1 || midMetrics.botsInLobbies !== 1) {
    throw new Error(
      `mid-match /metrics expected runningMatches=1 botsInLobbies=1, got ${JSON.stringify(midMetrics)}`,
    );
  }
  log("mid-match /metrics reflects 1 running match with 1 bot");

  // 10. Zero console errors across the whole browser run.
  await sleep(500); // let any straggling errors land
  if (consoleErrors.length > 0) {
    throw new Error(`console errors observed:\n  ${consoleErrors.join("\n  ")}`);
  }
  await browser.close();
  browser = null;
  log("browser part done, zero console errors");

  // 11. Graceful shutdown: `docker stop` must return promptly with exit
  //     code 0. A hung SIGTERM handler would make docker escalate to
  //     SIGKILL after the grace period -> exit 137 and a ~STOP_GRACE_S stall.
  log(`docker stop -t ${STOP_GRACE_S} (graceful shutdown check) ...`);
  const stopStart = Date.now();
  await docker("stop", "-t", String(STOP_GRACE_S), CONTAINER);
  const stopMs = Date.now() - stopStart;
  const exitCode = Number(await docker("inspect", "--format", "{{.State.ExitCode}}", CONTAINER));
  if (exitCode !== 0) {
    throw new Error(
      `container exit code ${exitCode} after docker stop (took ${stopMs}ms) — expected a graceful 0`,
    );
  }
  if (stopMs >= STOP_PROMPT_MS) {
    throw new Error(
      `docker stop took ${stopMs}ms (>= ${STOP_PROMPT_MS}ms) — SIGTERM was likely not handled promptly`,
    );
  }
  log(`graceful shutdown OK: docker stop returned in ${stopMs}ms, exit code 0`);

  // 12. Remove the (already stopped) container.
  await docker("rm", CONTAINER);
  containerStarted = false;

  console.log(
    `\nDOCKER SMOKE PASS — image ${IMAGE} on :${HOST_PORT}: healthz+metrics ok, menu served, ` +
      `same-origin WS connected, lobby ${code} with 1 bot, tiny match ran (timer ${t0}s -> ${t1}s), ` +
      `zero console errors, graceful stop in ${stopMs}ms with exit code 0.`,
  );
}

let failed = false;
try {
  await main();
} catch (err) {
  failed = true;
  console.error(`\nDOCKER SMOKE FAIL: ${err?.stack ?? err}`);
  await dumpContainerLogs();
} finally {
  await cleanupOnce();
}
process.exit(failed ? 1 : 0);
