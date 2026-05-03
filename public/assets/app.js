(() => {
  const REFRESH_SEC = 30;
  /** Minimum time the full-page blur overlay stays visible (auto-refresh); avoids sub-second flashes on fast LAN. */
  const FULL_PAGE_SYNC_MIN_MS = 1000;
  const tbody = document.getElementById('tbody');
  const detail = document.getElementById('detail');
  const detailContent = document.getElementById('detail-content');
  const detailLoading = document.getElementById('detail-loading');
  const atlasLedgerLoading = document.getElementById('atlas-ledger-loading');
  const lbLedgerLoading = document.getElementById('lb-ledger-loading');
  const fullPageSyncEl = document.getElementById('full-page-sync');
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
  /** Incremented on each openPlayer call so stale responses do not overwrite the panel. */
  let detailFetchGen = 0;

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

  function setDetailBusy(busy) {
    if (!detail) return;
    detail.classList.toggle('detail--busy', busy);
    if (busy) {
      detail.setAttribute('aria-busy', 'true');
    } else {
      detail.removeAttribute('aria-busy');
    }
    if (detailLoading) {
      detailLoading.classList.toggle('hidden', !busy);
      detailLoading.setAttribute('aria-hidden', busy ? 'false' : 'true');
    }
  }

  /** Leaderboard fetch + map + chronicle (every auto / initial refresh). */
  function setLedgerSyncBusy(busy) {
    const hide = !busy;
    if (atlasLedgerLoading) {
      atlasLedgerLoading.classList.toggle('hidden', hide);
      atlasLedgerLoading.setAttribute('aria-hidden', hide ? 'true' : 'false');
    }
    if (lbLedgerLoading) {
      lbLedgerLoading.classList.toggle('hidden', hide);
      lbLedgerLoading.setAttribute('aria-hidden', hide ? 'true' : 'false');
    }
    const atlasFrame = document.getElementById('atlas-svg-frame');
    if (atlasFrame) {
      if (busy) atlasFrame.setAttribute('aria-busy', 'true');
      else atlasFrame.removeAttribute('aria-busy');
    }
    const lbPanel = document.getElementById('lb-table-panel');
    if (lbPanel) {
      if (busy) lbPanel.setAttribute('aria-busy', 'true');
      else lbPanel.removeAttribute('aria-busy');
    }
  }

  /** Full viewport blur + spinner (timed auto-refresh only). */
  function setFullPageSyncBusy(busy) {
    if (!fullPageSyncEl) return;
    fullPageSyncEl.classList.toggle('hidden', !busy);
    fullPageSyncEl.setAttribute('aria-hidden', busy ? 'false' : 'true');
    document.body.classList.toggle('full-page-sync--locked', busy);
  }

  function detailWrite(html) {
    const shell = detailContent || detail;
    if (shell) shell.innerHTML = html;
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
    if (Array.isArray(j.tried) && j.tried.length) {
      parts.push('Tried paths: ' + j.tried.join(' · '));
    }
    if (j.error && parts.length === 0) parts.push('error: ' + j.error);
    return parts.length ? parts.join(' — ') : fallback;
  }

  const chronicleList = document.getElementById('chronicle-list');
  const chroniclePlaceholder = document.getElementById('chronicle-placeholder');
  const chronicleRoot = document.getElementById('chronicle-root');
  const chronicleCollapsible = document.getElementById('chronicle-collapsible');
  const chronicleCountEl = document.getElementById('chronicle-count');
  const chronicleListWrap = document.getElementById('chronicle-list-wrap');
  /** Must match irpg_chronicle_max_limit() / chronicle-omen.ts CHRONICLE_API_MAX_LIMIT */
  const CHRONICLE_API_MAX = 40;
  const chronicleFetchLimit = Math.min(
    CHRONICLE_API_MAX,
    Math.max(1, parseInt(String(chronicleRoot?.getAttribute('data-chronicle-limit') ?? '15'), 10) || 15),
  );

  const NS = 'http://www.w3.org/2000/svg';
  const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));
  let lastRealmPulse = null;

  let atlasUiBound = false;

  function hash32(str) {
    let h = 2166136261 >>> 0;
    const s = String(str);
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 16777619) >>> 0;
    }
    return h >>> 0;
  }

  function clamp(n, lo, hi) {
    return Math.min(hi, Math.max(lo, n));
  }

  /** Leaderboard `level` must be a finite number for sort + latitude (avoids NaN sort glitches). */
  function atlasSafeLevel(pl) {
    const n = Number(pl && pl.level);
    return Number.isFinite(n) ? n : 0;
  }

  function ensureAtlasDefs() {
    const defs = document.getElementById('atlas-defs');
    if (!defs || defs.dataset.defsVer === '2') return;
    defs.dataset.defsVer = '2';
    defs.innerHTML = `
      <linearGradient id="atlas-online-grad" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stop-color="#5cffe8"/>
        <stop offset="100%" stop-color="#00c9a7"/>
      </linearGradient>
      <linearGradient id="atlas-quest-grad" x1="0%" y1="100%" x2="100%" y2="0%">
        <stop offset="0%" stop-color="#ff9a5c"/>
        <stop offset="50%" stop-color="#ff5c8a"/>
        <stop offset="100%" stop-color="#a78bff"/>
      </linearGradient>
      <linearGradient id="atlas-trail-grad" x1="0%" y1="100%" x2="100%" y2="0%">
        <stop offset="0%" stop-color="rgba(255,140,90,0.5)"/>
        <stop offset="50%" stop-color="rgba(200,90,120,0.35)"/>
        <stop offset="100%" stop-color="rgba(120,80,180,0.4)"/>
      </linearGradient>
      <linearGradient id="atlas-front-grad" x1="0%" y1="0%" x2="100%" y2="0%">
        <stop offset="0%" stop-color="rgba(255,107,53,0.25)"/>
        <stop offset="50%" stop-color="rgba(255,200,120,0.2)"/>
        <stop offset="100%" stop-color="rgba(0,229,199,0.2)"/>
      </linearGradient>
    `;
  }

  function syncAtlasMarkerGeometry(g) {
    if (!g || !g.dataset.wx) return;
    const wx = parseFloat(g.dataset.wx);
    const wy = parseFloat(g.dataset.wy);
    const r0 = parseFloat(g.dataset.r0 || '4');
    g.setAttribute('transform', `translate(${wx.toFixed(2)} ${wy.toFixed(2)})`);
    const core = g.querySelector('.atlas-marker-core');
    const halo = g.querySelector('.atlas-marker-halo');
    const ring = g.querySelector('.atlas-marker-ring');
    if (core) core.setAttribute('r', r0.toFixed(2));
    if (halo) halo.setAttribute('r', (r0 + 5.5).toFixed(2));
    if (ring) ring.setAttribute('r', (r0 + 4).toFixed(2));
    const hit = g.querySelector('.atlas-marker-hit');
    if (hit) {
      const tag = hit.tagName && hit.tagName.toLowerCase();
      if (tag === 'rect') {
        const nameW = parseFloat(g.dataset.nameW || '48');
        const hr = Math.max(22, r0 * 4);
        const pad = 5;
        const hitW = hr + pad + nameW;
        const hitH = Math.max(hr * 2, 22);
        hit.setAttribute('x', (-hr).toFixed(2));
        hit.setAttribute('y', (-hitH / 2).toFixed(2));
        hit.setAttribute('width', hitW.toFixed(2));
        hit.setAttribute('height', hitH.toFixed(2));
        hit.setAttribute('rx', Math.min(14, hitH / 2).toFixed(2));
      } else {
        const hr = Math.max(26, r0 * 4.5);
        hit.setAttribute('r', hr.toFixed(2));
      }
    }
    const label = g.querySelector('.atlas-marker-label');
    if (label) label.setAttribute('x', (r0 + 6).toFixed(2));
  }

  function updateAtlasWorldTransform() {
    const scenery = document.getElementById('atlas-scenery');
    if (scenery) {
      scenery.removeAttribute('transform');
    }
    document.querySelectorAll('#atlas-markers .atlas-marker-g').forEach(syncAtlasMarkerGeometry);
  }

  /** Tooltip must sit under <body>: ancestors with filter/overflow can break position:fixed placement. */
  function ensureAtlasTooltipPortal() {
    const el = document.getElementById('atlas-tooltip');
    if (!el || el.dataset.portaled === '1') return;
    document.body.appendChild(el);
    el.dataset.portaled = '1';
  }

  function initRealmAtlasUi() {
    if (atlasUiBound) return;
    const svg = document.getElementById('realm-atlas-svg');
    if (!svg) return;
    atlasUiBound = true;
    ensureAtlasTooltipPortal();
  }

  /**
   * Beside pointer, viewport pixels (tooltip is portaled to document.body, position: fixed).
   */
  function layoutAtlasTooltip(el, clientX, clientY) {
    if (!el) return;
    ensureAtlasTooltipPortal();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const gapX = 6;
    const edge = 8;

    function measure() {
      const w = Math.max(el.scrollWidth, el.offsetWidth);
      const h = Math.max(el.scrollHeight, el.offsetHeight);
      return { w, h };
    }

    function place(wx, wy, w, h) {
      let x = wx;
      let y = wy;
      if (x + w + edge > vw) x = clientX - w - gapX;
      if (x < edge) x = edge;
      if (y < edge) y = edge;
      if (y + h + edge > vh) y = vh - h - edge;
      if (x + w + edge > vw) x = Math.max(edge, vw - w - edge);
      return { x, y };
    }

    function apply(px, py, w, h) {
      el.style.left = `${Math.round(px)}px`;
      el.style.top = `${Math.round(py)}px`;
      const cxMid = px + w / 2;
      const cyMid = py + h / 2;
      const q = (clientY < cyMid ? 'n' : 's') + (clientX < cxMid ? 'w' : 'e');
      el.style.visibility = 'visible';
      el.setAttribute('data-arrow', q);
      el.style.setProperty('--tt-ox', `${Math.round(clientX - px)}px`);
      el.style.setProperty('--tt-oy', `${Math.round(clientY - py)}px`);
    }

    el.classList.remove('hidden');
    el.hidden = false;
    el.style.visibility = 'hidden';
    el.style.left = '-9999px';
    el.style.top = '0';

    let { w, h } = measure();
    let pos = place(clientX + gapX, clientY - h / 2, w, h);
    apply(pos.x, pos.y, w, h);

    requestAnimationFrame(() => {
      const m = measure();
      pos = place(clientX + gapX, clientY - m.h / 2, m.w, m.h);
      apply(pos.x, pos.y, m.w, m.h);
    });
  }

  function renderAtlasDecorRoutes(routesG) {
    if (!routesG) return;
    routesG.innerHTML = '';
    const paths = [
      { d: 'M 500 535 C 340 460 280 340 380 240 S 470 135 500 92', cls: 'atlas-trail-path atlas-trail-march' },
      { d: 'M 85 415 L 180 380 L 260 400 L 400 310 L 580 335 L 720 295 L 915 265', cls: 'atlas-trail-path atlas-trail-front' },
      { d: 'M 130 525 Q 280 485 420 498 T 640 430 T 870 378', cls: 'atlas-trail-path atlas-trail-supply' },
    ];
    for (const s of paths) {
      const p = document.createElementNS(NS, 'path');
      p.setAttribute('d', s.d);
      p.setAttribute('class', s.cls);
      routesG.appendChild(p);
    }
    const labels = [
      { x: 500, y: 558, t: 'Recruit grounds', a: 'middle' },
      { x: 500, y: 82, t: 'Veteran heights', a: 'middle' },
      { x: 78, y: 402, t: 'Battle line', a: 'start' },
    ];
    for (const L of labels) {
      const t = document.createElementNS(NS, 'text');
      t.setAttribute('x', String(L.x));
      t.setAttribute('y', String(L.y));
      t.setAttribute('class', 'atlas-route-label atlas-route-label--trail');
      t.setAttribute('text-anchor', L.a);
      t.textContent = L.t;
      routesG.appendChild(t);
    }
  }

  function atlasHeroTooltipInner(p) {
    const on = p.online
      ? '<span class="tt-pill tt-pill--online">Online</span>'
      : '<span class="tt-pill tt-pill--offline">Offline</span>';
    return `<div class="tt-name">${escapeHtml(p.name)}</div><div class="tt-row">${on}<span class="tt-level mono">Lv.${escapeHtml(String(p.level))}</span></div><div class="tt-class">${escapeHtml(p.class)}</div><div class="tt-timer mono">⏳ ${escapeHtml(p.nextHuman || '')}</div><div class="tt-hint mono">Click → hero sheet</div>`;
  }

  function showAtlasTooltipFromPlayer(p, clientX, clientY) {
    ensureAtlasTooltipPortal();
    const el = document.getElementById('atlas-tooltip');
    if (!el) return;
    el.innerHTML = `<div class="atlas-tooltip-card">${atlasHeroTooltipInner(p)}</div>`;
    el.classList.remove('hidden');
    el.hidden = false;
    layoutAtlasTooltip(el, clientX, clientY);
    requestAnimationFrame(() => layoutAtlasTooltip(el, clientX, clientY));
    el.classList.remove('atlas-tooltip--pop');
    void el.offsetWidth;
    el.classList.add('atlas-tooltip--pop');
  }

  function hideAtlasTooltip() {
    const el = document.getElementById('atlas-tooltip');
    if (!el) return;
    el.classList.add('hidden');
    el.classList.remove('atlas-tooltip--pop');
    el.hidden = true;
    el.style.visibility = '';
  }

  function renderRealmAtlas(players, realmPulse, selectedName) {
    const svg = document.getElementById('realm-atlas-svg');
    const panel = document.getElementById('realm-atlas-root');
    const regionsG = document.getElementById('atlas-regions');
    const questG = document.getElementById('atlas-quest-layer');
    const routesG = document.getElementById('atlas-routes');
    const markersG = document.getElementById('atlas-markers');
    if (!svg || !regionsG || !questG || !markersG || !routesG) return;

    ensureAtlasDefs();
    initRealmAtlasUi();

    if (panel) {
      panel.classList.toggle('realm-atlas-panel--lucky', !!(realmPulse && realmPulse.luckySecondsLeft > 0));
      panel.classList.toggle('realm-atlas-panel--quest', !!(realmPulse && realmPulse.questActive));
    }

    regionsG.innerHTML = '';

    renderAtlasDecorRoutes(routesG);

    questG.innerHTML = '';
    if (realmPulse && realmPulse.questActive) {
      const path = document.createElementNS(NS, 'path');
      path.setAttribute('d', 'M 220 130 Q 500 20 780 450');
      path.setAttribute('class', 'atlas-quest-path');
      questG.appendChild(path);
      const t1 = document.createElementNS(NS, 'text');
      t1.setAttribute('x', '200');
      t1.setAttribute('y', '115');
      t1.setAttribute('class', 'atlas-region-label');
      t1.setAttribute('text-anchor', 'middle');
      t1.textContent = 'Sunbound';
      questG.appendChild(t1);
      const t2 = document.createElementNS(NS, 'text');
      t2.setAttribute('x', '800');
      t2.setAttribute('y', '475');
      t2.setAttribute('class', 'atlas-region-label');
      t2.setAttribute('text-anchor', 'middle');
      t2.textContent = 'Moonveil';
      questG.appendChild(t2);
    }

    markersG.innerHTML = '';
    if (!players || !players.length) {
      updateAtlasWorldTransform();
      return;
    }

    const sorted = players.slice().sort((a, b) => atlasSafeLevel(a) - atlasSafeLevel(b));
    const levels = sorted.map(atlasSafeLevel);
    const minL = Math.min(...levels);
    const maxL = Math.max(...levels);

    /** North (high level) = small y. Integer steps: ≥ N px between L and L+1 when the on-map span allows it. */
    const ATLAS_Y_NORTH = 90;
    const ATLAS_Y_SOUTH = 540;
    const ATLAS_MIN_PX_PER_LEVEL = 52;
    const ATLAS_SAME_LEVEL_STACK = 15;
    const latSpan = ATLAS_Y_SOUTH - ATLAS_Y_NORTH;

    const countAtLevel = Object.create(null);
    for (const pl of sorted) {
      const L = atlasSafeLevel(pl);
      countAtLevel[L] = (countAtLevel[L] || 0) + 1;
    }
    const idxAtLevel = Object.create(null);

    sorted.forEach((p, rank) => {
      const lv = atlasSafeLevel(p);
      let yBand;
      if (maxL === minL) {
        yBand = (ATLAS_Y_NORTH + ATLAS_Y_SOUTH) / 2;
      } else {
        const dL = maxL - minL;
        const idealStep = Math.max(ATLAS_MIN_PX_PER_LEVEL, latSpan / dL);
        const need = dL * idealStep;
        const scale = need > latSpan ? latSpan / need : 1;
        const stepPx = idealStep * scale;
        yBand = ATLAS_Y_SOUTH - (lv - minL) * stepPx;
      }
      const k = idxAtLevel[lv] ?? 0;
      idxAtLevel[lv] = k + 1;
      const nHere = countAtLevel[lv];
      const stackY = nHere > 1 ? (k - (nHere - 1) / 2) * ATLAS_SAME_LEVEL_STACK : 0;
      const jitterA = ((hash32(p.name) % 360) * Math.PI) / 180 / 12;
      const a = rank * GOLDEN_ANGLE + jitterA;
      const spread = 112 + Math.sqrt(rank + 1) * 48;
      let x = 500 + Math.cos(a) * spread * 1.02;
      const h0 = hash32(p.name);
      x += (h0 % 29) - 14;
      const yJ = ((h0 >>> 7) % 11) - 5;
      let y = yBand + yJ + stackY;
      x = clamp(x, 72, 928);
      y = clamp(y, 88, 548);

      const rad = Math.max(4, 2.8 + Math.min(11.5, atlasSafeLevel(p) / 7));
      const displayName = p.name.length > 24 ? `${p.name.slice(0, 22)}…` : p.name;
      const estNameW = Math.min(132, 8 + displayName.length * 5.65);
      const g = document.createElementNS(NS, 'g');
      g.setAttribute('class', 'atlas-marker-g' + (p.online ? ' is-online' : '') + (selectedName === p.name ? ' is-selected' : ''));
      g.dataset.wx = String(x);
      g.dataset.wy = String(y);
      g.dataset.r0 = String(rad);
      g.dataset.nameW = String(estNameW);

      const hit = document.createElementNS(NS, 'rect');
      hit.setAttribute('class', 'atlas-marker-hit');
      g.appendChild(hit);

      const halo = document.createElementNS(NS, 'circle');
      halo.setAttribute('class', 'atlas-marker-halo');
      g.appendChild(halo);

      const ring = document.createElementNS(NS, 'circle');
      ring.setAttribute('class', 'atlas-marker-ring');
      g.appendChild(ring);

      const c = document.createElementNS(NS, 'circle');
      c.setAttribute('class', 'atlas-marker-core');
      g.appendChild(c);

      const label = document.createElementNS(NS, 'text');
      label.setAttribute('class', 'atlas-marker-label');
      label.setAttribute('text-anchor', 'start');
      label.setAttribute('dominant-baseline', 'middle');
      label.textContent = displayName;
      g.appendChild(label);

      syncAtlasMarkerGeometry(g);

      const bindMarker = (target) => {
        target.addEventListener('mousedown', (ev) => ev.stopPropagation());
        target.addEventListener('click', (ev) => {
          ev.stopPropagation();
          hideAtlasTooltip();
          openPlayer(p.name);
          detail.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        });
        target.addEventListener('mouseenter', (ev) => {
          showAtlasTooltipFromPlayer(p, ev.clientX, ev.clientY);
        });
        target.addEventListener('mousemove', (ev) => {
          const tip = document.getElementById('atlas-tooltip');
          if (!tip || tip.classList.contains('hidden')) return;
          layoutAtlasTooltip(tip, ev.clientX, ev.clientY);
        });
        target.addEventListener('mouseleave', hideAtlasTooltip);
      };
      bindMarker(hit);

      markersG.appendChild(g);
    });

    updateAtlasWorldTransform();
  }

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
    medal: 'Medal',
    gauntlet_win: 'Gauntlet',
    gauntlet_lose: 'Gauntlet',
  };

  function chronicleKindLabel(k) {
    return CHRONICLE_KIND[k] || k;
  }

  function realmEventKindClass(kind) {
    const k = String(kind || 'misc');
    const safe = /^[a-z0-9_]+$/i.test(k) ? k : 'misc';
    return safe;
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
      chronicleList.innerHTML = '';
      if (chronicleCollapsible) chronicleCollapsible.classList.add('hidden');
      if (chronicleListWrap) {
        chronicleListWrap.setAttribute('hidden', '');
      }
      const btn = chronicleCollapsible?.querySelector('.chronicle-strip-toggle');
      if (btn) {
        btn.classList.remove('is-open');
        btn.setAttribute('aria-expanded', 'false');
      }
      return;
    }
    chroniclePlaceholder.classList.add('hidden');
    if (chronicleCollapsible) chronicleCollapsible.classList.remove('hidden');
    if (chronicleCountEl) chronicleCountEl.textContent = String(events.length);
    chronicleList.innerHTML = events
      .map((e) => {
        const kind = chronicleKindLabel(e.kind || '');
        const safeKind = realmEventKindClass(e.kind);
        const ago = formatAgoSec(e.ts);
        const det = escapeHtml((e.detail || '').trim() || '—');
        return `<li class="chronicle-item chronicle-item--${safeKind}"><div class="chronicle-meta">${escapeHtml(kind)} <span class="chronicle-ago">· ${ago} ago</span></div><div class="chronicle-detail">${det}</div></li>`;
      })
      .join('');
    if (chronicleListWrap) {
      chronicleListWrap.setAttribute('hidden', '');
    }
    const btn = chronicleCollapsible?.querySelector('.chronicle-strip-toggle');
    if (btn) {
      btn.classList.remove('is-open');
      btn.setAttribute('aria-expanded', 'false');
    }
  }

  async function fetchChronicle() {
    const r = await fetch('api/chronicle.php?limit=' + encodeURIComponent(String(chronicleFetchLimit)), { cache: 'no-store' });
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
      realmPulse: j.realmPulse && typeof j.realmPulse === 'object' ? j.realmPulse : null,
    };
  }

  function setRealmPulse(pulse) {
    const el = document.getElementById('realm-pulse');
    if (!el) return;
    if (pulse && typeof pulse.display === 'string' && pulse.display.trim()) {
      el.textContent = pulse.display;
    } else {
      el.textContent = 'Realm pulse: sync the leaderboard API for live stats.';
    }
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

  function formatMedalsList(d) {
    const raw = d.medals;
    if (!Array.isArray(raw) || raw.length === 0) {
      return '<p class="muted" style="margin:0.35rem 0 0;font-size:0.85rem">No medals yet — quest wins, duels, gauntlet, and level milestones grant them.</p>';
    }
    const chips = raw
      .map((m) => {
        const label =
          m && typeof m === 'object' && m.label
            ? String(m.label)
            : m && typeof m === 'object' && m.key
              ? String(m.key).replace(/_/g, ' ')
              : String(m);
        const tier =
          m && typeof m === 'object' && m.tier && /^[a-z]+$/i.test(String(m.tier))
            ? String(m.tier).toLowerCase()
            : 'bronze';
        return `<span class="medal-chip medal-chip--${tier}">${escapeHtml(label)}</span>`;
      })
      .join('');
    return `<div class="medal-chips">${chips}</div>`;
  }

  function formatRecentFinds(d) {
    const raw = d.recentFinds;
    if (!Array.isArray(raw) || raw.length === 0) {
      return '';
    }
    const n = raw.length;
    const items = raw
      .map((e) => {
        const kindLabel = chronicleKindLabel(e.kind || '');
        const safeKind = realmEventKindClass(e.kind);
        const ago = formatAgoSec(e.ts);
        const det = escapeHtml((e.detail || '').trim() || '—');
        return `<li class="finds-item finds-item--${safeKind}"><span class="finds-kind">${escapeHtml(kindLabel)}</span><span class="finds-detail">${det}</span><span class="finds-ago">${ago} ago</span></li>`;
      })
      .join('');
    return `<div class="finds-strip">
      <button type="button" class="finds-strip-toggle" aria-expanded="false" aria-controls="finds-ledger-panel">
        <span class="finds-chevron" aria-hidden="true"></span>
        <span class="finds-strip-label">Recent ledger <span class="finds-strip-scope">(this hero)</span></span>
        <span class="finds-count mono">${n}</span>
      </button>
      <div class="finds-list-wrap" id="finds-ledger-panel" hidden>
        <ul class="finds-list">${items}</ul>
      </div>
    </div>`;
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
    const gen = (detailFetchGen += 1);
    const shell = detailContent || detail;
    if (!shell) return;
    setDetailBusy(true);
    try {
      const d = await fetchPlayer(name);
      if (gen !== detailFetchGen) return;
      if (!d) {
        detailWrite('<p class="muted">No such hero in the database.</p>');
        selName = null;
        renderRealmAtlas(rows, lastRealmPulse, null);
        return;
      }
      const stats = Object.entries(d.stats || {})
        .map(([k, v]) => `<span>${escapeHtml(k)}: ${v}</span>`)
        .join('');
      const charmRow =
        d.trinket && String(d.trinket).trim()
          ? `<div class="dl-item detail-charm"><dt>Charm</dt><dd>${escapeHtml(String(d.trinket))}</dd></div>`
          : '';
      const dw = d.duelWins != null ? Number(d.duelWins) : 0;
      const gw = d.gauntletWins != null ? Number(d.gauntletWins) : 0;
      detailWrite(`
        <div class="detail-name">${escapeHtml(d.name)}</div>
        <p class="detail-sub">Level <span class="mono" style="color:var(--arc)">${d.level}</span> · ${escapeHtml(d.class)}</p>
        <div class="dl-grid">
          <div class="dl-item"><dt>Next level</dt><dd class="arc">${escapeHtml(d.nextHuman)}</dd></div>
          <div class="dl-item"><dt>Total idle</dt><dd>${escapeHtml(String(d.idledHours))} h</dd></div>
          <div class="dl-item"><dt>Status</dt><dd>${formatStatus(d)}</dd></div>
          <div class="dl-item"><dt>Alignment</dt><dd>${escapeHtml(formatAlignment(d.alignment))}</dd></div>
          <div class="dl-item"><dt>Arena</dt><dd>${dw} duel win${dw === 1 ? '' : 's'}</dd></div>
          <div class="dl-item"><dt>Gauntlet</dt><dd>${gw} win${gw === 1 ? '' : 's'}</dd></div>
          ${charmRow}
        </div>
        <div class="stats-label">Medals</div>
        ${formatMedalsList(d)}
        ${formatRecentFinds(d)}
        <div class="stats-label">Penalties (seconds)</div>
        <div class="stats-tags">${stats}</div>`);
      if (gen !== detailFetchGen) return;
      renderRealmAtlas(rows, lastRealmPulse, selName);
    } catch (e) {
      if (gen !== detailFetchGen) return;
      const msg = formatApiErr(e.detail, 'Shard unreachable. Try api/health.php in the browser.');
      detailWrite(`<p class="muted">${escapeHtml(msg)}</p>`);
    } finally {
      if (gen === detailFetchGen) {
        setDetailBusy(false);
      }
    }
  }

  async function refresh(options = {}) {
    const fullPage = options.fullPage === true;
    const fullPageSyncStartedAt = fullPage ? Date.now() : 0;
    if (fullPage) setFullPageSyncBusy(true);
    else setLedgerSyncBusy(true);
    try {
      const { players, generatedAt, botOnline, botLastSeenMs, realmPulse } = await fetchLb();
      rows = players;
      lastRealmPulse = realmPulse;
      setLastUpdated(generatedAt);
      setBotStatus(botOnline, botLastSeenMs);
      setRealmPulse(realmPulse);
      setErr(null);
      applyFilter();
      renderRealmAtlas(rows, realmPulse, selName);
      if (selName) openPlayer(selName);
      try {
        const events = await fetchChronicle();
        renderChronicle(events);
      } catch {
        if (chroniclePlaceholder) {
          chroniclePlaceholder.textContent =
            'Chronicle offline — open api/chronicle.php in the browser to debug.';
          chroniclePlaceholder.classList.remove('hidden');
          if (chronicleCollapsible) chronicleCollapsible.classList.add('hidden');
          if (chronicleList) {
            chronicleList.innerHTML = '';
          }
          if (chronicleListWrap) chronicleListWrap.setAttribute('hidden', '');
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
    } finally {
      if (fullPage) {
        const elapsed = Date.now() - fullPageSyncStartedAt;
        if (elapsed < FULL_PAGE_SYNC_MIN_MS) {
          await new Promise((r) => setTimeout(r, FULL_PAGE_SYNC_MIN_MS - elapsed));
        }
        setFullPageSyncBusy(false);
      } else {
        setLedgerSyncBusy(false);
      }
    }
  }

  qEl.addEventListener('input', applyFilter);

  if (detail) {
    detail.addEventListener('click', (ev) => {
      const btn = ev.target.closest('.finds-strip-toggle');
      if (!btn || !detail.contains(btn)) return;
      const wrap = document.getElementById('finds-ledger-panel');
      if (!wrap || !detail.contains(wrap)) return;
      const willOpen = wrap.hasAttribute('hidden');
      if (willOpen) {
        wrap.removeAttribute('hidden');
        btn.classList.add('is-open');
        btn.setAttribute('aria-expanded', 'true');
      } else {
        wrap.setAttribute('hidden', '');
        btn.classList.remove('is-open');
        btn.setAttribute('aria-expanded', 'false');
      }
    });
  }

  if (chronicleRoot) {
    chronicleRoot.addEventListener('click', (ev) => {
      const btn = ev.target.closest('.chronicle-strip-toggle');
      if (!btn || !chronicleRoot.contains(btn)) return;
      const wrap = document.getElementById('chronicle-list-wrap');
      if (!wrap) return;
      const willOpen = wrap.hasAttribute('hidden');
      if (willOpen) {
        wrap.removeAttribute('hidden');
        btn.classList.add('is-open');
        btn.setAttribute('aria-expanded', 'true');
      } else {
        wrap.setAttribute('hidden', '');
        btn.classList.remove('is-open');
        btn.setAttribute('aria-expanded', 'false');
      }
    });
  }

  setInterval(async () => {
    if (countdown > 0) {
      countdown -= 1;
      updateCountdownDisplay();
    }
    if (countdown > 0) return;
    if (refreshInFlight) return;
    refreshInFlight = true;
    try {
      await refresh({ fullPage: true });
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

  window.requestAnimationFrame(() => {
    const h = (location.hash || '').replace(/^#/, '').toLowerCase();
    if (h === 'realm-atlas' || h === 'worldmap') {
      document.getElementById('realm-atlas')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  });
})();
