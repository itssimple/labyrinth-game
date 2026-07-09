#!/usr/bin/env node
/**
 * Two-browser end-to-end smoke test for Echowake.
 *
 * Run from the repo root: `node tools/e2e-smoke.mjs`
 *
 * Spawns the authoritative server (PORT=8091) and the Vite dev client
 * (port 5183), then drives two scenarios against the same server + vite:
 *
 * 1. TWO-PLAYER: two isolated headless Chromium contexts — host lobby ->
 *    join by code -> start a tiny match -> hold W -> assert the match timer
 *    is counting down, the HUD ping indicator shows a real RTT number
 *    ("N ms"), and the combat HUD shows the HP bar + 4 inventory slots;
 *    press Space (attack swing — a no-op miss is fine, real combat is
 *    covered by server integration tests) and require zero console errors
 *    from both pages.
 * 2. SOLO-WITH-BOT: a fresh context hosts a lobby, clicks "Add bot",
 *    asserts the roster shows 2 entries with a BOT tag, starts a small
 *    match, asserts the Pixi canvas + HUD timer countdown, and lets the
 *    match run ~4s with zero console errors.
 * 3. PUBLIC-BROWSER: dave hosts a lobby and checks "List publicly"; erin
 *    opens "Browse public games", sees exactly one entry (dave's, with his
 *    host name), clicks Join, and lands in dave's lobby — both rosters show
 *    2 players, zero console errors.
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
  spawnChild("server", "pnpm", ["--filter", "@echowake/server", "start"], {
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
    ["--filter", "@echowake/client-web", "dev", "--port", String(CLIENT_PORT), "--strictPort"],
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

  // 7b. HUD ping indicator must show a measured RTT ("N ms", not the "— ms"
  //     placeholder) on an in-game page — clients ping every ~2s, so a real
  //     sample must have landed well within this timeout.
  await pageA
    .waitForFunction(
      () => /^\d+ ms$/.test(document.querySelector(".hud .ping")?.textContent?.trim() ?? ""),
      undefined,
      { timeout: 10_000 },
    )
    .catch(async () => {
      const text = await pageA.locator(".hud .ping").textContent().catch(() => null);
      throw new Error(`alice's HUD ping never showed a number, got ${JSON.stringify(text)}`);
    });
  const pingText = ((await pageA.locator(".hud .ping").textContent()) ?? "").trim();
  log(`alice's HUD ping shows a measured RTT: "${pingText}"`);

  // 7c. Combat HUD (docs/CONTRACTS.md "Items, combat & auras"): the HP bar
  //     and exactly INVENTORY_SLOTS (4) inventory slot boxes must be in the
  //     HUD on an in-game page.
  await pageA
    .locator(".combat-hud .hp-bar")
    .waitFor({ timeout: 10_000 })
    .catch(() => {
      throw new Error("alice's combat HUD never showed an HP bar (.combat-hud .hp-bar missing)");
    });
  const slotCount = await pageA.locator(".combat-hud .inv-slot").count();
  if (slotCount !== 4) {
    throw new Error(`alice's combat HUD shows ${slotCount} inventory slots, expected 4`);
  }
  log("combat HUD present: HP bar + 4 inventory slots");

  // 7d. Space = attack. Swinging at nothing must be harmless (a swing sound /
  //     no-op) — the console-error gate below fails the smoke if the action
  //     path throws. Forcing a real fight in a browser is deliberately out of
  //     scope here; hit/damage rules are covered by server integration tests.
  await pageA.keyboard.press("Space");
  await sleep(700); // let the action round-trip a few ticks
  log("alice swung (Space) with no visible target — no crash");

  // 8. Console errors from the whole run fail the smoke.
  await sleep(500); // let any straggling errors land
  if (consoleErrors.length > 0) {
    throw new Error(`console errors observed:\n  ${consoleErrors.join("\n  ")}`);
  }
  log(`two-player scenario OK (lobby ${code}, timer ${t0}s -> ${t1}s)`);

  // ---------------------------------------------------------------------
  // Scenario 2 — SOLO-WITH-BOT: reuse the running server + vite.
  // ---------------------------------------------------------------------
  // Close the two-player contexts first so their tiny match winds down and
  // cannot leak console errors into this scenario.
  await ctxA.close();
  await ctxB.close();

  log("SOLO-WITH-BOT: carol hosts a fresh lobby ...");
  const ctxC = await browser.newContext();
  const pageC = await ctxC.newPage();
  const soloErrors = [];
  watchErrors(pageC, "carol", soloErrors);

  // 9. Carol hosts a lobby.
  await pageC.goto(APP_URL, { waitUntil: "domcontentloaded" });
  await pageC.getByPlaceholder("your name").fill("carol");
  await pageC.getByRole("button", { name: "Host game" }).click();
  await pageC.locator(".lobby-code").waitFor({ timeout: 15_000 });
  const codeC = (await pageC.locator(".lobby-code").textContent())?.trim() ?? "";
  if (!/^[A-Z]{4}$/.test(codeC)) throw new Error(`bad lobby code read from DOM: ${JSON.stringify(codeC)}`);
  log(`carol hosted lobby ${codeC}`);

  // 10. Add a bot; roster must show 2 entries, exactly one tagged BOT.
  await pageC.getByRole("button", { name: "Add bot" }).click();
  await pageC
    .waitForFunction(() => document.querySelectorAll(".player-list li").length === 2, undefined, {
      timeout: 10_000,
    })
    .catch(async () => {
      const n = await pageC.locator(".player-list li").count();
      throw new Error(`carol's roster shows ${n} entries after Add bot, expected 2`);
    });
  const botTagCount = await pageC.locator(".player-list li .host-tag", { hasText: /^BOT$/ }).count();
  if (botTagCount !== 1) {
    throw new Error(`expected exactly 1 roster entry with a BOT tag, found ${botTagCount}`);
  }
  log("roster shows 2 entries, one tagged BOT");

  // 11. Start a small match; the Pixi canvas must appear.
  await pageC.locator("select").selectOption("small");
  await pageC.getByRole("button", { name: "Start match" }).click();
  await pageC
    .locator(".game-canvas canvas")
    .waitFor({ timeout: 20_000 })
    .catch(async () => {
      const err = await pageC.locator(".error").first().textContent().catch(() => null);
      throw new Error(`carol never reached the game screen (Pixi canvas missing)${err ? `; UI error: ${err}` : ""}`);
    });
  log("carol shows the game canvas");

  // 12. HUD timer must be counting down; let the bot match run ~4s.
  const timerC = pageC.locator(".hud .timer");
  await timerC.waitFor({ timeout: 10_000 });
  const s0 = parseTimer((await timerC.textContent()) ?? "");
  await sleep(4000);
  const s1 = parseTimer((await timerC.textContent()) ?? "");
  if (!(s1 < s0)) {
    throw new Error(`solo-with-bot match timer is not counting down (stuck at ${s0}s) — match not running?`);
  }
  log(`solo-with-bot match running: timer ${s0}s -> ${s1}s`);

  // 13. Zero console errors during the whole bot scenario.
  await sleep(500); // let any straggling errors land
  if (soloErrors.length > 0) {
    throw new Error(`console errors observed in SOLO-WITH-BOT scenario:\n  ${soloErrors.join("\n  ")}`);
  }
  log(`solo-with-bot scenario OK (lobby ${codeC}, timer ${s0}s -> ${s1}s)`);

  // ---------------------------------------------------------------------
  // Scenario 3 — PUBLIC-BROWSER: reuse the running server + vite.
  // ---------------------------------------------------------------------
  // Close carol's context first: her lobby (and its bot) disappears with
  // her, and — like every earlier lobby — it was never listed publicly, so
  // the browser below must show exactly ONE entry: dave's.
  await ctxC.close();

  log("PUBLIC-BROWSER: dave hosts and lists his lobby publicly ...");
  const ctxD = await browser.newContext();
  const ctxE = await browser.newContext();
  const pageD = await ctxD.newPage();
  const pageE = await ctxE.newPage();
  const browserErrors = [];
  watchErrors(pageD, "dave", browserErrors);
  watchErrors(pageE, "erin", browserErrors);

  // 14. Dave hosts a lobby and checks "List publicly" (host-only toggle).
  await pageD.goto(APP_URL, { waitUntil: "domcontentloaded" });
  await pageD.getByPlaceholder("your name").fill("dave");
  await pageD.getByRole("button", { name: "Host game" }).click();
  await pageD.locator(".lobby-code").waitFor({ timeout: 15_000 });
  const codeD = (await pageD.locator(".lobby-code").textContent())?.trim() ?? "";
  if (!/^[A-Z]{4}$/.test(codeD)) throw new Error(`bad lobby code read from DOM: ${JSON.stringify(codeD)}`);
  const publicToggle = pageD.getByLabel("List publicly");
  if (await publicToggle.isChecked()) {
    throw new Error("'List publicly' is already checked on a fresh lobby — lobbies must default to private");
  }
  // Plain click, not check(): the checkbox is React-controlled by
  // lobbyState.isPublic, so its checked state only settles after the server
  // round-trip — check()'s immediate post-click assertion would race that.
  await publicToggle.click();
  // Waiting for it to become checked proves the server accepted
  // setLobbyPublic and echoed isPublic=true back in lobbyState.
  await pageD
    .waitForFunction(
      () => document.querySelector("label.checkbox input[type=checkbox]")?.checked === true,
      undefined,
      { timeout: 10_000 },
    )
    .catch(() => {
      throw new Error("'List publicly' never became checked — server did not echo isPublic=true");
    });
  log(`dave hosted lobby ${codeD} and listed it publicly`);

  // 15. Erin browses public games and must see exactly one entry: dave's.
  await pageE.goto(APP_URL, { waitUntil: "domcontentloaded" });
  await pageE.getByPlaceholder("your name").fill("erin");
  await pageE.getByRole("button", { name: "Browse public games" }).click();
  // Poll with Refresh: the first lobbyList reply may have raced dave's
  // setLobbyPublic round-trip, and Refresh is part of the contract anyway.
  const browseDeadline = Date.now() + 15_000;
  let entryCount = 0;
  while (Date.now() < browseDeadline) {
    entryCount = await pageE.locator(".lobby-browser li").count();
    if (entryCount > 0) break;
    await pageE.getByRole("button", { name: "Refresh" }).click();
    await sleep(500);
  }
  if (entryCount !== 1) {
    throw new Error(`public lobby browser shows ${entryCount} entries, expected exactly 1 (dave's)`);
  }
  const hostName = ((await pageE.locator(".lobby-browser li .host-name").textContent()) ?? "").trim();
  if (hostName !== "dave") {
    throw new Error(`public lobby entry host name is ${JSON.stringify(hostName)}, expected "dave"`);
  }
  log("erin's browser shows exactly one public game, hosted by dave");

  // 16. Erin joins from the browser and must land in dave's lobby.
  const joinBtn = pageE.locator(".lobby-browser li button");
  if (await joinBtn.isDisabled()) {
    throw new Error("Join button is disabled for a joinable (not in-match) public lobby");
  }
  await joinBtn.click();
  await pageE.locator(".lobby-code").waitFor({ timeout: 15_000 });
  const codeE = (await pageE.locator(".lobby-code").textContent())?.trim() ?? "";
  if (codeE !== codeD) {
    throw new Error(`erin landed in lobby ${JSON.stringify(codeE)}, expected dave's ${codeD}`);
  }
  for (const [label, page] of [["dave", pageD], ["erin", pageE]]) {
    await page
      .waitForFunction(() => document.querySelectorAll(".player-list li").length === 2, undefined, {
        timeout: 10_000,
      })
      .catch(async () => {
        const n = await page.locator(".player-list li").count();
        throw new Error(`${label}'s roster shows ${n} players after the browser join, expected 2`);
      });
  }
  log(`erin joined dave's lobby ${codeD} via the public browser; both rosters show 2 players`);

  // 17. Zero console errors during the whole public-browser scenario.
  await sleep(500); // let any straggling errors land
  if (browserErrors.length > 0) {
    throw new Error(`console errors observed in PUBLIC-BROWSER scenario:\n  ${browserErrors.join("\n  ")}`);
  }

  console.log(
    `\nSMOKE PASS — two-player: lobby ${code}, 2 players joined, tiny match started on both pages, ` +
      `timer counting down (${t0}s -> ${t1}s), HUD ping "${pingText}", ` +
      `combat HUD (HP bar + 4 slots) present, Space swing ok, zero console errors; ` +
      `solo-with-bot: lobby ${codeC}, roster 2 (1 BOT), small match ran ~4s, ` +
      `timer counting down (${s0}s -> ${s1}s), zero console errors; ` +
      `public-browser: lobby ${codeD} listed publicly, browser showed exactly 1 entry (host dave), ` +
      `erin joined via Join, roster 2 on both pages, zero console errors.`,
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
