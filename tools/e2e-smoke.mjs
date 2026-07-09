#!/usr/bin/env node
/**
 * Two-browser end-to-end smoke test for the labyrinth game.
 *
 * Run from the repo root: `node tools/e2e-smoke.mjs`
 *
 * Spawns the authoritative server (PORT=8091) and the Vite dev client
 * (port 5183), then drives two isolated headless Chromium contexts through:
 * host lobby -> join by code -> start a tiny match -> hold W -> assert the
 * match timer is counting down, collecting console errors from both pages.
 *
 * Exit code 0 + "SMOKE PASS" on success; non-zero with details otherwise.
 * Only the processes spawned here are killed on exit.
 */

import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { setTimeout as sleep } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SERVER_PORT = 8091;
const CLIENT_PORT = 5183;
const HEALTH_URL = `http://127.0.0.1:${SERVER_PORT}/healthz`;
const APP_URL = `http://127.0.0.1:${CLIENT_PORT}/`;
const WS_URL = `ws://127.0.0.1:${SERVER_PORT}/ws`;

/** Child processes we spawned (and therefore may kill). */
const children = [];
let browser = null;

function log(msg) {
  console.log(`[smoke] ${msg}`);
}

// ---------------------------------------------------------------------------
// Process management
// ---------------------------------------------------------------------------

/**
 * Spawns a command in its own process group (detached) so we can reliably
 * kill the whole tree (pnpm -> tsx/vite -> node) and nothing else.
 */
function spawnChild(name, command, args, extraEnv) {
  const child = spawn(command, args, {
    cwd: ROOT,
    env: { ...process.env, ...extraEnv },
    detached: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
  const entry = { name, child, output: "" };
  const capture = (chunk) => {
    entry.output += chunk.toString();
    if (entry.output.length > 100_000) entry.output = entry.output.slice(-50_000);
  };
  child.stdout.on("data", capture);
  child.stderr.on("data", capture);
  child.on("exit", (code, signal) => {
    entry.exited = { code, signal };
  });
  children.push(entry);
  return entry;
}

/** Kills the process group of every child we spawned (and only those). */
async function killChildren() {
  for (const entry of children) {
    if (entry.exited) continue;
    try {
      process.kill(-entry.child.pid, "SIGTERM");
    } catch {
      /* already gone */
    }
  }
  // Grace period, then hard-kill stragglers.
  const deadline = Date.now() + 3000;
  while (Date.now() < deadline && children.some((e) => !e.exited)) await sleep(100);
  for (const entry of children) {
    if (entry.exited) continue;
    try {
      process.kill(-entry.child.pid, "SIGKILL");
    } catch {
      /* already gone */
    }
  }
}

async function cleanup() {
  try {
    if (browser) await browser.close();
  } catch {
    /* ignore */
  }
  browser = null;
  await killChildren();
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
// Helpers
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
  // Fall back: glob /opt/pw-browsers for any chromium build.
  const base = "/opt/pw-browsers";
  const candidates = [];
  for (const dir of fs.existsSync(base) ? fs.readdirSync(base) : []) {
    if (!dir.startsWith("chromium")) continue;
    for (const sub of ["chrome-linux/chrome", "chrome-linux/headless_shell"]) {
      const p = path.join(base, dir, sub);
      if (fs.existsSync(p)) candidates.push(p);
    }
  }
  // Prefer full chrome over headless_shell, newest build first.
  candidates.sort((a, b) => (a.endsWith("/chrome") === b.endsWith("/chrome") ? b.localeCompare(a) : a.endsWith("/chrome") ? -1 : 1));
  if (candidates.length === 0) throw new Error(`no chromium found under ${base}`);
  return candidates[0];
}

/** Attaches console-error + page-error collectors to a page. */
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

function dumpChildOutput() {
  for (const entry of children) {
    const status = entry.exited ? `exited ${JSON.stringify(entry.exited)}` : "running";
    console.error(`\n----- ${entry.name} (${status}) — last output -----`);
    console.error(entry.output.slice(-4000) || "(no output)");
  }
}

// ---------------------------------------------------------------------------
// The smoke test
// ---------------------------------------------------------------------------

async function main() {
  // 1. Server.
  log(`starting server on :${SERVER_PORT} ...`);
  spawnChild("server", "pnpm", ["--filter", "@labyrinth/server", "start"], {
    PORT: String(SERVER_PORT),
  });
  await waitForHttp(HEALTH_URL, {
    timeoutMs: 30_000,
    check: async (res) => (await res.json())?.ok === true,
  });
  log("server healthy");

  // 2. Vite dev client.
  log(`starting vite on :${CLIENT_PORT} ...`);
  spawnChild(
    "vite",
    "pnpm",
    // NB: no "--" separator — pnpm would forward it literally and vite would
    // then ignore the port flags.
    ["--filter", "@labyrinth/client-web", "dev", "--port", String(CLIENT_PORT), "--strictPort"],
    { VITE_SERVER_URL: WS_URL },
  );
  await waitForHttp(APP_URL, { timeoutMs: 60_000 });
  log("client page served");

  // 3. Browser: two isolated contexts, one page each.
  const executablePath = findChromium();
  log(`launching chromium: ${executablePath}`);
  browser = await chromium.launch({ executablePath, headless: true });
  const ctxA = await browser.newContext();
  const ctxB = await browser.newContext();
  const pageA = await ctxA.newPage();
  const pageB = await ctxB.newPage();
  const consoleErrors = [];
  watchErrors(pageA, "alice", consoleErrors);
  watchErrors(pageB, "bob", consoleErrors);

  // 4. Page A hosts a lobby.
  await pageA.goto(APP_URL, { waitUntil: "domcontentloaded" });
  await pageA.getByPlaceholder("your name").fill("alice");
  await pageA.getByRole("button", { name: "Host game" }).click();
  await pageA.locator(".lobby-code").waitFor({ timeout: 15_000 });
  const code = (await pageA.locator(".lobby-code").textContent())?.trim() ?? "";
  if (!/^[A-Z]{4}$/.test(code)) throw new Error(`bad lobby code read from DOM: ${JSON.stringify(code)}`);
  log(`alice hosted lobby ${code}`);

  // 5. Page B joins with the code; both rosters must show 2 players.
  await pageB.goto(APP_URL, { waitUntil: "domcontentloaded" });
  await pageB.getByPlaceholder("your name").fill("bob");
  await pageB.getByPlaceholder("CODE").fill(code);
  await pageB.getByRole("button", { name: "Join game" }).click();
  await pageB.locator(".lobby-code").waitFor({ timeout: 15_000 });
  for (const [label, page] of [["alice", pageA], ["bob", pageB]]) {
    await page.waitForFunction(
      () => document.querySelectorAll(".player-list li").length === 2,
      undefined,
      { timeout: 10_000 },
    ).catch(async () => {
      const n = await page.locator(".player-list li").count();
      throw new Error(`${label}'s roster shows ${n} players, expected 2`);
    });
  }
  log("both rosters show 2 players");

  // 6. Host picks "tiny" and starts; both pages must reach the game screen.
  await pageA.locator("select").selectOption("tiny");
  await pageA.getByRole("button", { name: "Start match" }).click();
  for (const [label, page] of [["alice", pageA], ["bob", pageB]]) {
    await page
      .locator(".game-canvas canvas")
      .waitFor({ timeout: 20_000 })
      .catch(async () => {
        const err = await page.locator(".error").first().textContent().catch(() => null);
        throw new Error(`${label} never reached the game screen (Pixi canvas missing)${err ? `; UI error: ${err}` : ""}`);
      });
  }
  log("both pages show the game canvas");

  // 7. Match must be running: HUD timer visible and counting down while
  //    alice holds W for ~1.5s.
  const timerA = pageA.locator(".hud .timer");
  await timerA.waitFor({ timeout: 10_000 });
  const t0 = parseTimer((await timerA.textContent()) ?? "");
  await pageA.keyboard.down("w");
  await sleep(1500);
  await pageA.keyboard.up("w");
  // Give the HUD time to cross a whole-second boundary.
  const holdDeadline = Date.now() + 5000;
  let t1 = t0;
  while (Date.now() < holdDeadline) {
    t1 = parseTimer((await timerA.textContent()) ?? "");
    if (t1 < t0) break;
    await sleep(200);
  }
  if (!(t1 < t0)) throw new Error(`match timer is not counting down (stuck at ${t0}s) — match not running?`);
  const timerBText = (await pageB.locator(".hud .timer").textContent()) ?? "";
  parseTimer(timerBText); // throws if bob's HUD has no valid timer
  log(`match running: alice timer ${t0}s -> ${t1}s, bob timer ${timerBText.trim()}`);

  // 8. Console errors from the whole run fail the smoke.
  await sleep(500); // let any straggling errors land
  if (consoleErrors.length > 0) {
    throw new Error(`console errors observed:\n  ${consoleErrors.join("\n  ")}`);
  }

  console.log(
    `\nSMOKE PASS — lobby ${code}: 2 players joined, tiny match started on both pages, ` +
      `timer counting down (${t0}s -> ${t1}s), zero console errors.`,
  );
}

let failed = false;
try {
  await main();
} catch (err) {
  failed = true;
  console.error(`\nSMOKE FAIL: ${err?.stack ?? err}`);
  dumpChildOutput();
} finally {
  await cleanupOnce();
}
process.exit(failed ? 1 : 0);
