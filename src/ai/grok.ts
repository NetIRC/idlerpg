/** Optional Groq client for flavor text and assistive lore responses. */

import type { AppConfig } from '../config.js';

type GrokResult =
  | { ok: true; text: string }
  | { ok: false; err: string };

const GROQ_API_URL = 'https://api.groq.com/openai/v1/chat/completions';

function cleanLoreText(raw: string): string {
  const line = raw.replace(/\s+/g, ' ').trim();
  if (!line) return 'The realm is quiet. Even fate declines to comment.';
  if (line.length <= 320) return line;
  return `${line.slice(0, 317)}...`;
}

function localLoreFallback(topic: string): string {
  const t = topic.trim() || 'the realm';
  return `Local lore: ${t} keeps moving under silent timers. Check !realm and !chronicle for live state while the oracle rests.`;
}

function localBanterFallback(heroNames: string[]): string {
  const first = heroNames[0];
  if (!first) return 'The shard is awake. Silence still beats speeches.';
  return `${first}, keep the channel quiet and the timer honest.`;
}

async function requestGrokLine(
  cfg: AppConfig,
  systemPrompt: string,
  userPrompt: string,
  fallback: string,
): Promise<GrokResult> {
  if (!cfg.aiEnabled) return { ok: false, err: fallback };
  const key = cfg.aiGrokApiKey.trim();
  if (!key) return { ok: false, err: fallback };

  const ctl = new AbortController();
  const timeout = setTimeout(() => ctl.abort(), cfg.aiTimeoutMs);
  try {
    const res = await fetch(GROQ_API_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: cfg.aiGrokModel,
        temperature: 0.7,
        max_tokens: cfg.aiMaxTokens,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
      }),
      signal: ctl.signal,
    });
    if (!res.ok) return { ok: false, err: fallback };
    const data = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const raw = data?.choices?.[0]?.message?.content ?? '';
    return { ok: true, text: cleanLoreText(raw) };
  } catch {
    return { ok: false, err: fallback };
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Ask Groq for one concise in-universe line.
 * Never blocks gameplay logic; always returns a safe user-facing response.
 */
export async function askGrokLore(cfg: AppConfig, topic: string): Promise<GrokResult> {
  const promptTopic = topic.trim() || 'the current state of the IdleRPG realm';
  return requestGrokLine(
    cfg,
    'You write one concise, professional, in-universe line for an IRC IdleRPG bot. Keep it clean, no profanity, no markdown, no bullets.',
    `Write one short lore line about: ${promptTopic}`,
    localLoreFallback(promptTopic),
  );
}

/**
 * AI ambient banter for channel flavor.
 * Mentions online heroes and stays playful but clean.
 */
export async function askGrokBanter(cfg: AppConfig, heroNames: string[]): Promise<GrokResult> {
  const names = heroNames.slice(0, 6).join(', ');
  const topic = names ? `online heroes: ${names}` : 'the currently online heroes';
  return requestGrokLine(
    cfg,
    'You write one short ambient IRC line for an IdleRPG channel. Tone: playful, witty, lightly teasing, clean, and professional. Keep it fun, never rude. No toxicity, no slurs, no harassment, no sexual content, no markdown, max 180 chars.',
    `Write one channel banter line about ${topic}.`,
    localBanterFallback(heroNames),
  );
}
