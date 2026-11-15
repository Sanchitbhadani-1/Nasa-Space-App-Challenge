/* SUNDIAL rhythm: the daily fire curve measured from the satellites' own drift (no schematic).

   data/diurnal.json holds, per country, detections by local solar half-hour for each satellite
   (0 Terra, 1 Aqua, 2 Suomi NPP, 3 NOAA-20) in two periods: 2012-2019 (before the drift) and 2022-2025 (after).

   Terra and Aqua are the same kind of camera. Before the drift they looked at about 10:30, 13:30, 22:30 and 01:30.
   After it they look at about 09:40, 14:15, 21:30 and 02:15. That is eight local times sampled by one camera type.
   Fire totals differ between the two periods, so every count is divided by what Suomi NPP saw in daytime in the
   same period: Suomi NPP stayed near 13:30, so it measures how much fire there was, not when the camera looked.

   Result: eight points of "MODIS detections per VIIRS afternoon detection" against local time. Nothing is assumed
   about the curve's shape; a smooth curve is fitted through the points only to guide the eye.
   Assumptions, stated on the page: Suomi NPP did not drift, Terra and Aqua detect alike, and the rhythm itself did
   not change between the two periods. Where the last one fails (India), the points show it. */
(function (root) {
  const PERIODS = ['2012-2019', '2022-2025'];
  const SATS = [{ i: 0, id: 'terra', name: 'Terra' }, { i: 1, id: 'aqua', name: 'Aqua' }];
  const MIN_N = 150;        // detections needed in a pass group before we call it a measurement
  const MIN_REF = 1000;     // Suomi NPP daytime detections needed in each period

  const isDay = (h) => h >= 6 && h < 18;
  /* split one histogram into its day and night groups: total count and count-weighted mean local hour (circular) */
  function groups(hist) {
    const g = { day: { n: 0, sx: 0, sy: 0 }, night: { n: 0, sx: 0, sy: 0 } };
    for (const k in hist) {
      const h = +k + 0.25, n = hist[k]; if (!(n > 0)) continue;   // a bin is labelled by its start (checked against the monthly pass times in the series files), so its middle is a quarter hour later
      const a = (h / 24) * 2 * Math.PI, t = isDay(h) ? g.day : g.night;
      t.n += n; t.sx += n * Math.cos(a); t.sy += n * Math.sin(a);
    }
    for (const k in g) { const t = g[k]; t.h = t.n ? ((Math.atan2(t.sy, t.sx) / (2 * Math.PI)) * 24 + 24) % 24 : null; }
    return g;
  }

  /* the eight measured points for one country (fewer when a group has too few detections) */
  function points(rec) {
    if (!rec) return [];
    const out = [];
    PERIODS.forEach((p, pi) => {
      const ref = rec['2|' + p]; if (!ref) return;
      const refDay = groups(ref).day.n; if (refDay < MIN_REF) return;
      SATS.forEach((s) => {
        const hist = rec[s.i + '|' + p]; if (!hist) return;
        const g = groups(hist);
        ['day', 'night'].forEach((part) => {
          const t = g[part]; if (t.n < MIN_N) return;
          const v = t.n / refDay;
          out.push({ sat: s.id, name: s.name, period: p, late: pi === 1, part, h: t.h, v, n: t.n, se: v * Math.sqrt(1 / t.n + 1 / refDay) });
        });
      });
    });
    return out;
  }

  /* shape used only to draw a line through the points: a floor plus one bump, like the old schematic but with free
     peak time, width and floor. Fitted in log space so night and day points count alike. */
  const shape = (t, pk, sg, f) => { let d = Math.abs(t - pk); if (d > 12) d = 24 - d; return f + (1 - f) * Math.exp(-0.5 * (d / sg) * (d / sg)); };
  function fit(pts) {
    if (pts.length < 5) return null;
    const ly = pts.map((p) => Math.log(p.v));
    let best = null;
    for (let pk = 11; pk <= 18.01; pk += 0.25) for (let sg = 1.6; sg <= 5.01; sg += 0.2) for (let f = 0.002; f <= 0.3; f *= 1.35) {
      let sum = 0; const lm = pts.map((p) => Math.log(shape(p.h, pk, sg, f)));
      for (let i = 0; i < pts.length; i++) sum += ly[i] - lm[i];
      const la = sum / pts.length; let sse = 0;
      for (let i = 0; i < pts.length; i++) { const r = ly[i] - lm[i] - la; sse += r * r; }
      if (!best || sse < best.sse) best = { pk, sg, f, a: Math.exp(la), sse };
    }
    best.rms = Math.sqrt(best.sse / pts.length);
    best.at = (t) => best.a * shape(t, best.pk, best.sg, best.f);
    return best;
  }

  /* one satellite's day pass before and after the drift: how much its catch changed, and the slope that implies */
  function pair(pts, sat) {
    const a = pts.find((p) => p.sat === sat && p.part === 'day' && !p.late), b = pts.find((p) => p.sat === sat && p.part === 'day' && p.late);
    if (!a || !b || Math.abs(b.h - a.h) < 0.2) return null;
    const lr = Math.log(b.v / a.v), dh = b.h - a.h;
    return { from: a, to: b, change: b.v / a.v - 1, slope: lr / dh, se: Math.sqrt(1 / a.n + 1 / b.n) / Math.abs(dh), dh };
  }

  function measure(rec) {
    const pts = points(rec), day = pts.filter((p) => p.part === 'day');
    const terra = pair(pts, 'terra'), aqua = pair(pts, 'aqua');
    const ok = day.length === 4 && !!terra && !!aqua;
    const f = ok ? fit(pts) : null;
    const hi = day.length ? Math.max.apply(null, day.map((p) => p.h)) : null;
    return {
      ok, pts, terra, aqua, fit: f,
      /* the peak is only "seen" when the curve turns over inside the hours the satellites sample */
      peakSeen: !!(f && aqua && aqua.slope < 0 && f.pk <= hi),
      lastHour: hi
    };
  }

  /* all countries added together: the curve for the story chart */
  function pool(all, ids) {
    const sum = {};
    (ids || Object.keys(all)).forEach((id) => { const rec = all[id]; if (!rec) return; for (const k in rec) { const t = sum[k] || (sum[k] = {}); for (const h in rec[k]) t[h] = (t[h] || 0) + rec[k][h]; } });
    return sum;
  }

  const API = { measure, points, fit, pool, groups, MIN_N, MIN_REF };
  if (typeof module !== 'undefined' && module.exports) module.exports = API; else root.RHYTHM = API;
})(typeof window !== 'undefined' ? window : globalThis);
