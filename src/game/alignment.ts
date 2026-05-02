/** Single-letter alignments from classic IdleRPG (`n` / `g` / `e`). */

export function alignmentLabel(raw: string | null | undefined): string {
  const a = String(raw ?? '').trim().toLowerCase();
  if (a === 'n' || a === '') return 'Neutral';
  if (a === 'g') return 'Good';
  if (a === 'e') return 'Evil';
  const t = String(raw ?? '').trim();
  return t !== '' ? t : 'Neutral';
}

/** Multiplier applied to idle countdown tick (higher = level faster). */
export function alignmentIdleRate(raw: string | null | undefined): number {
  const a = String(raw ?? '').trim().toLowerCase();
  if (a === 'g') return 1.004;
  if (a === 'e') return 0.996;
  return 1;
}

export function alignmentIdleHint(raw: string | null | undefined): string {
  const a = String(raw ?? '').trim().toLowerCase();
  if (a === 'g') return 'Good · idle ~0.4% faster';
  if (a === 'e') return 'Evil · idle ~0.4% slower';
  return 'Neutral · baseline idle';
}
