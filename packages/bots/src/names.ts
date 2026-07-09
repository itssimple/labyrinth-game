/**
 * Friendly bot display names. Pure lookup — same index always yields the same
 * name (lobby UI and server must agree without coordination).
 */
const BOT_NAMES = [
  "Juno",
  "Piper",
  "Milo",
  "Hazel",
  "Otis",
  "Wren",
  "Basil",
  "Nova",
  "Remy",
  "Sage",
  "Iggy",
  "Luna",
  "Felix",
  "Poppy",
  "Ozzy",
  "Cleo",
  "Ziggy",
  "Maple",
  "Bruno",
  "Tilly",
] as const;

/**
 * Deterministic friendly bot display name for lobby index `i` ("Bot Juno").
 * Indices beyond the name list wrap with a numeric suffix ("Bot Juno 2").
 */
export function botName(i: number): string {
  const n = Number.isFinite(i) ? Math.max(0, Math.floor(i)) : 0;
  const base = BOT_NAMES[n % BOT_NAMES.length] as string;
  const round = Math.floor(n / BOT_NAMES.length);
  return round === 0 ? `Bot ${base}` : `Bot ${base} ${round + 1}`;
}
