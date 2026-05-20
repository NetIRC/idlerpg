/** Per-hero daily idle timer gain for web timer trend (meta keys shared with PHP player API). */

import type Database from 'better-sqlite3';
import { metaGetInt, metaSetInt } from '../db/index.js';

export const TIMER_TREND_ANCHOR_META_PREFIX = 'timer_trend_anchor_';
export const TIMER_TREND_IDLE_GAIN_META_PREFIX = 'timer_trend_idle_sec_';

/** Local-midnight unix second; must match PHP `strtotime('today')` on the same host. */
export function startOfGameDaySec(nowSec: number): number {
  const d = new Date(nowSec * 1000);
  d.setHours(0, 0, 0, 0);
  return Math.floor(d.getTime() / 1000);
}

export function addTimerTrendIdleGain(
  db: Database.Database,
  playerId: number,
  gainSec: number,
  nowSec: number,
): void {
  const gain = Math.max(0, Math.floor(gainSec));
  if (gain <= 0) return;
  const anchor = startOfGameDaySec(nowSec);
  const anchorKey = `${TIMER_TREND_ANCHOR_META_PREFIX}${playerId}`;
  const gainKey = `${TIMER_TREND_IDLE_GAIN_META_PREFIX}${playerId}`;
  if (metaGetInt(db, anchorKey) !== anchor) {
    metaSetInt(db, anchorKey, anchor);
    metaSetInt(db, gainKey, 0);
  }
  metaSetInt(db, gainKey, (metaGetInt(db, gainKey) ?? 0) + gain);
}

export function getTimerTrendIdleGainSec(
  db: Database.Database,
  playerId: number,
  nowSec: number,
): number {
  const anchor = startOfGameDaySec(nowSec);
  const anchorKey = `${TIMER_TREND_ANCHOR_META_PREFIX}${playerId}`;
  if (metaGetInt(db, anchorKey) !== anchor) return 0;
  return Math.max(0, metaGetInt(db, `${TIMER_TREND_IDLE_GAIN_META_PREFIX}${playerId}`) ?? 0);
}
