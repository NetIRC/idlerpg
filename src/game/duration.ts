/** Human-readable duration, same idea as `duration()` in the Perl bot */
export function durationIt(totalSec: number): string {
  if (!Number.isFinite(totalSec) || totalSec < 0) return `n/a (${totalSec})`;
  const s = Math.floor(totalSec);
  const days = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const dayWord = days === 1 ? 'day' : 'days';
  return `${days} ${dayWord}, ${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
}
