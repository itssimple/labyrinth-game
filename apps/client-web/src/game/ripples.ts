import { Container, Graphics } from "pixi.js";
import type { PerceivedSound, SoundConfidence } from "@labyrinth/common";
import { TILE_PX } from "./palette";

interface RippleStyle {
  color: number;
  /** Peak line alpha at spawn. */
  alpha: number;
  /** Final ring radius in tiles. */
  maxRadiusTiles: number;
  /** Stroke width in px (thicker = more diffuse). */
  width: number;
  durationMs: number;
  /** Extra faint halo rings for blur/diffuse look. */
  halo: boolean;
}

/** Confidence-banded ripple styling: high = tight & bright, low = big & vague. */
const STYLES: Record<SoundConfidence, RippleStyle> = {
  high: { color: 0xfff0a0, alpha: 0.95, maxRadiusTiles: 1.3, width: 3, durationMs: 700, halo: false },
  medium: { color: 0xe8d8b0, alpha: 0.6, maxRadiusTiles: 2.8, width: 5, durationMs: 1000, halo: true },
  low: { color: 0xb9b4c8, alpha: 0.32, maxRadiusTiles: 4.5, width: 9, durationMs: 1300, halo: true },
};

interface Ripple {
  g: Graphics;
  x: number;
  y: number;
  ageMs: number;
  style: RippleStyle;
  intensity: number;
}

/**
 * Expanding sound-ripple rings ("sound is vision"). Rendered above the fog so
 * sounds from unexplored areas still show — position accuracy is already
 * confidence-limited by the server, so this is not a wallhack.
 */
export class RippleField {
  readonly container = new Container();
  private readonly ripples: Ripple[] = [];

  /** Spawns a ripple for one perceived sound (world position in tiles). */
  spawn(sound: PerceivedSound): void {
    const g = new Graphics();
    this.container.addChild(g);
    this.ripples.push({
      g,
      x: sound.x * TILE_PX,
      y: sound.y * TILE_PX,
      ageMs: 0,
      style: STYLES[sound.confidence],
      intensity: sound.intensity,
    });
  }

  /** Advances and redraws all ripples; removes finished ones. */
  update(dtMs: number): void {
    for (let i = this.ripples.length - 1; i >= 0; i--) {
      const r = this.ripples[i];
      if (r === undefined) continue;
      r.ageMs += dtMs;
      const t = r.ageMs / r.style.durationMs;
      if (t >= 1) {
        r.g.destroy();
        this.ripples.splice(i, 1);
        continue;
      }
      const ease = 1 - (1 - t) * (1 - t); // ease-out expansion
      const radius = (0.15 + ease * r.style.maxRadiusTiles) * TILE_PX;
      const alpha = (1 - t) * r.style.alpha * (0.5 + 0.5 * r.intensity);
      const g = r.g;
      g.clear();
      g.circle(r.x, r.y, radius).stroke({ color: r.style.color, alpha, width: r.style.width });
      if (r.style.halo) {
        g.circle(r.x, r.y, radius * 0.75).stroke({
          color: r.style.color,
          alpha: alpha * 0.4,
          width: r.style.width * 1.6,
        });
      }
    }
  }

  /** Destroys all ripple graphics. */
  destroy(): void {
    for (const r of this.ripples) r.g.destroy();
    this.ripples.length = 0;
    this.container.destroy({ children: true });
  }
}
