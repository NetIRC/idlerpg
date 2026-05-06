/**
 * Human-readable duration for level timers, lucky hour, penalties, etc.
 *
 * - Under 1 minute: `45s`
 * - Under 1 hour: `13m 5s` or `10m`
 * - Under 1 day: `14h 18m 29s`
 * - 1+ days: `2d 14h 18m 29s`
 */
export function durationIt(totalSec: number): string {
  if (!Number.isFinite(totalSec) || totalSec < 0) return `n/a (${totalSec})`;
  const s = Math.floor(totalSec);
  if (s < 60) return `${s}s`;
  const days = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (days === 0 && h === 0) {
    if (sec === 0) return `${m}m`;
    return `${m}m ${sec}s`;
  }
  if (days === 0) {
    if (sec === 0) return m > 0 ? `${h}h ${m}m` : `${h}h`;
    return `${h}h ${m}m ${sec}s`;
  }
  if (sec === 0) {
    if (m === 0) return `${days}d ${h}h`;
    return `${days}d ${h}h ${m}m`;
  }
  return `${days}d ${h}h ${m}m ${sec}s`;
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
