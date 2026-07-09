import { TICK_RATE } from "@labyrinth/common";
import type { VisiblePlayerState } from "@labyrinth/protocol";

export interface Vec2 {
  x: number;
  y: number;
}

interface TimedPos {
  x: number;
  y: number;
  recvMs: number;
}

const SNAPSHOT_MS = 1000 / TICK_RATE;

function clamp01(t: number): number {
  return t < 0 ? 0 : t > 1 ? 1 : t;
}

/**
 * Renders positions one snapshot behind real time by lerping between the last
 * two received snapshot positions. Presentation-only smoothing — never
 * authoritative.
 */
export class Interpolator {
  private prev: TimedPos | null = null;
  private curr: TimedPos | null = null;

  /** Records a snapshot position received at local time `recvMs`. */
  push(x: number, y: number, recvMs: number): void {
    this.prev = this.curr;
    this.curr = { x, y, recvMs };
  }

  /** Interpolated position at local time `nowMs`, or null before any data. */
  posAt(nowMs: number): Vec2 | null {
    const curr = this.curr;
    if (curr === null) return null;
    const prev = this.prev;
    if (prev === null) return { x: curr.x, y: curr.y };
    const span = Math.max(1, Math.min(curr.recvMs - prev.recvMs, SNAPSHOT_MS * 4));
    const t = clamp01((nowMs - curr.recvMs) / span);
    return {
      x: prev.x + (curr.x - prev.x) * t,
      y: prev.y + (curr.y - prev.y) * t,
    };
  }
}

interface RemoteEntry {
  interp: Interpolator;
  lastTick: number;
}

/**
 * Tracks visible other players across snapshots. A player is rendered only
 * while present in the latest snapshot (the server already filtered by
 * vision); entries unseen for a while are pruned.
 */
export class RemotePlayers {
  private readonly entries = new Map<string, RemoteEntry>();
  private latestTick = -1;

  /** Feeds one snapshot's visible players, received at local time `recvMs`. */
  update(players: readonly VisiblePlayerState[], tick: number, recvMs: number): void {
    this.latestTick = tick;
    for (const p of players) {
      let e = this.entries.get(p.playerId);
      if (e === undefined) {
        e = { interp: new Interpolator(), lastTick: tick };
        this.entries.set(p.playerId, e);
      }
      e.interp.push(p.x, p.y, recvMs);
      e.lastTick = tick;
    }
    // Prune players not seen for > 5 seconds of ticks.
    for (const [id, e] of this.entries) {
      if (tick - e.lastTick > TICK_RATE * 5) this.entries.delete(id);
    }
  }

  /** Interpolated positions of players present in the latest snapshot. */
  visibleAt(nowMs: number): { id: string; x: number; y: number }[] {
    const out: { id: string; x: number; y: number }[] = [];
    for (const [id, e] of this.entries) {
      if (e.lastTick !== this.latestTick) continue;
      const pos = e.interp.posAt(nowMs);
      if (pos !== null) out.push({ id, x: pos.x, y: pos.y });
    }
    return out;
  }
}
