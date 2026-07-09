/**
 * Twin virtual touch sticks (contract "Client aim sources"): pointer events
 * with pointerType "touch" only, so mouse/pen never spawn sticks and the
 * feature is inert on non-touch devices. Left half of the game area = move
 * stick, right half = aim stick. Each active stick renders as a translucent
 * base + knob circle pair in a DOM overlay (presentation only — the overlay
 * is pointer-events:none; we listen on the host element itself).
 *
 * Sticks are "floating": the base anchors where the finger lands, the knob
 * follows the finger (clamped to the stick radius). Stick math (deadzone,
 * normalization, walk threshold) lives in aim.ts.
 *
 * TODO(touch v2): sprint/sneak and attack for touch — v1 is move + aim only.
 */

import { readStick, type StickRead } from "./aim";

/** Max knob travel from the base center, in px (also the read scale). */
const STICK_RADIUS_PX = 56;
const BASE_DIAMETER_PX = 2 * STICK_RADIUS_PX;
const KNOB_DIAMETER_PX = 48;

type Side = "move" | "aim";

interface ActiveStick {
  side: Side;
  /** Base center in client coordinates. */
  baseX: number;
  baseY: number;
  /** Raw deflection in [-1, 1]-ish units of STICK_RADIUS_PX (unclamped). */
  dx: number;
  dy: number;
  base: HTMLDivElement;
  knob: HTMLDivElement;
}

function makeCircle(className: string, diameter: number): HTMLDivElement {
  const el = document.createElement("div");
  el.className = className;
  el.style.width = `${diameter}px`;
  el.style.height = `${diameter}px`;
  return el;
}

export class TouchSticks {
  private host: HTMLElement | null = null;
  private overlay: HTMLDivElement | null = null;
  /** Active sticks by pointerId (at most one per side). */
  private readonly sticks = new Map<number, ActiveStick>();

  private readonly onPointerDown = (e: PointerEvent) => {
    if (e.pointerType !== "touch" || this.host === null || this.overlay === null) return;
    const rect = this.host.getBoundingClientRect();
    const side: Side = e.clientX - rect.left < rect.width / 2 ? "move" : "aim";
    if (this.bySide(side) !== null) return; // one finger per side
    const base = makeCircle("touch-stick-base", BASE_DIAMETER_PX);
    const knob = makeCircle("touch-stick-knob", KNOB_DIAMETER_PX);
    this.overlay.append(base, knob);
    const stick: ActiveStick = {
      side,
      baseX: e.clientX,
      baseY: e.clientY,
      dx: 0,
      dy: 0,
      base,
      knob,
    };
    this.sticks.set(e.pointerId, stick);
    this.position(stick, rect);
    e.preventDefault(); // keep the browser from synthesizing mouse events
  };

  private readonly onPointerMove = (e: PointerEvent) => {
    const stick = this.sticks.get(e.pointerId);
    if (stick === undefined || this.host === null) return;
    stick.dx = (e.clientX - stick.baseX) / STICK_RADIUS_PX;
    stick.dy = (e.clientY - stick.baseY) / STICK_RADIUS_PX;
    this.position(stick, this.host.getBoundingClientRect());
  };

  private readonly onPointerEnd = (e: PointerEvent) => {
    const stick = this.sticks.get(e.pointerId);
    if (stick === undefined) return;
    this.sticks.delete(e.pointerId);
    stick.base.remove();
    stick.knob.remove();
  };

  /** Installs pointer listeners + the visual overlay on `host`. Idempotent. */
  attach(host: HTMLElement): void {
    if (this.host !== null) this.detach();
    this.host = host;
    this.overlay = document.createElement("div");
    this.overlay.className = "touch-stick-overlay";
    host.appendChild(this.overlay);
    host.addEventListener("pointerdown", this.onPointerDown);
    // Move/end on window: touch drags routinely leave the host element.
    window.addEventListener("pointermove", this.onPointerMove);
    window.addEventListener("pointerup", this.onPointerEnd);
    window.addEventListener("pointercancel", this.onPointerEnd);
  }

  /** Removes listeners, overlay and any active sticks. Idempotent. */
  detach(): void {
    if (this.host === null) return;
    this.host.removeEventListener("pointerdown", this.onPointerDown);
    window.removeEventListener("pointermove", this.onPointerMove);
    window.removeEventListener("pointerup", this.onPointerEnd);
    window.removeEventListener("pointercancel", this.onPointerEnd);
    this.overlay?.remove();
    this.overlay = null;
    this.host = null;
    this.sticks.clear();
  }

  /** Current move-stick read (left half), or null when not touched. */
  readMove(): StickRead | null {
    return this.read("move");
  }

  /** Current aim-stick read (right half), or null when not touched. */
  readAim(): StickRead | null {
    return this.read("aim");
  }

  private read(side: Side): StickRead | null {
    const stick = this.bySide(side);
    return stick === null ? null : readStick(stick.dx, stick.dy);
  }

  private bySide(side: Side): ActiveStick | null {
    for (const s of this.sticks.values()) if (s.side === side) return s;
    return null;
  }

  /** Places the base/knob circles (host-relative; knob clamped to radius). */
  private position(stick: ActiveStick, rect: DOMRect): void {
    const bx = stick.baseX - rect.left;
    const by = stick.baseY - rect.top;
    const mag = Math.hypot(stick.dx, stick.dy);
    const scale = mag > 1 ? 1 / mag : 1;
    const kx = bx + stick.dx * scale * STICK_RADIUS_PX;
    const ky = by + stick.dy * scale * STICK_RADIUS_PX;
    stick.base.style.transform = `translate(${bx - STICK_RADIUS_PX}px, ${by - STICK_RADIUS_PX}px)`;
    stick.knob.style.transform = `translate(${kx - KNOB_DIAMETER_PX / 2}px, ${ky - KNOB_DIAMETER_PX / 2}px)`;
  }
}
