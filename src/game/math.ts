import type { AppConfig } from '../config.js';

/** Seconds until next level — `ttl` in bot.pl */
export function ttl(level: number, c: AppConfig): number {
  if (level <= 60) return c.rpbase * c.rpstep ** level;
  return c.rpbase * c.rpstep ** 60 + 86400 * (level - 60);
}

/** Penalty time scale — `penttl` in bot.pl */
export function penttl(level: number, c: AppConfig): number {
  if (level <= 60) return c.rpbase * c.rppenstep ** level;
  return c.rpbase * c.rppenstep ** 60 + 86400 * (level - 60);
}
