export interface InputSample {
  moveX: -1 | 0 | 1;
  moveY: -1 | 0 | 1;
  sprint: boolean;
  sneak: boolean;
}

const IDLE: InputSample = { moveX: 0, moveY: 0, sprint: false, sneak: false };

/**
 * Keyboard state tracker for gameplay input. WASD/arrows move, Shift sprints,
 * Ctrl or C sneaks. Pure key bookkeeping — sampling and sending happen in the
 * session's input loop at TICK_RATE.
 */
export class InputTracker {
  private readonly down = new Set<string>();
  private attached = false;
  /** When false (e.g. chat overlay open) read() reports idle input. */
  enabled = true;

  private readonly onKeyDown = (e: KeyboardEvent) => {
    this.down.add(e.code);
    // Keep arrows/space from scrolling the page while playing.
    if (this.enabled && (e.code.startsWith("Arrow") || e.code === "Space")) e.preventDefault();
  };
  private readonly onKeyUp = (e: KeyboardEvent) => {
    this.down.delete(e.code);
  };
  private readonly onBlur = () => {
    this.down.clear();
  };

  /** Starts listening on window. Idempotent. */
  attach(): void {
    if (this.attached) return;
    this.attached = true;
    window.addEventListener("keydown", this.onKeyDown);
    window.addEventListener("keyup", this.onKeyUp);
    window.addEventListener("blur", this.onBlur);
  }

  /** Stops listening and clears held keys. Idempotent. */
  detach(): void {
    if (!this.attached) return;
    this.attached = false;
    window.removeEventListener("keydown", this.onKeyDown);
    window.removeEventListener("keyup", this.onKeyUp);
    window.removeEventListener("blur", this.onBlur);
    this.down.clear();
  }

  private has(...codes: string[]): boolean {
    for (const c of codes) if (this.down.has(c)) return true;
    return false;
  }

  /** Current movement intent, already constrained to protocol-valid values. */
  read(): InputSample {
    if (!this.enabled) return IDLE;
    const left = this.has("KeyA", "ArrowLeft");
    const right = this.has("KeyD", "ArrowRight");
    const up = this.has("KeyW", "ArrowUp");
    const downK = this.has("KeyS", "ArrowDown");
    return {
      moveX: right === left ? 0 : right ? 1 : -1,
      moveY: downK === up ? 0 : downK ? 1 : -1,
      sprint: this.has("ShiftLeft", "ShiftRight"),
      sneak: this.has("ControlLeft", "ControlRight", "KeyC"),
    };
  }
}
