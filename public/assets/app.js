/** Frontend runtime for leaderboard dashboard, chronicle, and realm atlas interactions. */

(() => {
  const REFRESH_SEC = 60;
  const tbody = document.getElementById('tbody');
  const detail = document.getElementById('detail');
  const detailContent = document.getElementById('detail-content');
  const detailLoading = document.getElementById('detail-loading');
  const atlasLedgerLoading = document.getElementById('atlas-ledger-loading');
  const lbLedgerLoading = document.getElementById('lb-ledger-loading');
  const qEl = document.getElementById('q');
  const errEl = document.getElementById('err');
  const lastUpdatedEl = document.getElementById('last-updated');
  const refreshCountdownEl = document.getElementById('refresh-countdown');
  const refreshFabBannerEl = document.getElementById('refresh-fab-banner');
  const fabScrollTopEl = document.getElementById('fab-scroll-top');
  const refreshFabEl = document.getElementById('refresh-fab');
  const refreshFabCountEl = document.getElementById('refresh-fab-count');
  const refreshFabEdgeSvg = document.getElementById('refresh-fab-banner-edge');
  const refreshFabEdgeFillEl = refreshFabEdgeSvg?.querySelector('.refresh-fab-banner__edge-fill') ?? null;
  const realmAtlasPanelEl = document.getElementById('realm-atlas-root');

  let rows = [];
  let selName = null;
  let lastOkFetchAt = null;
  let countdown = REFRESH_SEC;
  /** Only while a timed sync (at countdown 0) is in flight — does not block the ticking countdown. */
  let refreshInFlight = false;
  /** Incremented on each openPlayer call so stale responses do not overwrite the panel. */
  let detailFetchGen = 0;
  const countdownPulseOk = !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  let countdownSecondTimer = 0;

  function setupAtlasPerformanceMode() {
    const panel = realmAtlasPanelEl;
    if (!panel) return;

    const prefersReduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const saveData = !!navigator.connection?.saveData;
    const ect = navigator.connection?.effectiveType;
    const slowNetwork = ect === 'slow-2g' || ect === '2g';
    const hwThreads = Number(navigator.hardwareConcurrency) || 0;
    const memGiB = Number(navigator.deviceMemory) || 0;
    const likelyTouchUi =
      window.matchMedia('(pointer: coarse)').matches ||
      (navigator.maxTouchPoints > 0 && window.matchMedia('(hover: none)').matches);

    /** rAF deltas stay ~16ms even when compositing janks — do not rely on probe alone. */
    const ultraHint =
      prefersReduced ||
      saveData ||
      slowNetwork ||
      (!likelyTouchUi && hwThreads > 0 && hwThreads <= 6) ||
      (memGiB > 0 && memGiB <= 8) ||
      (!likelyTouchUi && memGiB === 0 && hwThreads > 0 && hwThreads <= 6);

    const strongDesktop =
      !prefersReduced &&
      !saveData &&
      !slowNetwork &&
      hwThreads >= 12 &&
      memGiB >= 12;

    let frameProbeDone = prefersReduced;
    let frameProbeSamples = 0;
    let frameProbePrevTs = 0;
    let frameProbeTotalDelta = 0;

    const setLiteFx = (on) => {
      panel.classList.toggle('realm-atlas-panel--litefx', on);
    };
    const setUltraLiteFx = (on) => {
      panel.classList.toggle('realm-atlas-panel--ultralite', on);
      if (on) setLiteFx(true);
    };

    const setPaused = (on) => {
      panel.classList.toggle('realm-atlas-panel--fx-paused', on);
    };

    let atlasInView = false;
    const syncPausedState = () => {
      setPaused(document.hidden || !atlasInView);
    };

    /** Match IntersectionObserver threshold 0.08 before the first async IO callback. */
    function syncAtlasInViewFromGeometry() {
      const r = panel.getBoundingClientRect();
      const vh = window.innerHeight || document.documentElement.clientHeight || 0;
      if (vh <= 0 || r.height <= 0) {
        atlasInView = false;
      } else {
        const visible = Math.min(r.bottom, vh) - Math.max(r.top, 0);
        atlasInView = visible / r.height >= 0.08;
      }
      syncPausedState();
    }

    const runFrameProbe = () => {
      if (frameProbeDone) return;
      const targetSamples = 48;
      const tick = (ts) => {
        if (frameProbeSamples >= targetSamples) {
          frameProbeDone = true;
          const avgDelta = frameProbeTotalDelta / Math.max(1, frameProbeSamples - 1);
          const ultraProbeMs = likelyTouchUi ? 28 : 22;
          if (avgDelta > ultraProbeMs) setUltraLiteFx(true);
          return;
        }
        if (frameProbePrevTs > 0) frameProbeTotalDelta += ts - frameProbePrevTs;
        frameProbePrevTs = ts;
        frameProbeSamples += 1;
        window.requestAnimationFrame(tick);
      };
      window.requestAnimationFrame(tick);
    };

    function scheduleAtlasFrameProbe() {
      if (frameProbeDone) return;
      const kick = () => {
        syncAtlasInViewFromGeometry();
        window.requestAnimationFrame(() => {
          window.requestAnimationFrame(() => {
            syncAtlasInViewFromGeometry();
            runFrameProbe();
          });
        });
      };
      if (document.readyState === 'complete') kick();
      else window.addEventListener('load', kick, { once: true });
    }

    try {
      if (window.sessionStorage?.getItem('IRPG_ATLAS_FULLFX') === '1') {
        setUltraLiteFx(false);
        setLiteFx(false);
      } else {
        setUltraLiteFx(ultraHint);
        if (strongDesktop) {
          setUltraLiteFx(false);
          setLiteFx(false);
        } else {
          setLiteFx(true);
        }
      }
    } catch {
      setUltraLiteFx(ultraHint);
      if (strongDesktop) {
        setUltraLiteFx(false);
        setLiteFx(false);
      } else {
        setLiteFx(true);
      }
    }

    syncAtlasInViewFromGeometry();
    scheduleAtlasFrameProbe();

    window.addEventListener('pageshow', syncAtlasInViewFromGeometry, { passive: true });

    if ('IntersectionObserver' in window) {
      const io = new IntersectionObserver(
        (entries) => {
          const entry = entries[0];
          if (!entry) return;
          atlasInView = entry.intersectionRatio >= 0.08;
          syncPausedState();
        },
        { threshold: [0, 0.08, 0.25] },
      );
      io.observe(panel);
    } else {
      window.addEventListener('scroll', syncAtlasInViewFromGeometry, { passive: true });
      window.addEventListener('resize', syncAtlasInViewFromGeometry, { passive: true });
    }

    document.addEventListener('visibilitychange', () => {
      if (!('IntersectionObserver' in window)) syncAtlasInViewFromGeometry();
      else syncPausedState();
    });
  }

  function setupScrollReveal() {
    const items = Array.from(document.querySelectorAll('.section-rise'));
    if (!items.length) return;
    const prefersReduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (prefersReduced || !('IntersectionObserver' in window)) {
      items.forEach((el) => el.classList.add('is-visible'));
      return;
    }
    document.documentElement.classList.add('js-reveal');
    const revealNow = (el) => {
      if (!el.classList.contains('is-visible')) el.classList.add('is-visible');
    };
    const inView = (el) => {
      const r = el.getBoundingClientRect();
      return r.top < window.innerHeight * 0.92;
    };
    let aboveFoldIndex = 0;
    items.forEach((el, idx) => {
      const delay = `${Math.min((idx % 4) * 45, 135)}ms`;
      el.style.setProperty('--reveal-delay', delay);
      if (inView(el)) {
        const extra = aboveFoldIndex * 32;
        aboveFoldIndex += 1;
        setTimeout(() => revealNow(el), extra);
      }
    });
    const observer = new IntersectionObserver(
      (entries, obs) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) return;
          const target = entry.target;
          revealNow(target);
          obs.unobserve(target);
        });
      },
      { threshold: 0.12, rootMargin: '0px 0px -10% 0px' },
    );
    items.forEach((el) => {
      if (el.classList.contains('is-visible')) return;
      observer.observe(el);
    });
  }

  setupScrollReveal();
  setupAtlasPerformanceMode();

  /** Expandable pill: CSS inset ring; bright stroke hidden during width tween (frozen SVG stretch); unlock on max-width end. */
  function setupRefreshBannerScroll() {
    const banner = refreshFabBannerEl;
    const topBtn = fabScrollTopEl;
    const svg = refreshFabEdgeSvg;
    const fill = refreshFabEdgeFillEl;
    if (!banner || !topBtn || !refreshFabEl || !svg || !fill) return;

    const EDGE_LEN = 1000;
    let edgeLayoutW = 0;
    let edgeLayoutH = 0;
    let edgeReady = false;
    /** Skip SVG geometry updates while max-width is transitioning — track stays visible via CSS. */
    let growLayoutFrozen = false;
    let growLayoutUnlockTimer = 0;
    /** While frozen, hold dash offset so stroke does not crawl as the stretched SVG resizes. */
    let frozenDashRatio = null;

    const grow = banner.querySelector('.refresh-fab-banner__grow');
    const prefersReduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    let scheduled = false;
    let prevExpanded = null;
    let collapseHideGen = 0;

    function readScrollRatio() {
      const root = document.documentElement;
      const y = window.scrollY || root.scrollTop || 0;
      const scrollable = Math.max(1, root.scrollHeight - window.innerHeight);
      return Math.min(1, Math.max(0, y / scrollable));
    }

    function roundedOutlinePath(x0, y0, iw, ih, rxCap) {
      const r = Math.min(rxCap, iw / 2, ih / 2);
      const n = (v) => (Number.isFinite(v) ? Number(v.toFixed(2)) : 0);
      const x = n(x0);
      const y = n(y0);
      const rr = n(r);
      const right = n(x0 + iw);
      const bottom = n(y0 + ih);
      const xr = n(x0 + iw - r);
      const yb = n(y0 + ih - r);
      const xl = n(x0 + r);
      return [
        `M ${xl} ${y}`,
        `L ${xr} ${y}`,
        `A ${rr} ${rr} 0 0 1 ${right} ${n(y0 + r)}`,
        `L ${right} ${yb}`,
        `A ${rr} ${rr} 0 0 1 ${xr} ${bottom}`,
        `L ${xl} ${bottom}`,
        `A ${rr} ${rr} 0 0 1 ${x} ${yb}`,
        `L ${x} ${n(y0 + r)}`,
        `A ${rr} ${rr} 0 0 1 ${xl} ${y}`,
        'Z',
      ].join(' ');
    }

    function layoutBannerEdge() {
      if (growLayoutFrozen) return false;
      const rect = banner.getBoundingClientRect();
      const W = Math.max(8, Math.round(rect.width));
      const H = Math.max(8, Math.round(rect.height));
      if (W === edgeLayoutW && H === edgeLayoutH && edgeReady) return false;
      edgeLayoutW = W;
      edgeLayoutH = H;
      const strokeInset = 2;
      const x = strokeInset / 2;
      const y = strokeInset / 2;
      const iw = W - strokeInset;
      const ih = H - strokeInset;
      const rxCap = Math.min(iw, ih) / 2;
      const d = roundedOutlinePath(x, y, iw, ih, rxCap);
      fill.setAttribute('d', d);
      fill.setAttribute('pathLength', String(EDGE_LEN));
      svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
      edgeReady = typeof fill.getTotalLength === 'function' && fill.getTotalLength() > 0;
      return true;
    }

    function setGrowLayoutFrozen(on) {
      growLayoutFrozen = on;
      banner.classList.toggle('is-grow-layout-frozen', on);
    }

    function clearGrowFreezeState() {
      frozenDashRatio = null;
      setGrowLayoutFrozen(false);
    }

    function armGrowLayoutUnlockFallback() {
      if (growLayoutUnlockTimer) {
        window.clearTimeout(growLayoutUnlockTimer);
        growLayoutUnlockTimer = 0;
      }
      growLayoutUnlockTimer = window.setTimeout(() => {
        growLayoutUnlockTimer = 0;
        clearGrowFreezeState();
        scheduled = false;
        apply();
      }, 220);
    }

    function unlockGrowLayoutAndSync() {
      if (growLayoutUnlockTimer) {
        window.clearTimeout(growLayoutUnlockTimer);
        growLayoutUnlockTimer = 0;
      }
      clearGrowFreezeState();
      scheduled = false;
      apply();
    }

    if (grow && !prefersReduced) {
      grow.addEventListener('transitionrun', (ev) => {
        if (ev.propertyName !== 'max-width') return;
        frozenDashRatio = readScrollRatio();
        setGrowLayoutFrozen(true);
        armGrowLayoutUnlockFallback();
      });
      grow.addEventListener('transitionend', (ev) => {
        if (ev.propertyName !== 'max-width') return;
        unlockGrowLayoutAndSync();
      });
      grow.addEventListener('transitioncancel', (ev) => {
        if (ev.propertyName !== 'max-width' && ev.propertyName !== 'opacity') return;
        armGrowLayoutUnlockFallback();
      });
    }

    function scheduleHideTopAfterCollapse() {
      collapseHideGen += 1;
      const gen = collapseHideGen;
      const finish = () => {
        if (gen !== collapseHideGen) return;
        if (banner.classList.contains('is-scrolled')) return;
        topBtn.classList.add('hidden');
      };
      if (prefersReduced || !grow) {
        finish();
        return;
      }
      const onEnd = (ev) => {
        if (ev.target !== grow || ev.propertyName !== 'max-width') return;
        grow.removeEventListener('transitionend', onEnd);
        finish();
      };
      grow.addEventListener('transitionend', onEnd);
      window.setTimeout(() => {
        grow.removeEventListener('transitionend', onEnd);
        finish();
      }, 220);
    }

    let edgeDashInstantUntil = 0;

    function apply() {
      scheduled = false;
      const ratio = readScrollRatio();
      const y = window.scrollY || document.documentElement.scrollTop || 0;
      const expanded = y > 72 || ratio > 0.025;
      const dashRatio = growLayoutFrozen ? frozenDashRatio ?? ratio : ratio;

      const edgePathRelaid = layoutBannerEdge();

      if (edgeReady) {
        fill.style.strokeDasharray = `${EDGE_LEN} ${EDGE_LEN}`;
        fill.style.strokeDashoffset = String(EDGE_LEN * (1 - dashRatio));
      }
      svg.setAttribute('aria-valuenow', String(Math.round(ratio * 100)));

      const dashSnap =
        prefersReduced || performance.now() < edgeDashInstantUntil || edgePathRelaid;
      banner.classList.toggle('is-edge-dash-instant', dashSnap);

      if (prevExpanded === null || expanded !== prevExpanded) {
        if (expanded) {
          collapseHideGen += 1;
          topBtn.classList.remove('hidden');
        } else {
          scheduleHideTopAfterCollapse();
        }
        if (grow && !prefersReduced) {
          const growAnimating =
            (prevExpanded !== null && expanded !== prevExpanded) ||
            (prevExpanded === null && expanded);
          if (growAnimating) {
            frozenDashRatio = ratio;
            setGrowLayoutFrozen(true);
            armGrowLayoutUnlockFallback();
          }
        }
        prevExpanded = expanded;
      }

      banner.classList.toggle('is-scrolled', expanded);
    }

    function scheduleApply() {
      if (scheduled) return;
      scheduled = true;
      requestAnimationFrame(apply);
    }

    window.addEventListener('scroll', () => {
      edgeDashInstantUntil = performance.now() + 160;
      scheduleApply();
    }, { passive: true });
    window.addEventListener('resize', scheduleApply, { passive: true });
    if ('ResizeObserver' in window) {
      const ro = new ResizeObserver(() => scheduleApply());
      ro.observe(banner);
      ro.observe(document.documentElement);
      if (document.body) ro.observe(document.body);
      const appRoot = document.getElementById('app');
      if (appRoot) ro.observe(appRoot);
    }
    const appRootMo = document.getElementById('app');
    if (appRootMo && 'MutationObserver' in window) {
      let moRaf = 0;
      const mo = new MutationObserver(() => {
        if (moRaf) return;
        moRaf = window.requestAnimationFrame(() => {
          moRaf = 0;
          scheduleApply();
        });
      });
      mo.observe(appRootMo, {
        subtree: true,
        childList: true,
        attributes: true,
        attributeFilter: ['class', 'style', 'hidden', 'aria-hidden', 'aria-expanded'],
      });
    }
    topBtn.addEventListener('click', () => {
      window.scrollTo({ top: 0, behavior: prefersReduced ? 'auto' : 'smooth' });
    });

    scheduleApply();
  }

  setupRefreshBannerScroll();

  function updateCountdownDisplay() {
    if (refreshCountdownEl) {
      refreshCountdownEl.textContent = String(Math.max(0, countdown));
    }
    if (refreshFabCountEl) {
      refreshFabCountEl.textContent = String(Math.max(0, countdown));
    }
  }

  function msUntilNextSecondBoundary() {
    const ms = 1000 - (Date.now() % 1000);
    return ms === 1000 ? 1000 : ms;
  }

  function clearCountdownSecondTimer() {
    if (!countdownSecondTimer) return;
    window.clearTimeout(countdownSecondTimer);
    countdownSecondTimer = 0;
  }

  function pulseRefreshCountdownDigits() {
    if (!countdownPulseOk) return;
    for (const el of [refreshCountdownEl, refreshFabCountEl]) {
      if (!el) continue;
      el.classList.remove('refresh-countdown-pulse');
      void el.offsetWidth;
      el.classList.add('refresh-countdown-pulse');
    }
  }

  function scheduleCountdownSecondTick() {
    clearCountdownSecondTimer();
    countdownSecondTimer = window.setTimeout(async () => {
      countdownSecondTimer = 0;
      if (countdown > 0) {
        countdown -= 1;
        updateCountdownDisplay();
        pulseRefreshCountdownDigits();
        scheduleCountdownSecondTick();
        return;
      }
      await forceRefreshNow();
    }, msUntilNextSecondBoundary());
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
    if (refreshFabEl) {
      refreshFabEl.classList.toggle('is-refreshing', busy);
      refreshFabEl.setAttribute('aria-busy', busy ? 'true' : 'false');
    }
    if (refreshFabBannerEl) {
      refreshFabBannerEl.classList.toggle('is-refreshing', busy);
    }
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
  const chronicleKindFilterEl = document.getElementById('chronicle-kind-filter');
  const chronicleSearchEl = document.getElementById('chronicle-search');
  const chronicleSinceEl = document.getElementById('chronicle-since');
  const chronicleUntilEl = document.getElementById('chronicle-until');
  const chronicleApplyEl = document.getElementById('chronicle-apply');
  const seasonCurrentExpandEl = document.getElementById('season-current-expand');
  const seasonHistoryToggleEl = document.getElementById('season-history-toggle');
  const seasonHistoryExpandEl = document.getElementById('season-history-expand');
  const seasonHistoryCountEl = document.getElementById('season-history-count');
  const guildListExpandEl = document.getElementById('guild-list-expand');
  let chronicleBeforeId = null;
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
  let seasonCurrentExpanded = false;
  let seasonHistoryOpen = false;
  let seasonHistoryCount = 0;
  let seasonStandingsHistoryExpanded = false;
  let seasonCurrentRows = [];
  let seasonStandingsRows = [];
  let seasonCurrentMeta = null;
  let seasonCurrentLabel = null;
  let chronicleExpanded = false;
  let heroLedgerExpanded = false;
  let seasonHistoryExpanded = false;
  let guildPreviewRows = [];
  let guildListExpanded = false;
  /** Guild card keys (`tag|name`) with full roster visible */
  const guildMembersExpanded = new Set();

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
        const hr = Math.max(10, r0 * 1.45);
        const pad = 2;
        const hitW = hr + pad + nameW;
        const hitH = Math.max(hr * 2, 16);
        hit.setAttribute('x', (-hr).toFixed(2));
        hit.setAttribute('y', (-hitH / 2).toFixed(2));
        hit.setAttribute('width', hitW.toFixed(2));
        hit.setAttribute('height', hitH.toFixed(2));
        hit.setAttribute('rx', Math.min(10, hitH / 2).toFixed(2));
      } else {
        const hr = Math.max(12, r0 * 1.8);
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
      el.style.visibility = 'visible';
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
    return `<div class="tt-name">${escapeHtml(p.name)}</div><div class="tt-row">${on}<span class="tt-level mono">L${escapeHtml(String(p.level))}</span></div><div class="tt-class">${escapeHtml(p.class)}</div><div class="tt-timer mono">⏳ ${escapeHtml(p.nextHuman || '')}</div><div class="tt-hint mono">Click → hero sheet</div>`;
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
    const ATLAS_SAME_LEVEL_SPREAD_X = 118;
    const latSpan = ATLAS_Y_SOUTH - ATLAS_Y_NORTH;

    const countAtLevel = Object.create(null);
    for (const pl of sorted) {
      const L = atlasSafeLevel(pl);
      countAtLevel[L] = (countAtLevel[L] || 0) + 1;
    }
    const idxAtLevel = Object.create(null);
    const placedPoints = [];

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
      const stackX = nHere > 1 ? (k - (nHere - 1) / 2) * ATLAS_SAME_LEVEL_SPREAD_X : 0;
      const jitterA = ((hash32(p.name) % 360) * Math.PI) / 180 / 12;
      const a = rank * GOLDEN_ANGLE + jitterA;
      const spread = 200 + Math.sqrt(rank + 1) * 76;
      const displayName = p.name.length > 24 ? `${p.name.slice(0, 22)}…` : p.name;
      const estNameW = Math.min(150, 10 + displayName.length * 6.2);
      let x = 500 + Math.cos(a) * spread * 1.02;
      const h0 = hash32(p.name);
      x += (h0 % 29) - 14 + stackX;
      let y = yBand;
      const xMin = 44;
      const xMax = 1000 - 20 - (Math.max(4.6, 3.6 + Math.min(13.5, atlasSafeLevel(p) / 6.2)) + 6 + estNameW);
      if (xMax <= xMin) {
        x = (xMin + xMax) / 2;
      } else {
        x = clamp(x, xMin, xMax);
      }
      y = clamp(y, 88, 548);
      const maxBandDrift = 2;
      const bandMin = clamp(yBand - maxBandDrift, 88, 548);
      const bandMax = clamp(yBand + maxBandDrift, 88, 548);

      const rad = Math.max(4.6, 3.6 + Math.min(13.5, atlasSafeLevel(p) / 6.2));
      const minGap = 46 + rad * 2.7;
      let tries = 0;
      while (tries < 24) {
        let overlap = false;
        for (const q of placedPoints) {
          const dx = x - q.x;
          const dy = y - q.y;
          const distSq = dx * dx + dy * dy;
          const gap = Math.max(minGap, q.minGap);
          if (distSq < gap * gap) {
            overlap = true;
            break;
          }
        }
        if (!overlap) break;
        const nudge = 38 + tries * 4.8;
        x += (k % 2 === 0 ? 1 : -1) * nudge;
        if (xMax > xMin) {
          x = clamp(x, xMin, xMax);
        }
        y = clamp(y, bandMin, bandMax);
        tries += 1;
      }
      placedPoints.push({ x, y, minGap });
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
        target.addEventListener('click', async (ev) => {
          ev.stopPropagation();
          hideAtlasTooltip();
          await openPlayer(p.name);
          scrollHeroSheetIntoView();
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

  let atlasRenderRaf = 0;
  let atlasRenderQueued = null;
  function scheduleRealmAtlasRender(players, realmPulse, selectedName) {
    atlasRenderQueued = { players, realmPulse, selectedName };
    if (atlasRenderRaf) return;
    atlasRenderRaf = window.requestAnimationFrame(() => {
      atlasRenderRaf = 0;
      const payload = atlasRenderQueued;
      atlasRenderQueued = null;
      if (!payload) return;
      renderRealmAtlas(payload.players, payload.realmPulse, payload.selectedName);
    });
  }

  const CHRONICLE_KIND = {
    quest_start: 'Quest',
    quest_end: 'Quest end',
    quest_win: 'Quest win',
    quest_lose: 'Quest loss',
    lucky_hour: 'Lucky hour',
    realm_record: 'Record',
    hog_win: 'HoG win',
    hog_lose: 'HoG loss',
    register: 'Join',
    login: 'Login',
    logout: 'Logout',
    part: 'Part',
    quit: 'Quit',
    netsplit: 'Netsplit',
    admin_resetpass: 'Admin',
    admin_forcelogout: 'Admin',
    admin_delete: 'Admin',
    admin_shutdown: 'Shutdown',
    admin_restart: 'Restart',
    lucky_hour_admin: 'Lucky',
    omen_rare: 'Rare omen',
    omen_boon: 'Omen boon',
    omen_curse: 'Omen curse',
    duel: 'Duel',
    duel_win: 'Duel win',
    duel_lose: 'Duel loss',
    medal: 'Medal',
    gauntlet_win: 'Gauntlet win',
    gauntlet_lose: 'Gauntlet loss',
    daily_trial_win: 'Daily trial win',
    daily_trial_lose: 'Daily trial loss',
    bounty_claim: 'Bounty',
    world_boss_start: 'World boss start',
    world_boss_slay: 'World boss slain',
    world_boss_fail: 'World boss fail',
    world_boss_reward: 'World boss reward',
    guild_create: 'Guild',
    guild_join: 'Guild',
    guild_leave: 'Guild',
    relic_found: 'Relic',
    relic_equip: 'Relic',
    prestige: 'Prestige',
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
    if (ago < 60) return `${Math.max(1, ago)}s`;
    if (ago < 3600) return `${Math.floor(ago / 60)}m`;
    if (ago < 86400) return `${Math.floor(ago / 3600)}h`;
    return `${Math.floor(ago / 86400)}d`;
  }

  function formatDurationSec(totalSec) {
    const s = Math.max(0, Math.floor(Number(totalSec) || 0));
    if (s < 60) return `${s}s`;
    if (s < 3600) {
      const m = Math.floor(s / 60);
      const sec = s % 60;
      return sec > 0 ? `${m}m ${sec}s` : `${m}m`;
    }
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = s % 60;
    if (sec > 0) return `${h}h ${m}m ${sec}s`;
    if (m > 0) return `${h}h ${m}m`;
    return `${h}h`;
  }

  function formatDurationWithDays(totalSec) {
    const s = Math.max(0, Math.floor(Number(totalSec) || 0));
    if (s < 86400) return formatDurationSec(s);
    const d = Math.floor(s / 86400);
    const rem = s % 86400;
    const h = Math.floor(rem / 3600);
    const m = Math.floor((rem % 3600) / 60);
    const sec = rem % 60;
    if (sec > 0) return `${d}d ${h}h ${m}m ${sec}s`;
    if (m > 0) return `${d}d ${h}h ${m}m`;
    return `${d}d ${h}h`;
  }

  /** Keep chronicle readable when old rows still contain legacy H:MM:SS text. */
  function normalizeLegacyDurationText(detail) {
    const src = String(detail || '');
    const withDays = src.replace(/(\d+)\s+day(?:s)?,\s*(\d+):([0-5]\d):([0-5]\d)/gi, (_m, d, h, m, s) => {
      const total = Number(d) * 86400 + Number(h) * 3600 + Number(m) * 60 + Number(s);
      return formatDurationWithDays(total);
    });
    return withDays.replace(/\b(\d+):([0-5]\d):([0-5]\d)\b/g, (_m, h, m, s) => {
      const total = Number(h) * 3600 + Number(m) * 60 + Number(s);
      return formatDurationSec(total);
    });
  }

  function renderChronicle(events) {
    if (!chronicleList || !chroniclePlaceholder) return;
    if (!events || !events.length) {
      chroniclePlaceholder.textContent =
        'Chronicle empty — start the bot; quests, Hand of God, duels, and records will add the first lines.';
      chroniclePlaceholder.classList.remove('hidden');
      chronicleList.innerHTML = '';
      if (chronicleCollapsible) chronicleCollapsible.classList.add('hidden');
      if (chronicleListWrap) {
        chronicleListWrap.classList.add('is-collapsed');
      }
      const btn = chronicleCollapsible?.querySelector('.chronicle-strip-toggle');
      if (btn) {
        btn.classList.remove('is-open');
        btn.setAttribute('aria-expanded', 'false');
      }
      chronicleExpanded = false;
      return;
    }
    chroniclePlaceholder.classList.add('hidden');
    if (chronicleCollapsible) chronicleCollapsible.classList.remove('hidden');
    if (chronicleCountEl) chronicleCountEl.textContent = String(events.length);
    let prevDay = '';
    chronicleList.innerHTML = events
      .map((e) => {
        const kind = chronicleKindLabel(e.kind || '');
        const safeKind = realmEventKindClass(e.kind);
        const ago = formatAgoSec(e.ts);
        const det = escapeHtml(normalizeLegacyDurationText((e.detail || '').trim() || '—'));
        const dayKey = Number.isFinite(e.ts) ? new Date(e.ts * 1000).toLocaleDateString() : '';
        const dayHead = dayKey && dayKey !== prevDay ? `<li class="chronicle-day-head mono">${escapeHtml(dayKey)}</li>` : '';
        prevDay = dayKey || prevDay;
        return `${dayHead}<li class="chronicle-item chronicle-item--${safeKind}"><div class="chronicle-meta">${escapeHtml(kind)} <span class="chronicle-ago">· ${ago} ago</span></div><div class="chronicle-detail">${det}</div></li>`;
      })
      .join('');
    if (chronicleListWrap) chronicleListWrap.classList.toggle('is-collapsed', !chronicleExpanded);
    const btn = chronicleCollapsible?.querySelector('.chronicle-strip-toggle');
    if (btn) {
      btn.classList.toggle('is-open', chronicleExpanded);
      btn.setAttribute('aria-expanded', chronicleExpanded ? 'true' : 'false');
    }
  }

  async function fetchChronicle() {
    const params = new URLSearchParams({ limit: String(chronicleFetchLimit) });
    if (chronicleKindFilterEl && chronicleKindFilterEl.value) params.set('kind', chronicleKindFilterEl.value);
    if (chronicleSearchEl && chronicleSearchEl.value.trim()) params.set('search', chronicleSearchEl.value.trim());
    if (chronicleSinceEl && chronicleSinceEl.value) {
      const v = Math.floor(new Date(chronicleSinceEl.value).getTime() / 1000);
      if (Number.isFinite(v) && v > 0) params.set('since', String(v));
    }
    if (chronicleUntilEl && chronicleUntilEl.value) {
      const v = Math.floor(new Date(chronicleUntilEl.value).getTime() / 1000);
      if (Number.isFinite(v) && v > 0) params.set('until', String(v));
    }
    if (chronicleBeforeId != null) params.set('before_id', String(chronicleBeforeId));
    const r = await fetch('api/chronicle.php?' + params.toString(), { cache: 'no-store' });
    const text = await r.text();
    const j = parseJsonSafe(text);
    if (!r.ok || !j || !Array.isArray(j.events)) {
      const err = new Error('chronicle');
      err.detail = j || { hint: text.slice(0, 200) };
      throw err;
    }
    chronicleBeforeId = typeof j.nextBeforeId === 'number' ? j.nextBeforeId : null;
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
      aiEnabled: j.aiEnabled === true,
      realmPulse: j.realmPulse && typeof j.realmPulse === 'object' ? j.realmPulse : null,
      season: typeof j.season === 'string' ? j.season : null,
      seasonMeta: j.seasonMeta && typeof j.seasonMeta === 'object' ? j.seasonMeta : null,
      worldBoss: typeof j.worldBoss === 'string' ? j.worldBoss : null,
      guildsPreview: Array.isArray(j.guildsPreview) ? j.guildsPreview : [],
      seasonPreview: Array.isArray(j.seasonPreview) ? j.seasonPreview : [],
      seasonStandings: Array.isArray(j.seasonStandings) ? j.seasonStandings : [],
    };
  }

  function setRealmPulse(pulse) {
    const el = document.getElementById('realm-pulse');
    const secondary = document.getElementById('realm-status-secondary');
    if (!el) return;
    if (pulse && typeof pulse.display === 'string' && pulse.display.trim()) {
      el.textContent = pulse.display;
      if (secondary) {
        secondary.classList.add('hidden');
        secondary.setAttribute('aria-hidden', 'true');
      }
    } else {
      el.textContent = 'Realm pulse: sync the leaderboard API for live stats.';
      if (secondary) {
        secondary.classList.remove('hidden');
        secondary.setAttribute('aria-hidden', 'false');
      }
    }
  }

  function setBotStatus(botOnline, botLastSeenMs, aiEnabled) {
    const led = document.getElementById('bot-status-led');
    const txt = document.getElementById('bot-status-text');
    const banner = document.getElementById('bot-offline-banner');
    const bannerDetail = document.getElementById('bot-offline-banner-detail');
    if (led) led.classList.toggle('is-bot-offline', !botOnline);
    if (txt) {
      txt.classList.toggle('is-bot-offline', !botOnline);
      const aiLabel = aiEnabled ? 'AI: active' : 'AI: inactive';
      if (botOnline) {
        txt.textContent = `IRC bot: online · ${aiLabel}`;
      } else {
        txt.textContent = `IRC bot: offline · ${aiLabel}`;
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
    if (refreshFabBannerEl) {
      refreshFabBannerEl.classList.toggle('hidden', !botOnline);
      refreshFabBannerEl.setAttribute('aria-hidden', botOnline ? 'false' : 'true');
    }
  }

  function setSeasonBanner(label) {
    const el = document.getElementById('season-banner');
    if (!el) return;
    if (!label) {
      el.textContent = 'Season status: unavailable';
      forceRealmPulseRepaint();
      return;
    }
    el.textContent = `${label} · campaign active`;
    forceRealmPulseRepaint();
  }

  function setSeasonPreviewMeta(seasonMeta, fallbackLabel) {
    const el = document.getElementById('season-preview-meta');
    if (!el) return;
    const base = 'Live season pass ladder — top ranks by tier and XP. Open past seasons for archives.';
    const label =
      seasonMeta && typeof seasonMeta.label === 'string' && seasonMeta.label.trim()
        ? seasonMeta.label.trim()
        : typeof fallbackLabel === 'string' && fallbackLabel.trim()
          ? fallbackLabel.trim()
          : '';
    const startsAt =
      seasonMeta && Number.isFinite(Number(seasonMeta.startsAt)) ? Number(seasonMeta.startsAt) : 0;
    const endsAt =
      seasonMeta && Number.isFinite(Number(seasonMeta.endsAt)) ? Number(seasonMeta.endsAt) : 0;
    if (!label || startsAt <= 0 || endsAt <= 0) {
      el.textContent = base;
      return;
    }
    const started = new Date(startsAt * 1000).toLocaleDateString();
    const ends = new Date(endsAt * 1000).toLocaleDateString();
    el.textContent = `${base} ${label}: started ${started} · ends ${ends}.`;
  }

  function setWorldBossBanner(worldBossText) {
    const el = document.getElementById('world-boss-banner');
    if (!el) return;
    if (!worldBossText) {
      el.textContent = 'World Boss scouting the frontier';
      forceRealmPulseRepaint();
      return;
    }
    el.textContent = `World Boss engaged: ${worldBossText}`;
    forceRealmPulseRepaint();
  }

  /** iOS Safari: force a tiny repaint to avoid first-load glyph clipping in pulse bars. */
  function forceRealmPulseRepaint() {
    const nodes = document.querySelectorAll('.realm-pulse');
    if (!nodes.length) return;
    const pulse = () => {
      requestAnimationFrame(() => {
        nodes.forEach((node) => {
          node.classList.add('realm-pulse--repaint');
        });
        requestAnimationFrame(() => {
          nodes.forEach((node) => {
            node.classList.remove('realm-pulse--repaint');
          });
        });
      });
    };
    pulse();
    setTimeout(pulse, 120);
    setTimeout(pulse, 420);
  }

  if (document.fonts && typeof document.fonts.ready === 'object') {
    document.fonts.ready.then(() => {
      forceRealmPulseRepaint();
    }).catch(() => undefined);
  }

  function guildCardKey(g) {
    return `${String((g && g.tag) || '')}|${String((g && g.name) || '')}`;
  }

  function sortGuildMembersLeaderFirst(members) {
    if (!Array.isArray(members) || !members.length) return [];
    return members.slice().sort((a, b) => {
      const al = String(a.role || 'member').toLowerCase() === 'leader' ? 0 : 1;
      const bl = String(b.role || 'member').toLowerCase() === 'leader' ? 0 : 1;
      if (al !== bl) return al - bl;
      const lv = (Number(b.level) || 0) - (Number(a.level) || 0);
      if (lv !== 0) return lv;
      return String(a.name || '').localeCompare(String(b.name || ''));
    });
  }

  /** Shared 6-column grid: #, Player, Tier, Class/Role, XP, L (Guild + Season align) */
  const STANDINGS_COLGROUP = `<colgroup>
    <col class="standings-col-rank" />
    <col class="standings-col-player" />
    <col class="standings-col-tier" />
    <col class="standings-col-class" />
    <col class="standings-col-xp" />
    <col class="standings-col-lv" />
  </colgroup>`;

  function renderGuildMemberRow(m, rank) {
    const role = String(m.role || 'member').toLowerCase() === 'leader' ? 'leader' : 'member';
    const roleLabel = role === 'leader' ? 'Leader' : 'Member';
    const name = escapeHtml(String(m.name || 'Unknown'));
    const dotClass = m.online ? 'dot dot--online' : 'dot dot--offline';
    const dotTitle = m.online ? 'Online' : 'Offline';
    return `<tr class="guild-standings-row">
      <td class="mono guild-standings-rank">${rank}</td>
      <td><span class="player-presence player-presence--dot-left"><span class="${dotClass}" title="${dotTitle}" aria-hidden="true"></span><strong class="player-presence__name">${name}</strong></span></td>
      <td class="mono standings-tier-cell" aria-hidden="true"></td>
      <td class="hide-sm standings-role-cell"><span class="guild-role guild-role--${role}">${roleLabel}</span></td>
      <td class="mono standings-xp-cell" aria-hidden="true"></td>
      <td class="lv guild-standings-lv">${Number(m.level) || 0}</td>
    </tr>`;
  }

  function renderGuildLeaderTable(members) {
    if (!Array.isArray(members) || !members.length) {
      return '<p class="guild-empty mono muted">No linked members yet.</p>';
    }
    const sorted = sortGuildMembersLeaderFirst(members);
    const leaderHtml = renderGuildMemberRow(sorted[0], 1);
    return `<div class="table-wrap guild-standings-wrap">
      <table class="table guild-standings-table">
        ${STANDINGS_COLGROUP}
        <thead>
          <tr>
            <th scope="col">#</th>
            <th scope="col">Player</th>
            <th scope="col" class="standings-spacer-head standings-tier-head" aria-hidden="true"></th>
            <th scope="col" class="hide-sm standings-role-head">Role</th>
            <th scope="col" class="standings-spacer-head standings-xp-head" aria-hidden="true"></th>
            <th scope="col" class="guild-standings-lv-head" title="Hero level">L</th>
          </tr>
        </thead>
        <tbody>${leaderHtml}</tbody>
      </table>
    </div>`;
  }

  function renderGuildRosterExtraPanel(members, rosterExpanded, panelId) {
    const sorted = sortGuildMembersLeaderFirst(members);
    const rest = sorted.slice(1);
    if (!rest.length) return '';
    const collapsed = rosterExpanded ? '' : ' is-collapsed';
    return `<div class="finds-collapse-panel guild-roster-extra-panel${collapsed}" id="${escapeHtml(panelId)}">
      <div class="finds-collapse-panel-inner">
        <div class="table-wrap guild-standings-wrap guild-standings-wrap--extra">
          <table class="table guild-standings-table guild-standings-table--extra">
            ${STANDINGS_COLGROUP}
            <tbody>${rest.map((m, i) => renderGuildMemberRow(m, i + 2)).join('')}</tbody>
          </table>
        </div>
      </div>
    </div>`;
  }

  function renderGuildMembersToggle(members, rosterExpanded, cardKey, panelId) {
    const sorted = sortGuildMembersLeaderFirst(members);
    if (sorted.length <= 1) return '';
    const extra = sorted.length - 1;
    const scope = rosterExpanded ? '(showing all)' : `(+${extra})`;
    return `<button
      type="button"
      class="finds-strip-toggle guild-card__members-toggle${rosterExpanded ? ' is-open' : ''}"
      data-guild-key="${escapeHtml(cardKey)}"
      data-member-extra="${extra}"
      aria-expanded="${rosterExpanded ? 'true' : 'false'}"
      aria-controls="${escapeHtml(panelId)}"
    >
      <span class="finds-chevron" aria-hidden="true"></span>
      <span class="finds-strip-label">All members <span class="finds-strip-scope">${scope}</span></span>
    </button>`;
  }

  function renderGuildCard(g, rank) {
    const tag = escapeHtml(String(g.tag || 'TAG'));
    const name = escapeHtml(String(g.name || 'Guild'));
    const members = Number(g.members) || 0;
    const createdTs = Number(g.createdAt);
    const createdLabel =
      Number.isFinite(createdTs) && createdTs > 0
        ? new Date(createdTs * 1000).toLocaleDateString()
        : 'N/A';
    const rankMod =
      rank === 1 ? ' guild-card--gold' : rank === 2 ? ' guild-card--silver' : rank === 3 ? ' guild-card--bronze' : '';
    const membersList = Array.isArray(g.memberList) ? g.memberList : [];
    const cardKey = guildCardKey(g);
    const rosterExpanded = guildMembersExpanded.has(cardKey);
    const panelId = `guild-roster-extra-${rank}`;
    return `<article class="guild-card${rankMod}" data-guild-key="${escapeHtml(cardKey)}">
      <header class="guild-card__head">
        <div class="guild-card__title-row">
          <h3 class="guild-card__title"><span class="mono guild-card__tag">[${tag}]</span> ${name}</h3>
          <span class="guild-card__badge">#${rank}</span>
        </div>
        <p class="guild-card__window mono">${members} member${members !== 1 ? 's' : ''} · Founded ${escapeHtml(createdLabel)}</p>
      </header>
      ${renderGuildLeaderTable(membersList)}
      ${renderGuildMembersToggle(membersList, rosterExpanded, cardKey, panelId)}
      ${renderGuildRosterExtraPanel(membersList, rosterExpanded, panelId)}
    </article>`;
  }

  function setGuildPreview(guilds) {
    const root = document.getElementById('guild-board-list');
    const meta = document.getElementById('guild-preview-meta');
    if (!root) return;
    guildPreviewRows = Array.isArray(guilds) ? guilds.slice() : [];
    if (guildPreviewRows.length <= 3 && guildListExpanded) guildListExpanded = false;
    const validGuildKeys = new Set(guildPreviewRows.map((g) => guildCardKey(g)));
    for (const k of guildMembersExpanded) {
      if (!validGuildKeys.has(k)) guildMembersExpanded.delete(k);
    }

    if (meta) {
      const n = guildPreviewRows.length;
      meta.textContent =
        n > 0
          ? `${n} guild${n !== 1 ? 's' : ''} on this shard — leader shown first; tap All members to expand each roster.`
          : 'Guild rosters ranked by member count (live from the shard ledger).';
    }

    if (!guildPreviewRows.length) {
      root.innerHTML = '<p class="guild-empty mono muted">No guilds registered on this shard yet.</p>';
      if (guildListExpandEl) guildListExpandEl.classList.add('hidden');
      return;
    }

    const topGuilds = guildPreviewRows.slice(0, 3);
    const restGuilds = guildPreviewRows.slice(3);
    const topHtml = topGuilds.map((g, i) => renderGuildCard(g, i + 1)).join('');
    const restHtml =
      restGuilds.length > 0
        ? `<div class="finds-collapse-panel guild-list-extra-panel${
            guildListExpanded ? '' : ' is-collapsed'
          }"><div class="finds-collapse-panel-inner guild-board__stack">${restGuilds
            .map((g, i) => renderGuildCard(g, i + 4))
            .join('')}</div></div>`
        : '';
    root.innerHTML = topHtml + restHtml;

    if (guildListExpandEl) {
      const canExpand = guildPreviewRows.length > 3;
      guildListExpandEl.classList.toggle('hidden', !canExpand);
      guildListExpandEl.classList.toggle('is-open', guildListExpanded);
      guildListExpandEl.setAttribute('aria-expanded', guildListExpanded ? 'true' : 'false');
      const scopeEl = guildListExpandEl.querySelector('.finds-strip-scope');
      if (scopeEl) scopeEl.textContent = guildListExpanded ? '(showing all)' : '(top 3)';
    }
  }


  function renderSeasonStandingsRow(r, rank) {
    const dotClass = r && r.online ? 'dot dot--online' : 'dot dot--offline';
    const dotTitle = r && r.online ? 'Online' : 'Offline';
    const name = escapeHtml(String((r && r.name) || 'Unknown'));
    const tier = Number((r && r.tier) || 0);
    const xp = Number((r && r.xp) || 0);
    const heroLevel = Number((r && r.level) || 0);
    const heroClass = escapeHtml(String((r && r.class) || ''));
    const rankMod =
      rank === 1
        ? ' season-rank--gold'
        : rank === 2
          ? ' season-rank--silver'
          : rank === 3
            ? ' season-rank--bronze'
            : '';
    return `<tr class="season-standings-row${rankMod}">
      <td class="mono season-standings-rank">${rank}</td>
      <td><span class="player-presence player-presence--dot-left"><span class="${dotClass}" title="${dotTitle}" aria-hidden="true"></span><strong class="player-presence__name">${name}</strong></span></td>
      <td class="mono season-standings-tier">${tier}</td>
      <td class="hide-sm season-standings-class">${heroClass || '—'}</td>
      <td class="mono season-standings-xp">${xp}</td>
      <td class="lv season-standings-lv">${heroLevel}</td>
    </tr>`;
  }

  function renderSeasonStandingsTable(rows, rosterExpanded, panelId) {
    if (!rows.length) {
      return '<p class="season-empty mono muted">No standings recorded yet.</p>';
    }
    const top = rows.slice(0, 3);
    const rest = rows.slice(3);
    const topHtml = top.map((r, i) => renderSeasonStandingsRow(r, i + 1)).join('');
    const collapsed = rosterExpanded ? '' : ' is-collapsed';
    const extraPanel =
      rest.length > 0
        ? `<div class="finds-collapse-panel season-standings-extra-panel${collapsed}" id="${escapeHtml(panelId)}">
        <div class="finds-collapse-panel-inner">
          <div class="table-wrap season-standings-wrap season-standings-wrap--extra">
            <table class="table season-standings-table season-standings-table--extra">
              ${STANDINGS_COLGROUP}
              <tbody>${rest.map((r, i) => renderSeasonStandingsRow(r, i + 4)).join('')}</tbody>
            </table>
          </div>
        </div>
      </div>`
        : '';
    return `<div class="table-wrap season-standings-wrap">
      <table class="table season-standings-table">
        ${STANDINGS_COLGROUP}
        <thead>
          <tr>
            <th scope="col">#</th>
            <th scope="col">Player</th>
            <th scope="col">Tier</th>
            <th scope="col" class="hide-sm">Class</th>
            <th scope="col">XP</th>
            <th scope="col" class="season-standings-lv-head" title="Hero level">L</th>
          </tr>
        </thead>
        <tbody>${topHtml}</tbody>
      </table>
    </div>
    ${extraPanel}`;
  }

  function renderSeasonCardMarkup(label, badge, badgeMod, windowText, rows, rosterExpanded, panelId) {
    const mod = badgeMod ? ` ${badgeMod}` : '';
    return `<article class="season-card${mod}">
      <header class="season-card__head">
        <div class="season-card__title-row">
          <h3 class="season-card__title">${label}</h3>
          <span class="season-card__badge">${badge}</span>
        </div>
        <p class="season-card__window mono">${windowText}</p>
      </header>
      ${renderSeasonStandingsTable(rows, rosterExpanded, panelId)}
    </article>`;
  }

  function setSeasonPreview(currentRows, standingsRows, seasonMeta, fallbackLabel) {
    const currentBoard = document.getElementById('season-current-board');
    const historyWrap = document.getElementById('season-history-wrap');
    const historyBoard = document.getElementById('season-history-board');
    if (!currentBoard || !historyWrap || !historyBoard) return;
    seasonCurrentRows = Array.isArray(currentRows) ? currentRows.slice() : [];
    seasonStandingsRows = Array.isArray(standingsRows) ? standingsRows.slice() : [];
    const ended = seasonStandingsRows.filter((s) => s && !s.isActive);
    seasonHistoryCount = ended.length;
    if (seasonHistoryCount === 0) {
      seasonHistoryOpen = false;
      seasonStandingsHistoryExpanded = false;
    }
    if (seasonCurrentRows.length <= 3 && seasonCurrentExpanded) seasonCurrentExpanded = false;
    if (ended.length <= 3 && seasonStandingsHistoryExpanded) seasonStandingsHistoryExpanded = false;

    const currentSeasonLabel =
      seasonMeta && typeof seasonMeta.label === 'string' && seasonMeta.label.trim()
        ? seasonMeta.label.trim()
        : typeof fallbackLabel === 'string' && fallbackLabel.trim()
          ? fallbackLabel.trim()
          : 'Current season';
    const currentStartsAt =
      seasonMeta && Number.isFinite(Number(seasonMeta.startsAt)) ? Number(seasonMeta.startsAt) : 0;
    const currentEndsAt =
      seasonMeta && Number.isFinite(Number(seasonMeta.endsAt)) ? Number(seasonMeta.endsAt) : 0;
    const currentStartsLabel =
      currentStartsAt > 0 ? new Date(currentStartsAt * 1000).toLocaleDateString() : 'N/A';
    const currentEndsLabel =
      currentEndsAt > 0 ? new Date(currentEndsAt * 1000).toLocaleDateString() : 'N/A';

    historyWrap.classList.toggle('is-collapsed', !seasonHistoryOpen);

    currentBoard.innerHTML = renderSeasonCardMarkup(
      escapeHtml(currentSeasonLabel),
      'Active',
      'season-card--active',
      `${escapeHtml(currentStartsLabel)} → ${escapeHtml(currentEndsLabel)}`,
      seasonCurrentRows,
      seasonCurrentExpanded,
      'season-roster-extra-current',
    );

    if (!seasonHistoryOpen) {
      historyBoard.innerHTML =
        '<p class="season-empty mono muted">Tap <strong>Past seasons</strong> above to view archived ladders.</p>';
    } else if (!ended.length) {
      historyBoard.innerHTML =
        '<h3 class="season-history-heading">Past seasons</h3><p class="season-empty mono muted">No completed seasons recorded yet.</p>';
    } else {
      const topSeasons = ended.slice(0, 3);
      const restSeasons = ended.slice(3);
      const renderEnded = (s) => {
        const label = escapeHtml(String((s && s.label) || `Season ${Number((s && s.id) || 0)}`));
        const startsAt = Number((s && s.startsAt) || 0);
        const endsAt = Number((s && s.endsAt) || 0);
        const startsLabel = startsAt > 0 ? new Date(startsAt * 1000).toLocaleDateString() : 'N/A';
        const endsLabel = endsAt > 0 ? new Date(endsAt * 1000).toLocaleDateString() : 'N/A';
        const leaders = Array.isArray(s && s.leaders) ? s.leaders : [];
        const seasonId = Number((s && s.id) || 0);
        return renderSeasonCardMarkup(
          label,
          'Ended',
          'season-card--ended',
          `${escapeHtml(startsLabel)} → ${escapeHtml(endsLabel)}`,
          leaders,
          true,
          `season-roster-ended-${seasonId}`,
        );
      };
      const topHtml = topSeasons.map(renderEnded).join('');
      const restHtml =
        restSeasons.length > 0
          ? `<div id="season-history-extra-panel" class="finds-collapse-panel season-history-extra-panel${
              seasonStandingsHistoryExpanded ? '' : ' is-collapsed'
            }"><div class="finds-collapse-panel-inner season-history-stack">${restSeasons
              .map(renderEnded)
              .join('')}</div></div>`
          : '';
      historyBoard.innerHTML =
        `<h3 class="season-history-heading">Past seasons <span class="season-history-count mono">${ended.length}</span></h3>` +
        topHtml +
        restHtml;
    }

    if (seasonCurrentExpandEl) {
      const canExpandCurrent = seasonCurrentRows.length > 3;
      seasonCurrentExpandEl.classList.toggle('hidden', !canExpandCurrent);
      seasonCurrentExpandEl.classList.toggle('is-open', seasonCurrentExpanded);
      seasonCurrentExpandEl.setAttribute('aria-expanded', seasonCurrentExpanded ? 'true' : 'false');
      seasonCurrentExpandEl.setAttribute('aria-controls', 'season-roster-extra-current');
      const scopeEl = seasonCurrentExpandEl.querySelector('.finds-strip-scope');
      if (scopeEl) {
        scopeEl.textContent = seasonCurrentExpanded ? '(showing all)' : '(top 3)';
      }
    }

    if (seasonHistoryToggleEl) {
      seasonHistoryToggleEl.classList.toggle('hidden', seasonHistoryCount <= 0);
      seasonHistoryToggleEl.classList.toggle('is-open', seasonHistoryOpen);
      seasonHistoryToggleEl.setAttribute('aria-expanded', seasonHistoryOpen ? 'true' : 'false');
    }
    if (seasonHistoryCountEl) seasonHistoryCountEl.textContent = String(seasonHistoryCount);

    if (seasonHistoryExpandEl) {
      const canExpandHistory = seasonHistoryCount > 3;
      seasonHistoryExpandEl.classList.toggle('hidden', !seasonHistoryOpen || !canExpandHistory);
      seasonHistoryExpandEl.classList.toggle('is-open', seasonStandingsHistoryExpanded);
      seasonHistoryExpandEl.setAttribute('aria-expanded', seasonStandingsHistoryExpanded ? 'true' : 'false');
      seasonHistoryExpandEl.setAttribute('aria-controls', 'season-history-extra-panel');
      const scopeEl = seasonHistoryExpandEl.querySelector('.finds-strip-scope');
      if (scopeEl) {
        scopeEl.textContent = seasonStandingsHistoryExpanded ? '(showing all)' : '(latest 3)';
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
      const dotClass = p.online ? 'dot dot--online' : 'dot dot--offline';
      const dotTitle = p.online ? 'Online' : 'Offline';
      const timerCell = p.online
        ? `<span class="timer-line">${escapeHtml(p.nextHuman)}</span>`
        : '<span class="timer-offline-tag">Offline</span>';
      tr.innerHTML = `
        <td class="mono" style="opacity:0.55">${i + 1}</td>
        <td><span class="player-presence player-presence--dot-left"><span class="${dotClass}" title="${dotTitle}" aria-hidden="true"></span><strong class="player-presence__name" style="color:#fff">${escapeHtml(p.name)}</strong></span></td>
        <td class="lv">${p.level}</td>
        <td class="hide-sm" style="opacity:0.85">${escapeHtml(p.class)}</td>
        <td class="timer">${timerCell}</td>`;
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

  function escapeRegex(s) {
    return String(s || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  function normalizeName(s) {
    return String(s || '').trim().toLowerCase();
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
    const sinceTs = Number(d && d.offlineSinceTs);
    const hasSince = Number.isFinite(sinceTs) && sinceTs > 0;
    const sinceLabel = hasSince ? new Date(sinceTs * 1000).toLocaleString() : null;
    const reason = String((d && d.offlineReason) || '').trim().toLowerCase();
    let sessionHint = '';
    if (d && d.sessionOpen) {
      if (reason === 'part') {
        sessionHint = 'Left the game channel (PART). Rejoin the game channel to resume automatically.';
      } else if (reason === 'quit' || reason === 'netsplit') {
        sessionHint = 'IRC disconnected (QUIT/netsplit). Rejoin the game channel to resume automatically.';
      } else {
        sessionHint = 'Session paused. Rejoin the game channel to resume automatically.';
      }
    } else if (reason === 'logout') {
      sessionHint = 'Logged out from this hero. LOGIN is required again. If you are already in channel, send LOGIN by private message.';
    } else if (reason === 'kick') {
      sessionHint = 'Kicked from the game channel. Rejoin the channel, then LOGIN again by private message.';
    } else if (reason === 'admin_forcelogout') {
      sessionHint = 'Session closed by an admin command. LOGIN is required again.';
    } else if (reason === 'admin_resetpass') {
      sessionHint = 'Password was reset by admin and session was closed. Use the new password to LOGIN again.';
    } else {
      sessionHint = 'No active IRC session. If you are in channel, send LOGIN by private message; otherwise join the game channel first.';
    }
    return (
      'Offline' +
      (sinceLabel ? ` <span class="muted mono">(since ${escapeHtml(sinceLabel)})</span>` : '') +
      `<br><span class="muted" style="display:inline-block;margin-top:0.35rem;font-size:0.78rem;line-height:1.4">${escapeHtml(sessionHint)}</span>`
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

  function parseSignedDurationEffectSec(detail) {
    const src = normalizeLegacyDurationText(String(detail || ''));
    const re = /([+-])\s*(?:(\d+)d)?\s*(?:(\d+)h)?\s*(?:(\d+)m)?\s*(?:(\d+)s)?/gi;
    let m;
    let effect = 0;
    while ((m = re.exec(src)) !== null) {
      const d = Number(m[2] || 0);
      const h = Number(m[3] || 0);
      const mm = Number(m[4] || 0);
      const s = Number(m[5] || 0);
      const sec = d * 86400 + h * 3600 + mm * 60 + s;
      if (sec <= 0) continue;
      // "-" on timer means a gain (positive trend), "+" means loss.
      effect += m[1] === '-' ? sec : -sec;
    }
    return effect;
  }

  function parseHeroSignedDurationEffectSec(detail, heroName) {
    const hero = String(heroName || '').trim();
    if (!hero) return parseSignedDurationEffectSec(detail);
    const src = normalizeLegacyDurationText(String(detail || ''));
    const re = new RegExp(
      `(^|[^\\w])${escapeRegex(hero)}([^\\w]|$)\\s*([+-])\\s*(?:(\\d+)d)?\\s*(?:(\\d+)h)?\\s*(?:(\\d+)m)?\\s*(?:(\\d+)s)?`,
      'gi',
    );
    let m;
    let effect = 0;
    while ((m = re.exec(src)) !== null) {
      const d = Number(m[4] || 0);
      const h = Number(m[5] || 0);
      const mm = Number(m[6] || 0);
      const s = Number(m[7] || 0);
      const sec = d * 86400 + h * 3600 + mm * 60 + s;
      if (sec <= 0) continue;
      effect += m[3] === '-' ? sec : -sec;
    }
    return effect;
  }

  function parseDuelMeta(event, heroName) {
    const hero = normalizeName(heroName);
    if (!hero) return null;
    const kind = String((event && event.kind) || '').toLowerCase();
    const src = normalizeLegacyDurationText(String((event && event.detail) || '')).trim();
    if (!src) return null;
    const defeated = src.match(/^(.+?)\s+defeated\s+(.+)$/i);
    if (defeated) {
      const a = String(defeated[1] || '').trim();
      const b = String(defeated[2] || '').trim();
      const aNorm = normalizeName(a);
      const bNorm = normalizeName(b);
      if (aNorm === hero) return { opponent: b, result: 'win' };
      if (bNorm === hero) return { opponent: a, result: 'loss' };
      return null;
    }
    const timed = src.match(
      /^(.+?)\s+[+-]\s*(?:(?:\d+)d\s*)?(?:(?:\d+)h\s*)?(?:(?:\d+)m\s*)?(?:(?:\d+)s\s*)?\s+vs\s+(.+)$/i,
    );
    if (!timed) return null;
    const actor = String(timed[1] || '').trim();
    const opponent = String(timed[2] || '').trim();
    const actorNorm = normalizeName(actor);
    const opponentNorm = normalizeName(opponent);
    if (actorNorm === hero) {
      if (kind === 'duel_win') return { opponent, result: 'win' };
      if (kind === 'duel_lose') return { opponent, result: 'loss' };
      return { opponent, result: null };
    }
    if (opponentNorm === hero) {
      if (kind === 'duel_win') return { opponent: actor, result: 'loss' };
      if (kind === 'duel_lose') return { opponent: actor, result: 'win' };
      return { opponent: actor, result: null };
    }
    return null;
  }

  function summarizeDuelToday(recentFinds, heroName) {
    if (!Array.isArray(recentFinds) || !recentFinds.length) return { wins: 0, losses: 0, rivals: [] };
    const dayStartSec = Math.floor(new Date().setHours(0, 0, 0, 0) / 1000);
    let wins = 0;
    let losses = 0;
    const rivals = new Set();
    for (const e of recentFinds) {
      const ts = Number((e && e.ts) || 0);
      if (!Number.isFinite(ts) || ts < dayStartSec) continue;
      const duel = parseDuelMeta(e, heroName);
      if (!duel || !duel.opponent) continue;
      if (duel.result === 'win') wins += 1;
      if (duel.result === 'loss') losses += 1;
      rivals.add(duel.opponent);
    }
    return { wins, losses, rivals: Array.from(rivals).slice(0, 3) };
  }

  function isPrimaryHeroDuelEntry(event, heroName) {
    const hero = normalizeName(heroName);
    if (!hero) return true;
    const kind = String((event && event.kind) || '').toLowerCase();
    if (kind !== 'duel_win' && kind !== 'duel_lose') return true;
    const src = normalizeLegacyDurationText(String((event && event.detail) || '')).trim();
    const timed = src.match(
      /^(.+?)\s+[+-]\s*(?:(?:\d+)d\s*)?(?:(?:\d+)h\s*)?(?:(?:\d+)m\s*)?(?:(?:\d+)s\s*)?\s+vs\s+(.+)$/i,
    );
    if (!timed) return true;
    const actor = String(timed[1] || '').trim();
    return normalizeName(actor) === hero;
  }

  function extractTrendPoints(recentFinds, heroName) {
    if (!Array.isArray(recentFinds) || !recentFinds.length) return [];
    const dayStartMs = new Date().setHours(0, 0, 0, 0);
    const dayStartSec = Math.floor(dayStartMs / 1000);
    const out = [];
    for (const e of recentFinds) {
      const ts = Number((e && e.ts) || 0);
      if (!Number.isFinite(ts) || ts < dayStartSec) continue;
      const apiEffect = Number((e && e.heroEffectSec) || 0);
      const effectSec =
        Number.isFinite(apiEffect) && apiEffect !== 0
          ? apiEffect
          : parseHeroSignedDurationEffectSec(e && e.detail, heroName);
      if (effectSec === 0) continue;
      const duel = parseDuelMeta(e, heroName);
      out.push({
        effectSec,
        kind: chronicleKindLabel((e && e.kind) || ''),
        ts,
        duelOpponent: duel && duel.opponent ? duel.opponent : '',
        duelResult: duel && duel.result ? duel.result : '',
      });
    }
    return out.reverse();
  }

  function summarizeTodayKinds(recentFinds, maxItems = 4) {
    if (!Array.isArray(recentFinds) || !recentFinds.length) return '';
    const dayStartMs = new Date().setHours(0, 0, 0, 0);
    const dayStartSec = Math.floor(dayStartMs / 1000);
    const counts = new Map();
    for (const e of recentFinds) {
      const ts = Number((e && e.ts) || 0);
      if (!Number.isFinite(ts) || ts < dayStartSec) continue;
      const label = chronicleKindLabel((e && e.kind) || 'event');
      counts.set(label, (counts.get(label) || 0) + 1);
    }
    if (!counts.size) return '';
    return Array.from(counts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, maxItems)
      .map(([label, count]) => `${label} x${count}`)
      .join(' · ');
  }

  function formatHeroTrend(d) {
    const points = extractTrendPoints(d && d.recentFinds, d && d.name);
    const allToday = Array.isArray(d && d.recentFinds)
      ? d.recentFinds.filter((e) => {
          const ts = Number((e && e.ts) || 0);
          if (!Number.isFinite(ts)) return false;
          const dayStartSec = Math.floor(new Date().setHours(0, 0, 0, 0) / 1000);
          return ts >= dayStartSec;
        }).length
      : 0;
    const streakSec = Math.max(0, Number((d && d.idleStreakSec) || 0));
    const streakHuman = formatDurationSec(streakSec);
    const eventMix = summarizeTodayKinds(d && d.recentFinds);
    const duelToday = summarizeDuelToday(d && d.recentFinds, d && d.name);
    const streakRewards = Math.max(0, Number((d && d.streakRewardCount) || 0));
    const duelWins = Math.max(0, Number((d && d.duelWins) || 0));
    const gauntletWins = Math.max(0, Number((d && d.gauntletWins) || 0));
    const prestigeRank = Math.max(0, Number((d && d.prestigeRank) || 0));
    const seasonTier = Math.max(0, Number((d && d.season && d.season.level) || 0));
    const seasonXp = Math.max(0, Number((d && d.season && d.season.xp) || 0));
    const trendMeta = `Idle streak: ${streakHuman} · Signed events: ${points.length} · Total events today: ${allToday}`;
    const trendKpis = [
      `Streak rewards: ${streakRewards}`,
      `Arena wins: ${duelWins}`,
      `Gauntlet wins: ${gauntletWins}`,
      `Prestige rank: ${prestigeRank}`,
      `Season tier: ${seasonTier}`,
      `Season XP: ${seasonXp}`,
    ];
    if (duelToday.wins + duelToday.losses > 0) {
      trendKpis.push(`Duel today W/L: ${duelToday.wins}/${duelToday.losses}`);
    }
    if (duelToday.rivals.length > 0) {
      trendKpis.push(`Rivals: ${duelToday.rivals.join(', ')}`);
    }
    if (!points.length) {
      return `<div>
        <p class="muted" style="margin:0.6rem 0 0;font-size:0.8rem">Timer trend for today unavailable yet — no signed gain/loss events today.</p>
        <p class="mono muted-strong" style="margin:0.45rem 0 0;font-size:0.74rem">${escapeHtml(trendMeta)}${eventMix ? ` · event mix: ${escapeHtml(eventMix)}` : ''}</p>
        <div class="stats-tags recent-ledger-highlights" style="margin-top:0.45rem;">${trendKpis.map((chip) => `<span>${escapeHtml(chip)}</span>`).join('')}</div>
      </div>`;
    }
    const net = points.reduce((acc, p) => acc + p.effectSec, 0);
    const maxAbs = Math.max(...points.map((p) => Math.abs(p.effectSec)), 1);
    const bars = points
      .map((p) => {
        const gain = p.effectSec > 0;
        const h = Math.max(10, Math.round((Math.abs(p.effectSec) / maxAbs) * 100));
        const sign = gain ? '-' : '+';
        const duelTip = p.duelOpponent
          ? ` · vs ${p.duelOpponent}${p.duelResult ? ` · ${p.duelResult.toUpperCase()}` : ''}`
          : '';
        const tip = `${sign}${formatDurationSec(Math.abs(p.effectSec))} · ${p.kind}${duelTip}${p.ts > 0 ? ` · ${formatAgoSec(p.ts)} ago` : ''}`;
        return `<span class="trend-bar ${gain ? 'trend-bar--gain' : 'trend-bar--loss'}" style="height:${h}%" title="${escapeHtml(tip)}"></span>`;
      })
      .join('');
    // `net` is positive when the hero gained progress (timer reduced).
    // Convert to timer-delta semantics for user-facing signs.
    const timerDelta = -net;
    const netAbs = formatDurationSec(Math.abs(timerDelta));
    const netSign = timerDelta > 0 ? '+' : timerDelta < 0 ? '-' : '±';
    const netCls = timerDelta < 0 ? 'trend-net--gain' : timerDelta > 0 ? 'trend-net--loss' : 'trend-net--flat';
    return `<div class="trend-strip">
      <div class="trend-head">
        <span class="trend-title">Timer trend for today</span>
        <span class="trend-net ${netCls} mono">Net timer ${netSign}${netAbs}</span>
      </div>
      <div class="trend-bars" role="img" aria-label="Today timer trend bars. Green is timer down, red is timer up.">${bars}</div>
      <p class="mono muted-strong" style="margin:0.45rem 0 0;font-size:0.74rem">${escapeHtml(trendMeta)}${eventMix ? ` · event mix: ${escapeHtml(eventMix)}` : ''}</p>
      <div class="stats-tags recent-ledger-highlights" style="margin-top:0.45rem;">${trendKpis.map((chip) => `<span>${escapeHtml(chip)}</span>`).join('')}</div>
    </div>`;
  }

  function formatRecentLedgerHighlights(d) {
    const streakSec = Math.max(0, Number((d && d.idleStreakSec) || 0));
    const streakRewards = Math.max(0, Number((d && d.streakRewardCount) || 0));
    const duelWins = Math.max(0, Number((d && d.duelWins) || 0));
    const gauntletWins = Math.max(0, Number((d && d.gauntletWins) || 0));
    const prestigeRank = Math.max(0, Number((d && d.prestigeRank) || 0));
    const prestigePoints = Math.max(0, Number((d && d.prestigePoints) || 0));
    const seasonXp = Math.max(0, Number((d && d.season && d.season.xp) || 0));
    const seasonTier = Math.max(0, Number((d && d.season && d.season.level) || 0));
    const chips = [
      `Idle streak: ${formatDurationSec(streakSec)}`,
      `Streak rewards: ${streakRewards}`,
      `Arena wins: ${duelWins}`,
      `Gauntlet wins: ${gauntletWins}`,
      `Prestige: rank ${prestigeRank} / ${prestigePoints} pt`,
      `Season: tier ${seasonTier} / XP ${seasonXp}`,
    ];
    return `<div class="stats-tags recent-ledger-highlights">${chips.map((chip) => `<span>${escapeHtml(chip)}</span>`).join('')}</div>`;
  }

  function formatSeasonHistory(d) {
    const rows = Array.isArray(d && d.seasonHistory) ? d.seasonHistory.slice(0, 6) : [];
    if (!rows.length) {
      return '<p class="muted" style="margin:0.4rem 0 0;font-size:0.8rem">No past seasons recorded for this hero yet.</p>';
    }
    const items = rows
      .map((s) => {
        const endTs = Number((s && s.endsAt) || 0);
        const endLabel = endTs > 0 ? new Date(endTs * 1000).toLocaleDateString() : 'N/A';
        const label = String((s && s.label) || `Season #${Number((s && s.id) || 0)}`);
        const level = Number((s && s.level) || 0);
        const xp = Number((s && s.xp) || 0);
        return `<li><strong>${escapeHtml(label)}</strong> · Tier ${level} · XP ${xp} · ended ${escapeHtml(endLabel)}</li>`;
      })
      ;
    if (items.length <= 3) {
      return `<ul class="rules-list">${items.join('')}</ul>`;
    }
    const topItems = items.slice(0, 3).join('');
    const extraItems = items.slice(3).join('');
    return `<div class="finds-strip">
      <button type="button" class="finds-strip-toggle${seasonHistoryExpanded ? ' is-open' : ''}" data-season-toggle="1" aria-expanded="${seasonHistoryExpanded ? 'true' : 'false'}" aria-controls="season-history-panel">
        <span class="finds-chevron" aria-hidden="true"></span>
        <span class="finds-strip-label">Season history <span class="finds-strip-scope">${seasonHistoryExpanded ? '(expanded)' : '(showing 3 / expand)'}</span></span>
        <span class="finds-count mono">${items.length}</span>
      </button>
      <ul class="rules-list">${topItems}</ul>
      <div id="season-history-panel" class="finds-collapse-panel season-history-panel${seasonHistoryExpanded ? '' : ' is-collapsed'}">
        <div class="finds-collapse-panel-inner">
          <ul class="rules-list">${extraItems}</ul>
        </div>
      </div>
    </div>`;
  }

  function formatRecentFinds(d) {
    const raw = d.recentFinds;
    const highlights = formatRecentLedgerHighlights(d);
    if (!Array.isArray(raw) || raw.length === 0) {
      return `<div class="finds-strip">
      <button type="button" class="finds-strip-toggle${heroLedgerExpanded ? ' is-open' : ''}" aria-expanded="${heroLedgerExpanded ? 'true' : 'false'}" aria-controls="finds-ledger-panel">
        <span class="finds-chevron" aria-hidden="true"></span>
        <span class="finds-strip-label">Recent ledger <span class="finds-strip-scope">(this hero, last 0)</span></span>
        <span class="finds-count mono">0</span>
      </button>
      <div class="finds-list-wrap finds-collapse-panel${heroLedgerExpanded ? '' : ' is-collapsed'}" id="finds-ledger-panel">
        <div class="finds-collapse-panel-inner">
          ${highlights}
          <p class="muted" style="margin:0.45rem 0 0;font-size:0.8rem">No hero-scoped ledger lines yet for today.</p>
        </div>
      </div>
    </div>`;
    }
    const filteredRaw = raw.filter((e) => isPrimaryHeroDuelEntry(e, d && d.name));
    if (!filteredRaw.length) {
      return `<div class="finds-strip">
      <button type="button" class="finds-strip-toggle${heroLedgerExpanded ? ' is-open' : ''}" aria-expanded="${heroLedgerExpanded ? 'true' : 'false'}" aria-controls="finds-ledger-panel">
        <span class="finds-chevron" aria-hidden="true"></span>
        <span class="finds-strip-label">Recent ledger <span class="finds-strip-scope">(this hero, last 0)</span></span>
        <span class="finds-count mono">0</span>
      </button>
      <div class="finds-list-wrap finds-collapse-panel${heroLedgerExpanded ? '' : ' is-collapsed'}" id="finds-ledger-panel">
        <div class="finds-collapse-panel-inner">
          ${highlights}
          <p class="muted" style="margin:0.45rem 0 0;font-size:0.8rem">No hero-scoped ledger lines yet for today.</p>
        </div>
      </div>
    </div>`;
    }
    const view = filteredRaw.slice(0, 15);
    const n = view.length;
    const items = view
      .map((e) => {
        const kindLabel = chronicleKindLabel(e.kind || '');
        const safeKind = realmEventKindClass(e.kind);
        const ago = formatAgoSec(e.ts);
        const detailText = normalizeLegacyDurationText((e.detail || '').trim() || '—');
        const det = escapeHtml(detailText);
        return `<li class="finds-item finds-item--${safeKind}"><span class="finds-kind">${escapeHtml(kindLabel)}</span><span class="finds-detail">${det}</span><span class="finds-ago">${ago} ago</span></li>`;
      })
      .join('');
    return `<div class="finds-strip">
      <button type="button" class="finds-strip-toggle${heroLedgerExpanded ? ' is-open' : ''}" aria-expanded="${heroLedgerExpanded ? 'true' : 'false'}" aria-controls="finds-ledger-panel">
        <span class="finds-chevron" aria-hidden="true"></span>
        <span class="finds-strip-label">Recent ledger <span class="finds-strip-scope">(this hero, last 15)</span></span>
        <span class="finds-count mono">${n}</span>
      </button>
      <div class="finds-list-wrap finds-collapse-panel${heroLedgerExpanded ? '' : ' is-collapsed'}" id="finds-ledger-panel">
        <div class="finds-collapse-panel-inner">
          ${highlights}
          <ul class="finds-list">${items}</ul>
        </div>
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

  /** Bring the hero sheet panel into view (used after map marker clicks once data is loaded). */
  function scrollHeroSheetIntoView() {
    if (!detail) return;
    const prefersReduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const behavior = prefersReduced ? 'auto' : 'smooth';
    window.requestAnimationFrame(() => {
      if (!detail) return;
      const y = detail.getBoundingClientRect().top + window.scrollY;
      window.scrollTo({ top: Math.max(0, y - 12), left: 0, behavior });
    });
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
        scheduleRealmAtlasRender(rows, lastRealmPulse, null);
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
      const streakSec = d.idleStreakSec != null ? Number(d.idleStreakSec) : 0;
      const streakRewards = d.streakRewardCount != null ? Number(d.streakRewardCount) : 0;
      const streakHuman = Number.isFinite(streakSec) ? formatDurationSec(Math.max(0, streakSec)) : '0s';
      const guildLabel = d.guild && d.guild.tag ? `[${d.guild.tag}] ${d.guild.name || ''}`.trim() : 'None';
      const relicLabel = d.activeRelic ? String(d.activeRelic) : 'None';
      const seasonLabel = d.season && d.season.label ? `${d.season.label} · XP ${d.season.xp || 0}` : 'N/A';
      const systems = d.systems && typeof d.systems === 'object' ? d.systems : {};
      const cooldowns = systems.cooldowns && typeof systems.cooldowns === 'object' ? systems.cooldowns : {};
      const cdOmen = Number(cooldowns.omenLeftSec || 0);
      const cdDuel = Number(cooldowns.duelLeftSec || 0);
      const cdGauntlet = Number(cooldowns.gauntletLeftSec || 0);
      const cooldownLabel = [
        cdOmen > 0 ? `omen ${formatDurationSec(cdOmen)}` : 'omen ready',
        cdDuel > 0 ? `duel ${formatDurationSec(cdDuel)}` : 'duel ready',
        cdGauntlet > 0 ? `gauntlet ${formatDurationSec(cdGauntlet)}` : 'gauntlet ready',
      ].join(' · ');
      const bounty = systems.bounty && typeof systems.bounty === 'object' ? systems.bounty : null;
      let bountyLabel = 'N/A';
      if (bounty) {
        const progress = Number(bounty.progressSec || 0);
        const target = Math.max(1, Number(bounty.targetSec || 1));
        const reward = Math.max(1, Number(bounty.rewardSec || 1));
        const quietLeft = Math.max(0, Number(bounty.quietLeftSec || 0));
        const claimedToday = bounty.claimedToday === true;
        const ready = String(bounty.state || '') === 'ready';
        const state = claimedToday ? 'claimed today' : ready ? 'ready' : 'in progress';
        const quietPart = quietLeft > 0 ? ` · quiet ${formatDurationSec(quietLeft)}` : '';
        bountyLabel = `${formatDurationSec(progress)} / ${formatDurationSec(target)} · reward -${formatDurationSec(reward)} · ${state}${quietPart}`;
      }
      const features = systems.features && typeof systems.features === 'object' ? systems.features : {};
      const activeSystems = Object.entries({
        dailyTrial: features.dailyTrialEnabled === true,
        streak: features.streakEnabled === true,
        bounty: features.bountyEnabled === true,
        season: features.seasonEnabled === true,
        worldBoss: features.worldBossEnabled === true,
        guild: features.guildEnabled === true,
        relic: features.relicEnabled === true,
        prestige: features.prestigeEnabled === true,
      })
        .filter(([, on]) => on)
        .map(([k]) => k)
        .join(' · ');
      const createdAtLabel =
        Number.isFinite(Number(d.createdAt)) && Number(d.createdAt) > 0
          ? new Date(Number(d.createdAt) * 1000).toLocaleDateString()
          : 'N/A';
      detailWrite(`
        <div class="detail-name">${escapeHtml(d.name)}</div>
        <p class="detail-sub">L<span class="mono" style="color:var(--arc)">${d.level}</span> · ${escapeHtml(d.class)}</p>
        <div class="dl-grid">
          <div class="dl-item"><dt>Level timer</dt><dd class="arc">${escapeHtml(d.nextHuman)}</dd></div>
          <div class="dl-item"><dt>Created</dt><dd>${escapeHtml(createdAtLabel)}</dd></div>
          <div class="dl-item"><dt>Total idle</dt><dd>${escapeHtml(String(d.idledHours))} h</dd></div>
          <div class="dl-item"><dt>Status</dt><dd>${formatStatus(d)}</dd></div>
          <div class="dl-item"><dt>Alignment</dt><dd>${escapeHtml(formatAlignment(d.alignment))}</dd></div>
          <div class="dl-item"><dt>Arena</dt><dd>${dw} duel win${dw === 1 ? '' : 's'}</dd></div>
          <div class="dl-item"><dt>Gauntlet</dt><dd>${gw} win${gw === 1 ? '' : 's'}</dd></div>
          <div class="dl-item"><dt>Idle streak</dt><dd>${escapeHtml(streakHuman)}</dd></div>
          <div class="dl-item"><dt>Streak rewards</dt><dd>${streakRewards}</dd></div>
          <div class="dl-item"><dt>Guild</dt><dd>${escapeHtml(guildLabel)}</dd></div>
          <div class="dl-item"><dt>Prestige</dt><dd>Rank ${Number(d.prestigeRank || 0)} · points ${Number(d.prestigePoints || 0)}</dd></div>
          <div class="dl-item"><dt>Relic</dt><dd>${escapeHtml(relicLabel)}</dd></div>
          <div class="dl-item"><dt>Season</dt><dd>${escapeHtml(seasonLabel)}</dd></div>
          <div class="dl-item"><dt>Bounty</dt><dd>${escapeHtml(bountyLabel)}</dd></div>
          <div class="dl-item"><dt>Cooldowns</dt><dd>${escapeHtml(cooldownLabel)}</dd></div>
          <div class="dl-item"><dt>Active systems</dt><dd>${escapeHtml(activeSystems || 'base only')}</dd></div>
          ${charmRow}
        </div>
        <div class="stats-label">Medals</div>
        ${formatMedalsList(d)}
        ${formatHeroTrend(d)}
        ${formatRecentFinds(d)}
        <div class="stats-label">Season history</div>
        ${formatSeasonHistory(d)}
        <div class="stats-label">Penalties (seconds)</div>
        <div class="stats-tags">${stats}</div>`);
      if (gen !== detailFetchGen) return;
      scheduleRealmAtlasRender(rows, lastRealmPulse, selName);
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

  async function refresh() {
    setLedgerSyncBusy(true);
    try {
      const {
        players,
        generatedAt,
        botOnline,
        botLastSeenMs,
        aiEnabled,
        realmPulse,
        season,
        seasonMeta,
        worldBoss,
        guildsPreview,
        seasonPreview,
        seasonStandings,
      } = await fetchLb();
      rows = players;
      lastRealmPulse = realmPulse;
      setLastUpdated(generatedAt);
      setBotStatus(botOnline, botLastSeenMs, aiEnabled);
      setRealmPulse(realmPulse);
      setSeasonBanner(season);
      setSeasonPreviewMeta(seasonMeta, season);
      setWorldBossBanner(worldBoss);
      setGuildPreview(guildsPreview);
      const standingsRows = Array.isArray(seasonStandings) && seasonStandings.length ? seasonStandings : [];
      seasonCurrentMeta = seasonMeta || null;
      seasonCurrentLabel = season || null;
      setSeasonPreview(seasonPreview, standingsRows, seasonMeta, season);
      setErr(null);
      applyFilter();
      scheduleRealmAtlasRender(rows, realmPulse, selName);
      if (selName) openPlayer(selName);
      try {
        chronicleBeforeId = null;
        const events = await fetchChronicle();
        renderChronicle(events);
      } catch {
        if (chroniclePlaceholder) {
          chroniclePlaceholder.textContent =
            'Chronicle offline — open api/chronicle.php in the browser to troubleshoot.';
          chroniclePlaceholder.classList.remove('hidden');
          if (chronicleCollapsible) chronicleCollapsible.classList.add('hidden');
          if (chronicleList) {
            chronicleList.innerHTML = '';
          }
          if (chronicleListWrap) chronicleListWrap.classList.add('is-collapsed');
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
      setLedgerSyncBusy(false);
    }
  }

  async function forceRefreshNow() {
    if (refreshInFlight) return;
    refreshInFlight = true;
    try {
      await refresh();
      countdown = REFRESH_SEC;
      updateCountdownDisplay();
    } finally {
      refreshInFlight = false;
      clearCountdownSecondTimer();
      scheduleCountdownSecondTick();
    }
  }

  qEl.addEventListener('input', applyFilter);
  if (chronicleApplyEl) {
    chronicleApplyEl.addEventListener('click', async () => {
      try {
        chronicleBeforeId = null;
        const events = await fetchChronicle();
        renderChronicle(events);
      } catch {
        if (chroniclePlaceholder) {
          chroniclePlaceholder.textContent = 'Chronicle filter failed — check API.';
          chroniclePlaceholder.classList.remove('hidden');
        }
      }
    });
  }

  if (detail) {
    detail.addEventListener('click', (ev) => {
      const seasonBtn = ev.target.closest('[data-season-toggle="1"]');
      if (seasonBtn && detail.contains(seasonBtn)) {
        const panel = document.getElementById('season-history-panel');
        if (!panel || !detail.contains(panel)) return;
        const willOpen = panel.classList.contains('is-collapsed');
        const scope = seasonBtn.querySelector('.finds-strip-scope');
        if (willOpen) {
          panel.classList.remove('is-collapsed');
          seasonBtn.classList.add('is-open');
          seasonBtn.setAttribute('aria-expanded', 'true');
          if (scope) scope.textContent = '(expanded)';
          seasonHistoryExpanded = true;
        } else {
          panel.classList.add('is-collapsed');
          seasonBtn.classList.remove('is-open');
          seasonBtn.setAttribute('aria-expanded', 'false');
          if (scope) scope.textContent = '(showing 3 / expand)';
          seasonHistoryExpanded = false;
        }
        return;
      }
      const btn = ev.target.closest('.finds-strip-toggle');
      if (!btn || !detail.contains(btn)) return;
      const wrap = document.getElementById('finds-ledger-panel');
      if (!wrap || !detail.contains(wrap)) return;
      const willOpen = wrap.classList.contains('is-collapsed');
      if (willOpen) {
        wrap.classList.remove('is-collapsed');
        btn.classList.add('is-open');
        btn.setAttribute('aria-expanded', 'true');
        heroLedgerExpanded = true;
      } else {
        wrap.classList.add('is-collapsed');
        btn.classList.remove('is-open');
        btn.setAttribute('aria-expanded', 'false');
        heroLedgerExpanded = false;
      }
    });
  }

  if (chronicleRoot) {
    chronicleRoot.addEventListener('click', (ev) => {
      const btn = ev.target.closest('.chronicle-strip-toggle');
      if (!btn || !chronicleRoot.contains(btn)) return;
      const wrap = document.getElementById('chronicle-list-wrap');
      if (!wrap) return;
      const willOpen = wrap.classList.contains('is-collapsed');
      if (willOpen) {
        wrap.classList.remove('is-collapsed');
        btn.classList.add('is-open');
        btn.setAttribute('aria-expanded', 'true');
        chronicleExpanded = true;
      } else {
        wrap.classList.add('is-collapsed');
        btn.classList.remove('is-open');
        btn.setAttribute('aria-expanded', 'false');
        chronicleExpanded = false;
      }
    });
  }

  if (seasonHistoryToggleEl) {
    seasonHistoryToggleEl.addEventListener('click', () => {
      seasonHistoryOpen = !seasonHistoryOpen;
      if (!seasonHistoryOpen) seasonStandingsHistoryExpanded = false;
      setSeasonPreview(seasonCurrentRows, seasonStandingsRows, seasonCurrentMeta, seasonCurrentLabel);
    });
  }
  if (seasonCurrentExpandEl) {
    seasonCurrentExpandEl.addEventListener('click', () => {
      if (seasonHistoryOpen) {
        seasonHistoryOpen = false;
        seasonStandingsHistoryExpanded = false;
        setSeasonPreview(seasonCurrentRows, seasonStandingsRows, seasonCurrentMeta, seasonCurrentLabel);
        return;
      }
      const panel = document.getElementById('season-roster-extra-current');
      if (!panel) return;
      const willOpen = panel.classList.contains('is-collapsed');
      if (willOpen) {
        panel.classList.remove('is-collapsed');
        seasonCurrentExpandEl.classList.add('is-open');
        seasonCurrentExpandEl.setAttribute('aria-expanded', 'true');
        seasonCurrentExpanded = true;
        const scope = seasonCurrentExpandEl.querySelector('.finds-strip-scope');
        if (scope) scope.textContent = '(showing all)';
      } else {
        panel.classList.add('is-collapsed');
        seasonCurrentExpandEl.classList.remove('is-open');
        seasonCurrentExpandEl.setAttribute('aria-expanded', 'false');
        seasonCurrentExpanded = false;
        const scope = seasonCurrentExpandEl.querySelector('.finds-strip-scope');
        if (scope) scope.textContent = '(top 3)';
      }
    });
  }
  if (seasonHistoryExpandEl) {
    seasonHistoryExpandEl.addEventListener('click', () => {
      if (!seasonHistoryOpen || seasonHistoryCount <= 3) return;
      const panel = document.getElementById('season-history-extra-panel');
      if (!panel) return;
      const willOpen = panel.classList.contains('is-collapsed');
      if (willOpen) {
        panel.classList.remove('is-collapsed');
        seasonHistoryExpandEl.classList.add('is-open');
        seasonHistoryExpandEl.setAttribute('aria-expanded', 'true');
        seasonStandingsHistoryExpanded = true;
        const scope = seasonHistoryExpandEl.querySelector('.finds-strip-scope');
        if (scope) scope.textContent = '(showing all)';
      } else {
        panel.classList.add('is-collapsed');
        seasonHistoryExpandEl.classList.remove('is-open');
        seasonHistoryExpandEl.setAttribute('aria-expanded', 'false');
        seasonStandingsHistoryExpanded = false;
        const scope = seasonHistoryExpandEl.querySelector('.finds-strip-scope');
        if (scope) scope.textContent = '(latest 3)';
      }
    });
  }
  if (guildListExpandEl) {
    guildListExpandEl.addEventListener('click', () => {
      guildListExpanded = !guildListExpanded;
      setGuildPreview(guildPreviewRows);
    });
  }
  const guildBoardListEl = document.getElementById('guild-board-list');
  if (guildBoardListEl) {
    guildBoardListEl.addEventListener('click', (e) => {
      const btn = e.target.closest('.guild-card__members-toggle');
      if (!btn) return;
      const panelId = btn.getAttribute('aria-controls');
      const panel = panelId ? document.getElementById(panelId) : null;
      if (!panel) return;
      const key = btn.getAttribute('data-guild-key');
      const extra = btn.getAttribute('data-member-extra') || '0';
      const willOpen = panel.classList.contains('is-collapsed');
      if (willOpen) {
        panel.classList.remove('is-collapsed');
        btn.classList.add('is-open');
        btn.setAttribute('aria-expanded', 'true');
        if (key) guildMembersExpanded.add(key);
        const scope = btn.querySelector('.finds-strip-scope');
        if (scope) scope.textContent = '(showing all)';
      } else {
        panel.classList.add('is-collapsed');
        btn.classList.remove('is-open');
        btn.setAttribute('aria-expanded', 'false');
        if (key) guildMembersExpanded.delete(key);
        const scope = btn.querySelector('.finds-strip-scope');
        if (scope) scope.textContent = `(+${extra})`;
      }
    });
  }

  if (refreshFabEl) {
    refreshFabEl.addEventListener('click', () => {
      forceRefreshNow();
    });
  }

  function setupTreasureRulePanels() {
    const guide = document.querySelector('.treasure-guide');
    if (!guide) return;
    guide.querySelectorAll('[data-treasure-rule-toggle]').forEach((btn) => {
      const panelId = btn.getAttribute('aria-controls');
      const panel = panelId ? document.getElementById(panelId) : null;
      if (!panel || !panel.classList.contains('finds-collapse-panel')) return;
      btn.addEventListener('click', () => {
        const willOpen = panel.classList.contains('is-collapsed');
        if (willOpen) {
          panel.classList.remove('is-collapsed');
          btn.classList.add('is-open');
          btn.setAttribute('aria-expanded', 'true');
        } else {
          panel.classList.add('is-collapsed');
          btn.classList.remove('is-open');
          btn.setAttribute('aria-expanded', 'false');
        }
      });
    });
  }

  setupTreasureRulePanels();

  (async () => {
    try {
      await refresh();
      countdown = REFRESH_SEC;
    } finally {
      updateCountdownDisplay();
      scheduleCountdownSecondTick();
    }
  })();

  window.requestAnimationFrame(() => {
    const h = (location.hash || '').replace(/^#/, '').toLowerCase();
    if (h === 'realm-atlas' || h === 'worldmap') {
      document.getElementById('realm-atlas')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  });
})();
