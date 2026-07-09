import { useState } from "react";
import type { AudioEngine } from "../audio/engine";

/**
 * Master volume slider + mute toggle. Reads/writes the AudioEngine (which
 * persists to localStorage); local React state only mirrors it for rendering.
 * `compact` is the in-game HUD variant.
 */
export function VolumeControl({ audio, compact = false }: { audio: AudioEngine; compact?: boolean }) {
  const [volume, setVolume] = useState(audio.volume);
  const [muted, setMuted] = useState(audio.muted);

  const toggleMute = () => {
    const next = !muted;
    audio.setMuted(next);
    setMuted(next);
  };
  const changeVolume = (v: number) => {
    audio.setVolume(v);
    setVolume(v);
  };

  return (
    <span className={compact ? "volume compact" : "volume"}>
      <button
        type="button"
        className="mute-toggle"
        aria-label={muted ? "Unmute" : "Mute"}
        aria-pressed={muted}
        onClick={toggleMute}
      >
        {muted ? "muted" : "sound"}
      </button>
      <input
        type="range"
        min={0}
        max={1}
        step={0.05}
        value={volume}
        disabled={muted}
        aria-label="Master volume"
        onChange={(e) => changeVolume(Number(e.target.value))}
      />
    </span>
  );
}
