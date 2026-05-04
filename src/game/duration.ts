/**
 * Human-readable duration for level timers, lucky hour, penalties, etc.
 *
 * - Under 1 minute: `45s`
 * - Under 1 hour: `13m 5s` or `10m` (unambiguous vs `H:MM:SS` clock style)
 * - Under 1 day: `H:MM:SS`
 * - 1+ days: `N day(s), H:MM:SS`
 */
export function durationIt(totalSec: number): string {
  if (!Number.isFinite(totalSec) || totalSec < 0) return `n/a (${totalSec})`;
  const s = Math.floor(totalSec);
  const pad2 = (n: number) => String(n).padStart(2, '0');
  if (s < 60) return `${s}s`;
  const days = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (days === 0 && h === 0) {
    if (sec === 0) return `${m}m`;
    return `${m}m ${sec}s`;
  }
  const clock = `${h}:${pad2(m)}:${pad2(sec)}`;
  if (days === 0) return clock;
  const dayWord = days === 1 ? 'day' : 'days';
  return `${days} ${dayWord}, ${clock}`;
}

/**
 * Relative “time ago” for chronicle / feeds (`s`, `m`, `h`, `d`).
 * Not for level-timer countdowns — use {@link durationIt} for those.
 */
export function formatRelativeAgoSec(agoSec: number): string {
  const a = Math.max(0, Math.floor(agoSec));
  if (a < 60) return `${Math.max(1, a)}s`;
  if (a < 3600) return `${Math.floor(a / 60)}m`;
  if (a < 86400) return `${Math.floor(a / 3600)}h`;
  return `${Math.floor(a / 86400)}d`;
}
