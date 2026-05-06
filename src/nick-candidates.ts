/** Nick fallback candidate builder for IRC connect and collision recovery. */

import type { AppConfig } from './config.js';

function truncateNick(n: string, maxLen: number): string {
  if (n.length <= maxLen) return n;
  return n.slice(0, maxLen);
}

/** Ordered unique nick candidates: primary → explicit alts → Base_1, Base_2, … */
export function buildNickCandidates(cfg: AppConfig): string[] {
  const primary = cfg.ircNick.trim();
  const alts = cfg.ircAltNicks
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const base = primary.replace(/_+$/, '') || primary;
  const auto: string[] = [];
  for (let i = 1; i <= cfg.ircNickSuffixMax; i++) {
    auto.push(`${base}_${i}`);
  }
  const seen = new Set<string>();
  const out: string[] = [];
  for (const n of [primary, ...alts, ...auto]) {
    const t = n.trim();
    if (!t) continue;
    const key = t.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(truncateNick(t, cfg.ircNickMaxLen));
  }
  return out;
}

/** Character names cannot match any bot nick candidate (case-insensitive). */
export function reservedBotNicksLower(cfg: AppConfig): Set<string> {
  return new Set(buildNickCandidates(cfg).map((n) => n.toLowerCase()));
}
