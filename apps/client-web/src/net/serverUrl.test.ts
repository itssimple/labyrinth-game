import { describe, expect, it } from "vitest";
import {
  normalizeServerUrl,
  resolveServerUrl,
  serverUrlHost,
  type PageLocation,
} from "./serverUrl";

const devLoc: PageLocation = { protocol: "http:", host: "localhost:5173", port: "5173" };
const prodHttps: PageLocation = { protocol: "https:", host: "play.example.com", port: "" };
const prodHttp: PageLocation = { protocol: "http:", host: "192.168.1.7:8080", port: "8080" };
const previewLoc: PageLocation = { protocol: "http:", host: "localhost:4173", port: "4173" };

describe("resolveServerUrl priority order", () => {
  it("1) manual wins over env and same-origin", () => {
    expect(resolveServerUrl("game.example.com", "ws://envhost/ws", prodHttps)).toBe(
      "wss://game.example.com/ws",
    );
    expect(resolveServerUrl("ws://raw:9000/ws", "ws://envhost/ws", devLoc)).toBe(
      "ws://raw:9000/ws",
    );
  });

  it("blank/whitespace manual falls through to env", () => {
    expect(resolveServerUrl("", "ws://envhost/ws", prodHttps)).toBe("ws://envhost/ws");
    expect(resolveServerUrl("   ", "ws://envhost/ws", devLoc)).toBe("ws://envhost/ws");
    expect(resolveServerUrl(null, "ws://envhost/ws", devLoc)).toBe("ws://envhost/ws");
    expect(resolveServerUrl(undefined, "ws://envhost/ws", devLoc)).toBe("ws://envhost/ws");
  });

  it("2) env wins over same-origin and fallback", () => {
    expect(resolveServerUrl(null, "ws://localhost:8090/ws", prodHttps)).toBe(
      "ws://localhost:8090/ws",
    );
    expect(resolveServerUrl(null, "ws://localhost:8090/ws", devLoc)).toBe(
      "ws://localhost:8090/ws",
    );
  });

  it("empty env is ignored", () => {
    expect(resolveServerUrl(null, "", devLoc)).toBe("ws://localhost:8080/ws");
  });

  it("3) same-origin when not on the vite dev port: https => wss", () => {
    expect(resolveServerUrl(null, undefined, prodHttps)).toBe("wss://play.example.com/ws");
  });

  it("3) same-origin when not on the vite dev port: http => ws, port kept", () => {
    expect(resolveServerUrl(null, undefined, prodHttp)).toBe("ws://192.168.1.7:8080/ws");
  });

  it("3) vite preview (4173) is NOT dev — same-origin applies", () => {
    expect(resolveServerUrl(null, undefined, previewLoc)).toBe("ws://localhost:4173/ws");
  });

  it("4) dev fallback on the vite dev server (5173)", () => {
    expect(resolveServerUrl(null, undefined, devLoc)).toBe("ws://localhost:8080/ws");
  });
});

describe("normalizeServerUrl", () => {
  it("returns null for blank input", () => {
    expect(normalizeServerUrl("", "http:")).toBeNull();
    expect(normalizeServerUrl("   ", "https:")).toBeNull();
  });

  it("bare host gets page-matching scheme and /ws path", () => {
    expect(normalizeServerUrl("example.com", "http:")).toBe("ws://example.com/ws");
    expect(normalizeServerUrl("example.com", "https:")).toBe("wss://example.com/ws");
  });

  it("bare host:port keeps the port", () => {
    expect(normalizeServerUrl("example.com:9000", "http:")).toBe("ws://example.com:9000/ws");
    expect(normalizeServerUrl("example.com:9000", "https:")).toBe("wss://example.com:9000/ws");
  });

  it("trims whitespace and trailing slashes on bare hosts", () => {
    expect(normalizeServerUrl("  example.com/  ", "http:")).toBe("ws://example.com/ws");
  });

  it("ws:// and wss:// URLs pass through unchanged", () => {
    expect(normalizeServerUrl("ws://x/ws", "https:")).toBe("ws://x/ws");
    expect(normalizeServerUrl("wss://x/ws", "http:")).toBe("wss://x/ws");
    expect(normalizeServerUrl("WSS://x/ws", "http:")).toBe("WSS://x/ws");
  });

  it("http(s):// schemes map to ws(s)://", () => {
    expect(normalizeServerUrl("http://example.com:9000/ws", "https:")).toBe(
      "ws://example.com:9000/ws",
    );
    expect(normalizeServerUrl("https://example.com/ws", "http:")).toBe("wss://example.com/ws");
  });
});

describe("serverUrlHost", () => {
  it("extracts host[:port] from ws(s) URLs", () => {
    expect(serverUrlHost("ws://localhost:8080/ws")).toBe("localhost:8080");
    expect(serverUrlHost("wss://play.example.com/ws")).toBe("play.example.com");
    expect(serverUrlHost("wss://play.example.com:9000/ws")).toBe("play.example.com:9000");
  });

  it("falls back to the raw string when unparseable", () => {
    expect(serverUrlHost("not a url")).toBe("not a url");
  });
});
