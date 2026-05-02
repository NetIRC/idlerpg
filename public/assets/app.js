(() => {
  const REFRESH_SEC = 30;
  const tbody = document.getElementById('tbody');
  const detail = document.getElementById('detail');
  const qEl = document.getElementById('q');
  const errEl = document.getElementById('err');
  const lastUpdatedEl = document.getElementById('last-updated');
  const refreshCountdownEl = document.getElementById('refresh-countdown');

  let rows = [];
  let selName = null;
  let lastOkFetchAt = null;
  let countdown = REFRESH_SEC;
  /** Only while a timed sync (at countdown 0) is in flight — does not block the ticking countdown. */
  let refreshInFlight = false;

  function updateCountdownDisplay() {
    if (!refreshCountdownEl) return;
    refreshCountdownEl.textContent = String(Math.max(0, countdown));
    refreshCountdownEl.classList.remove('refresh-countdown-pulse');
    void refreshCountdownEl.offsetWidth;
    refreshCountdownEl.classList.add('refresh-countdown-pulse');
  }

  function setLastUpdated(iso) {
    if (!lastUpdatedEl) return;
    lastUpdatedEl.classList.remove('is-stale');
    if (!iso) {
      lastUpdatedEl.textContent = '—';
      return;
    }
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) {
      lastUpdatedEl.textContent = '—';
      return;
    }
    lastOkFetchAt = d.getTime();
    lastUpdatedEl.textContent = 'Ledger snapshot: ' + d.toLocaleString();
  }

  function markStale() {
    if (!lastUpdatedEl || lastOkFetchAt === null) return;
    lastUpdatedEl.classList.add('is-stale');
    const d = new Date(lastOkFetchAt);
    lastUpdatedEl.textContent = 'Last good sync: ' + d.toLocaleString() + ' (fetch failed — retrying)';
  }

  function parseJsonSafe(text) {
    try {
      return JSON.parse(text);
    } catch {
      return null;
    }
  }

  function formatApiErr(j, fallback) {
    if (!j || typeof j !== 'object') return fallback;
    const parts = [];
    if (j.hint) parts.push(String(j.hint));
    if (j.message) parts.push(String(j.message));
    if (j.error === 'missing_config' && Array.isArray(j.searched) && j.searched.length) {
      parts.push('Paths searched: ' + j.searched.join(' · '));
    }
    if (j.path) parts.push('db_path resolved to: ' + j.path);
    if (j.error && parts.length === 0) parts.push('error: ' + j.error);
    return parts.length ? parts.join(' — ') : fallback;
  }

  const chronicleList = document.getElementById('chronicle-list');
  const chroniclePlaceholder = document.getElementById('chronicle-placeholder');

  const CHRONICLE_KIND = {
    quest_start: 'Quest',
    quest_end: 'Quest end',
    lucky_hour: 'Lucky hr',
    realm_record: 'Record',
    hog_win: 'HoG+',
    hog_lose: 'HoG−',
    register: 'Join',
    login: 'Login',
    logout: 'Logout',
    admin_resetpass: 'Admin',
    admin_forcelogout: 'Admin',
    lucky_hour_admin: 'Lucky',
    omen_rare: 'Omen',
    omen_boon: 'Omen+',
    omen_curse: 'Omen−',
    duel: 'Duel',
  };

  function chronicleKindLabel(k) {
    return CHRONICLE_KIND[k] || k;
  }

  function formatAgoSec(tsSec) {
    const now = Math.floor(Date.now() / 1000);
    const ago = Math.max(0, now - tsSec);
    if (ago < 3600) return `${Math.max(1, Math.floor(ago / 60))}m`;
    if (ago < 86400) return `${Math.floor(ago / 3600)}h`;
    return `${Math.floor(ago / 86400)}d`;
  }

  function renderChronicle(events) {
    if (!chronicleList || !chroniclePlaceholder) return;
    if (!events || !events.length) {
      chroniclePlaceholder.textContent =
        'No realm drama yet — run the bot; duels, quests, and omens will stream here.';
      chroniclePlaceholder.classList.remove('hidden');
      chronicleList.classList.add('hidden');
      chronicleList.innerHTML = '';
      return;
    }
    chroniclePlaceholder.classList.add('hidden');
    chronicleList.classList.remove('hidden');
    chronicleList.innerHTML = events
      .map((e) => {
        const kind = chronicleKindLabel(e.kind || '');
        const ago = formatAgoSec(e.ts);
        const det = escapeHtml((e.detail || '').trim() || '—');
        return `<li class="chronicle-item"><div class="chronicle-meta">${escapeHtml(kind)} <span class="chronicle-ago">· ${ago} ago</span></div><div class="chronicle-detail">${det}</div></li>`;
      })
      .join('');
  }

  async function fetchChronicle() {
    const r = await fetch('api/chronicle.php?limit=14', { cache: 'no-store' });
    const text = await r.text();
    const j = parseJsonSafe(text);
    if (!r.ok || !j || !Array.isArray(j.events)) {
      const err = new Error('chronicle');
      err.detail = j || { hint: text.slice(0, 200) };
      throw err;
    }
    return j.events;
  }

  async function fetchLb() {
    const r = await fetch('api/leaderboard.php', { cache: 'no-store' });
    const text = await r.text();
    const j = parseJsonSafe(text);
    if (!r.ok) {
      const err = new Error('leaderboard');
      err.detail = j || { hint: text.slice(0, 200) };
      throw err;
    }
    if (!j || !Array.isArray(j.players)) {
      const err = new Error('leaderboard');
      err.detail = { hint: 'Leaderboard API returned unexpected JSON.' };
      throw err;
    }
    return {
      players: j.players,
      generatedAt: j.generatedAt ?? null,
      botOnline: j.botOnline === true,
      botLastSeenMs: typeof j.botLastSeenMs === 'number' ? j.botLastSeenMs : null,
    };
  }

  function setBotStatus(botOnline, botLastSeenMs) {
    const led = document.getElementById('bot-status-led');
    const txt = document.getElementById('bot-status-text');
    const banner = document.getElementById('bot-offline-banner');
    const bannerDetail = document.getElementById('bot-offline-banner-detail');
    if (led) led.classList.toggle('is-bot-offline', !botOnline);
    if (txt) {
      txt.classList.toggle('is-bot-offline', !botOnline);
      if (botOnline) {
        txt.textContent = 'IRC bot: online';
      } else {
        txt.textContent = 'IRC bot: offline';
      }
    }
    if (banner) {
      if (botOnline) {
        banner.classList.add('hidden');
      } else {
        banner.classList.remove('hidden');
        if (bannerDetail) {
          let line =
            'Idle timers only advance and LOGIN / REGISTER (in private message) work while the bot is running and connected to IRC. Start the bot on the server, then refresh this page.';
          if (botLastSeenMs != null && botLastSeenMs > 0) {
            const d = new Date(botLastSeenMs);
            if (!Number.isNaN(d.getTime())) {
              line += ' Last bot signal: ' + d.toLocaleString() + '.';
            }
          }
          bannerDetail.textContent = line;
        }
      }
    }
  }

  async function fetchPlayer(name) {
    const r = await fetch('api/player.php?' + new URLSearchParams({ name }), { cache: 'no-store' });
    const text = await r.text();
    const j = parseJsonSafe(text);
    if (r.status === 404) return null;
    if (!r.ok) {
      const err = new Error('player');
      err.detail = j || { hint: text.slice(0, 200) };
      throw err;
    }
    return j;
  }

  function setErr(msg) {
    if (!msg) {
      errEl.classList.add('hidden');
      errEl.textContent = '';
    } else {
      errEl.textContent = msg;
      errEl.classList.remove('hidden');
    }
  }

  function renderTable(list) {
    tbody.innerHTML = '';
    if (!list.length) {
      const tr = document.createElement('tr');
      tr.innerHTML =
        '<td colspan="5" style="text-align:center;padding:2.5rem;opacity:0.45">The realm is empty — run the bot and register on IRC.</td>';
      tbody.appendChild(tr);
      return;
    }
    list.forEach((p, i) => {
      const tr = document.createElement('tr');
      tr.dataset.name = p.name;
      tr.innerHTML = `
        <td class="mono" style="opacity:0.55">${i + 1}</td>
        <td><strong style="color:#fff">${escapeHtml(p.name)}</strong>${p.online ? '<span class="dot" title="Online"></span>' : ''}</td>
        <td class="lv">${p.level}</td>
        <td class="hide-sm" style="opacity:0.85">${escapeHtml(p.class)}</td>
        <td class="timer">${escapeHtml(p.nextHuman)}</td>`;
      tr.addEventListener('click', () => openPlayer(p.name));
      tbody.appendChild(tr);
    });
  }

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  /** DB default / classic idlerpg-style single-letter alignments */
  function formatAlignment(raw) {
    const a = String(raw ?? '').trim().toLowerCase();
    if (a === 'n' || a === '') return 'Neutral';
    if (a === 'g') return 'Good';
    if (a === 'e') return 'Evil';
    return String(raw ?? '');
  }

  function formatStatus(d) {
    if (d.online) return 'IRC: ' + escapeHtml(d.ircNick || '');
    return (
      'Offline<br><span class="muted" style="display:inline-block;margin-top:0.35rem;font-size:0.78rem;line-height:1.4">Not in an IRC session (left channel or LOGOUT). Use LOGIN via private message while in the game channel.</span>'
    );
  }

  function applyFilter() {
    const q = (qEl.value || '').trim().toLowerCase();
    const list = q
      ? rows.filter((r) => r.name.toLowerCase().includes(q) || r.class.toLowerCase().includes(q))
      : rows;
    renderTable(list);
  }

  async function openPlayer(name) {
    selName = name;
    detail.innerHTML = '<p class="muted">Scanning the ledger...</p>';
    try {
      const d = await fetchPlayer(name);
      if (!d) {
        detail.innerHTML = '<p class="muted">No such hero in the database.</p>';
        return;
      }
      const stats = Object.entries(d.stats || {})
        .map(([k, v]) => `<span>${escapeHtml(k)}: ${v}</span>`)
        .join('');
      const charmRow =
        d.trinket && String(d.trinket).trim()
          ? `<div class="dl-item"><dt>Charm</dt><dd>${escapeHtml(String(d.trinket))}</dd></div>`
          : '';
      detail.innerHTML = `
        <div class="detail-name">${escapeHtml(d.name)}</div>
        <p class="detail-sub">Level <span class="mono" style="color:var(--arc)">${d.level}</span> · ${escapeHtml(d.class)}</p>
        <div class="dl-grid">
          <div class="dl-item"><dt>Next level</dt><dd class="arc">${escapeHtml(d.nextHuman)}</dd></div>
          <div class="dl-item"><dt>Total idle</dt><dd>${escapeHtml(String(d.idledHours))} h</dd></div>
          <div class="dl-item"><dt>Status</dt><dd>${formatStatus(d)}</dd></div>
          <div class="dl-item"><dt>Alignment</dt><dd>${escapeHtml(formatAlignment(d.alignment))}</dd></div>
          ${charmRow}
        </div>
        <div class="stats-label">Penalties (seconds)</div>
        <div class="stats-tags">${stats}</div>`;
    } catch (e) {
      const msg = formatApiErr(e.detail, 'Shard unreachable. Try api/health.php in the browser.');
      detail.innerHTML = `<p class="muted">${escapeHtml(msg)}</p>`;
    }
  }

  async function refresh() {
    try {
      const { players, generatedAt, botOnline, botLastSeenMs } = await fetchLb();
      rows = players;
      setLastUpdated(generatedAt);
      setBotStatus(botOnline, botLastSeenMs);
      setErr(null);
      applyFilter();
      if (selName) openPlayer(selName);
      try {
        const events = await fetchChronicle();
        renderChronicle(events);
      } catch {
        if (chroniclePlaceholder) {
          chroniclePlaceholder.textContent =
            'Chronicle offline — open api/chronicle.php in the browser to debug.';
          chroniclePlaceholder.classList.remove('hidden');
          if (chronicleList) {
            chronicleList.classList.add('hidden');
            chronicleList.innerHTML = '';
          }
        }
      }
    } catch (e) {
      markStale();
      const msg = formatApiErr(
        e.detail,
        'Link lost — open api/leaderboard.php or api/health.php in the browser to read the JSON error.',
      );
      setErr(msg);
      tbody.innerHTML = '';
    }
  }

  qEl.addEventListener('input', applyFilter);

  setInterval(async () => {
    if (countdown > 0) {
      countdown -= 1;
      updateCountdownDisplay();
    }
    if (countdown > 0) return;
    if (refreshInFlight) return;
    refreshInFlight = true;
    try {
      await refresh();
      countdown = REFRESH_SEC;
    } finally {
      refreshInFlight = false;
      updateCountdownDisplay();
    }
  }, 1000);

  (async () => {
    try {
      await refresh();
      countdown = REFRESH_SEC;
    } finally {
      updateCountdownDisplay();
    }
  })();
})();
