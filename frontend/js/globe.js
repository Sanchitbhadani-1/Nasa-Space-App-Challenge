/* SUNDIAL globe: one canvas that is the hero art, the thing you explore, and the map behind each country sheet. */
(function () {
  const S = window.SUN;
  const { land, borders, D: diurnal } = S;
  const $ = (s) => document.querySelector(s);
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const cv = $('#globe'), ctx = cv.getContext('2d');
  let W = 0, H = 0, DPR = 1, stars = [];
  const proj = d3.geoOrthographic().clipAngle(90).precision(1.1);
  const path = d3.geoPath(proj, ctx);
  const proj2 = d3.geoOrthographic().clipAngle(90).precision(5), path2 = d3.geoPath(proj2, ctx);   // coarser resampling for the 182 country shapes
  const grat = d3.geoGraticule10();

  const T = { utc: 11, month: 9.2, playing: !reduce, utcTarget: null, monthTarget: null };
  const V = { lon: -45, lat: 8, R: 300, cx: 0, cy: 0, glass: 0, ring: 0.3, band: 0, ctry: 1, labels: 0, light: 0, trend: 0, vis: 1, flat: 0, intro: 0 };   // vis: 0 when the globe has slid away; flat: 0 globe .. 1 flat world map
  let trendMap = null;   // id -> 'up' | 'down' | 'flat': paints whole countries by the direction of their fire trend
  const TREND_COL = { up: 'rgba(255,106,26,.62)', down: 'rgba(125,178,255,.62)', flat: 'rgba(243,234,217,.2)' };
  let F = { layout: 'hero', lon: -45, lat: 8, auto: true, ring: 0.3 };
  let hover = null, selected = null, dragging = false, userUntil = 0, autoLon = -45, inited = false, running = false, last = performance.now();
  let flagTex = null, pickCb = null, hoverCb = null, bandInfo = () => ({ h: 13.5, c: '125,178,255', label: 'VIIRS' });

  const wrap = (a) => ((((a + 180) % 360) + 360) % 360) - 180;
  const angDiff = (a, b) => wrap(a - b);
  const hdiff = (a, b) => ((((a - b + 12) % 24) + 24) % 24) - 12;

  function resize() {
    if (W && window.innerWidth === W && Math.abs(window.innerHeight - H) < 140 && matchMedia('(hover: none)').matches) return;   // toolbar show/hide on a phone
    DPR = Math.min(window.devicePixelRatio || 1, 1.25);
    W = window.innerWidth; H = window.innerHeight;
    cv.width = Math.round(W * DPR); cv.height = Math.round(H * DPR);
    cv.style.width = W + 'px'; cv.style.height = H + 'px';
    if (typeof flatCv !== 'undefined') { flatCv.width = cv.width; flatCv.height = cv.height; flatCv.style.width = W + 'px'; flatCv.style.height = H + 'px'; flatDirty = true; }
    const r = S.rng(77);
    stars = Array.from({ length: 300 }, () => ({ x: r() * W, y: r() * H, a: 0.12 + r() * 0.55, s: r() < 0.08 ? 1.7 : r() < 0.3 ? 1.1 : 0.7, ph: r() * 6.3, sp: 0.6 + r() * 1.4 }));
  }

  /* where on screen and how big, for each kind of scene */
  function layout(f) {
    const mobile = W < 860;
    if (f.layout === 'hero') return { R: mobile ? Math.min(W * 0.46, H * 0.3) : Math.min(W * 0.36, H * 0.4), cx: W / 2, cy: mobile ? H * 0.44 : H * 0.47 };
    if (f.layout === 'explore') return { R: Math.min(W * 0.42, H * (mobile ? 0.28 : 0.36)), cx: W / 2, cy: mobile ? H * 0.38 : H * 0.44 };
    if (f.layout === 'sheet') {
      const spanDeg = Math.max(2, f.span || 20);
      const fit = Math.min(W * (mobile ? 0.9 : 0.5), H * 0.36);
      return { R: Math.min(9000, fit / (spanDeg * Math.PI / 180)), cx: mobile ? W / 2 : W * 0.5, cy: mobile ? H * 0.2 : H * 0.24 };
    }
    // story: where the globe sits is up to each scene (f.at = fractions of the screen), and it can slide away or unfold into a flat map
    const k = f.k || 1, at = f.at || [0.7, 0.5];
    let R, cx, cy;
    if (mobile) { R = Math.min(W * 0.4, H * 0.27) * k; cx = W / 2; cy = H * 0.28; }
    else { R = Math.min(H * 0.4, W * 0.27) * k; cx = W * at[0]; cy = H * at[1]; }
    if (f.form === 'flat') { const b = flatBox(); R *= 1.12; cx = b.x + b.w / 2; cy = b.y + b.h / 2; }
    if (f.away) { cx += (f.awayDir || 1) * W * (mobile ? 0.5 : 0.32); R *= 0.8; }
    return { R, cx, cy };
  }

  /* the rectangle the flat world map fills: right of the text column on a desktop, under the title on a phone */
  function flatBox() {
    const mobile = W < 860;
    if (mobile) { const w = W * 0.94, h = Math.min(w / 2.05, H * 0.3); return { x: W * 0.03, y: H * 0.1, w, h }; }
    const w = Math.min(W * 0.5, H * 1.35), h = w / 2.05;   // the text column is on the left, so the map takes the right half
    return { x: W * 0.985 - w, y: (H - h) / 2, w, h };
  }

  const tone = (a) => { const l = V.light; return `rgba(${Math.round(243 + (28 - 243) * l)},${Math.round(234 + (21 - 234) * l)},${Math.round(217 + (16 - 217) * l)},${a})`; };

  function sunPos() {
    const lon = (12 - T.utc) * 15;
    const doy = (T.month - 1) * 30.4 + 15;
    return [wrap(lon), 23.44 * Math.sin(((2 * Math.PI) / 365) * (doy - 80))];
  }

  /* ---- fly-overs: a MODIS satellite and a VIIRS satellite cross the globe every so often, lighting the fires they see ---- */
  const SATS = [
    { name: 'TERRA', sensor: 'MODIS', res: '1 km pixels', h: S.terraH(2026), dir: -1, w: 5.2, c: '255,198,90', cl: '176,104,6' },
    { name: 'SUOMI NPP', sensor: 'VIIRS', res: '375 m pixels', h: 13.5, dir: 1, w: 6.6, c: '125,178,255', cl: '29,95,180' },
    { name: 'AQUA', sensor: 'MODIS', res: '1 km pixels', h: S.aquaH(2026), dir: 1, w: 5.2, c: '255,106,26', cl: '200,60,8' },
    { name: 'NOAA-20', sensor: 'VIIRS', res: '375 m pixels', h: 13.4, dir: 1, w: 6.6, c: '160,205,255', cl: '40,112,205' }
  ];
  let fly = null, flyIdx = 0, flyWait = 0, nextFly = performance.now() + 4500, curFly = null;
  function startFly(now) {
    const s = SATS[flyIdx % SATS.length];
    const lon0 = wrap((s.h - T.utc) * 15);
    if (Math.abs(angDiff(lon0, V.lon)) > 58) { if (++flyWait > 14) { flyIdx++; flyWait = 0; } nextFly = now + 1200; return; }
    fly = { s, lon0, t0: now, dur: 7000, end: 0 }; flyIdx++; flyWait = 0;
  }
  function updateFly(now) {
    if (!fly && now > nextFly && !reduce && F.layout === 'hero' && !dragging && !document.hidden) startFly(now);   // only on the title screen; inside a section nothing happens on a timer
    curFly = null; if (!fly) return;
    const u = (now - fly.t0) / fly.dur; let a = 1;
    if (u >= 1) { if (!fly.end) fly.end = now; a = 1 - (now - fly.end) / 1400; if (a <= 0) { fly = null; nextFly = now + 9000 + Math.random() * 6000; return; } }
    const uu = Math.min(1, u), lat = fly.s.dir < 0 ? 84 - 168 * uu : -84 + 168 * uu;
    curFly = { s: fly.s, lon: fly.lon0, lat, a, w: fly.s.w, dir: fly.s.dir };
  }
  /* ---- satellites: a small, properly drawn spacecraft and a soft footprint. No hard outlines, nothing thick. ---- */
  const rr = (x, y, w, h, r) => { if (ctx.roundRect) { ctx.beginPath(); ctx.roundRect(x, y, w, h, r); } else { ctx.beginPath(); ctx.rect(x, y, w, h); } };
  /* drawn at the origin, travelling along +x: soft glow, two solar wings with cell lines, a lit body and a lens */
  function sprite(k, c) {
    const gl = ctx.createRadialGradient(0, 0, 0, 0, 0, 24 * k); gl.addColorStop(0, `rgba(${c},.42)`); gl.addColorStop(0.45, `rgba(${c},.12)`); gl.addColorStop(1, `rgba(${c},0)`);
    ctx.fillStyle = gl; ctx.beginPath(); ctx.arc(0, 0, 24 * k, 0, 6.3); ctx.fill();
    for (const sg of [-1, 1]) {
      ctx.save(); ctx.scale(1, sg);
      ctx.strokeStyle = 'rgba(243,234,217,.7)'; ctx.lineWidth = 0.9 * k; ctx.beginPath(); ctx.moveTo(0, 3.4 * k); ctx.lineTo(0, 6 * k); ctx.stroke();   // arm
      const wg = ctx.createLinearGradient(-3 * k, 0, 3 * k, 0); wg.addColorStop(0, 'rgba(150,178,230,.95)'); wg.addColorStop(1, 'rgba(96,126,190,.95)');
      ctx.fillStyle = wg; rr(-3 * k, 6 * k, 6 * k, 10 * k, 1 * k); ctx.fill();
      ctx.strokeStyle = 'rgba(14,22,48,.5)'; ctx.lineWidth = 0.6 * k; ctx.stroke();
      ctx.beginPath(); for (let i = 1; i < 3; i++) { ctx.moveTo(-3 * k, (6 + i * 3.33) * k); ctx.lineTo(3 * k, (6 + i * 3.33) * k); } ctx.moveTo(0, 6 * k); ctx.lineTo(0, 16 * k); ctx.stroke();   // cells
      ctx.restore();
    }
    const bg = ctx.createLinearGradient(0, -4 * k, 0, 4 * k); bg.addColorStop(0, '#fff3dc'); bg.addColorStop(0.35, `rgb(${c})`); bg.addColorStop(1, `rgb(${c})`);
    ctx.fillStyle = bg; rr(-4.6 * k, -3.8 * k, 9.2 * k, 7.6 * k, 2 * k); ctx.fill();
    ctx.strokeStyle = 'rgba(10,9,8,.5)'; ctx.lineWidth = 0.7 * k; ctx.stroke();
    ctx.fillStyle = 'rgba(10,9,8,.72)'; ctx.beginPath(); ctx.arc(2.2 * k, 0, 1.5 * k, 0, 6.3); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,.8)'; ctx.beginPath(); ctx.arc(1.7 * k, -0.5 * k, 0.5 * k, 0, 6.3); ctx.fill();
  }
  /* a small label on a dark pill, so it reads over land, ocean and fire alike */
  function tag(text, x, y, c, a) {
    ctx.font = '700 10.5px "Hanken Grotesk", system-ui, sans-serif'; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    const w = ctx.measureText(text).width + 14;
    ctx.fillStyle = `rgba(10,9,8,${0.74 * a})`; rr(x, y - 9, w, 18, 9); ctx.fill();
    ctx.fillStyle = `rgba(${c},${a})`; ctx.fillText(text, x + 7, y + 0.5); ctx.textBaseline = 'alphabetic';
  }
  /* the ground track: a thin dotted line along the satellite's meridian, with a barely-there footprint beside it */
  function track(lon, lo, hi, half, c, a) {
    if (hi - lo < 0.5) return;
    ctx.fillStyle = `rgba(${c},${0.06 * a})`; ctx.beginPath(); path(d3.geoGraticule().extent([[lon - half, lo], [lon + half, hi]]).outline()); ctx.fill();
    ctx.save(); ctx.setLineDash([1.5, 6]); ctx.lineCap = 'round'; ctx.strokeStyle = `rgba(${c},${0.6 * a})`; ctx.lineWidth = 1.3;
    ctx.beginPath(); path({ type: 'LineString', coordinates: [[lon, lo], [lon, hi]] }); ctx.stroke(); ctx.restore();
  }
  function drawFly() {
    if (!curFly) return;
    const f = curFly, s0 = f.s, c = s0.c, tc = V.light > 0.5 && s0.cl ? s0.cl : s0.c, lam = V.lon * Math.PI / 180, phi = V.lat * Math.PI / 180;
    const vis = (lon, lat) => { const a = lon * Math.PI / 180, b = lat * Math.PI / 180; return Math.cos(b) * Math.cos(a) * Math.cos(phi) * Math.cos(lam) + Math.cos(b) * Math.sin(a) * Math.cos(phi) * Math.sin(lam) + Math.sin(b) * Math.sin(phi) > 0.07; };
    track(f.lon, f.dir < 0 ? f.lat : -84, f.dir < 0 ? 84 : f.lat, f.w * 0.8, tc, f.a);
    if (!vis(f.lon, f.lat)) return;
    const lift = (ll) => { const q = proj(ll); return [V.cx + (q[0] - V.cx) * 1.08, V.cy + (q[1] - V.cy) * 1.08]; };
    const p = lift([f.lon, f.lat]), p2 = lift([f.lon, f.lat + f.dir * 3]);
    const ang = Math.atan2(p2[1] - p[1], p2[0] - p[0]), k = Math.max(0.85, Math.min(2.1, V.R / 270));
    ctx.save(); ctx.translate(p[0], p[1]); ctx.rotate(ang); ctx.globalAlpha = f.a; sprite(k, c); ctx.restore();
    if (F.layout === 'hero') { ctx.globalAlpha = 1; return; }   // title screen: just the satellite, no caption
    ctx.globalAlpha = 1;
    tag(`${s0.name} · ${s0.sensor}`, p[0] + 22 * k, p[1] - 9, c, f.a);
    ctx.font = '600 10px "Hanken Grotesk", system-ui, sans-serif'; ctx.textAlign = 'left'; ctx.fillStyle = tone(0.8 * f.a);
    ctx.fillText(`${s0.res} · passes ~${S.fmtH(s0.h)} local time now`, p[0] + 22 * k + 2, p[1] + 17);
  }

  function hit(px, py) {
    if (!window.DATA.features) return null;
    let ll;
    if (V.flat > 0.5) { ll = fproj.invert([px, py]); if (!ll || !isFinite(ll[0]) || !isFinite(ll[1]) || Math.abs(ll[0]) > 180 || Math.abs(ll[1]) > 90) return null; }
    else { ll = proj.invert([px, py]); if (!ll || d3.geoDistance(ll, [V.lon, V.lat]) > 1.5) return null; }
    const fb = window.DATA.fbox;
    for (const id in window.DATA.features) {
      const bb = fb && fb[id];
      if (bb && (ll[0] < bb[0] || ll[0] > bb[2] || ll[1] < bb[1] || ll[1] > bb[3])) continue;
      if (d3.geoContains(window.DATA.features[id], ll)) return id;
    }
    return null;
  }

  let lastDraw = 0, lastGA = 1, introT = null;
  const introEase = (t) => 1 - Math.pow(1 - t, 3);
  setTimeout(() => { if (introT == null) introT = performance.now(); }, 7000);   // never leave it hidden if the page forgets to say go
  function draw(now) {
    if (!running) return;
    if (document.hidden) { requestAnimationFrame(draw); return; }
    if (!dragging && now - lastDraw < 29) { requestAnimationFrame(draw); return; }   // ~30 fps: plenty for a slow-turning globe, half the CPU
    lastDraw = now;
    const dt = Math.min(0.1, (now - last) / 1000); last = now;
    const st = dt * 60, ez = (k) => 1 - Math.pow(1 - k, st);   // per-frame easing constants, converted so speed does not depend on frame rate
    const DATA = window.DATA;

    // clock
    if (T.utcTarget != null) {
      const d = hdiff(T.utcTarget, T.utc);
      T.utc = (T.utc + d * ez(0.1) + 24) % 24;
    } else if (T.playing) T.utc = (T.utc + dt * (24 / 52) * (F.playSpeed || 1)) % 24;
    if (T.monthTarget != null) {
      let d = T.monthTarget - T.month; if (d > 6) d -= 12; if (d < -6) d += 12;
      T.month = 1 + ((T.month - 1 + d * ez(0.08) + 12) % 12);
    } else if (F.month != null) {
      let d = F.month - T.month; if (d > 6) d -= 12; if (d < -6) d += 12;
      T.month = 1 + ((T.month - 1 + d * ez(0.03) + 12) % 12);
    } else if (T.playing && (F.layout === 'hero' || F.layout === 'explore')) T.month = 1 + ((T.month - 1 + dt * (12 / 80)) % 12);
    else { let d = 8.5 - T.month; if (d > 6) d -= 12; if (d < -6) d += 12; T.month = 1 + ((T.month - 1 + d * ez(0.03) + 12) % 12); }   // a scene that names no month settles on late summer instead of drifting through the year

    updateFly(now);
    // ease the camera
    V.intro = introT == null ? 0 : introEase(Math.min(1, (now - introT) / 2800));
    const L = layout(F), e = inited ? ez(0.075) : 1;
    L.R *= 0.68 + 0.32 * V.intro;
    V.R *= Math.pow(L.R / V.R, e);
    V.cx += (L.cx - V.cx) * e; V.cy += (L.cy - V.cy) * e;
    V.ring += ((F.ring || 0) - V.ring) * ez(0.06);
    V.band += (((F.bands && F.bands.length) ? 1 : 0) - V.band) * ez(0.06);
    V.glass += ((F.glass || 0) - V.glass) * ez(0.07);
    V.trend += (((F.trend && trendMap) ? 1 : 0) - V.trend) * ez(0.07);
    V.ctry += ((F.layout === 'story' ? (F.trend ? 1 : 0.25) : F.layout === 'sheet' ? 0.0 : 1) - V.ctry) * ez(0.06);
    V.labels += (((F.layout === 'explore') ? 1 : 0) - V.labels) * ez(0.08);
    V.light += (((F.theme !== 'ink' && (F.layout === 'story' || F.layout === 'explore')) ? 1 : 0) - V.light) * ez(0.09);
    V.vis += ((F.away ? 0 : 1) - V.vis) * ez(0.07);
    V.flat += (((F.form === 'flat' && flatReady()) ? 1 : 0) - V.flat) * ez(0.07);
    if (!dragging && now > userUntil) {
      if (F.auto && !reduce) { autoLon += dt * (3.2 + 46 * (1 - V.intro) * (1 - V.intro)); V.lon = wrap(autoLon); V.lat += (F.lat - V.lat) * ez(0.05); }
      else { V.lon = wrap(V.lon + angDiff(F.lon, V.lon) * e); V.lat += (F.lat - V.lat) * e; autoLon = V.lon; }
    } else autoLon = V.lon;
    inited = true;

    // the globe fades out as it slides away or unfolds into the flat map; when it cannot be seen, do not paint it
    const gA = V.vis * V.intro * (1 - Math.min(1, V.flat * 1.5));
    if (Math.abs(gA - lastGA) > 0.004) { cv.style.opacity = gA.toFixed(3); lastGA = gA; }
    updateFlat();
    if (gA < 0.015) { requestAnimationFrame(draw); return; }

    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    ctx.clearRect(0, 0, W, H);
    const g1 = 1 - V.glass;
    proj.rotate([-V.lon, -V.lat]).scale(V.R).translate([V.cx, V.cy]);
    proj2.rotate([-V.lon, -V.lat]).scale(V.R).translate([V.cx, V.cy]);

    const sl = 1 - V.light;
    if (sl > 0.02) for (const s of stars) { ctx.fillStyle = `rgba(243,234,217,${s.a * (0.35 + 0.65 * g1) * sl * (0.72 + 0.28 * Math.sin(now / 1000 * s.sp + s.ph))})`; ctx.fillRect(s.x, s.y, s.s, s.s); }

    if (g1 > 0.02) { // atmosphere
      const g = ctx.createRadialGradient(V.cx, V.cy, V.R * 0.98, V.cx, V.cy, V.R * 1.22);
      g.addColorStop(0, `rgba(255,150,80,${0.17 * g1 * (1 - 0.35 * V.light)})`); g.addColorStop(0.5, `rgba(120,150,210,${0.05 * g1})`); g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(V.cx, V.cy, V.R * 1.22, 0, 7); ctx.fill();
    }
    // ocean + land (turn translucent as we zoom, so the sky shows through)
    const o = ctx.createRadialGradient(V.cx - V.R * 0.3, V.cy - V.R * 0.35, V.R * 0.1, V.cx, V.cy, V.R);
    const mx = (a, b) => Math.round(a + (b - a) * V.light);   // on a paper page the globe is lifted so it does not read as a black hole
    o.addColorStop(0, `rgba(${mx(22, 52)},${mx(32, 72)},${mx(47, 104)},${0.06 + 0.94 * g1})`); o.addColorStop(1, `rgba(${mx(11, 30)},${mx(17, 46)},${mx(27, 74)},${0.06 + 0.94 * g1})`);
    ctx.fillStyle = o; ctx.beginPath(); path({ type: 'Sphere' }); ctx.fill();
    ctx.strokeStyle = 'rgba(243,234,217,0.05)'; ctx.lineWidth = 0.6; ctx.beginPath(); path(grat); ctx.stroke();
    ctx.fillStyle = V.glass > 0.5 ? `rgba(14,20,34,${0.2 + 0.3 * g1})` : '#1c242f';
    ctx.fillStyle = `rgba(${Math.round(mx(28, 62) - 10 * V.glass)},${Math.round(mx(36, 78) - 12 * V.glass)},${Math.round(mx(47, 102) - 6 * V.glass)},${0.34 + 0.66 * g1})`;
    ctx.beginPath(); path(land); ctx.fill();
    ctx.strokeStyle = `rgba(243,234,217,${0.09 + 0.3 * V.glass})`; ctx.lineWidth = 0.6 + V.glass; if (V.ctry < 0.7 || !window.DATA.features) { ctx.beginPath(); path(borders); ctx.stroke(); }   // country outlines below already draw the borders

    // night side
    if (g1 > 0.02) {
      const [sLon, sLat] = sunPos();
      const night = d3.geoCircle().center([wrap(sLon + 180), -sLat]);
      [[96, 0.2], [90, 0.26], [82, 0.2]].forEach(([r, a]) => { ctx.fillStyle = `rgba(4,5,10,${a * g1 * (1 - 0.5 * V.light)})`; ctx.beginPath(); path(night.radius(r)()); ctx.fill(); });
    }

    if (DATA.features) drawCountries();
    if (V.band > 0.02 && F.bands) drawBands();
    if (DATA.climo) drawFires(DATA.climo);
    drawFly();

    if (g1 > 0.02) { ctx.strokeStyle = tone(0.22 * g1); ctx.lineWidth = 1; ctx.beginPath(); path({ type: 'Sphere' }); ctx.stroke(); }
    if (V.ring > 0.03 && g1 > 0.1) drawRing(sunPos()[0], V.ring * g1);
    if (F.pins) drawPins(F.pins);
    if (V.labels > 0.05 && DATA.byId) drawLabels();

    requestAnimationFrame(draw);
  }

  /* country outlines for the whole-globe view: unit vectors precomputed once, projected by hand (orthographic is just dot products).
     d3's general projector cost ~20 ms a frame for 180 shapes; this is under 1 ms. Points behind the horizon break the line. */
  let CR = null;
  function prepRings() {
    CR = {};
    for (const id in window.DATA.features) {
      const src = (window.DATA.lite && window.DATA.lite[id]) || window.DATA.features[id], g = src.geometry, polys = g.type === 'Polygon' ? [g.coordinates] : g.coordinates, rings = [];
      for (const p of polys) for (const r of p) {
        const n = r.length, a = new Float32Array(n * 3);
        for (let i = 0; i < n; i++) { const lo = r[i][0] * Math.PI / 180, la = r[i][1] * Math.PI / 180, c = Math.cos(la); a[i * 3] = c * Math.cos(lo); a[i * 3 + 1] = c * Math.sin(lo); a[i * 3 + 2] = Math.sin(la); }
        rings.push(a);
      }
      CR[id] = rings;
    }
  }
  function ringsPath(id, vx, vy, vz, ex, ey, nx, ny, nz) {
    const R = V.R, cx = V.cx, cy = V.cy;
    for (const a of CR[id]) {
      let pen = false;
      for (let i = 0; i < a.length; i += 3) {
        const x = a[i], y = a[i + 1], z = a[i + 2];
        if (x * vx + y * vy + z * vz < 0) { pen = false; continue; }
        const sx = cx + R * (x * ex + y * ey), sy = cy - R * (x * nx + y * ny + z * nz);
        if (pen) ctx.lineTo(sx, sy); else { ctx.moveTo(sx, sy); pen = true; }
      }
    }
  }

  function drawCountries() {
    const DATA = window.DATA;
    if (V.ctry < 0.02 && !selected) return;
    const lam = V.lon * Math.PI / 180, phi = V.lat * Math.PI / 180;
    const vx = Math.cos(phi) * Math.cos(lam), vy = Math.cos(phi) * Math.sin(lam), vz = Math.sin(phi);
    // everything on the visible side goes into ONE path (fast with 180+ countries); hovered and selected are drawn on top
    if (!CR) prepRings();
    const cl = Math.cos(lam), sl = Math.sin(lam), cp = Math.cos(phi), sp = Math.sin(phi);
    ctx.beginPath();
    let any = false;
    const tm = V.trend > 0.02 && trendMap, bk = { up: [], down: [], flat: [] };
    for (const id in DATA.features) {
      if (id === selected || id === hover) continue;
      const c = DATA.byId[id]; if (!c) continue;
      const la = c.centroid[1] * Math.PI / 180, lo = c.centroid[0] * Math.PI / 180;
      const dot = Math.cos(la) * Math.cos(lo) * vx + Math.cos(la) * Math.sin(lo) * vy + Math.sin(la) * vz;
      const half = Math.min(3.1, Math.max(c.bbox[2] - c.bbox[0], c.bbox[3] - c.bbox[1]) * Math.PI / 360);
      if (Math.acos(Math.max(-1, Math.min(1, dot))) > Math.PI / 2 + half) continue;
      ringsPath(id, vx, vy, vz, -sl, cl, -sp * cl, -sp * sl, cp); any = true;
      if (tm && bk[tm[id]]) bk[tm[id]].push(id);
    }
    if (any && V.ctry > 0.02) {
      ctx.fillStyle = `rgba(255,130,50,${0.07 * V.ctry * (1 - V.trend)})`; ctx.fill();
      ctx.strokeStyle = `rgba(255,170,90,${0.4 * V.ctry})`; ctx.lineWidth = 0.9; ctx.stroke();
    }
    if (tm) for (const k in bk) {   // trend map: one filled path per class (up / down / no clear trend)
      if (!bk[k].length) continue;
      ctx.beginPath(); for (const id of bk[k]) ringsPath(id, vx, vy, vz, -sl, cl, -sp * cl, -sp * sl, cp);
      ctx.globalAlpha = V.trend; ctx.fillStyle = TREND_COL[k]; ctx.fill(); ctx.globalAlpha = 1;
    }
    for (const id of [hover, selected]) {
      if (!id || !DATA.features[id]) continue;
      const f = DATA.features[id], isSel = id === selected, a = isSel ? 1 : V.ctry;
      if (a < 0.02) continue;
      ctx.beginPath(); path(f);
      ctx.fillStyle = `rgba(255,130,50,${(isSel ? 0.05 : 0.2) * a})`; ctx.fill();
      if (isSel && flagTex && V.glass > 0.25) {
        const bb = path.bounds(f), bw = bb[1][0] - bb[0][0], bh = bb[1][1] - bb[0][1];
        if (bw > 2 && bh > 2) {
          ctx.save(); ctx.beginPath(); path(f); ctx.clip();
          const sc = Math.max(bw / flagTex.width, bh / flagTex.height), dw = flagTex.width * sc, dh = flagTex.height * sc;
          ctx.globalAlpha = 0.34 * Math.min(1, (V.glass - 0.25) / 0.5);
          ctx.drawImage(flagTex, bb[0][0] + (bw - dw) / 2, bb[0][1] + (bh - dh) / 2, dw, dh);
          ctx.restore();
        }
      }
      ctx.beginPath(); path(f);
      ctx.strokeStyle = `rgba(255,170,90,${(isSel ? 0.9 : 0.95) * a})`; ctx.lineWidth = isSel ? 1.6 : 1.8; ctx.stroke();
    }
  }

  const COLS = ['rgba(255,110,30,.28)', 'rgba(255,120,30,.5)', 'rgba(255,150,50,.75)', 'rgba(255,190,90,.92)', 'rgba(255,236,180,1)'];
  /* one-time prep: per-cell, per-month strength already on the 0..1 curve, plus the list of cells that ever burn */
  let FP = null;
  function prepFires(C) {
    const lp = Math.log1p(C.p95), sm = new Float32Array(C.n * 12), act = [];
    for (let i = 0; i < C.n; i++) {
      let any = false;
      for (let m = 0; m < 12; m++) { const v = C.v[i * 12 + m]; if (v >= 0.6) { sm[i * 12 + m] = Math.pow(Math.min(1, Math.log1p(v) / lp), 1.7); any = true; } }
      if (any) act.push(i);
    }
    FP = { sm, act: Int32Array.from(act), bx: new Float32Array(act.length * 2) };
  }
  const dtab = new Float32Array(241);
  function drawFires(C) {
    if (!FP) prepFires(C);
    const lam = V.lon * Math.PI / 180, phi = V.lat * Math.PI / 180;
    const cl = Math.cos(lam), sl = Math.sin(lam), cp = Math.cos(phi), sp = Math.sin(phi);
    const vx = cp * cl, vy = cp * sl, vz = sp;            // toward the viewer
    const ex = -sl, ey = cl;                               // screen-right
    const nx = -sp * cl, ny = -sp * sl, nz = cp;           // screen-up
    const m0 = Math.floor(T.month - 1) % 12, m1 = (m0 + 1) % 12, f = (T.month - 1) - Math.floor(T.month - 1);
    for (let k = 0; k <= 240; k++) dtab[k] = diurnal(k / 10);
    const { sm, act } = FP, R = V.R, cx = V.cx, cy = V.cy, utc = T.utc;
    const fl = curFly, buckets = [[], [], [], [], []];
    for (let a = 0; a < act.length; a++) {
      const i = act[a], px = C.x[i], py = C.y[i], pz = C.z[i];
      if (px * vx + py * vy + pz * vz < 0.03) continue;
      const s = sm[i * 12 + m0] * (1 - f) + sm[i * 12 + m1] * f;
      if (s <= 0) continue;
      let lt = (utc + C.lon[i] / 15 + 24) % 24;
      let boost = 0;
      if (fl) { const dl = Math.abs(wrap(C.lon[i] - fl.lon)); if (dl < fl.w && (fl.dir < 0 ? C.lat[i] >= fl.lat : C.lat[i] <= fl.lat)) boost = fl.a; }
      const lvl = Math.min(1, s * (0.25 + 0.75 * dtab[Math.round(lt * 10)]) + 0.55 * boost * Math.max(s, 0.4));
      if (lvl < 0.07) continue;
      const b = Math.min(4, Math.floor(lvl * 6.2));
      buckets[b].push(cx + R * (px * ex + py * ey), cy - R * (px * nx + py * ny + pz * nz));
    }
    const cell = V.R * 0.5 * Math.PI / 180;
    const sz = Math.max(1.25, Math.min(cell * 0.95, V.R * 0.02));
    for (let b = 0; b < 5; b++) {
      const arr = buckets[b]; if (!arr.length) continue;
      const s = sz * (0.5 + b * 0.1);
      ctx.fillStyle = COLS[b]; ctx.beginPath();
      for (let i = 0; i < arr.length; i += 2) ctx.rect(arr[i] - s / 2, arr[i + 1] - s / 2, s, s);
      ctx.fill();
      if (b === 4 && sz < 12) {
        ctx.fillStyle = 'rgba(255,190,100,.12)'; ctx.beginPath();
        for (let i = 0; i < arr.length; i += 2) { ctx.moveTo(arr[i] + s * 1.7, arr[i + 1]); ctx.arc(arr[i], arr[i + 1], s * 1.7, 0, 6.3); }
        ctx.fill();
      }
    }
  }

  function drawBands() {
    F.bands.forEach((id) => {
      const b = bandInfo(id), lon = wrap((b.h - T.utc) * 15), tc = V.light > 0.5 && b.cl ? b.cl : b.c;
      track(lon, -80, 80, 5, tc, V.band);
      const lat = id === 'terra' ? 52 : id === 'aqua' ? 40 : 28;
      if (d3.geoDistance([lon, lat], [V.lon, V.lat]) < 1.25) {
        const p = proj([lon, lat]), k = Math.max(0.95, Math.min(1.9, V.R / 250));
        ctx.save(); ctx.translate(p[0], p[1]); ctx.rotate(-Math.PI / 2); ctx.globalAlpha = V.band; sprite(k, b.c); ctx.restore(); ctx.globalAlpha = 1;
        tag(`${b.label} ${S.fmtH(b.h)}`, p[0] + 18 * k, p[1], b.c, V.band);
      }
    });
  }

  function drawRing(sLon, a) {
    const r = V.R * 1.1;
    ctx.save(); ctx.translate(V.cx, V.cy);
    ctx.strokeStyle = tone(0.18 * a); ctx.lineWidth = 1; ctx.beginPath(); ctx.arc(0, 0, r, 0, 6.3); ctx.stroke();
    ctx.font = '600 10px "Hanken Grotesk", system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    for (let k = 0; k < 24; k++) {
      const off = k * 15 - 180, th = (off * Math.PI) / 180 - Math.PI / 2, major = k % 3 === 0, r1 = r - (major ? 9 : 4);
      ctx.strokeStyle = tone((major ? 0.55 : 0.28) * a);
      ctx.beginPath(); ctx.moveTo(Math.cos(th) * r1, Math.sin(th) * r1); ctx.lineTo(Math.cos(th) * r, Math.sin(th) * r); ctx.stroke();
      if (major) {
        const lt = (T.utc + (V.lon + off) / 15 + 48) % 24;
        ctx.fillStyle = tone(0.62 * a);
        ctx.fillText(String(Math.round(lt) % 24).padStart(2, '0'), Math.cos(th) * (r + 15), Math.sin(th) * (r + 15));
      }
    }
    const st = (wrap(sLon - V.lon) * Math.PI) / 180 - Math.PI / 2;
    ctx.fillStyle = `rgba(255,198,90,${a})`; ctx.beginPath(); ctx.arc(Math.cos(st) * r, Math.sin(st) * r, 4.4, 0, 6.3); ctx.fill();
    ctx.strokeStyle = `rgba(255,198,90,${0.35 * a})`; ctx.beginPath(); ctx.arc(Math.cos(st) * r, Math.sin(st) * r, 9, 0, 6.3); ctx.stroke();
    ctx.restore();
  }

  function drawPins(pins) {
    ctx.font = '600 11px "Hanken Grotesk", system-ui, sans-serif'; ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
    pins.forEach((p) => {
      if (d3.geoDistance([p.lon, p.lat], [V.lon, V.lat]) > 1.35) return;
      const q = proj([p.lon, p.lat]);
      // pins sit on the dark globe, so they use light ink with a dark halo (the paper-theme ink was invisible over the ocean)
      ctx.strokeStyle = 'rgba(243,234,217,.92)'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.arc(q[0], q[1], 4, 0, 6.3); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(q[0] + 4, q[1] - 4); ctx.lineTo(q[0] + 18, q[1] - 16); ctx.lineTo(q[0] + 24, q[1] - 16); ctx.stroke();
      ctx.lineJoin = 'round'; ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(10,9,8,.8)'; ctx.strokeText(p.t, q[0] + 28, q[1] - 12);
      ctx.fillStyle = 'rgb(243,234,217)'; ctx.fillText(p.t, q[0] + 28, q[1] - 12);
    });
  }

  function drawLabels() {
    const DATA = window.DATA;
    ctx.font = '600 10.5px "Hanken Grotesk", system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    DATA.meta.countries.forEach((c) => {
      if (d3.geoDistance(c.centroid, [V.lon, V.lat]) > 1.2) return;
      const span = Math.max(c.bbox[3] - c.bbox[1], (c.bbox[2] - c.bbox[0]) * Math.cos(c.centroid[1] * Math.PI / 180));
      if (span < 15 && c.id !== hover) return;
      const q = proj(c.centroid);
      ctx.fillStyle = tone((c.id === hover ? 1 : 0.72) * V.labels);
      ctx.fillText(c.name.replace('United States', 'USA').toUpperCase(), q[0], q[1]);
    });
  }


  /* ---- the flat world: one still image of every country, painted by trend, so the whole planet reads at once ----
     It lives on its own canvas under the globe. Moving between the two is a cross-fade while the globe grows and glides
     into the map's place, so nothing is redrawn per frame: only the canvas opacity and scale change. */
  const flatCv = document.createElement('canvas'); flatCv.id = 'flat'; flatCv.setAttribute('aria-hidden', 'true'); cv.parentNode.insertBefore(flatCv, cv);
  const fctx = flatCv.getContext('2d'), baseCv = document.createElement('canvas'), bctx = baseCv.getContext('2d');
  const fproj = d3.geoNaturalEarth1(), fpath = d3.geoPath(fproj, bctx);   // fpath is only for the sphere, graticule and land, which are drawn in d3's own orientation
  let flatDirty = true, flatPaint = true, flatHover = null, lastFA = -1, lastFS = -1;
  const flatReady = () => !!(window.DATA && window.DATA.features);
  /* a flat map needs no spherical maths: project each point, then fill as an ordinary polygon (ring direction then does not matter) */
  function planar(c, feat) {
    const g = feat.geometry, polys = g.type === 'Polygon' ? [g.coordinates] : g.coordinates;
    for (const poly of polys) for (const ring of poly) {
      let n = 0;
      for (const pt of ring) { const q = fproj(pt); if (!q) continue; if (n++) c.lineTo(q[0], q[1]); else c.moveTo(q[0], q[1]); }
      if (n) c.closePath();
    }
  }
  function renderFlat() {
    const D = window.DATA, b = flatBox(), k = DPR;
    fproj.fitExtent([[b.x, b.y], [b.x + b.w, b.y + b.h]], { type: 'Sphere' });
    baseCv.width = Math.round(W * k); baseCv.height = Math.round(H * k);
    bctx.setTransform(k, 0, 0, k, 0, 0); bctx.clearRect(0, 0, W, H);
    const o = bctx.createLinearGradient(0, b.y, 0, b.y + b.h); o.addColorStop(0, 'rgb(52,72,104)'); o.addColorStop(1, 'rgb(30,46,74)');
    bctx.fillStyle = o; bctx.beginPath(); fpath({ type: 'Sphere' }); bctx.fill();
    bctx.strokeStyle = 'rgba(243,234,217,0.06)'; bctx.lineWidth = 0.6; bctx.beginPath(); fpath(grat); bctx.stroke();
    bctx.fillStyle = 'rgb(66,82,106)'; bctx.beginPath(); fpath(land); bctx.fill();
    const lite = D.lite || D.features, bk = { up: [], down: [], flat: [], none: [] };
    for (const id in lite) bk[(trendMap && trendMap[id]) || 'none'].push(lite[id]);
    for (const c of ['none', 'flat', 'down', 'up']) {
      if (!bk[c].length) continue;
      bctx.beginPath(); for (const f of bk[c]) planar(bctx, f);
      bctx.fillStyle = c === 'none' ? 'rgba(255,130,50,0.1)' : TREND_COL[c]; bctx.fill('evenodd');
      bctx.strokeStyle = 'rgba(10,9,8,0.55)'; bctx.lineWidth = 0.5; bctx.stroke();
    }
    bctx.strokeStyle = 'rgba(243,234,217,0.22)'; bctx.lineWidth = 1; bctx.beginPath(); fpath({ type: 'Sphere' }); bctx.stroke();
    flatCv.style.transformOrigin = `${b.x + b.w / 2}px ${b.y + b.h / 2}px`;
    flatDirty = false; flatPaint = true;
  }
  function updateFlat() {
    if ((F.form === 'flat' || V.flat > 0.01) && flatReady()) {
      if (flatDirty) renderFlat();
      if (flatPaint) {
        fctx.setTransform(1, 0, 0, 1, 0, 0); fctx.clearRect(0, 0, flatCv.width, flatCv.height); fctx.drawImage(baseCv, 0, 0);
        const f = flatHover && window.DATA.features[flatHover];
        if (f) { fctx.setTransform(DPR, 0, 0, DPR, 0, 0); fctx.beginPath(); planar(fctx, f); fctx.strokeStyle = 'rgba(255,198,90,0.95)'; fctx.lineWidth = 1.8; fctx.stroke(); }
        flatPaint = false;
      }
    }
    const a = V.flat * V.vis, sc = 0.93 + 0.07 * V.flat;
    if (Math.abs(a - lastFA) > 0.004) { flatCv.style.opacity = a.toFixed(3); lastFA = a; }
    if (Math.abs(sc - lastFS) > 0.002) { flatCv.style.transform = `scale(${sc.toFixed(4)})`; lastFS = sc; }
  }

  /* ---- input ---- */
  let down = null, lastPt = null, hoverAt = 0;
  cv.addEventListener('pointerdown', (e) => {
    if (F.layout === 'sheet') return;
    dragging = true; down = { x: e.clientX, y: e.clientY, t: performance.now(), moved: 0 }; lastPt = [e.clientX, e.clientY];
    cv.setPointerCapture(e.pointerId); cv.classList.add('grab');
  });
  cv.addEventListener('pointermove', (e) => {
    if (dragging) {
      const k = 90 / V.R;
      if (V.flat < 0.5) {   // the flat map does not turn
        V.lon = wrap(V.lon - (e.clientX - lastPt[0]) * k * 1.1);
        V.lat = Math.max(-80, Math.min(80, V.lat + (e.clientY - lastPt[1]) * k * 1.1));
      }
      down.moved += Math.abs(e.clientX - lastPt[0]) + Math.abs(e.clientY - lastPt[1]);
      lastPt = [e.clientX, e.clientY];
    } else if (performance.now() - hoverAt > 60 && F.layout !== 'sheet') {
      hoverAt = performance.now();
      const id = hit(e.clientX, e.clientY);
      if (id !== hover) { hover = id; if (V.flat > 0.5) { flatHover = id; flatPaint = true; } cv.style.cursor = id ? 'pointer' : (V.flat > 0.5 ? 'default' : 'grab'); if (hoverCb) hoverCb(id, e.clientX, e.clientY); }
      else if (id && hoverCb) hoverCb(id, e.clientX, e.clientY);
    }
  });
  const end = (e) => {
    if (!dragging) return;
    dragging = false; cv.classList.remove('grab'); userUntil = performance.now() + 3500;
    if (down && down.moved < 7 && performance.now() - down.t < 600 && e.type === 'pointerup') {
      const id = hit(e.clientX, e.clientY);
      if (id && pickCb) pickCb(id);
    }
  };
  cv.addEventListener('pointerup', end); cv.addEventListener('pointercancel', end);
  cv.addEventListener('pointerleave', () => { if (!dragging) { hover = null; if (flatHover) { flatHover = null; flatPaint = true; } if (hoverCb) hoverCb(null); } });

  function start() { if (running) return; running = true; last = performance.now(); requestAnimationFrame(draw); }
  function stop() { running = false; }
  window.addEventListener('resize', resize);
  resize();

  window.GLOBE = {
    T, V, start, stop,
    focus(f) { F = Object.assign({ lon: V.lon, lat: V.lat }, f); userUntil = 0; },   // a scene that says nothing about where to look keeps the current view
    get layout() { return F.layout; },
    setSelected(id) { selected = id; },
    intro() { if (introT == null) introT = performance.now(); },
    setTrendMap(m) { trendMap = m; flatDirty = true; },
    get form() { return F.form || 'globe'; },
    setFlag(c) { flagTex = c; },
    onPick(cb) { pickCb = cb; }, onHover(cb) { hoverCb = cb; },
    setBandInfo(fn) { bandInfo = fn; },
    lockLocalHour(hour, lon) { T.utcTarget = ((hour - lon / 15) % 24 + 24) % 24; },
    unlock() { T.utcTarget = null; T.monthTarget = null; },
    setMonth(m) { T.monthTarget = m; },
    localHourAtCenter() { return (T.utc + V.lon / 15 + 24) % 24; },
    project: (ll) => proj(ll),
    /* typical fire in the cell under a screen point, for the selected month (null when off the globe or over no fire) */
    heatAt(px, py) {
      const C = window.DATA && window.DATA.climo, ll = C && proj.invert([px, py]);
      if (!ll || d3.geoDistance(ll, [V.lon, V.lat]) > 1.5) return null;
      const la = ll[1] * Math.PI / 180, lo = ll[0] * Math.PI / 180, x = Math.cos(la) * Math.cos(lo), y = Math.cos(la) * Math.sin(lo), z = Math.sin(la);
      const m0 = Math.floor(T.month - 1) % 12, m1 = (m0 + 1) % 12, f = (T.month - 1) - Math.floor(T.month - 1), cosTol = Math.cos(0.45 * Math.PI / 180);
      let best = 0;
      for (let i = 0; i < C.n; i++) {
        if (C.x[i] * x + C.y[i] * y + C.z[i] * z < cosTol) continue;
        const v = C.v[i * 12 + m0] * (1 - f) + C.v[i * 12 + m1] * f; if (v > best) best = v;
      }
      return best;
    },
    /* the hottest cell inside a country box for a calendar month: what 'fully deep orange' means for that country */
    heatScale(bbox, month) {
      const C = window.DATA && window.DATA.climo; if (!C) return 1;
      const m = ((month - 1) % 12 + 12) % 12; let mx = 1;
      for (let i = 0; i < C.n; i++) { if (C.lon[i] < bbox[0] || C.lon[i] > bbox[2] || C.lat[i] < bbox[1] || C.lat[i] > bbox[3]) continue; const v = C.v[i * 12 + m]; if (v > mx) mx = v; }
      return mx;
    }
  };
})();
