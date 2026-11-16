/* SUNDIAL app: title that docks, scroll-driven globe, sky that follows place and time, places tray, country sheet. */
(function () {
  'use strict';
  const S = window.SUN, SKY = window.SKY, G = window.GLOBE, DATA = window.DATA, RH = window.RHYTHM, TR = window.TREND;
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const MONF = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
  const fmt = (n) => n == null ? '–' : n >= 999500 ? (n / 1e6).toFixed(1) + 'M' : n >= 9950 ? Math.round(n / 1e3) + 'k' : n >= 999.5 ? (n / 1e3).toFixed(1) + 'k' : Math.round(n) + '';   // thresholds sit at the rounding edges, so 999,600 reads 1.0M, not 1000k
  const TIER = { measured: ['Measured from this country\'s own data', 'Enough detections here to calculate the correction directly.'], blended: ['Partly borrowed calibration', 'Fewer detections here, so the correction is blended with the pooled value from similar countries.'], borrowed: ['Borrowed calibration', 'Very few detections here, so the correction uses the pooled value from other countries. Treat the details with care.'] };
  const p0 = (v) => (v == null ? 'n/a' : v.toFixed(0) + '%');
  const ymLabel = (ym) => `${MON[ym % 100 - 1]} ${Math.floor(ym / 100)}`;
  const nowUTC = () => { const d = new Date(); return d.getUTCHours() + d.getUTCMinutes() / 60; };
  const hourAt = (lon) => ((nowUTC() + lon / 15) % 24 + 24) % 24;
  const hourWord = (h) => { h = Math.floor(h) % 24; return h === 0 ? '12a' : h < 12 ? h + 'a' : h === 12 ? '12p' : (h - 12) + 'p'; };
  const ICON = {
    clock: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="8.5"/><path d="M12 7v5l3 2"/></svg>',
    cal: '<svg viewBox="0 0 24 24"><rect x="3.5" y="5" width="17" height="15" rx="3"/><path d="M3.5 10h17M8 3v4M16 3v4"/></svg>',
    chart: '<svg viewBox="0 0 24 24"><path d="M4 19V9M10 19V5M16 19v-7M22 19H2"/></svg>',
    flame: '<svg viewBox="0 0 24 24"><path d="M12 3c1 4 5 5.5 5 10a5 5 0 0 1-10 0c0-2 1-3 2-4 .3 1.5 1 2 2 2 0-3-1-5 1-8z"/></svg>',
    sat: '<svg viewBox="0 0 24 24"><path d="M4 20l6-6M9 6l3 3-3 3-3-3zM15 12l3 3-3 3-3-3zM13 8l3-3M19 14l2-2"/></svg>',
    check: '<svg viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7"/></svg>',
    down: '<svg viewBox="0 0 24 24"><path d="M12 4v11M7 11l5 5 5-5M5 20h14"/></svg>',
    warn: '<svg viewBox="0 0 24 24"><path d="M12 4l9 16H3zM12 10v4M12 17v.5"/></svg>',
    pulse: '<svg viewBox="0 0 24 24"><path d="M2 17c4 0 5-10 10-10s6 10 10 10"/><circle cx="8" cy="11" r="1.4"/><circle cx="15" cy="9.5" r="1.4"/></svg>',
    trend: '<svg viewBox="0 0 24 24"><path d="M3 17l5-5 4 3 8-9M15 6h5v5"/></svg>'
  };

  const st = { year: 2000, yearTouched: false, sheetOpen: false };
  const TITLE0 = document.title;
  let focusId = 'hero';

  /* ============ the journey: where the globe goes, and what the page looks like, for each part of the story ============
     at:   where the globe sits (fractions of the screen)       k: size       side: which side the text takes
     away: the globe slides off and fades                       form: 'flat' unfolds it into a world map
     bg:   the page colour behind this scene (see SCENE_BG)     theme: 'ink' draws the globe for a dark page */
  const FOCI = {
    hero: { layout: 'hero', lon: -45, lat: 8, auto: true, ring: 0.3 },
    explore: { layout: 'explore', lon: -40, lat: 6, auto: true, ring: 0.45 },
    cameras: { layout: 'story', at: [0.7, 0.5], lon: 22, lat: -10, k: 1.15, month: 8, ring: 0, pins: [{ lon: 17.5, lat: -12, t: 'Angola' }, { lon: 35, lat: -17, t: 'Mozambique' }], bg: 'paper', side: 'left' },
    clock: { layout: 'story', at: [0.28, 0.52], lon: 20, lat: 4, k: 1.2, ring: 1, bands: ['viirs'], bg: 'sun', side: 'right' },
    drift: { layout: 'story', at: [0.72, 0.46], lon: 40, lat: 6, k: 1.1, ring: 0.8, bands: ['terra', 'aqua', 'viirs'], bg: 'sand', side: 'left' },
    swath: { layout: 'story', at: [0.25, 0.5], lon: 28, lat: -6, k: 0.98, ring: 0.5, bands: ['terra'], pins: [{ lon: 22, lat: -26, t: 'west edge' }, { lon: 34.5, lat: -26, t: 'east edge' }], bg: 'stone', side: 'right' },
    evidence: { layout: 'story', away: true, awayDir: 1, lon: 60, lat: 6, k: 1.0, month: 9, ring: 0, pins: [], bg: 'ink', theme: 'ink', side: 'center' },
    trend: { layout: 'story', form: 'flat', lon: 12, lat: 14, month: 9, ring: 0, trend: true, pins: [], bg: 'paper', side: 'left' },   // every country painted by trend direction, on a flat map
    continuity: { layout: 'story', at: [0.26, 0.5], lon: 30, lat: 12, k: 0.92, ring: 0.5, bands: ['viirs'], month: 9, pins: [], bg: 'dusk', side: 'right' },
    tools: { layout: 'story', away: true, awayDir: -1, lon: -10, lat: 8, k: 1.0, month: 9, ring: 0, pins: [], bg: 'ink', theme: 'ink', side: 'center' }
  };
  const SCENE_BG = { paper: [243, 234, 217], sun: [249, 226, 192], sand: [237, 225, 200], stone: [226, 229, 222], dusk: [221, 229, 240], ink: [17, 14, 12] };
  G.setBandInfo((id) => {
    const y = st.year;
    if (id === 'terra') return { h: S.terraH(y), c: '255,198,90', cl: '176,104,6', label: 'TERRA' };
    if (id === 'aqua') return { h: S.aquaH(y), c: '255,106,26', cl: '200,60,8', label: 'AQUA' };
    return { h: S.VIIRS_H, c: '125,178,255', cl: '29,95,180', label: 'VIIRS' };
  });

  /* ============ title: big over the globe, then docks top right ============ */
  const title = $('#title');
  let tw = 1, th = 1, baseYear = reduce ? 1983 : 2050;
  function layoutTitle() {
    const W = innerWidth, H = innerHeight;
    title.style.fontSize = Math.min(W * 0.135, H * 0.27) + 'px';
    title.style.transform = 'none';
    tw = title.offsetWidth || 1; th = title.offsetHeight || 1;
    placeTitle();
  }
  function placeTitle() {
    const W = innerWidth, H = innerHeight, mobile = W < 860;
    tw = title.offsetWidth || tw; th = title.offsetHeight || th;
    const big = parseFloat(title.style.fontSize) || 100, small = mobile ? 16 : 21, s = small / big;
    const p = st.sheetOpen ? 1 : clamp(scrollY / (H * 0.85), 0, 1);
    const e = p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2;
    const cy = mobile ? H * 0.44 : H * 0.47;
    const x0 = (W - tw) / 2, y0 = cy - th / 2, x1 = W - tw * s - (mobile ? 16 : 30), y1 = mobile ? 15 : 22;
    title.style.transform = `translate(${x0 + (x1 - x0) * e}px,${y0 + (y1 - y0) * e}px) scale(${1 + (s - 1) * e})`;
    title.classList.toggle('docked', p > 0.95);
    const fade = st.sheetOpen ? 1 : 1 - clamp((p - 0.06) / 0.2, 0, 1);   // the title has done its job once you scroll off the title screen; it comes back inside a country
    title.style.opacity = fade < 1 ? fade.toFixed(3) : ''; title.style.pointerEvents = fade < 0.2 ? 'none' : '';
    const prog = clamp(scrollY / Math.max(1, document.documentElement.scrollHeight - H), 0, 1);
    title.style.setProperty('--year', (baseYear + (reduce ? 0 : 38 * prog)).toFixed(1));
  }

  /* ============ sky ============
     Title screen: black with distant stars. Everything after it: paper. A country sheet: black with an orange tint from one side
     that follows the local sun, and gets deeper with the time of day and wherever you point at hotter parts of the country. */
  const skyEl = $('#sky'), glowEl = $('#glow');
  const DARK = [10, 9, 8], PAPER = [243, 234, 217];
  const cur = { c: DARK.slice(), glow: 0.12, x: 90, y: 20, heat: 0 };
  let sheetCtx = null, lastSkyStr = '', lastGlowStr = '', heatTarget = 0;
  const glowAlpha = (hour, lat, month, smoke, heat) => {
    const alt = SKY.sunAlt(lat, month, hour), day = clamp(alt / 38, 0, 1), dusk = clamp((alt + 10) / 14, 0, 1) * (1 - day);
    return clamp(0.07 + 0.3 * day + 0.12 * dusk + 0.24 * smoke + 0.32 * heat, 0, 0.9);
  };
  const glowPos = (hour) => { const t = clamp((hour - 5) / 14, 0, 1); return { x: 100 - t * 100, y: 40 - 40 * Math.sin(Math.PI * t) }; };
  function skyFrame() {
    const light = document.body.classList.contains('lightpage'), sc = FOCI[focusId];
    const c = SKY.sky(G.V.lat, G.T.month, G.localHourAtCenter(), 0), base = light ? SCENE_BG[(sc && sc.bg) || 'paper'] || PAPER : DARK, k = light && !(sc && sc.bg === 'ink') ? 0.07 : 0.1;
    const tgt = SKY.mix(base, c.mid, k);
    for (let i = 0; i < 3; i++) cur.c[i] += (tgt[i] - cur.c[i]) * 0.12;
    const str = `rgb(${cur.c.map(Math.round).join(',')})`;
    if (str !== lastSkyStr) { skyEl.style.background = str; lastSkyStr = str; }
    if (sheetCtx) {
      const hour = ((G.T.utc + sheetCtx.lon / 15) % 24 + 24) % 24; sheetCtx.hourNow = hour;
      cur.heat += (heatTarget - cur.heat) * 0.08;
      const a = glowAlpha(hour, sheetCtx.lat, sheetCtx.month, sheetCtx.smoke, cur.heat), p = glowPos(hour);
      cur.glow += (a - cur.glow) * 0.1; cur.x += (p.x - cur.x) * 0.1; cur.y += (p.y - cur.y) * 0.1;
      const g = cur.glow, deep = Math.max(0, g - 0.2);
      const gs = `radial-gradient(ellipse 80% 95% at ${cur.x.toFixed(1)}% ${cur.y.toFixed(1)}%, rgba(255,106,26,${g.toFixed(3)}) 0%, rgba(224,70,12,${(g * 0.5).toFixed(3)}) 36%, rgba(120,30,6,${(deep * 0.35).toFixed(3)}) 62%, transparent 82%), ` +
        `radial-gradient(ellipse 60% 45% at ${(100 - cur.x).toFixed(1)}% 108%, rgba(150,40,8,${(0.1 + 0.3 * cur.heat).toFixed(3)}) 0%, transparent 70%), #050404`;
      if (gs !== lastGlowStr) { glowEl.style.background = gs; lastGlowStr = gs; }
    }
  }

  /* ============ embers: smoke you can see when a place is burning ============ */
  const ec = $('#embers'), ectx = ec.getContext('2d');
  let parts = [], emberDirty = false, emberLevel = 0, lastT = performance.now();
  function embersFrame(now) {
    const dt = Math.min(0.1, (now - lastT) / 1000); lastT = now;
    const want = st.sheetOpen && !reduce ? Math.round(emberLevel * 90) : 0;
    if (!want && !parts.length) { if (emberDirty) { ectx.setTransform(1, 0, 0, 1, 0, 0); ectx.clearRect(0, 0, ec.width, ec.height); emberDirty = false; } return; }   // nothing burning: leave the canvas alone
    emberDirty = true;
    const W = innerWidth, H = innerHeight, dpr = 1;
    if (ec.width !== Math.round(W * dpr) || ec.height !== Math.round(H * dpr)) { ec.width = Math.round(W * dpr); ec.height = Math.round(H * dpr); }
    ectx.setTransform(dpr, 0, 0, dpr, 0, 0); ectx.clearRect(0, 0, W, H);
    while (parts.length < want) parts.push({ x: Math.random() * W, y: H + Math.random() * 40, v: 18 + Math.random() * 46, s: 0.8 + Math.random() * 2.2, ph: Math.random() * 6.3, a: 0.2 + Math.random() * 0.5 });
    if (parts.length > want) parts.length = want;
    ectx.globalCompositeOperation = 'lighter';
    for (const p of parts) {
      p.y -= p.v * dt; p.x += Math.sin(now / 900 + p.ph) * 12 * dt;
      if (p.y < -10) { p.y = H + 10; p.x = Math.random() * W; }
      const fade = clamp(p.y / (H * 0.35), 0, 1);
      ectx.fillStyle = `rgba(255,${Math.round(120 + 90 * (1 - fade))},40,${p.a * fade})`;
      ectx.beginPath(); ectx.arc(p.x, p.y, p.s, 0, 6.3); ectx.fill();
    }
    ectx.globalCompositeOperation = 'source-over';
  }

  /* ============ the hint: a bubble out of the earth, once the title has gone, that fades as the page covers the globe ============ */
  const hintEl = $('#hint'); let hintH = 0, hintOp = -1;
  const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
  function hintFrame() {
    const H = innerHeight, W = innerWidth, p = clamp(scrollY / (H * 0.85), 0, 1), introTop = intro.getBoundingClientRect().top;
    const o = st.sheetOpen || document.body.classList.contains('loading') ? 0 : smooth(0.28, 0.4, p) * (1 - clamp((H * 0.3 - introTop) / (H * 0.18), 0, 1))   // in after the title is gone, and held until the page reaches the top of the globe;
    if (o <= 0.01) { if (hintOp !== 0) { hintEl.style.opacity = 0; hintOp = 0; } return; }
    const V = G.V, R = V.R, w = hintEl.offsetWidth; hintH = hintH || hintEl.offsetHeight;
    const x = clamp(V.cx + R * 0.18 - 16, 10, W - w - 10), y = V.cy - R * 0.6 - hintH - 10;
    hintEl.style.transform = `translate(${x.toFixed(1)}px,${y.toFixed(1)}px)`; hintEl.style.setProperty('--tail', clamp(V.cx + R * 0.18 - x, 14, w - 24).toFixed(0) + 'px');
    hintEl.style.opacity = o.toFixed(3); hintOp = o;
  }

  /* ============ frame loop for things that are not the globe ============ */
  let fAt = 0;
  function frame(now) {
    requestAnimationFrame(frame);
    if (document.hidden || now - fAt < 33) return;   // 30 fps is plenty for slow colour drifts
    fAt = now;
    skyFrame(); embersFrame(now); hintFrame();
  }

  /* ============ scroll ============ */
  addEventListener('keydown', (e) => { if (e.key === 'Tab') document.body.classList.add('kbd'); });
  addEventListener('pointerdown', () => document.body.classList.remove('kbd'));
  const jumpEl = $('#jump'); if (jumpEl && 'IntersectionObserver' in window) new IntersectionObserver((es, o) => es.forEach((en) => { if (en.isIntersecting) { jumpEl.classList.add('in'); o.disconnect(); } }), { threshold: 0.5 }).observe(jumpEl); else if (jumpEl) jumpEl.classList.add('in');
  const scenes = $$('.scene');
  scenes.forEach((sc) => { const f = FOCI[sc.id]; if (f && f.side) sc.dataset.side = f.side; if (f && f.bg) sc.dataset.bg = f.bg; });   // which side the text takes comes from the same table as the globe
  /* the dock has one dot per chapter; each fills as you read through the scenes in it */
  const GROUPS = $$('#dock a').map((a) => ({ a, key: a.dataset.for, ids: a.dataset.scenes.split(' '), p: -1, on: false }));
  const dockOf = {}; GROUPS.forEach((g) => g.ids.forEach((id) => { dockOf[id] = g.key; }));
  const closing = $('#why'), intro = $('#intro'), dockEl = $('#dock');
  const coarse = matchMedia('(hover: none)').matches;
  let peekT = 0;
  function peekDock() {   // no hover on a phone: show the labels for a moment when the chapter changes
    if (!coarse) return;
    dockEl.classList.add('peek'); clearTimeout(peekT); peekT = setTimeout(() => dockEl.classList.remove('peek'), 2200);
  }
  let latestPick = 'hero', focusT = 0;
  function commitFocus(pick) {
    focusId = pick; const f = FOCI[pick] || FOCI.hero; G.focus(f);
    document.body.dataset.form = f.away ? 'away' : f.form === 'flat' ? 'flat' : 'globe';
    if (dockOf[pick]) peekDock();
  }
  let nav = null;   // an eased jump in progress: while it runs, the globe heads straight for the destination instead of lurching past every scene
  function onScroll() {
    placeTitle();
    if (st.sheetOpen) return;
    const H = innerHeight, mid = H * 0.5, introTop = intro.getBoundingClientRect().top;
    document.body.classList.toggle('lightpage', introTop <= 0);
    document.body.classList.toggle('ink-title', introTop < 60);   // the paper band now fills the screen, so the page can safely turn white behind it
    const rects = {}; let pick = 'hero';
    for (const s of scenes) { const r = (rects[s.id] = s.getBoundingClientRect()); if (r.top <= mid && r.bottom > mid) pick = s.id; }
    if (pick === 'hero' && introTop < H * 0.2) pick = 'explore';   // while the paper band is up, the globe quietly moves to its next position behind it
    if (nav && nav.focus) pick = nav.focus;
    latestPick = pick;
    if (pick !== focusId) {   // the globe only changes between sections: wait until the scroll settles so a quick flick past a scene does not make it flinch
      if (nav) commitFocus(pick);
      else if (!focusT) focusT = setTimeout(() => { focusT = 0; if (latestPick !== focusId) commitFocus(latestPick); }, 170);
    }
    document.body.classList.toggle('on-hero', pick === 'hero');
    const line = H * 0.55;
    for (const g of GROUPS) {
      const first = rects[g.ids[0]], last = rects[g.ids[g.ids.length - 1]];
      if (first && last) { const p = clamp((line - first.top) / Math.max(1, last.bottom - first.top), 0, 1); if (Math.abs(p - g.p) > 0.002) { g.p = p; g.a.style.setProperty('--p', p.toFixed(3)); } }
      const on = g.key === dockOf[pick];
      if (on !== g.on) { g.on = on; g.a.classList.toggle('on', on); if (on) g.a.setAttribute('aria-current', 'location'); else g.a.removeAttribute('aria-current'); }
    }
    const past = closing.getBoundingClientRect().top < H * 0.4;
    if (past !== document.body.classList.contains('past-stage')) { document.body.classList.toggle('past-stage', past); past ? G.stop() : G.start(); }
    if (pick === 'drift' && !st.yearTouched) {
      const r = rects.drift;
      setYear(2000 + clamp((H * 0.35 - r.top) / (r.height - H * 0.6), 0, 1) * 26.8);
    }
  }
  addEventListener('scroll', onScroll, { passive: true });

  /* ---- eased scrolling: one smooth glide whatever the distance, and any wheel, touch or key stops it ---- */
  document.documentElement.classList.add('js-scroll');   // turns off the browser's own smooth scrolling, which fights this one
  const easeIO = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
  let glide = null;
  function stopGlide() { if (!glide) return; cancelAnimationFrame(glide.raf); glide = null; nav = null; onScroll(); }
  ['wheel', 'touchstart', 'pointerdown'].forEach((t) => addEventListener(t, stopGlide, { passive: true }));
  addEventListener('keydown', (e) => { if (['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End', ' '].includes(e.key)) stopGlide(); });
  function glideTo(y, done) {
    stopGlide();
    const from = scrollY, y1 = clamp(y, 0, document.documentElement.scrollHeight - innerHeight), dist = Math.abs(y1 - from);
    if (dist < 2) { if (done) done(); return; }
    if (reduce) { scrollTo({ top: y1, left: 0, behavior: 'instant' }); if (done) done(); return; }
    const dur = clamp(520 + dist * 0.2, 650, 1500), t0 = performance.now(), g = (glide = { raf: 0 });
    const step = (now) => {
      if (glide !== g) return;
      const t = clamp((now - t0) / dur, 0, 1);
      scrollTo({ top: from + (y1 - from) * easeIO(t), left: 0, behavior: 'instant' });
      if (t < 1) g.raf = requestAnimationFrame(step); else { glide = null; if (done) done(); }
    };
    g.raf = requestAnimationFrame(step);
  }
  /* go to a scene or any element by id. Scenes land with their card centred; forms and panels land with a little air above. */
  function goTo(id, opts) {
    const el = document.getElementById(id); if (!el) return false;
    const top = el.getBoundingClientRect().top + scrollY, isScene = !!FOCI[id];
    nav = { id, focus: isScene ? id : null };
    glideTo(id === 'hero' ? 0 : isScene ? top : top - Math.round(innerHeight * 0.12), () => {
      nav = null; onScroll();
      if (!opts || !opts.silent) { try { history.replaceState(null, '', '#' + id); } catch (e) { /* ignore */ } }
    });
    return true;
  }
  document.addEventListener('click', (e) => {   // every in-page link glides: the dock, the title, the buttons, the skip link
    const a = e.target.closest && e.target.closest('a[href^="#"]');
    if (!a || e.defaultPrevented || e.button || e.metaKey || e.ctrlKey || e.shiftKey || a.closest('#sheet')) return;
    let id = ''; try { id = decodeURIComponent(a.getAttribute('href').slice(1)); } catch (err) { return; }
    if (!id || /^place=/.test(id) || !document.getElementById(id)) return;
    e.preventDefault(); goTo(id);
  });

  /* ---- cards ease in from the side their scene puts them on ---- */
  if ('IntersectionObserver' in window && !reduce) {
    document.documentElement.classList.add('reveal');
    const io = new IntersectionObserver((es) => es.forEach((en) => { if (en.isIntersecting) { en.target.classList.add('in'); io.unobserve(en.target); } }), { threshold: 0.06, rootMargin: '0px 0px -6% 0px' });
    $$('.scene .card').forEach((c) => io.observe(c));
  }
  /* the drift card stays pinned while the year scrubs, so all of it has to fit above the dock */
  const stickyCard = $('#drift .card.sticky');
  function fitSticky() { if (stickyCard) stickyCard.style.setProperty('--stickyH', stickyCard.offsetHeight + 'px'); }
  if (stickyCard && 'ResizeObserver' in window) new ResizeObserver(fitSticky).observe(stickyCard);
  addEventListener('resize', () => { layoutTitle(); fitSticky(); onScroll(); });

  /* ============ story figures ============ */
  const D3 = window.d3;
  const dsvg = D3.select('#diurnal').append('svg').attr('viewBox', '0 0 380 190').attr('class', 'dchart');
  const dsvg2 = D3.select('#diurnal-static').append('svg').attr('viewBox', '0 0 380 150').attr('class', 'dchart');
  const dx = D3.scaleLinear().domain([0, 24]).range([30, 366]);
  const dy = D3.scaleLinear().domain([0, 1.05]).range([160, 14]);
  const dyS = D3.scaleLinear().domain([0, 1.05]).range([124, 12]);
  const curve = D3.range(0, 24.01, 0.25);
  function baseChart(svg, y, bottom) {
    svg.append('path').attr('class', 'dfill').attr('d', D3.area().x((t) => dx(t)).y0(bottom).y1((t) => y(S.D(t))).curve(D3.curveBasis)(curve));
    svg.append('path').attr('class', 'dline').attr('d', D3.line().x((t) => dx(t)).y((t) => y(S.D(t))).curve(D3.curveBasis)(curve));
    svg.append('line').attr('class', 'axis').attr('x1', 30).attr('x2', 366).attr('y1', bottom).attr('y2', bottom);
    [0, 6, 12, 18, 24].forEach((t) => svg.append('text').attr('x', dx(t)).attr('y', bottom + 15).attr('text-anchor', 'middle').text(String(t).padStart(2, '0') + ':00'));
  }
  baseChart(dsvg, dy, 160); baseChart(dsvg2, dyS, 124);
  dsvg2.append('line').attr('class', 'peak').attr('x1', dx(15)).attr('x2', dx(15)).attr('y1', dyS(1)).attr('y2', 124);
  dsvg2.append('text').attr('class', 'lab').attr('x', dx(15) + 6).attr('y', 16).text('peak ≈ 3 pm local');
  dsvg2.append('text').attr('class', 'lab dim').attr('x', dx(2.5)).attr('y', dyS(0.2)).text('pre-dawn: weakest');
  const marks = {};
  [['terra', '#ffc65a', 'Terra'], ['aqua', '#ff6a1a', 'Aqua'], ['viirs', '#7db2ff', 'VIIRS']].forEach(([id, c, name]) => {
    const g = dsvg.append('g');
    g.append('line').attr('y1', 160).attr('stroke', c).attr('stroke-width', 1.4).attr('stroke-dasharray', '2 3');
    g.append('circle').attr('r', 5).attr('fill', c).attr('stroke', '#0a0908').attr('stroke-width', 1.5);
    g.append('text').attr('class', 'lab').attr('fill', c).text(name);
    marks[id] = g;
  });
  function setYear(v) {
    st.year = clamp(v, 2000, 2026.8);
    $('#year').value = st.year.toFixed(1);
    const half = Math.round(st.year * 2) / 2; $('#year-out').textContent = half % 1 ? half.toFixed(1) : String(half);   // nearest half year (it used to show 2015 at 2015.5 but 2015.5 at 2015.6)
    const vals = { terra: S.terraH(st.year), aqua: S.aquaH(st.year), viirs: S.VIIRS_H }, lift = { terra: 0, aqua: 0, viirs: 18 };
    for (const id in marks) {
      const h = vals[id], px = dx(h), py = dy(S.D(h)), g = marks[id];
      g.select('line').attr('x1', px).attr('x2', px).attr('y2', py);
      g.select('circle').attr('cx', px).attr('cy', py);
      g.select('text').attr('x', px + (id === 'terra' ? -4 : id === 'aqua' ? 6 : 0)).attr('y', py - 11 - lift[id]).attr('text-anchor', id === 'terra' ? 'end' : id === 'aqua' ? 'start' : 'middle');
    }
    const th = vals.terra, miss = Math.round((1 - Math.exp(-0.28 * (10.5 - th))) * 100);
    $('#drift-read').innerHTML = `<span class="t">Terra ${S.fmtH(th)}</span> sees about <b>${100 - miss}%</b> of what it saw at 10:30 &nbsp;·&nbsp; <span class="a">Aqua ${S.fmtH(vals.aqua)}</span> &nbsp;·&nbsp; <span class="v">VIIRS ${S.fmtH(S.VIIRS_H)}</span>`;
  }
  $('#year').addEventListener('input', () => { st.yearTouched = true; setYear(parseFloat($('#year').value)); });
  $('#year').addEventListener('change', () => setTimeout(() => (st.yearTouched = false), 4000));
  function calc() {
    const n = +$('#c-n').value, h = +$('#c-h').value, k = +$('#c-k').value, b = +$('#c-b').value, m = Math.exp(-b * (h - 10.5));
    $('#c-mult').textContent = '×' + m.toFixed(2); $('#c-res').textContent = '≈ ' + Math.round(n * m * k).toLocaleString('en-US');
  }
  ['#c-n', '#c-h', '#c-k', '#c-b'].forEach((id) => $(id).addEventListener('input', calc)); calc();
  (function swathFig() {
    const svg = D3.select('#swath-fig').append('svg').attr('viewBox', '0 0 640 230').attr('class', 'sfig');
    svg.append('rect').attr('class', 'strip').attr('x', 70).attr('y', 70).attr('width', 500).attr('height', 120).attr('rx', 10);
    svg.append('text').attr('class', 'dim').attr('x', 320).attr('y', 136).attr('text-anchor', 'middle').text('one satellite pass, seen from above');
    svg.append('path').attr('class', 'arrow').attr('d', 'M 320 58 L 320 24 M 314 32 L 320 22 L 326 32');
    svg.append('text').attr('class', 'dim').attr('x', 334).attr('y', 36).text('flight direction');
    [[102, 'west edge', '09:10', '#ffc65a'], [538, 'east edge', '09:50', '#ff6a1a']].forEach(([x, t, tm, c]) => {
      svg.append('rect').attr('x', x - 11).attr('y', 139).attr('width', 22).attr('height', 22).attr('rx', 4).attr('fill', c);
      svg.append('text').attr('x', x).attr('y', 205).attr('text-anchor', 'middle').attr('fill', c).text(t + ' · ' + tm);
    });
    svg.append('path').attr('class', 'bracket').attr('d', 'M 102 168 L 102 176 L 538 176 L 538 168');
    svg.append('text').attr('x', 320).attr('y', 168).attr('text-anchor', 'middle').text('≈ 40 minutes of local time · same pixel size');
  })();

  /* ============ real numbers in the story ============ */
  function initEvidence() {
    const all = Object.values(DATA.score).map((r) => ({ id: r.country, name: DATA.byId[r.country].name, gap: r['V2_terra_drift.gap_closed_pct'], err: r['V1_holdout.median_abs_err_pct'] }));
    const rows = all.filter((r) => r.gap != null).sort((a, b) => b.gap - a.gap), skipped = all.filter((r) => r.gap == null);
    const better = rows.filter((r) => r.gap > 0), worse = rows.filter((r) => r.gap <= 0);
    $('#ev-title').textContent = `It shrank Terra's false trend in ${better.length} of ${rows.length} tested countries.`;
    $('#board').innerHTML = rows.map((r) => {
      const w = r.gap <= 0, wd = clamp(Math.abs(r.gap), 0, 100);
      return `<li class="${w ? 'worse' : ''}"><span>${r.name}</span><span class="b-bar" role="img" aria-label="${Math.round(r.gap)} percent of the false trend removed"><i style="width:${wd}%"></i></span><span class="b-num">${Math.round(r.gap)}%</span><span class="b-tag">${w ? 'Worse' : 'Better'}</span></li>`;
    }).join('');
    const errs = rows.map((r) => r.err).filter((e) => e != null).sort((a, b) => a - b);
    const tiers = {}; DATA.meta.countries.forEach((c) => { tiers[c.tier] = (tiers[c.tier] || 0) + 1; });
    const lowData = worse.filter((r) => { const t = DATA.byId[r.id].tier; return t === 'blended' || t === 'borrowed'; }).length;
    const bigWorse = worse.slice().sort((x, y) => (DATA.byId[y.id].calib_n || 0) - (DATA.byId[x.id].calib_n || 0)).slice(0, 4).map((r) => r.name);
    $('#ev-note').textContent = `${worse.length ? `It made ${worse.length} countries worse, and we show that on purpose: ${lowData} of them have little data here, and the largest are ${bigWorse.join(', ')}. ` : ''}${skipped.length ? 'Not enough clean data to test ' + skipped.length + ' smaller countries. ' : ''}Calibration adapts to the data: ${tiers.measured || 0} countries are calibrated on their own, ${tiers.blended || 0} are blended with the pooled value, ${tiers.borrowed || 0} borrow it. Another ${DATA.meta.excluded || 0} places had too little fire to include. ${DATA.score.India && DATA.score.India['V2_terra_drift.gap_closed_pct'] <= 0 ? 'In India the burning schedule itself changed (Punjab crop burning moved later in the day), which breaks the method\u2019s assumption. ' : ''}Converting MODIS to VIIRS units on held-out years (2016 to 2019) is off by a median of ${errs[0].toFixed(1)}% to ${errs[errs.length - 1].toFixed(1)}% per year, depending on the country.`;
    const rs = rhythmStat();
    if (rs && rs.yes && rs.no) $('#ev-note').textContent += ` A second check: the drift itself measures the morning slope, independently of the swath trick. Where the two slopes agree (${rs.yes} countries) the fix helped in ${Math.round(100 * rs.yesOk / rs.yes)}%; where they disagree (${rs.no}) it helped in ${Math.round(100 * rs.noOk / rs.no)}%. Each country sheet shows which case it is.`;
    const a = DATA.score.Angola;
    if (a) $('#drift-angola').innerHTML = `<b>Real result, Angola:</b> after the drift began, Terra alone shows <b>${a['V2_terra_drift.raw_terra_change_pct'].toFixed(0)}%</b> while VIIRS shows <b>${a['V2_terra_drift.viirs_change_pct'].toFixed(0)}%</b>. Our correction brings Terra to <b>${a['V2_terra_drift.corrected_terra_change_pct'] > 0 ? '+' : ''}${a['V2_terra_drift.corrected_terra_change_pct'].toFixed(0)}%</b>. The decline is the satellite waking up earlier, not less fire.`;
    FOCI.evidence.pins = ['Mozambique', 'India', 'Kazakhstan', 'Australia'].map((id) => { const c = DATA.byId[id], r = DATA.score[id]; return { lon: c.centroid[0], lat: c.centroid[1], t: `${c.name} ${Math.round(r['V2_terra_drift.gap_closed_pct'])}%` }; });
  }

  /* ============ countries: loaded up front so tooltips, the switcher and the screen-reader list work ============ */
  async function buildPlaces() {
    const ids = DATA.meta.countries.map((c) => c.id);
    $('#places-list').innerHTML = ids.map((id) => `<li><button type="button" data-id="${id}">${DATA.byId[id].name}</button></li>`).join('');
    $('#places-list').addEventListener('click', (e) => { const b = e.target.closest('button[data-id]'); if (b) openPlace(b.dataset.id); });
    $('#switch').innerHTML = ids.slice().sort((a, b) => DATA.byId[a].name.localeCompare(DATA.byId[b].name)).map((id) => `<option value="${id}">${DATA.byId[id].name}</option>`).join('');
    $('#switch').addEventListener('change', (e) => openPlace(e.target.value));
    const countries = DATA.meta.countries.slice().sort((a, b) => a.name.localeCompare(b.name));
    const search = $('#country-search'), status = $('#country-search-status');
    $('#country-options').replaceChildren(...countries.map((c) => { const option = document.createElement('option'); option.value = c.name; return option; }));
    search.disabled = false; $('#country-open').disabled = false; $('#try-angola').disabled = !DATA.byId.Angola;
    status.textContent = `${countries.length} countries available. Choose a name or type to search.`;
    $('#explore').addEventListener('submit', async (e) => {
      e.preventDefault();
      const matches = CATALOG.matchCountries(countries, search.value);
      if (matches.length !== 1) {
        status.textContent = matches.length ? `More than one match: ${matches.slice(0, 5).map((c) => c.name).join(', ')}${matches.length > 5 ? '…' : ''}. Enter a full country name.` : 'No matching country in this dataset. Choose a country from the suggestions.';
        search.setAttribute('aria-invalid', 'true'); search.focus(); return;
      }
      search.removeAttribute('aria-invalid'); status.textContent = `Opening ${matches[0].name}…`;
      try { await openPlace(matches[0].id, { section: 'calendar-card' }); status.textContent = `${countries.length} countries available. Choose another country to explore.`; }
      catch (error) { status.textContent = 'The country record could not be loaded. Please try again.'; console.error(error); }
    });
    search.addEventListener('input', () => search.removeAttribute('aria-invalid'));
    $('#try-angola').addEventListener('click', async () => {
      try { await openPlace('Angola', { section: 'calendar-card' }); }
      catch (error) { status.textContent = 'The Angola record could not be loaded. Please try again.'; console.error(error); }
    });
    $$('a[href="#explore"]').forEach((link) => link.addEventListener('click', () => setTimeout(() => search.focus({ preventScroll: true }), 100)));
  }

  function populateSources(root = document) {
    const fullMonth = (ym) => `${MONF[ym % 100 - 1]} ${Math.floor(ym / 100)}`;
    $$('[data-record-coverage]', root).forEach((el) => { el.textContent = `${fullMonth(DATA.meta.first_month)}–${fullMonth(DATA.meta.last_month)} · historical monthly observations, not live fire alerts`; });
    $$('[data-globe-years]', root).forEach((el) => { el.textContent = (DATA.climo.years || '2012-2025').replace('-', '–'); });
    const p = DATA.provenance;
    const field = (selector, value) => { if (typeof value === 'string' && value.trim()) $$(selector, root).forEach((el) => { el.textContent = value; }); };
    field('[data-product-versions]', p.product_versions);
    field('[data-uncertainty-method]', p.uncertainty_method ? `The exported 95% band is calculated as follows: ${p.uncertainty_method}. It is not a regional confidence interval.` : null);
    field('[data-analysis-revision]', p.analysis_revision);
    if (p.analysis_repository) {
      try {
        const url = new URL(p.analysis_repository);
        if (url.protocol === 'https:') $$('[data-analysis-revision]', root).forEach((el) => { const a = document.createElement('a'); a.href = url.href; a.textContent = p.analysis_revision ? `revision ${p.analysis_revision}` : 'upstream analysis repository (revision not recorded)'; a.target = '_blank'; a.rel = 'noopener'; el.replaceChildren(a); });
      } catch (_) { /* Keep the explicit missing-provenance label. */ }
    }
    if (p.exported_at && Number.isFinite(Date.parse(p.exported_at))) field('[data-export-date]', `Exported ${new Date(p.exported_at).toISOString()}.`);
  }

  function initSources() {
    $('#sources .sources-content').append($('#sources-template').content.cloneNode(true));
    populateSources();
  }

  /* ============ flag map: the country's flag in theme colours only (ink, ember, sun, paper) ============ */
  const flagCache = {};
  function ramp(l) {
    const stops = [[0, [18, 8, 10]], [0.25, [122, 34, 8]], [0.55, [255, 106, 26]], [0.8, [255, 198, 90]], [1, [243, 234, 217]]];
    for (let i = 1; i < stops.length; i++) if (l <= stops[i][0]) { const [a, A1] = stops[i - 1], [b, B1] = stops[i], t = (l - a) / (b - a); return A1.map((v, k) => v + (B1[k] - v) * t); }
    return stops[4][1];
  }
  function flagTex(id) {
    if (flagCache[id]) return flagCache[id];
    return (flagCache[id] = fetch('flags/' + id + '.svg').then((r) => r.text()).then((t) => new Promise((res) => {
      const svg = t.replace('<svg ', '<svg width="480" height="360" preserveAspectRatio="xMidYMid slice" ');   // it is drawn at 34% opacity under the borders, so 480x360 looks the same and is 4x cheaper to recolour
      const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' })), img = new Image();
      img.onload = () => {
        const c = document.createElement('canvas'); c.width = 480; c.height = 360;
        const x = c.getContext('2d'); x.drawImage(img, 0, 0, 480, 360);
        const d = x.getImageData(0, 0, 480, 360), p = d.data;
        for (let i = 0; i < p.length; i += 4) { const col = ramp((0.299 * p[i] + 0.587 * p[i + 1] + 0.114 * p[i + 2]) / 255); p[i] = col[0]; p[i + 1] = col[1]; p[i + 2] = col[2]; }
        x.putImageData(d, 0, 0); URL.revokeObjectURL(url); res(c);
      };
      img.onerror = () => res(null); img.src = url;
    })).catch(() => null));
  }

  /* ============ the country sheet ============ */
  const sheet = $('#sheet'), scroller = $('#sheet-scroll'), cardsEl = $('#cards');
  const sh = { id: null, s: null, c: null, idx: 0, hour: 12, mode: 'camera', div: 0.5, playing: false, region: null };
  const cname = (c) => c.name;
  let openToken = 0;

  async function openPlace(id, opts) {
    opts = opts || {};
    const token = ++openToken;
    const s = await DATA.loadSeries(id), c = DATA.byId[id];
    if (token !== openToken) return;   // a newer country was picked while this one was loading
    stopPlay();
    sh.region = null;
    sh.rh = RH && DATA.diurnal ? RH.measure(DATA.diurnal[id]) : null;   // this country's measured daily curve
    Object.assign(sh, { id, s, c, idx: opts.idx != null ? opts.idx : s.months.length - 1, hour: hourAt(c.centroid[0]), mode: 'camera', div: 0.5, playing: false });
    document.title = `${c.name} · ${TITLE0}`;
    st.sheetOpen = true; document.body.classList.add('sheet-open');
    const { lat, lon, span } = DATA.placeGeom(id);   // not the plain bbox: Russia, Fiji, NZ and the US straddle 180°
    sh.lon = lon;
    G.setSelected(id); G.setFlag(null); flagTex(id).then((t) => { if (sh.id === id) G.setFlag(t); });
    $('#switch').value = id;
    G.focus({ layout: 'sheet', lon, lat, span: span * 1.1, glass: 1, ring: 0 });
    G.lockLocalHour(sh.hour, lon);
    sheetCtx = { lat, lon, month: 6, smoke: 0, hourNow: sh.hour };
    sheet.classList.add('open'); sheet.setAttribute('aria-hidden', 'false');
    scroller.scrollTop = 0; hideTip();
    buildCards(); selectIdx(sh.idx); setHour(sh.hour);   // selectIdx writes the share link (country + month); setHour fills the time slider
    sh.region = REGIONS.mount($('#region-explorer'), c, (box) => updatePlaceLink(box), opts.box);
    placeTitle();
    if (opts.section) goToSheetSection(opts.section);
    setTimeout(() => { if (token === openToken && st.sheetOpen) (opts.section ? $('#' + opts.section) : $('#sheet-back')).focus({ preventScroll: true }); }, 700);
  }
  function closePlace() {
    if (!st.sheetOpen) return;
    openToken++; stopPlay(); document.title = TITLE0; st.sheetOpen = false; document.body.classList.remove('sheet-open');
    sheet.classList.remove('open'); sheet.setAttribute('aria-hidden', 'true');
    G.setSelected(null); G.setFlag(null); G.unlock(); sheetCtx = null;
    G.focus(FOCI.cameras || FOCI.hero); focusId = 'cameras';
    placeTitle(); onScroll();
    try { history.replaceState(null, '', location.pathname + location.search); } catch (e) { /* ignore */ }   // drop the country from the address; keep the scroll position
  }
  $('#sheet-back').addEventListener('click', closePlace);
  function goToSheetSection(id) {
    const target = $('#' + id, sheet);
    if (!target) return;
    if (id === 'sheet-methodology') $('details', target).open = true;
    scroller.scrollTop += target.getBoundingClientRect().top - scroller.getBoundingClientRect().top - 80;
    target.focus({ preventScroll: true });
  }
  sheet.addEventListener('click', (e) => {
    const button = e.target.closest('[data-sheet-go]');
    if (button) goToSheetSection(button.dataset.sheetGo);
    const sources = e.target.closest('a[href="#sheet-methodology"]');
    if (sources) { e.preventDefault(); goToSheetSection('sheet-methodology'); $('#sheet-methodology details').open = true; }
  });
  scroller.addEventListener('pointermove', (e) => {
    if (!st.sheetOpen || !sheetCtx) return;
    if (e.target.closest('.cards, .stepper, .switch, .sheet-back, .tier')) { heatTarget = 0; hideTip(); return; }
    const v = G.heatAt(e.clientX, e.clientY);
    if (v == null || v < 0.6) { heatTarget = 0; hideTip(); return; }
    heatTarget = clamp(Math.log1p(v) / Math.log1p(sheetCtx.vmax || 1), 0, 1);
    gtip.innerHTML = `Typical ${MONF[sheetCtx.month - 1]}<small>about ${fmt(v)} detections a month in this 0.5° grid cell</small>`;
    gtip.style.left = e.clientX + 'px'; gtip.style.top = e.clientY + 'px'; gtip.hidden = false;
  });
  scroller.addEventListener('pointerleave', () => { heatTarget = 0; hideTip(); });
  addEventListener('keydown', (e) => { if (e.key === 'Escape' && st.sheetOpen) closePlace(); });
  scroller.addEventListener('scroll', () => $('#sheet-bar').classList.toggle('on', scroller.scrollTop > innerHeight * 0.3));
  $('#m-prev').addEventListener('click', () => selectIdx(Math.max(0, sh.idx - 1)));
  $('#m-next').addEventListener('click', () => selectIdx(Math.min(sh.s.months.length - 1, sh.idx + 1)));
  $('#play').addEventListener('click', togglePlay);
  $('#play-mode').addEventListener('click', (e) => { const b = e.target.closest('button[data-pm]'); if (b) setPlayMode(b.dataset.pm); });
  $('#play-speed').addEventListener('click', () => { PLAY.speed = SPEEDS[(SPEEDS.indexOf(PLAY.speed) + 1) % SPEEDS.length]; savePlay(); syncPlay(); });
  $('#timeline').addEventListener('input', (e) => {
    const v = +e.target.value; if (!sh.s) return;
    if (PLAY.on) stopPlay();
    if (PLAY.mode === 'day') setHour(v, true);
    else if (PLAY.mode === 'years') { const s = sh.s, mo = s.months[sh.idx] % 100; let j = s.months.indexOf(v * 100 + mo); if (j < 0) j = s.months.findIndex((m) => Math.floor(m / 100) === v); if (j >= 0) selectIdx(j); }
    else selectIdx(v);
  });
  /* keys inside a country: ← → step a month (a year in Years mode), K plays or pauses */
  addEventListener('keydown', (e) => {
    if (!st.sheetOpen || !sh.s || e.metaKey || e.ctrlKey || e.altKey) return;
    const t = e.target, tag = t.tagName, field = tag === 'SELECT' || tag === 'TEXTAREA' || (tag === 'INPUT' && t.type !== 'range' && t.type !== 'checkbox' && t.type !== 'radio') || t.isContentEditable;
    if (field || (tag === 'INPUT' && t.type === 'range')) return;
    if (e.key === 'k' || e.key === 'K') { e.preventDefault(); togglePlay(); }
    else if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
      const dir = e.key === 'ArrowRight' ? 1 : -1, j = PLAY.mode === 'years' ? sh.s.months.indexOf(sh.s.months[sh.idx] + 100 * dir) : sh.idx + dir;
      if (j >= 0 && j < sh.s.months.length) { e.preventDefault(); selectIdx(j); }
    }
  });

  function setHour(h, fromUser) {
    sh.hour = ((h % 24) + 24) % 24;
    G.lockLocalHour(sh.hour, sh.lon);
    $$('.hr', cardsEl).forEach((b) => b.classList.toggle('on', +b.dataset.h === Math.floor(sh.hour)));
    const tod = $('#tod'); if (tod) { tod.value = sh.hour.toFixed(2); $('#tod-out').textContent = fmt12(sh.hour); }
    if (fromUser && PLAY.on) stopPlay();
    if (PLAY.mode === 'day') syncTimeline();
  }
  const fmt12 = (h) => { const hh = Math.floor(h) % 24, mm = Math.floor((h % 1) * 60); return `${hh % 12 || 12}:${String(mm).padStart(2, '0')} ${hh < 12 ? 'AM' : 'PM'}`; };
  function paintTrack() {
    if (!sheetCtx || !$('#tod')) return;
    const stops = []; for (let h = 0; h <= 24; h++) { const k = clamp(glowAlpha(h % 24, sheetCtx.lat, sheetCtx.month, sheetCtx.smoke, 0) / 0.9, 0, 1); stops.push(`rgb(${Math.round(8 + 247 * k)},${Math.round(6 + 100 * k)},${Math.round(6 + 20 * k)}) ${(h / 24 * 100).toFixed(1)}%`); }
    $('#tod').style.setProperty('--trackbg', `linear-gradient(90deg, ${stops.join(',')})`);
  }
  /* ---------- play: through the months, through the years, or through one day ----------
     One engine for all three. Months steps the record one month at a time, Years steps the same calendar month from year
     to year (so you compare like with like), Day turns the clock round once. Any hand on the controls pauses it. */
  const PLAY = { mode: 'months', speed: 1, on: false };
  const PLAY_MS = { months: 380, years: 700 };   // time per step at 1x
  const SPEEDS = [0.5, 1, 2, 4, 8];
  try { const m = localStorage.getItem('sundial.playmode'), v = +localStorage.getItem('sundial.playspeed'); if (PLAY_MS[m] || m === 'day') PLAY.mode = m; if (SPEEDS.includes(v)) PLAY.speed = v; } catch (e) { /* storage can be blocked */ }
  const savePlay = () => { try { localStorage.setItem('sundial.playmode', PLAY.mode); localStorage.setItem('sundial.playspeed', String(PLAY.speed)); } catch (e) { /* ignore */ } };
  let playRaf = 0;
  function nextIdx() {   // where the next step lands, or -1 at the end of the record
    const s = sh.s, ym = s.months[sh.idx];
    if (PLAY.mode === 'months') return sh.idx < s.months.length - 1 ? sh.idx + 1 : -1;
    const j = s.months.indexOf(ym + 100);   // same calendar month, next year
    return j;
  }
  function startPlay() {
    if (!sh.s) return;
    if (PLAY.mode !== 'day' && nextIdx() < 0) selectIdx(PLAY.mode === 'months' ? 0 : sh.s.months.findIndex((m) => m % 100 === sh.s.months[sh.idx] % 100), { play: true });   // at the end: start over
    PLAY.on = true; sheet.classList.add('playing'); syncPlay();
    let last = performance.now(), acc = 0;
    const tick = (now) => {
      if (!PLAY.on) return;
      const dt = Math.min(0.25, (now - last) / 1000); last = now;
      if (PLAY.mode === 'day') setHour(sh.hour + dt * (24 / 16) * PLAY.speed);
      else {
        acc += dt * 1000 * PLAY.speed;
        while (acc >= PLAY_MS[PLAY.mode]) {
          acc -= PLAY_MS[PLAY.mode];
          const j = nextIdx();
          if (j < 0) { stopPlay(true); return; }
          selectIdx(j, { play: true });
        }
      }
      playRaf = requestAnimationFrame(tick);
    };
    playRaf = requestAnimationFrame(tick);
  }
  function stopPlay(atEnd) {
    const was = PLAY.on;
    PLAY.on = false; cancelAnimationFrame(playRaf); sheet.classList.remove('playing');
    if (was && sh.s && PLAY.mode !== 'day') updatePlaceLink(sh.region && sh.region.bounds());   // the share link only needs to be right where playing stopped
    syncPlay(atEnd ? 'end' : '');
  }
  function setPlayMode(m) {
    if (m === PLAY.mode) return;
    stopPlay(); PLAY.mode = m; savePlay(); syncPlay(); syncTimeline();
  }
  /* the timeline slider is months, years or hours depending on the mode, so it is always the thing that is playing */
  function syncTimeline() {
    const t = $('#timeline'); if (!t || !sh.s) return;
    const s = sh.s, n = s.months.length, y0 = Math.floor(s.months[0] / 100), y1 = Math.floor(s.months[n - 1] / 100);
    let ticks;
    if (PLAY.mode === 'day') {
      t.min = 0; t.max = 23.99; t.step = 0.02; t.value = sh.hour.toFixed(2); t.setAttribute('aria-valuetext', fmt12(sh.hour));
      ticks = [[0, '12 AM'], [25, '6 AM'], [50, '12 PM'], [75, '6 PM'], [100, '12 AM']];
    } else if (PLAY.mode === 'years') {
      t.min = y0; t.max = y1; t.step = 1; t.value = Math.floor(s.months[sh.idx] / 100); t.setAttribute('aria-valuetext', String(t.value));
      ticks = [y0, 2005, 2010, 2015, 2020, y1].filter((y, k, a) => y >= y0 && y <= y1 && a.indexOf(y) === k).map((y) => [(y - y0) / Math.max(1, y1 - y0) * 100, y]);
    } else {
      t.min = 0; t.max = n - 1; t.step = 1; t.value = sh.idx; t.setAttribute('aria-valuetext', ymLabel(s.months[sh.idx]));
      ticks = [2005, 2010, 2015, 2020, 2025].filter((y) => s.months.indexOf(y * 100 + 1) >= 0).map((y) => [s.months.indexOf(y * 100 + 1) / Math.max(1, n - 1) * 100, y]);
    }
    t.style.setProperty('--pct', ((t.value - t.min) / Math.max(1e-9, t.max - t.min) * 100).toFixed(2) + '%');
    $('#tl-ticks').innerHTML = ticks.map(([p, l]) => `<span style="left:${p.toFixed(1)}%">${l}</span>`).join('');
  }
  function syncPlay(why) {
    const on = PLAY.on, s = sh.s;
    $$('#play').forEach((b) => { b.classList.toggle('on', on); b.setAttribute('aria-label', on ? 'Pause' : PLAY.mode === 'day' ? 'Play the day' : PLAY.mode === 'years' ? 'Play through the years' : 'Play through the months'); });
    $$('#play-mode button').forEach((b) => { const sel = b.dataset.pm === PLAY.mode; b.classList.toggle('on', sel); b.setAttribute('aria-checked', String(sel)); });
    const sp = $('#play-speed'); if (sp) sp.textContent = PLAY.speed + '×';
    const d = $('#day-play'); if (d) d.textContent = on && PLAY.mode === 'day' ? '❚❚ Pause' : '▶ Play the day';
    const r = $('#play-read'); if (!r || !s) return;
    const mo = MONF[s.months[sh.idx] % 100 - 1], last = ymLabel(s.months[s.months.length - 1]);
    r.textContent = why === 'end' ? `Reached ${last}. Press play to start again.`
      : PLAY.mode === 'day' ? (on ? 'Playing one day, local time. The sun and the satellites move with it.' : 'One day, local time. Press play, or drag the slider.')
      : PLAY.mode === 'years' ? `${on ? 'Playing' : 'Plays'} ${mo} of each year, one year at a time.`
      : `${on ? 'Playing' : 'Plays'} every month, ${ymLabel(s.months[0])} to ${last}, one month at a time.`;
  }
  function togglePlay() { PLAY.on ? stopPlay() : startPlay(); }

  function selectIdx(i, opts) {
    if (!(opts && opts.play) && PLAY.on && PLAY.mode !== 'day') stopPlay();   // a tap on a month, a year or the arrows takes over from playing
    sh.idx = i;
    const s = sh.s, ym = s.months[i], mo = ym % 100, v = s.harm[i], z = s.z[i];
    $('#sheet-name').textContent = cname(sh.c);
    const tr = TIER[sh.c.tier]; const te = $('#tier'); te.hidden = !tr; if (tr) { te.className = 'tier ' + sh.c.tier; te.textContent = tr[0]; te.title = tr[1]; }
    $('#sheet-num').textContent = Math.round(v).toLocaleString('en-US');
    const verdict = z >= 2 ? `Unusually high for ${MONF[mo - 1]}` : z <= -2 ? `Unusually low for ${MONF[mo - 1]}` : `Typical for ${MONF[mo - 1]}`;
    const same = s.harm.filter((x, j) => s.months[j] % 100 === mo && j !== i && x != null), typ = same.length ? same.reduce((p, q) => p + q, 0) / same.length : null;
    $('#sheet-cond').textContent = `fire detections in ${ymLabel(ym)}`;
    $('#sheet-hl').textContent = `${verdict}${typ != null ? `: an average ${MONF[mo - 1]} has ${fmt(typ)}` : ''}. Busiest month on record: ${ymLabel(s.summary.peak_month)} (${fmt(s.summary.peak_value)}). Counts are VIIRS-equivalent.`;
    $('#sheet-coverage').textContent = `${ymLabel(s.months[0])}–${ymLabel(s.months[s.months.length - 1])} · historical observations`;
    $('#sheet-source').textContent = `Selected-month source: ${CATALOG.sourceLabel(s.source[i])} · VIIRS-equivalent detections`;
    $('#calendar-selection').textContent = `${ymLabel(ym)}: ${fmt(v)} VIIRS-equivalent detections · ${CATALOG.sourceLabel(s.source[i])} · ${verdict.toLowerCase()}`;
    $('#m-label').textContent = ymLabel(ym);
    $('#bar-name').textContent = cname(sh.c); $('#bar-val').textContent = Math.round(v).toLocaleString('en-US');
    $('#m-prev').disabled = i === 0; $('#m-next').disabled = i === s.months.length - 1;
    G.setMonth(mo);
    sheetCtx.month = mo; sheetCtx.smoke = clamp(v / (s.summary.peak_value || 1), 0, 1);
    emberLevel = sheetCtx.smoke; sheetCtx.vmax = G.heatScale(sh.c.bbox, mo); paintTrack();
    $$('.c-cell.sel', cardsEl).forEach((e) => e.classList.remove('sel'));
    const cell = $(`.c-cell[data-i="${i}"]`, cardsEl); if (cell) cell.classList.add('sel');
    refreshPasses(); drawMark();
    $('#season-summary').innerHTML = REGIONS.countrySummary(s, sh.c, i);
    if (!(opts && opts.play)) updatePlaceLink(sh.region && sh.region.bounds());   // while playing, the link is written once, when it stops (browsers cap how often the address can change)
    const yr = Math.floor(ym / 100);
    $$('.yr.on', cardsEl).forEach((e) => e.classList.remove('on'));
    const yrow = $(`.yr[data-y="${yr}"]`, cardsEl); if (yrow) yrow.classList.add('on');
    if (cell && opts && opts.play) {   // keep the playing month in view inside the scrolling calendar, without moving the page
      const box = cell.closest('.cal-scroll');
      if (box) { const r = cell.getBoundingClientRect(), b = box.getBoundingClientRect(); if (r.left < b.left + 24 || r.right > b.right - 24) box.scrollLeft += r.left - b.left - b.width / 2; }
    }
    syncTimeline(); if (!PLAY.on) syncPlay();
  }

  function updatePlaceLink(box) {
    try { history.replaceState(null, '', `#place=${sh.id}&m=${sh.s.months[sh.idx]}${box ? '&box=' + box.join(',') : ''}`); } catch (e) { /* ignore */ }
  }

  /* ---------- cards ---------- */
  function buildCards() {
    const s = sh.s;
    const rh = sh.rh, measured = !!(rh && rh.ok && rh.fit);
    const dayCurve = measured ? (t) => rh.fit.at(t) / rh.fit.a : S.D;   // the country's own curve when we could measure it, else the schematic
    const hours = Array.from({ length: 24 }, (_, h) => `<button type="button" class="hr" data-h="${h}" aria-label="Local time ${h}:00"><span class="hl">${hourWord(h)}</span><span class="hb"><i style="height:${Math.round(dayCurve(h + 0.5) * 100)}%"></i></span><span class="hs"></span></button>`).join('');
    const years = D3.range(2001, 2026);
    const mx = D3.max(s.harm) || 1;
    const yrows = years.map((y) => {
      const v = s.months.map((m, i) => (Math.floor(m / 100) === y ? s.harm[i] : null)).filter((x) => x != null);
      if (!v.length) return '';
      const lo = Math.min(...v), hi = Math.max(...v), mean = v.reduce((a, b) => a + b, 0) / v.length;
      return `<button type="button" class="yr" data-y="${y}" aria-label="${y}: monthly range ${fmt(lo)} to ${fmt(hi)}"><span class="y">${y}</span><span class="rb"><i style="left:${(lo / mx * 100).toFixed(1)}%;width:${Math.max(1.5, (hi - lo) / mx * 100).toFixed(1)}%"></i><u style="left:${(mean / mx * 100).toFixed(1)}%"></u></span><span class="tot">${fmt(s.summary.yearly[y] != null ? s.summary.yearly[y] : v.reduce((a, b) => a + b, 0))}</span></button>`;   // a few series (Falkland Islands) lack a 2025 entry in the summary
    }).join('');
    const sc = DATA.score[sh.id] || {};
    const gap = sc['V2_terra_drift.gap_closed_pct'], worse = gap != null && gap <= 0;
    const anoms = s.months.map((m, i) => ({ i, m, z: s.z[i], v: s.harm[i] })).filter((r) => Math.abs(r.z) >= 2).sort((a, b) => Math.abs(b.z) - Math.abs(a.z)).slice(0, 7);
    cardsEl.innerHTML = `
<section class="gcard span2" id="season-summary" tabindex="-1" aria-label="Country fire season summary"></section>
<section class="gcard span2" id="region-explorer" tabindex="-1" aria-label="Select a local area"></section>
<section class="gcard span2 country-context"><h3 class="gh">Country record · ${cname(sh.c)}</h3><p>The calendar, satellite comparisons and downloads below cover all of ${cname(sh.c)}. A regional box changes the explorer above, not this country record.</p><p class="note">Observations: ${ymLabel(s.months[0])}–${ymLabel(s.months[s.months.length - 1])}. The globe shows a 2012–2025 seasonal average.</p></section>
<section class="gcard span2"><h3 class="gh">${ICON.clock} When in the day<span class="gr" id="pass-sum"></span></h3>
  <div class="dayrow"><p id="day-line"></p><button type="button" id="day-play">▶ Play the day</button></div>
  <div class="tod"><div class="tod-top"><span class="tod-lab">Drag to see when the satellites pass over this country</span><output class="tod-out" id="tod-out" for="tod"></output></div><div class="tod-marks" id="tod-marks"></div><input type="range" id="tod" min="0" max="23.99" step="0.02" value="12" aria-label="Local time of day"><div class="tod-ticks" aria-hidden="true"><span>12 AM</span><span>6 AM</span><span>12 PM</span><span>6 PM</span><span>12 AM</span></div></div>
  <div class="hours" id="hours">${hours}</div>
  <p class="note">${measured ? 'The bars follow the daily rhythm measured for this country (next card).' : 'The bars are a schematic daily fire rhythm: there are too few detections here to measure one.'} The markers show when each satellite passed this country in the selected month. Tap an hour to see the sky and the night side at that time.</p></section>
<section class="gcard span2"><h3 class="gh">${ICON.pulse} Measured daily rhythm<span class="gr">from the drift itself</span></h3>
  <div id="rh"></div><div id="rh-body"></div></section>
<section class="gcard"><h3 class="gh">${ICON.chart} Year by year</h3><div class="yrows" id="yrows">${yrows}</div><p class="note">Each bar spans the lowest to highest month. The dot is the average month.</p></section>
<section class="gcard"><h3 class="gh">${ICON.sat} Orbit drift</h3><div id="orb"></div>
  <div class="keys"><span><i style="background:#ffd27a"></i>Terra</span><span><i style="background:#ff8a4a"></i>Aqua</span><span><i style="background:#a9cdff"></i>VIIRS</span></div>
  <p class="note">Local time of each satellite's daytime pass over ${cname(sh.c)}. Terra slides earlier and Aqua later, from about 2020.</p></section>
<section class="gcard span2" id="calendar-card" tabindex="-1"><h3 class="gh">${ICON.cal} ${cname(sh.c)} · Burning calendar<span class="gr">tap a month</span></h3>
  <div class="sheet-shortcuts"><button type="button" data-sheet-go="season-summary">Season summary ↑</button><button type="button" data-sheet-go="region-explorer">Select a local area ↑</button><button type="button" data-sheet-go="sheet-methodology">Sources &amp; methodology ↓</button></div>
  <p class="note calendar-selection" id="calendar-selection" aria-live="polite"></p>
  <div class="cal-scroll"><div class="cal" id="cal" role="grid" aria-label="Burning calendar"></div></div>
  <p class="note">Harmonized detections per month in VIIRS units. ▲ unusually high · ▼ unusually low, against the same month in other years.</p></section>
<section class="gcard span2"><h3 class="gh">${ICON.flame} Before and after</h3>
  <div class="seg" role="group" aria-label="Which fix to show"><button type="button" data-m="camera" class="on">Two cameras</button><button type="button" data-m="clock">Drifting clock</button></div>
  <div class="ba" id="ba"><svg id="ba-svg" role="img" aria-label="Monthly series. Left of the divider the uncorrected record, right of it the corrected record."></svg><span class="lab l">Before</span><span class="lab r">After</span></div>
  <p class="note" id="ba-note"></p></section>
<section class="gcard span2"><h3 class="gh">${ICON.trend} Is fire rising here?<span class="gr">2001 to 2025</span></h3>
  <div id="tr-chart"></div><div id="tr-body"></div></section>
<section class="gcard"><h3 class="gh">${ICON.warn} Unusual months</h3><ol class="anoms" id="anoms">${anoms.length ? anoms.map((r) => `<li><button type="button" data-i="${r.i}"><span class="k ${r.z > 0 ? 'up' : 'dn'}">${r.z > 0 ? '▲ High' : '▼ Low'}</span> ${ymLabel(r.m)}<em>${fmt(r.v)} · z ${r.z.toFixed(1)}</em></button></li>`).join('') : '<li class="note">No month passes the |z| ≥ 2 test here.</li>'}</ol></section>
<section class="gcard"><h3 class="gh">${ICON.check} Does it work here?</h3>
  ${gap == null ? `<p>Not enough clean data here to test the correction.</p>${TIER[sh.c.tier] ? `<p class="note"><b>${TIER[sh.c.tier][0]}.</b> ${TIER[sh.c.tier][1]}</p>` : ''}` : `<div class="score"><div><div class="n ${worse ? 'bad' : ''}">${Math.round(gap)}%</div><div class="l">of Terra's false trend removed</div></div><div><div class="n">${sc['V1_holdout.median_abs_err_pct'] == null ? 'n/a' : sc['V1_holdout.median_abs_err_pct'].toFixed(1) + '%'}</div><div class="l">typical yearly error on years we hid from the fit</div></div></div>
  <p>Terra alone changed by <b>${p0(sc['V2_terra_drift.raw_terra_change_pct'])}</b> after the drift began while VIIRS changed by <b>${p0(sc['V2_terra_drift.viirs_change_pct'])}</b>. Corrected, Terra changes by <b>${p0(sc['V2_terra_drift.corrected_terra_change_pct'])}</b>.</p>
  ${TIER[sh.c.tier] ? `<p class="note"><b>${TIER[sh.c.tier][0]}.</b> ${TIER[sh.c.tier][1]}</p>` : ''}
  ${DATA.cont && DATA.cont.rows[sh.id] ? `<p class="note"><b>After Suomi NPP:</b> NOAA-20 × ${DATA.cont.rows[sh.id].c.toFixed(3)} stands in for it here${DATA.cont.rows[sh.id].ho == null ? '' : ` (held-out yearly error ${DATA.cont.rows[sh.id].ho.toFixed(1)}%)`}.</p>` : ''}
  ${worse ? `<p class="note"><b>Here the fix made things worse.</b> ${sh.id === 'India' ? 'Punjab crop burning moved later in the day, which breaks the method’s assumption.' : 'We show this on purpose.'}</p>` : ''}`}</section>
<section class="gcard span2"><h3 class="gh">${ICON.down} Download</h3><div class="dl"><button type="button" class="btn" id="dl-csv">Monthly table (CSV)</button><a class="btn ghost" href="https://firms.modaps.eosdis.nasa.gov/download/" target="_blank" rel="noopener">NASA FIRMS raw archive ↗</a><button type="button" class="btn ghost" id="dl-link">Copy link to this view</button></div>
  <p class="note">One row per month: harmonized count with the supplied 95% band, anomaly score, raw counts per satellite, uncorrected and drift-corrected MODIS, pass times and fire power. See the uncertainty limitations below.</p><p class="toast" id="toast" role="status" aria-live="polite"></p></section>
<section class="gcard span2" id="sheet-methodology" tabindex="-1"><details><summary>Sources, methodology &amp; limitations</summary><div class="sources-content"></div></details></section>`;
    $('#sheet-methodology .sources-content').append($('#sources-template').content.cloneNode(true));
    populateSources($('#sheet-methodology'));
    // wire
    $('#tod').addEventListener('input', () => setHour(parseFloat($('#tod').value), true));
    $('#hours').addEventListener('click', (e) => { const b = e.target.closest('.hr'); if (b) setHour(+b.dataset.h + 0.5, true); });
    $('#day-play').addEventListener('click', () => { if (PLAY.on && PLAY.mode === 'day') stopPlay(); else { setPlayMode('day'); startPlay(); } });
    $('#yrows').addEventListener('click', (e) => { const b = e.target.closest('.yr'); if (!b) return; const y = +b.dataset.y; let best = -1, bi = -1; s.months.forEach((m, i) => { if (Math.floor(m / 100) === y && s.harm[i] > best) { best = s.harm[i]; bi = i; } }); if (bi >= 0) selectIdx(bi); });
    $('#anoms').addEventListener('click', (e) => { const b = e.target.closest('button[data-i]'); if (b) { selectIdx(+b.dataset.i); } });
    $$('.seg button', cardsEl).forEach((b) => b.addEventListener('click', () => { sh.mode = b.dataset.m; $$('.seg button', cardsEl).forEach((x) => x.classList.toggle('on', x === b)); drawBA(); }));
    $('#dl-csv').addEventListener('click', downloadCSV);
    $('#dl-link').addEventListener('click', async () => { try { await navigator.clipboard.writeText(location.href); toast('Link copied. It saves the country and month.'); } catch (e) { toast('Copy failed. The address bar holds the link.'); } });
    buildCalendar(); drawOrbit(); drawBA(); drawRhythm(); drawTrend();
  }

  /* ---------- is fire rising here? the glued record against the fair one ---------- */
  const sp = (x) => (x > 0.04 ? '+' : x < -0.04 ? '−' : '') + Math.abs(x).toFixed(1) + '%';
  const rising = (d) => (d === 'up' ? 'rising' : d === 'down' ? 'falling' : 'flat');
  function trendVerdict(k, N, H, nd, hd) {
    const n = `${sp(N.pct)} a year`, h = `${sp(H.pct)} a year`;
    if (k === 'flip') return `<b>Gluing flips the answer.</b> The glued record says fire here is ${rising(nd)} (${n}). On the fair record it is ${rising(hd)} (${h}). The jump when VIIRS starts in 2012 is what drags the glued line the wrong way.`;
    if (k === 'phantom') return `<b>The glued trend is mostly the camera.</b> The glued record says fire is ${rising(nd)} (${n}). On the fair record there is no clear trend (${h}, range ${sp(H.lo)} to ${sp(H.hi)}).`;
    if (k === 'hidden') return `<b>Gluing hides a trend.</b> The glued record shows no clear change (${n}), but on the fair record fire is ${rising(hd)} (${h}).`;
    if (k === 'overstated') return `<b>Same direction, wrong size.</b> Both say fire is ${rising(hd)}, but the glued record puts it at ${n} against ${h} on the fair one.`;
    return `<b>The two records agree here.</b> Fire is ${rising(hd)} on both (${n} glued, ${h} fair).`;
  }
  function drawTrend() {
    const box = $('#tr-chart'), body = $('#tr-body'); if (!box || !body || !TR) return;
    const m = TR.measure(sh.s); if (!m) { body.innerHTML = '<p>Not enough full years of data here to fit a trend.</p>'; return; }
    const { N, H } = m, w = Math.max(280, box.clientWidth || 640), h = Math.round(Math.max(190, Math.min(240, w * 0.36))), mg = { l: 44, r: 12, t: 14, b: 24 };
    const x = D3.scaleLinear().domain([2001, 2025]).range([mg.l, w - mg.r]);
    const y = D3.scaleLinear().domain([0, D3.max([...N.pts, ...H.pts], (p) => p.v) * 1.08]).range([h - mg.b, mg.t]).nice();
    const svg = D3.select(box).html('').append('svg').attr('class', 'trc').attr('viewBox', `0 0 ${w} ${h}`).attr('role', 'img')
      .attr('aria-label', `Yearly fire totals for ${cname(sh.c)}, glued record ${sp(N.pct)} a year, fair record ${sp(H.pct)} a year.`);
    svg.append('g').attr('class', 'grid').selectAll('line').data(y.ticks(4)).join('line').attr('x1', mg.l).attr('x2', w - mg.r).attr('y1', (d) => y(d)).attr('y2', (d) => y(d));
    svg.append('g').selectAll('text').data(y.ticks(4)).join('text').attr('x', mg.l - 6).attr('y', (d) => y(d) + 3).attr('text-anchor', 'end').text((d) => D3.format('~s')(d));
    svg.append('g').selectAll('text').data(w < 480 ? [2005, 2015, 2025] : [2001, 2005, 2010, 2015, 2020, 2025]).join('text').attr('x', (d) => x(d)).attr('y', h - 7).attr('text-anchor', 'middle').text((d) => d);
    svg.append('line').attr('class', 'split').attr('x1', x(2012)).attr('x2', x(2012)).attr('y1', mg.t).attr('y2', h - mg.b);
    svg.append('text').attr('class', 'split-t').attr('x', x(2012) + 5).attr('y', mg.t + 8).text('VIIRS starts');
    [[N, 'naive'], [H, 'fair']].forEach(([f, cls]) => {
      svg.append('path').attr('class', 'ln ' + cls).attr('d', D3.line().x((p) => x(p.y)).y((p) => y(p.v))(f.pts));
      svg.append('path').attr('class', 'fitln ' + cls).attr('d', D3.line().x((yr) => x(yr)).y((yr) => y(Math.exp(f.a + f.b * yr)))([2001, 2025]));
    });
    const sc = DATA.score[sh.id] || {}, err = sc['V1_holdout.median_abs_err_pct'];
    const care = sh.c.tier === 'borrowed' ? ' Calibration is borrowed from other countries here, so treat the fair trend with extra care.' : sh.c.tier === 'blended' ? ' Calibration is partly borrowed here.' : '';
    body.innerHTML = `<div class="keys"><span><i style="background:#ffa597"></i>Glued record</span><span><i style="background:#fff"></i>Fair record (VIIRS units)</span><span><i class="dash"></i>trend line</span></div>
  <div class="score"><div><div class="n">${sp(N.pct)}</div><div class="l">a year on the glued record · range ${sp(N.lo)} to ${sp(N.hi)}</div></div><div><div class="n ${m.kind === 'agree' ? '' : 'bad'}">${sp(H.pct)}</div><div class="l">a year on the fair record · range ${sp(H.lo)} to ${sp(H.hi)}</div></div></div>
  <p>${trendVerdict(m.kind, N, H, m.n, m.h)}</p>
  <p class="note">Straight line through the log of each year's total, 2001 to 2025. Yearly totals are not independent, so the ranges are tighter than they should be. The fair trend is only as good as the MODIS to VIIRS conversion${err == null ? '' : ` (off by a median of ${err.toFixed(1)}% a year on held-out years here)`}.${care}</p>`;
  }

  /* ---------- the "what fire actually did" story scene ---------- */
  function initTrend() {
    const T = DATA.trends, sec = $('#trend'); if (!T || !sec) { if (sec) sec.remove(); return; }
    const rows = Object.entries(T), N = rows.length, cnt = (f, d) => rows.filter(([, r]) => r[f] === d).length;
    const flips = rows.filter(([, r]) => r.k === 'flip'), phantom = rows.filter(([, r]) => r.k === 'phantom').length, hid = rows.filter(([, r]) => r.k === 'hidden').length, over = rows.filter(([, r]) => r.k === 'overstated').length;
    const nUp = cnt('nd', 'up'), hUp = cnt('hd', 'up');
    $('#tr-title').textContent = `The glued record says fire is rising in ${nUp} of ${N} countries. The fair one says ${hUp}.`;
    $('#tr-lede').textContent = `Fit a straight line through each country's yearly total, 2001 to 2025. On the glued record the line points up almost everywhere, because of the 2012 jump. On the fair record it mostly does not. In ${flips.length} countries the two records disagree about the direction itself, and in ${phantom} more the glued record shows a trend that vanishes. Flip the switch and watch the globe change.`;
    const paint = (m) => {
      G.setTrendMap(Object.fromEntries(rows.map(([id, r]) => [id, m === 'n' ? r.nd : r.hd])));
      const f = m === 'n' ? 'nd' : 'hd';
      $('#tr-tally').innerHTML = `<b>${m === 'n' ? 'Glued record' : 'Fair record'}:</b> rising in <b>${cnt(f, 'up')}</b> · falling in <b>${cnt(f, 'down')}</b> · no clear trend in <b>${cnt(f, 'flat')}</b>`;
      $$('#tr-seg button').forEach((b) => b.classList.toggle('on', b.dataset.m === m));
    };
    $('#tr-seg').addEventListener('click', (e) => { const b = e.target.closest('button[data-m]'); if (b) paint(b.dataset.m); });
    const big = flips.sort((a, b) => b[1].tot - a[1].tot).slice(0, 6);
    $('#tr-list').innerHTML = `<li class="tr-h">Largest countries where the direction flips</li>` + big.map(([id, r]) => `<li><button type="button" data-id="${id}"><span>${DATA.byId[id].name}</span><span class="tr-a">${sp(r.n.pct)}</span><span aria-hidden="true">→</span><span class="tr-b">${sp(r.h.pct)}</span><small>a year</small></button></li>`).join('');
    $('#tr-list').addEventListener('click', (e) => { const b = e.target.closest('button[data-id]'); if (b) openPlace(b.dataset.id); });
    $('#tr-note').textContent = `Kinds of disagreement, of ${N} countries: ${flips.length} flip direction, ${phantom} show a glued trend that disappears, ${hid} have a trend the glued record hides, ${over} are the right direction but the wrong size. "Clearly" means the 95% range excludes zero. Yearly totals are not independent, so those ranges are optimistic, and the fair record is only as good as the MODIS to VIIRS conversion (the holdout test above).`;
    paint('n');
  }

  /* ---------- measured daily rhythm ----------
     Terra and Aqua are the same kind of camera, and their drift moved them to new local times. Scaled by what VIIRS
     saw (it never moved), their before and after passes give eight real points on this country's daily curve. */
  const pct = (x) => (x > 0 ? '+' : x < 0 ? '−' : '') + Math.abs(Math.round(x * 100)) + '%';
  const slopeAgrees = (m, b) => b != null && b > 0 && m.terra.slope / b > 0.5 && m.terra.slope / b < 1.5;
  let rhStat = null;
  /* over every country where both slopes exist: does agreement between them go with the fix working? */
  function rhythmStat() {
    if (rhStat || !RH || !DATA.diurnal) return rhStat;
    const a = { yes: 0, yesOk: 0, no: 0, noOk: 0, n: 0 };
    DATA.meta.countries.forEach((c) => {
      const r = DATA.score[c.id], gap = r && r['V2_terra_drift.gap_closed_pct']; if (!r || gap == null || r.b_adj == null) return;
      const m = RH.measure(DATA.diurnal[c.id]); if (!m.ok) return;
      a.n++; if (slopeAgrees(m, r.b_adj)) { a.yes++; if (gap > 0) a.yesOk++; } else { a.no++; if (gap > 0) a.noOk++; }
    });
    return (rhStat = a);
  }
  function drawRhythm() {
    const box = $('#rh'), body = $('#rh-body'), m = sh.rh; if (!box || !body) return;
    if (!m || !m.ok || !m.fit) {
      box.innerHTML = '';
      body.innerHTML = `<p>Too few detections here to measure the daily curve. It needs at least ${RH ? RH.MIN_N : 150} detections in each Terra and Aqua daytime pass, before and after the drift.</p><p class="note">Where it can be measured, this card shows eight real points on the country's daily fire curve.</p>`;
      return;
    }
    const w = Math.max(280, box.clientWidth || 640), h = Math.round(Math.max(200, Math.min(250, w * 0.4))), mg = { l: 36, r: 12, t: 20, b: 24 }, f = m.fit;   // drawn at real size so labels stay readable on phones
    const x = D3.scaleLinear().domain([0, 24]).range([mg.l, w - mg.r]);
    const top = Math.max(f.a, D3.max(m.pts, (p) => p.v)) * 1.14;
    const y = D3.scaleLinear().domain([0, top]).range([h - mg.b, mg.t]);
    const svg = D3.select(box).html('').append('svg').attr('class', 'rh').attr('viewBox', `0 0 ${w} ${h}`).attr('role', 'img')
      .attr('aria-label', `Daily fire curve for ${cname(sh.c)} with eight measured points: Terra and Aqua, day and night, before and after the drift.`);
    svg.append('g').attr('class', 'grid').selectAll('line').data(y.ticks(4)).join('line').attr('x1', mg.l).attr('x2', w - mg.r).attr('y1', (d) => y(d)).attr('y2', (d) => y(d));
    svg.append('g').selectAll('text').data(y.ticks(4)).join('text').attr('x', mg.l - 6).attr('y', (d) => y(d) + 3).attr('text-anchor', 'end').text((d) => D3.format('~g')(d));
    svg.append('g').selectAll('text').data(w < 480 ? [0, 6, 12, 18, 24] : [0, 3, 6, 9, 12, 15, 18, 21, 24]).join('text').attr('x', (d) => x(d)).attr('y', h - 7).attr('text-anchor', 'middle').text((d) => String(d).padStart(2, '0') + ':00');
    const ts = D3.range(0, 24.01, 0.25);
    svg.append('path').attr('class', 'fill').attr('d', D3.area().x((t) => x(t)).y0(y(0)).y1((t) => y(f.at(t)))(ts));
    svg.append('path').attr('class', 'ln').attr('d', D3.line().x((t) => x(t)).y((t) => y(f.at(t)))(ts));
    // each pass group: before (ring) -> after (dot)
    [['terra', 'day'], ['aqua', 'day'], ['terra', 'night'], ['aqua', 'night']].forEach(([sat, part]) => {
      const a = m.pts.find((p) => p.sat === sat && p.part === part && !p.late), b = m.pts.find((p) => p.sat === sat && p.part === part && p.late);
      const g = svg.append('g').attr('class', 'pt ' + sat);
      if (a && b) g.append('line').attr('x1', x(a.h)).attr('y1', y(a.v)).attr('x2', x(b.h)).attr('y2', y(b.v));
      [a, b].forEach((p) => { if (!p) return; g.append('circle').attr('class', p.late ? 'after' : 'before').attr('r', 5).attr('cx', x(p.h)).attr('cy', y(p.v)).append('title').text(`${p.name}, ${p.period}, ${part}: ${S.fmtH(p.h)} local, ${p.n.toLocaleString('en-US')} detections`); });
      if (a && b && part === 'day') {
        const left = sat === 'terra', hi = a.v > b.v ? a : b;
        g.append('text').attr('x', x(hi.h) + (left ? -10 : 10)).attr('y', y(hi.v) - 8).attr('text-anchor', left ? 'end' : 'start').text(`${a.name} ${S.fmtH(a.h)} → ${S.fmtH(b.h)}`);
      }
    });
    const sc = DATA.score[sh.id] || {}, b = sc.b_adj, T = m.terra, A = m.aqua, agree = slopeAgrees(m, b), st = rhythmStat();
    const peak = m.peakSeen ? `The curve turns over near ${S.fmtH(f.pk)}.` : A.slope > 0.05 ? `Fire was still rising at Aqua's latest pass (${S.fmtH(A.to.h)}), so the peak comes after that. No satellite here looks later in the day.` : `Between ${S.fmtH(A.from.h)} and ${S.fmtH(A.to.h)} Aqua's catch barely moved (${pct(A.change)}), so the peak sits close to those hours.`;
    const verdict = b == null || !(b > 0) ? 'There is no swath slope to compare with here.'
      : agree ? `<b>Two independent measurements agree.</b> The swath trick, fitted only on data from before 2020, says detections rise ${b.toFixed(2)} per hour in the morning. What Terra actually lost after it drifted says ${T.slope.toFixed(2)}. The correction stands on solid ground here.`
        : T.slope < b ? `<b>The two measurements disagree.</b> The swath trick predicts a rise of ${b.toFixed(2)} per hour, but the drift cost Terra much less than that (${T.slope.toFixed(2)}). So the fix over-corrects here. ${sh.id === 'India' ? 'In India the burning itself moved later in the day, so the rhythm changed between the two periods.' : 'Either the daily rhythm changed between the two periods, or the swath slope is picking up something other than the clock.'}`
          : `<b>The two measurements disagree.</b> The swath trick predicts a rise of ${b.toFixed(2)} per hour, but the drift cost Terra more than that (${T.slope.toFixed(2)}). So the fix under-corrects here.`;
    body.innerHTML = `<div class="keys"><span><i style="background:#ffd27a"></i>Terra</span><span><i style="background:#ff8a4a"></i>Aqua</span><span><i class="ring"></i>2012 to 2019</span><span><i style="background:#fff"></i>2022 to 2025</span></div>
  <div class="score three"><div><div class="n">${pct(T.change)}</div><div class="l">Terra's catch after sliding from ${S.fmtH(T.from.h)} to ${S.fmtH(T.to.h)}</div></div><div><div class="n ${b != null && !agree ? 'bad' : ''}">${T.slope.toFixed(2)}</div><div class="l">rise per hour, measured from the drift</div></div><div><div class="n">${b == null ? 'n/a' : b.toFixed(2)}</div><div class="l">rise per hour, from the swath trick (what the fix uses)</div></div></div>
  <p>${verdict}</p><p>${peak}</p>
  <p class="note">Each point is Terra or Aqua detections divided by what VIIRS saw in daytime in the same years. VIIRS never drifted, so that removes "more fire" and leaves "different time of day". Rings are before the drift, dots after. The line is only a guide through the eight points; hours no satellite visits are not measured.${st && st.yes && st.no ? ` Across ${st.n} countries, the fix helped in ${Math.round(100 * st.yesOk / st.yes)}% of those where the two slopes agree and ${Math.round(100 * st.noOk / st.no)}% where they do not.` : ''} Assumes Terra and Aqua detect alike and the rhythm did not change between the periods.</p>`;
  }

  /* the story chart: lay the pooled measurement over the schematic, so the page says how close the sketch is */
  function storyRhythm() {
    if (!RH || !DATA.diurnal) return;
    const m = RH.measure(RH.pool(DATA.diurnal, DATA.meta.countries.map((c) => c.id))); if (!m.ok) return;
    const k = Math.exp(D3.mean(m.pts, (p) => Math.log(S.D(p.h)) - Math.log(p.v)));   // one scale factor: the sketch has no units
    const g = dsvg2.append('g').attr('class', 'meas');
    m.pts.forEach((p) => g.append('circle').attr('class', p.sat + (p.late ? ' after' : ' before')).attr('r', 4).attr('cx', dx(p.h)).attr('cy', dyS(Math.min(1.04, p.v * k))).append('title').text(`${p.name}, ${p.period}, ${p.part}: ${S.fmtH(p.h)} local`));
    const el = $('#rh-story');
    el.innerHTML = `The line is a sketch. The dots are measured: Terra (yellow) and Aqua (orange) in ${DATA.meta.countries.length} countries, before the drift (rings) and after (dots), scaled by VIIRS. Sliding from ${S.fmtH(m.terra.from.h)} to ${S.fmtH(m.terra.to.h)} cost Terra <b>${Math.abs(Math.round(m.terra.change * 100))}%</b> of its detections. Open a country to see its own curve.`;
    el.hidden = false;
  }
  const toast = (t) => { const el = $('#toast'); if (!el) return; el.textContent = t; clearTimeout(toast.t); toast.t = setTimeout(() => (el.textContent = ''), 5000); };

  function refreshPasses() {
    const s = sh.s, i = sh.idx, H = s.hours;
    const t = H.hT[i], a = H.hA[i], v = H.hS[i] != null ? H.hS[i] : H.hN[i];
    $$('.hs', cardsEl).forEach((e) => (e.innerHTML = ''));
    const put = (h, cls, txt) => { if (h == null) return; const el = $(`.hr[data-h="${Math.floor(h) % 24}"] .hs`, cardsEl); if (el) el.insertAdjacentHTML('beforeend', `<b class="${cls}">${txt}</b>`); };
    put(t, 't', 'T'); put(a, 'a', 'A'); put(v, 'v', 'V');
    const tm = $('#tod-marks'); if (tm) { let prev = -99, row = 0; tm.innerHTML = [[t, 't', 'Terra'], [a, 'a', 'Aqua'], [v, 'v', 'VIIRS']].filter((x) => x[0] != null).sort((p, q) => p[0] - q[0]).map((x) => { row = x[0] - prev < 3.6 ? (row + 1) % 3 : 0; prev = x[0]; return `<b class="${x[1]}" style="left:${(x[0] / 24 * 100).toFixed(1)}%;top:${row * 1.25}rem">${x[2]}</b>`; }).join(''); tm.style.height = '3.7rem'; }
    const bits = [];
    if (t != null) bits.push(`<b style="color:#ffd27a">Terra ${S.fmtH(t)}</b>`);
    if (a != null) bits.push(`<b style="color:#ff9d62">Aqua ${S.fmtH(a)}</b>`);
    if (v != null) bits.push(`<b style="color:#b6d4ff">VIIRS ${S.fmtH(v)}</b>`);
    $('#day-line').innerHTML = bits.length ? bits.join(' &nbsp;·&nbsp; ') + ` <span style="opacity:.75">in ${ymLabel(s.months[i])}</span>` : 'No satellite pass data this month.';
    $$('.hr', cardsEl).forEach((b) => b.classList.toggle('on', +b.dataset.h === Math.floor(sh.hour)));
  }

  const RAMP = D3.interpolateRgbBasis(['rgba(255,255,255,0.14)', '#ffe9a8', '#ff9a3a', '#ff4d0e', '#b61a00']);
  function buildCalendar() {
    const s = sh.s, by = new Map(s.months.map((m, i) => [m, i])), p = D3.quantile(s.harm.slice().sort(D3.ascending), 0.97) || 1;
    const years = D3.range(2000, 2026);
    let h = '<div></div>' + years.map((y) => `<div class="c-yr" role="columnheader">${y % 5 === 0 ? y : ''}</div>`).join('');
    for (let m = 1; m <= 12; m++) {
      h += `<div class="c-mo" role="rowheader">${MON[m - 1]}</div>`;
      years.forEach((y) => {
        const i = by.get(y * 100 + m);
        if (i == null) { h += '<div class="c-cell empty" role="gridcell"></div>'; return; }
        const z = s.z[i], flag = z >= 2 ? '<b>▲</b>' : z <= -2 ? '<b class="lo">▼</b>' : '';
        h += `<button type="button" class="c-cell" role="gridcell" data-i="${i}" style="background:${RAMP(Math.sqrt(Math.max(0, s.harm[i]) / p))}" aria-label="${ymLabel(y * 100 + m)}: ${fmt(s.harm[i])} detections${z >= 2 ? ', unusually high' : z <= -2 ? ', unusually low' : ''}">${flag}</button>`;
      });
    }
    $('#cal').innerHTML = h;
    $('#cal').addEventListener('click', (e) => { const b = e.target.closest('.c-cell[data-i]'); if (b) selectIdx(+b.dataset.i); });
  }

  function drawOrbit() {
    const s = sh.s, w = 420, hh = 190, m = { l: 36, r: 8, t: 10, b: 22 };
    const yy = (mo) => Math.floor(mo / 100) + (mo % 100 - 0.5) / 12;
    const x = D3.scaleLinear().domain([2000.8, 2026]).range([m.l, w - m.r]), y = D3.scaleLinear().domain([8, 16]).range([hh - m.b, m.t]);
    const svg = D3.select('#orb').html('').append('svg').attr('class', 'orb').attr('viewBox', `0 0 ${w} ${hh}`);
    svg.append('g').attr('class', 'grid').selectAll('line').data([9, 10.5, 12, 13.5, 15]).join('line').attr('x1', m.l).attr('x2', w - m.r).attr('y1', (d) => y(d)).attr('y2', (d) => y(d));
    svg.selectAll('.yl').data([9, 10.5, 12, 13.5, 15]).join('text').attr('x', m.l - 5).attr('y', (d) => y(d) + 3).attr('text-anchor', 'end').text((d) => S.fmtH(d));
    svg.selectAll('.xl').data([2000, 2005, 2010, 2015, 2020, 2025]).join('text').attr('x', (d) => x(d)).attr('y', hh - 6).attr('text-anchor', 'middle').text((d) => d);
    [['hT', 't'], ['hA', 'a'], ['hS', 's']].forEach(([k, c]) => {
      const pts = s.months.map((mo, i) => [mo, s.hours[k][i]]).filter((d) => d[1] != null);
      svg.append('path').attr('class', 'ln ' + c).attr('d', D3.line().x((d) => x(yy(d[0]))).y((d) => y(d[1]))(pts));
    });
  }

  function drawBA() {
    const s = sh.s, wrap = $('#ba'), w = wrap.clientWidth || 600, h = Math.max(240, Math.min(340, w * 0.36)), m = { l: 46, r: 12, t: 12, b: 24 };
    const svg = D3.select('#ba-svg').attr('viewBox', `0 0 ${w} ${h}`).attr('width', w).attr('height', h); svg.selectAll('*').remove();
    const yy = (mo) => Math.floor(mo / 100) + (mo % 100 - 0.5) / 12;
    const pts = (arr) => s.months.map((mo, i) => ({ x: yy(mo), v: arr[i] }));
    const camera = sh.mode === 'camera';
    const A = pts(camera ? s.naive : s.terra_raw_vu), B = pts(camera ? s.harm : s.terra_vu), R = pts(s.viirs_vu);
    const x = D3.scaleLinear().domain([2000.8, 2026]).range([m.l, w - m.r]);
    const top = D3.max([...A, ...B, ...R].map((d) => d.v || 0)) * 1.06 || 1;
    const y = D3.scaleLinear().domain([0, top]).range([h - m.b, m.t]).nice();
    svg.append('g').attr('class', 'grid').selectAll('line').data(y.ticks(4)).join('line').attr('x1', m.l).attr('x2', w - m.r).attr('y1', (d) => y(d)).attr('y2', (d) => y(d));
    svg.append('g').selectAll('text').data(y.ticks(4)).join('text').attr('x', m.l - 6).attr('y', (d) => y(d) + 3).attr('text-anchor', 'end').text((d) => D3.format('~s')(d));
    svg.append('g').selectAll('text').data([2000, 2005, 2010, 2015, 2020, 2025]).join('text').attr('x', (d) => x(d)).attr('y', h - 7).attr('text-anchor', 'middle').text((d) => d);
    const ann = svg.append('g').attr('class', 'ann');
    (camera ? [[2012.1, 'VIIRS starts']] : [[2020.3, 'drift begins']]).forEach(([yv, t]) => { ann.append('line').attr('x1', x(yv)).attr('x2', x(yv)).attr('y1', m.t).attr('y2', h - m.b); ann.append('text').attr('x', x(yv) + 5).attr('y', m.t + 20).text(t); });
    const line = (d) => D3.line().defined((p) => p.v != null && isFinite(p.v)).x((p) => x(p.x)).y((p) => y(p.v))(d);
    const defs = svg.append('defs');
    defs.append('clipPath').attr('id', 'cL').append('rect').attr('id', 'cLr').attr('height', h);
    defs.append('clipPath').attr('id', 'cR').append('rect').attr('id', 'cRr').attr('height', h);
    const gL = svg.append('g').attr('clip-path', 'url(#cL)');
    gL.append('path').attr('class', 'ln ' + (camera ? 'naive' : 'rawT')).attr('d', line(A));
    if (!camera) gL.append('path').attr('class', 'ln ref').attr('d', line(R));
    const gR = svg.append('g').attr('clip-path', 'url(#cR)');
    if (camera) gR.append('path').attr('class', 'band').attr('d', D3.area().x((_, i) => x(yy(s.months[i]))).y0((_, i) => y(s.lo[i])).y1((_, i) => y(s.hi[i]))(s.months));
    gR.append('path').attr('class', 'ln harm').attr('d', line(B));
    if (!camera) gR.append('path').attr('class', 'ln ref').attr('d', line(R));
    if (camera) gR.selectAll('circle').data(s.months.map((mo, i) => ({ mo, i })).filter((d) => Math.abs(s.z[d.i]) >= 2)).join('circle').attr('class', (d) => 'an ' + (s.z[d.i] > 0 ? 'hi' : 'lo')).attr('r', 3.3).attr('cx', (d) => x(yy(d.mo))).attr('cy', (d) => y(s.harm[d.i]));
    svg.append('g').attr('class', 'selm').attr('id', 'selm');
    const dv = svg.append('g').attr('class', 'dv').attr('id', 'dv').attr('tabindex', 0).attr('role', 'slider').attr('aria-label', 'Before and after divider').attr('aria-valuemin', 0).attr('aria-valuemax', 100);
    dv.append('line').attr('y1', 0).attr('y2', h); dv.append('rect').attr('x', -15).attr('y', h / 2 - 15).attr('width', 30).attr('height', 30).attr('rx', 15);
    dv.append('path').attr('d', `M -5 ${h / 2 - 5} l -5 5 l 5 5 M 5 ${h / 2 - 5} l 5 5 l -5 5`);
    sh.geom = { x, y, w, h, m };
    placeDivider(); drawMark();
    $('#ba-note').textContent = camera ? 'Left: raw MODIS counts, then raw VIIRS counts, glued at 2012. The jump is the camera. Right: everything on one VIIRS scale, with a 95% band.' : 'Left: Terra alone in VIIRS units, with the drift wiping out its counts after 2020. Right: Terra corrected for its pass time. The dashed line is VIIRS, which never drifted.';
    if (!wrap._wired) {
      wrap._wired = true; let on = false;
      const set = (cx) => { const r = wrap.getBoundingClientRect(), g = sh.geom; sh.div = clamp((cx - r.left - g.m.l) / (g.w - g.m.l - g.m.r), 0, 1); placeDivider(); };
      wrap.addEventListener('pointerdown', (e) => { on = true; wrap.setPointerCapture(e.pointerId); set(e.clientX); });
      wrap.addEventListener('pointermove', (e) => { if (on) set(e.clientX); });
      wrap.addEventListener('pointerup', () => (on = false));
      wrap.addEventListener('pointercancel', () => (on = false));   // a touch that turns into a page scroll must not leave the divider stuck to the finger
      wrap.addEventListener('keydown', (e) => { if (!e.target.closest('#dv')) return; const d = e.shiftKey ? 0.1 : 0.03; if (e.key === 'ArrowLeft') { sh.div = Math.max(0, sh.div - d); placeDivider(); e.preventDefault(); } if (e.key === 'ArrowRight') { sh.div = Math.min(1, sh.div + d); placeDivider(); e.preventDefault(); } });
    }
  }
  function placeDivider() {
    const g = sh.geom; if (!g) return; const px = g.m.l + sh.div * (g.w - g.m.l - g.m.r);
    D3.select('#cLr').attr('x', 0).attr('width', px); D3.select('#cRr').attr('x', px).attr('width', g.w - px);
    D3.select('#dv').attr('transform', `translate(${px},0)`).attr('aria-valuenow', Math.round(sh.div * 100));
    const l = $('.ba .lab.l'), r = $('.ba .lab.r'); if (l) l.style.opacity = sh.div > 0.14 ? 1 : 0.15; if (r) r.style.opacity = sh.div < 0.86 ? 1 : 0.15;
  }
  function drawMark() {
    const g = D3.select('#selm'); if (g.empty() || !sh.geom) return; g.selectAll('*').remove();
    const mo = sh.s.months[sh.idx], px = sh.geom.x(Math.floor(mo / 100) + (mo % 100 - 0.5) / 12);
    g.append('line').attr('x1', px).attr('x2', px).attr('y1', sh.geom.m.t).attr('y2', sh.geom.h - sh.geom.m.b);
    g.append('circle').attr('r', 5).attr('cx', px).attr('cy', sh.geom.y(sh.s.harm[sh.idx]));
  }

  function downloadCSV() {
    const s = sh.s, q = (v) => (typeof v === 'string' && /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v == null ? '' : v);
    const head = ['area', 'month', 'harmonized_fires_viirs_equiv', 'lower_95', 'upper_95', 'record_source', 'anomaly_z', 'anomaly_flag', 'modis_terra_count', 'modis_aqua_count', 'viirs_snpp_count', 'viirs_noaa20_count', 'naive_glued_count', 'modis_drift_corrected_viirs_equiv', 'modis_uncorrected_viirs_equiv', 'terra_day_overpass_local_hour', 'aqua_day_overpass_local_hour', 'fire_radiative_power_mw_total'];
    const rows = s.months.map((ym, i) => { const z = s.z[i]; return [s.label, `${Math.floor(ym / 100)}-${String(ym % 100).padStart(2, '0')}`, s.harm[i], s.lo[i], s.hi[i], s.source[i], z, z >= 2 ? 'high' : z <= -2 ? 'low' : '', s.T[i], s.A[i], s.S[i], s.N[i], s.naive[i], s.modis_vu[i], s.modis_raw_vu[i], s.hours.hT[i], s.hours.hA[i], s.frp[i]].map(q).join(','); });
    const url = URL.createObjectURL(new Blob([[head.join(',')].concat(rows).join('\n')], { type: 'text/csv' }));
    const a = document.createElement('a'); a.href = url; a.download = `sundial_${sh.id}_monthly.csv`; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 2000);
    toast('Saved the monthly table.');
  }

  /* ============ globe interactions ============ */
  const gtip = $('#gtip');
  function hideTip() { gtip.hidden = true; }
  G.onHover((id, x, y) => {
    if (!id || st.sheetOpen) { hideTip(); return; }
    const tr = focusId === 'trend' && DATA.trends && DATA.trends[id];
    if (tr) { gtip.innerHTML = `${DATA.byId[id].name}<small>glued ${sp(tr.n.pct)} a year · fair ${sp(tr.h.pct)} a year · tap to open</small>`; gtip.style.left = x + 'px'; gtip.style.top = y + 'px'; gtip.hidden = false; return; }
    const s = DATA.series[id];
    gtip.innerHTML = s ? `${DATA.byId[id].name}<small>${ymLabel(s.months[s.months.length - 1])} · ${fmt(s.harm[s.months.length - 1])} fires · tap to open</small>` : `${DATA.byId[id].name}<small>tap to open</small>`;
    gtip.style.left = x + 'px'; gtip.style.top = y + 'px'; gtip.hidden = false;
  });
  G.onPick((id) => { hideTip(); openPlace(id); });

  /* ============ boot ============ */
  layoutTitle(); setYear(2000); onScroll();
  G.start(); requestAnimationFrame(frame);
  addEventListener('resize', () => { if (st.sheetOpen && sh.s) { drawBA(); drawRhythm(); drawTrend(); } });

  const minWait = new Promise((r) => setTimeout(r, reduce ? 100 : 1900));
  Promise.all([DATA.ready.catch((e) => { console.error(e); return null; }), (document.fonts && document.fonts.ready) || 0, minWait]).then(async ([d]) => {
    layoutTitle();
    document.body.classList.remove('loading');
    if (!reduce) { const t0 = performance.now(); (function unmelt(now) { const t = clamp((now - t0) / 2200, 0, 1); baseYear = 2050 - 67 * (1 - Math.pow(1 - t, 3)); placeTitle(); if (t < 1) requestAnimationFrame(unmelt); })(t0); }
    if (!d) { $('.explore-hint').textContent = 'The data files did not load. Open this page over http(s), not as a local file.'; $('#country-search-status').textContent = 'Country data could not be loaded. Refresh to try again.'; return; }
    initEvidence(); storyRhythm(); initTrend(); if (window.EXTRAS) window.EXTRAS.init(DATA); fitSticky();
    initSources();
    $('.explore-hint').innerHTML = `<span aria-hidden="true">⟲</span> Next to each card the globe is live: drag it, and tap a glowing country (brighter = more fire). ${DATA.meta.countries.length} countries.`;
    await buildPlaces();
    // share links: #place=<id>&m=<yyyymm>&box=w,s,e,n. Ids can contain hyphens (Guinea-Bissau, Timor-Leste).
    const fromHash = async () => {
      const params = new URLSearchParams(location.hash.slice(1)), id = params.get('place');
      if (!id || !DATA.byId[id]) {
        if (st.sheetOpen && !params.has('place')) closePlace();
        else if (st.sheetOpen && sh.s) updatePlaceLink();   // unknown country in a pasted link: keep the address honest
        return;
      }
      const s = await DATA.loadSeries(id), idx = s.months.indexOf(+params.get('m'));
      const box = params.has('box') ? params.get('box').split(',').map(Number) : null;
      openPlace(id, { ...(idx >= 0 ? { idx } : {}), ...(SEASON.bounds(box) ? { box } : {}) });
    };
    addEventListener('hashchange', fromHash);   // a link pasted into an open tab, or the back button
    fromHash();
    let wanted = ''; try { wanted = decodeURIComponent(location.hash.slice(1)); } catch (e) { /* malformed */ }
    if (wanted && !/^place=/.test(wanted) && document.getElementById(wanted)) setTimeout(() => goTo(wanted, { silent: true }), 400);   // a link like #swath lands there, gliding
  });
})();
