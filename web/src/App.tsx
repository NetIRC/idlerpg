import { useEffect, useMemo, useState } from 'react';

type Row = {
  name: string;
  level: number;
  class: string;
  nextSeconds: number;
  nextHuman: string;
  online: boolean;
  idledHours: number;
};

type Detail = Row & {
  alignment: string;
  ircNick: string | null;
  trinket?: string | null;
  stats: Record<string, number>;
};

async function fetchLb(): Promise<{ rows: Row[]; botOnline: boolean; botLastSeenMs: number | null }> {
  const r = await fetch('/api/leaderboard');
  const j = (await r.json()) as {
    players: Row[];
    botOnline?: boolean;
    botLastSeenMs?: number | null;
  };
  return {
    rows: j.players,
    botOnline: j.botOnline === true,
    botLastSeenMs: typeof j.botLastSeenMs === 'number' ? j.botLastSeenMs : null,
  };
}

async function fetchPlayer(name: string): Promise<Detail | null> {
  const r = await fetch(`/api/player/${encodeURIComponent(name)}`);
  if (!r.ok) return null;
  return r.json() as Promise<Detail>;
}

export default function App() {
  const [rows, setRows] = useState<Row[]>([]);
  const [q, setQ] = useState('');
  const [sel, setSel] = useState<Detail | null | undefined>(undefined);
  const [err, setErr] = useState<string | null>(null);
  const [botOnline, setBotOnline] = useState<boolean | null>(null);
  const [botLastSeenMs, setBotLastSeenMs] = useState<number | null>(null);

  useEffect(() => {
    let on = true;
    const load = () => {
      fetchLb()
        .then(({ rows: p, botOnline: online, botLastSeenMs: seen }) => {
          if (!on) return;
          setRows(p);
          setErr(null);
          setBotOnline(online);
          setBotLastSeenMs(seen);
        })
        .catch(() => on && setErr('API unreachable — run `npm run api`.'));
    };
    load();
    const id = setInterval(load, 15000);
    return () => {
      on = false;
      clearInterval(id);
    };
  }, []);

  const filtered = useMemo(() => {
    if (!q.trim()) return rows;
    const s = q.toLowerCase();
    return rows.filter((r) => r.name.toLowerCase().includes(s) || r.class.toLowerCase().includes(s));
  }, [rows, q]);

  const open = (name: string) => {
    setSel(undefined);
    fetchPlayer(name)
      .then((d) => setSel(d))
      .catch(() => setSel(null));
  };

  const offlineBannerDetail =
    botOnline === false
      ? (() => {
          let line =
            'Idle timers only advance and LOGIN / REGISTER (in private message) work while the bot is running and connected to IRC. Start the bot on the server, then refresh this page.';
          if (botLastSeenMs != null && botLastSeenMs > 0) {
            const d = new Date(botLastSeenMs);
            if (!Number.isNaN(d.getTime())) line += ` Last bot signal: ${d.toLocaleString()}.`;
          }
          return line;
        })()
      : null;

  return (
    <div className="min-h-screen bg-void bg-grid-glow bg-[length:48px_48px]">
      <div className="pointer-events-none fixed inset-0 bg-[radial-gradient(ellipse_at_top,_rgba(255,107,53,0.08),transparent_55%),radial-gradient(ellipse_at_bottom,_rgba(0,229,199,0.12),transparent_50%)]" />

      {offlineBannerDetail && (
        <div
          className="relative z-10 border-b border-ember/45 bg-gradient-to-r from-ember/25 via-[#281218]/95 to-[#0c0a14] shadow-[0_8px_32px_rgba(0,0,0,0.45)]"
          role="alert"
          aria-live="assertive"
        >
          <div className="mx-auto flex max-w-6xl items-start gap-4 px-6 py-4">
            <span
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-ember to-[#ff944d] font-display text-lg font-extrabold text-[#05040a] shadow-[0_0_20px_rgba(255,107,53,0.45)]"
              aria-hidden
            >
              !
            </span>
            <div>
              <strong className="font-display text-sm font-bold uppercase tracking-wide text-white md:text-base">
                IRC bot is offline
              </strong>
              <p className="mt-1 max-w-[52rem] font-mono text-xs leading-relaxed text-[#ffebeb]/95 md:text-sm">
                {offlineBannerDetail}
              </p>
            </div>
          </div>
        </div>
      )}

      <header className="relative border-b border-white/5 px-6 py-10">
        <div className="mx-auto flex max-w-6xl flex-col gap-6 md:flex-row md:items-end md:justify-between">
          <div>
            <p className="font-mono text-xs uppercase tracking-[0.35em] text-arc/80">IdleRPG reimagined</p>
            <h1 className="font-display text-4xl font-bold tracking-tight text-white md:text-5xl">
              <span className="text-glow text-arc">idlerpg</span>
            </h1>
            <p className="mt-2 max-w-xl text-sm text-dust/90">
              Inspired by the original{' '}
              <a className="text-arc underline decoration-arc/30 hover:decoration-arc" href="http://idlerpg.net" rel="noopener noreferrer">
                IdleRPG
              </a>{' '}
              (<a className="text-arc underline decoration-arc/30 hover:decoration-arc" href="https://github.com/falsovsky/idlerpg">
                falsovsky/idlerpg
              </a>
              ). Stay in channel and idle — live leaderboard here.
            </p>
          </div>
          <div className="glass glow-arc rounded-2xl px-5 py-4 font-mono text-xs text-dust/80">
            <div className="text-arc/90">Stack</div>
            <div>IRC · Express · React · Tailwind</div>
            {botOnline === true && <div className="mt-3 border-t border-white/10 pt-3 text-arc/80">IRC bot: online</div>}
          </div>
        </div>
      </header>

      <main className="relative mx-auto grid max-w-6xl gap-8 px-6 py-10 lg:grid-cols-[1.1fr_0.9fr]">
        <section className="space-y-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <h2 className="font-display text-xl font-semibold text-white">Leaderboard</h2>
            <input
              className="w-full rounded-xl border border-white/10 bg-black/40 px-4 py-2.5 font-mono text-sm text-white outline-none ring-arc/30 placeholder:text-dust/40 focus:ring-2 sm:max-w-xs"
              placeholder="Search name or class…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
          </div>

          {err && <p className="rounded-xl border border-ember/30 bg-ember/10 px-4 py-3 text-sm text-ember">{err}</p>}

          <div className="glass overflow-hidden rounded-2xl">
            <table className="w-full text-left text-sm">
              <thead className="font-mono text-xs uppercase tracking-wider text-dust/50">
                <tr className="border-b border-white/5">
                  <th className="px-4 py-3">#</th>
                  <th className="px-4 py-3">Player</th>
                  <th className="px-4 py-3">Lv</th>
                  <th className="px-4 py-3 hidden sm:table-cell">Class</th>
                  <th className="px-4 py-3">Timer</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((r, i) => (
                  <tr
                    key={r.name}
                    className="cursor-pointer border-b border-white/5 transition hover:bg-white/[0.04]"
                    onClick={() => open(r.name)}
                  >
                    <td className="px-4 py-3 font-mono text-dust/60">{i + 1}</td>
                    <td className="px-4 py-3 font-medium text-white">
                      <span className="inline-flex items-center gap-2">
                        {r.name}
                        {r.online && (
                          <span className="h-2 w-2 rounded-full bg-arc shadow-[0_0_10px_rgba(0,229,199,0.8)]" title="Online" />
                        )}
                      </span>
                    </td>
                    <td className="px-4 py-3 font-mono text-arc">{r.level}</td>
                    <td className="px-4 py-3 text-dust/80 hidden sm:table-cell">{r.class}</td>
                    <td className="px-4 py-3 font-mono text-xs text-dust/70">{r.nextHuman}</td>
                  </tr>
                ))}
                {!filtered.length && (
                  <tr>
                    <td colSpan={5} className="px-4 py-10 text-center text-dust/50">
                      No data yet — run the bot and register on IRC.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>

        <aside className="space-y-4">
          <h2 className="font-display text-xl font-semibold text-white">Detail</h2>
          <div className="glass min-h-[280px] rounded-2xl p-6">
            {sel === undefined && (
              <p className="text-sm text-dust/60">Click a player for penalties and summary.</p>
            )}
            {sel === null && <p className="text-sm text-ember/90">Player not found.</p>}
            {sel && (
              <div className="space-y-4">
                <div>
                  <div className="font-display text-2xl font-bold text-white">{sel.name}</div>
                  <div className="mt-1 text-sm text-dust/80">
                    Level <span className="font-mono text-arc">{sel.level}</span> · {sel.class}
                  </div>
                </div>
                <dl className="grid grid-cols-2 gap-3 font-mono text-xs">
                  <div className="rounded-lg bg-black/30 p-3">
                    <dt className="text-dust/50">Next level</dt>
                    <dd className="mt-1 text-arc">{sel.nextHuman}</dd>
                  </div>
                  <div className="rounded-lg bg-black/30 p-3">
                    <dt className="text-dust/50">Total idle</dt>
                    <dd className="mt-1 text-white">{sel.idledHours} h</dd>
                  </div>
                  <div className="rounded-lg bg-black/30 p-3">
                    <dt className="text-dust/50">Status</dt>
                    <dd className="mt-1 text-white">{sel.online ? `IRC: ${sel.ircNick}` : 'Offline'}</dd>
                  </div>
                  <div className="rounded-lg bg-black/30 p-3">
                    <dt className="text-dust/50">Alignment</dt>
                    <dd className="mt-1 text-white">{sel.alignment}</dd>
                  </div>
                  {sel.trinket ? (
                    <div className="rounded-lg bg-black/30 p-3">
                      <dt className="text-dust/50">Charm</dt>
                      <dd className="mt-1 text-white">{sel.trinket}</dd>
                    </div>
                  ) : null}
                </dl>
                <div>
                  <div className="text-xs uppercase tracking-wider text-dust/40">Penalties (seconds)</div>
                  <div className="mt-2 flex flex-wrap gap-2 font-mono text-[11px]">
                    {Object.entries(sel.stats).map(([k, v]) => (
                      <span key={k} className="rounded-md bg-white/5 px-2 py-1 text-dust/80">
                        {k}: {v}
                      </span>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </div>
        </aside>
      </main>

      <footer className="relative border-t border-white/5 px-6 py-8 text-center font-mono text-[11px] text-dust/40">
        Independent project — not affiliated with idlerpg.net — host behind Apache/XAMPP or proxy to the Node API as you prefer.
      </footer>
    </div>
  );
}
