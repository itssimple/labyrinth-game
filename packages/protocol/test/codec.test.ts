import { describe, expect, it } from "vitest";
import type { ClientMessage, ServerMessage } from "../src/messages.js";
import { decodeClientMessage, decodeServerMessage, encodeMessage } from "../src/codec.js";

// ---------------------------------------------------------------------------
// Round-trips: every ClientMessage variant
// ---------------------------------------------------------------------------

const clientMessages: ClientMessage[] = [
  { type: "hello", protocolVersion: 1, name: "Ariadne" },
  { type: "createLobby" },
  { type: "joinLobby", code: "ABcd" },
  { type: "leaveLobby" },
  {
    type: "startMatch",
    options: { seed: "seed-1", size: "medium", difficulty: 0.5, modifiers: ["fog"] },
  },
  { type: "startMatch", options: { seed: "", size: "tiny" } },
  { type: "input", seq: 42, moveX: -1, moveY: 1, sprint: true, sneak: false },
  { type: "input", seq: 0, moveX: 0, moveY: 0, sprint: false, sneak: true },
  { type: "chat", text: "behind you!" },
];

describe("encodeMessage + decodeClientMessage round-trip", () => {
  for (const msg of clientMessages) {
    it(`round-trips ${msg.type} (${JSON.stringify(msg).slice(0, 60)})`, () => {
      expect(decodeClientMessage(encodeMessage(msg))).toEqual(msg);
    });
  }
});

// ---------------------------------------------------------------------------
// Round-trips: every ServerMessage variant
// ---------------------------------------------------------------------------

const serverMessages: ServerMessage[] = [
  { type: "welcome", playerId: "p-123" },
  { type: "error", code: "lobbyFull", message: "Lobby is full" },
  {
    type: "lobbyState",
    code: "WXYZ",
    hostId: "p-123",
    isPublic: false,
    players: [{ playerId: "p-123", name: "Ariadne", isBot: false }],
  },
  {
    type: "matchStart",
    options: { seed: "s", size: "large" },
    endTick: 6000,
    yourSpawnIndex: 3,
  },
  {
    type: "snapshot",
    tick: 17,
    ackSeq: 5,
    you: { x: 3.5, y: 2.5, escaped: false },
    visiblePlayers: [{ playerId: "p-456", x: 4.5, y: 2.5 }],
    visibleCells: [0, 1, 2],
    sounds: [
      { kind: "footstep-walk", x: 6, y: 7, confidence: "medium", intensity: 0.3, tick: 17 },
    ],
  },
  { type: "matchEnd", reason: "allEscaped", escaped: ["p-123", "p-456"] },
  { type: "chatBroadcast", playerId: "p-123", name: "Ariadne", text: "gg" },
];

describe("encodeMessage + decodeServerMessage round-trip", () => {
  for (const msg of serverMessages) {
    it(`round-trips ${msg.type}`, () => {
      expect(decodeServerMessage(encodeMessage(msg))).toEqual(msg);
    });
  }
});

// ---------------------------------------------------------------------------
// decodeClientMessage: malformed / hostile inputs all return null
// ---------------------------------------------------------------------------

const malformedClientInputs: [label: string, raw: string][] = [
  // Not JSON / not an object
  ["garbage string", "hello there"],
  ["empty string", ""],
  ["json null", "null"],
  ["json number", "42"],
  ["json string", '"hello"'],
  ["json array", "[]"],
  ["json true", "true"],
  ["empty object", "{}"],
  ["truncated json", '{"type":"hel'],

  // Bad / unknown / hostile type discriminators
  ["numeric type", '{"type":123}'],
  ["null type", '{"type":null}'],
  ["unknown type", '{"type":"teleport"}'],
  ["prototype pollution type", '{"type":"__proto__"}'],
  ["constructor type", '{"type":"constructor"}'],
  ["hasOwnProperty type", '{"type":"hasOwnProperty"}'],
  ["case-mismatched type", '{"type":"Hello","protocolVersion":1,"name":"a"}'],

  // hello
  ["hello missing name", '{"type":"hello","protocolVersion":1}'],
  ["hello empty name", '{"type":"hello","protocolVersion":1,"name":""}'],
  [
    "hello oversized name (21 chars)",
    `{"type":"hello","protocolVersion":1,"name":"${"a".repeat(21)}"}`,
  ],
  ["hello numeric name", '{"type":"hello","protocolVersion":1,"name":7}'],
  ["hello string version", '{"type":"hello","protocolVersion":"1","name":"a"}'],
  ["hello Infinity version (1e999)", '{"type":"hello","protocolVersion":1e999,"name":"a"}'],
  ["hello fractional version", '{"type":"hello","protocolVersion":1.5,"name":"a"}'],

  // joinLobby
  ["joinLobby missing code", '{"type":"joinLobby"}'],
  ["joinLobby short code", '{"type":"joinLobby","code":"ABC"}'],
  ["joinLobby long code", '{"type":"joinLobby","code":"ABCDE"}'],
  ["joinLobby digit in code", '{"type":"joinLobby","code":"AB1D"}'],
  ["joinLobby symbol in code", '{"type":"joinLobby","code":"AB!D"}'],
  ["joinLobby numeric code", '{"type":"joinLobby","code":1234}'],

  // startMatch / MazeGenOptions
  ["startMatch missing options", '{"type":"startMatch"}'],
  ["startMatch null options", '{"type":"startMatch","options":null}'],
  ["startMatch array options", '{"type":"startMatch","options":[]}'],
  ["startMatch missing seed", '{"type":"startMatch","options":{"size":"tiny"}}'],
  ["startMatch numeric seed", '{"type":"startMatch","options":{"seed":5,"size":"tiny"}}'],
  [
    "startMatch bad size",
    '{"type":"startMatch","options":{"seed":"s","size":"gigantic"}}',
  ],
  ["startMatch numeric size", '{"type":"startMatch","options":{"seed":"s","size":35}}'],
  [
    "startMatch non-finite difficulty",
    '{"type":"startMatch","options":{"seed":"s","size":"tiny","difficulty":1e999}}',
  ],
  [
    "startMatch string difficulty",
    '{"type":"startMatch","options":{"seed":"s","size":"tiny","difficulty":"0.5"}}',
  ],
  [
    "startMatch non-array modifiers",
    '{"type":"startMatch","options":{"seed":"s","size":"tiny","modifiers":"fog"}}',
  ],
  [
    "startMatch non-string modifier element",
    '{"type":"startMatch","options":{"seed":"s","size":"tiny","modifiers":[1]}}',
  ],
  [
    "startMatch oversized seed (65 chars)",
    `{"type":"startMatch","options":{"seed":"${"s".repeat(65)}","size":"tiny"}}`,
  ],
  [
    "startMatch huge seed (60KB)",
    `{"type":"startMatch","options":{"seed":"${"s".repeat(60_000)}","size":"tiny"}}`,
  ],
  [
    "startMatch too many modifiers (9)",
    `{"type":"startMatch","options":{"seed":"s","size":"tiny","modifiers":${JSON.stringify(
      Array.from({ length: 9 }, () => "m"),
    )}}}`,
  ],
  [
    "startMatch oversized modifier (33 chars)",
    `{"type":"startMatch","options":{"seed":"s","size":"tiny","modifiers":["${"m".repeat(33)}"]}}`,
  ],

  // input
  ["input missing fields", '{"type":"input","seq":1}'],
  [
    "input moveX out of range",
    '{"type":"input","seq":1,"moveX":2,"moveY":0,"sprint":false,"sneak":false}',
  ],
  [
    "input fractional moveY",
    '{"type":"input","seq":1,"moveX":0,"moveY":0.5,"sprint":false,"sneak":false}',
  ],
  [
    "input string moveX",
    '{"type":"input","seq":1,"moveX":"1","moveY":0,"sprint":false,"sneak":false}',
  ],
  [
    "input Infinity seq (1e999)",
    '{"type":"input","seq":1e999,"moveX":0,"moveY":0,"sprint":false,"sneak":false}',
  ],
  [
    "input string sprint",
    '{"type":"input","seq":1,"moveX":0,"moveY":0,"sprint":"true","sneak":false}',
  ],
  [
    "input null sneak",
    '{"type":"input","seq":1,"moveX":0,"moveY":0,"sprint":false,"sneak":null}',
  ],

  // chat
  ["chat missing text", '{"type":"chat"}'],
  ["chat numeric text", '{"type":"chat","text":42}'],
  ["chat oversized text (201 chars)", `{"type":"chat","text":"${"x".repeat(201)}"}`],
];

describe("decodeClientMessage rejects malformed input", () => {
  for (const [label, raw] of malformedClientInputs) {
    it(`returns null for ${label}`, () => {
      expect(decodeClientMessage(raw)).toBeNull();
    });
  }
});

describe("decodeClientMessage boundary and hardening behavior", () => {
  it("accepts a 20-char name and a 200-char chat (at the limit)", () => {
    expect(
      decodeClientMessage(`{"type":"hello","protocolVersion":1,"name":"${"n".repeat(20)}"}`),
    ).toEqual({ type: "hello", protocolVersion: 1, name: "n".repeat(20) });
    expect(decodeClientMessage(`{"type":"chat","text":"${"c".repeat(200)}"}`)).toEqual({
      type: "chat",
      text: "c".repeat(200),
    });
  });

  it("accepts a 64-char seed and 8 modifiers of 32 chars each (at the limit)", () => {
    const seed = "s".repeat(64);
    const modifiers = Array.from({ length: 8 }, () => "m".repeat(32));
    expect(
      decodeClientMessage(
        `{"type":"startMatch","options":{"seed":"${seed}","size":"tiny","modifiers":${JSON.stringify(
          modifiers,
        )}}}`,
      ),
    ).toEqual({ type: "startMatch", options: { seed, size: "tiny", modifiers } });
  });

  it("accepts lowercase lobby codes (case-insensitive)", () => {
    expect(decodeClientMessage('{"type":"joinLobby","code":"abcd"}')).toEqual({
      type: "joinLobby",
      code: "abcd",
    });
  });

  it("strips unknown extra properties from the decoded message", () => {
    const decoded = decodeClientMessage(
      '{"type":"joinLobby","code":"ABCD","isAdmin":true,"__proto__":{"polluted":1}}',
    );
    expect(decoded).toEqual({ type: "joinLobby", code: "ABCD" });
    expect(Object.keys(decoded as object).sort()).toEqual(["code", "type"]);
    // The shared Object prototype must not have been polluted.
    expect(({} as Record<string, unknown>)["polluted"]).toBeUndefined();
  });

  it("strips unknown extra properties from nested MazeGenOptions", () => {
    const decoded = decodeClientMessage(
      '{"type":"startMatch","options":{"seed":"s","size":"tiny","cheat":true}}',
    );
    expect(decoded).toEqual({ type: "startMatch", options: { seed: "s", size: "tiny" } });
  });
});

// ---------------------------------------------------------------------------
// decodeServerMessage: light-weight checks
// ---------------------------------------------------------------------------

describe("decodeServerMessage", () => {
  it("returns null for invalid JSON", () => {
    expect(decodeServerMessage("not json")).toBeNull();
  });

  it("returns null for non-objects", () => {
    expect(decodeServerMessage("null")).toBeNull();
    expect(decodeServerMessage("[]")).toBeNull();
    expect(decodeServerMessage('"welcome"')).toBeNull();
  });

  it("returns null for unknown or client-side types", () => {
    expect(decodeServerMessage('{"type":"nope"}')).toBeNull();
    expect(decodeServerMessage('{"type":"__proto__"}')).toBeNull();
    expect(decodeServerMessage('{"type":123}')).toBeNull();
  });
});
