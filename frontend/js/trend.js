/* SUNDIAL trend: what the fire trend is on the glued record vs on the fair (harmonized) one.

   Both records are summed to calendar years (2001 to 2025: only years with all 12 months), and a straight line is
   fitted to log(total) against year. The slope is "percent change per year". The 95% interval comes from the line fit
   to those 25 yearly points.

   Two honest limits, repeated on the page:
   - Yearly totals next to each other are not independent (a wet year follows a wet year), so the intervals here are
     tighter than they should be. Treat a result close to "no clear trend" as no clear trend.
   - The fair trend is only as good as the MODIS to VIIRS conversion. That is what the holdout test measures.

   Used in the browser and by tools/build_trends.js (which writes data/trends.json). */
(function (root) {
  const Y0 = 2001, Y1 = 2025;
  const tcrit = (df) => 1.96 + 2.37 / df + 2.8 / (df * df);   // 95% two-sided Student t, within 0.01 for df >= 10

  function annual(months, arr) {
    const o = {};
    months.forEach((m, i) => { const v = arr[i]; if (v == null || !isFinite(v)) return; const y = Math.floor(m / 100), t = o[y] || (o[y] = { s: 0, n: 0 }); t.s += v; t.n++; });
    const out = [];
    for (let y = Y0; y <= Y1; y++) if (o[y] && o[y].n === 12 && o[y].s > 0) out.push({ y, v: o[y].s });
    return out;
  }

  function fit(months, arr) {
    const pts = annual(months, arr); if (pts.length < 10) return null;
    const n = pts.length, mx = pts.reduce((s, p) => s + p.y, 0) / n, ly = pts.map((p) => Math.log(p.v)), my = ly.reduce((s, v) => s + v, 0) / n;
    let sxx = 0, sxy = 0; pts.forEach((p, i) => { sxx += (p.y - mx) ** 2; sxy += (p.y - mx) * (ly[i] - my); });
    const b = sxy / sxx, a = my - b * mx; let sse = 0; pts.forEach((p, i) => { sse += (ly[i] - a - b * p.y) ** 2; });
    const se = Math.sqrt(sse / (n - 2) / sxx), t = tcrit(n - 2), pc = (x) => (Math.exp(x) - 1) * 100;
    return { pct: pc(b), lo: pc(b - t * se), hi: pc(b + t * se), a, b, se, n, pts };
  }

  const up = (t) => t.lo > 0, down = (t) => t.hi < 0, clear = (t) => up(t) || down(t);
  /* flip: the two records disagree about direction.  phantom: glued shows a clear trend, fair shows none.
     hidden: the reverse.  overstated: same direction, but the intervals do not even overlap.  agree: none of these. */
  function kind(N, H) {
    if ((up(N) && down(H)) || (down(N) && up(H))) return 'flip';
    if (clear(N) && !clear(H)) return 'phantom';
    if (!clear(N) && clear(H)) return 'hidden';
    if (up(N) && up(H) && H.hi < N.lo) return 'overstated';
    if (down(N) && down(H) && N.hi < H.lo) return 'overstated';
    return 'agree';
  }
  /* what a map should paint for one record */
  const dir = (t) => (up(t) ? 'up' : down(t) ? 'down' : 'flat');

  function measure(s) {
    const N = fit(s.months, s.naive), H = fit(s.months, s.harm); if (!N || !H) return null;
    return { N, H, kind: kind(N, H), n: dir(N), h: dir(H) };
  }
  const r1 = (x) => Math.round(x * 10) / 10;
  const slim = (t) => ({ pct: r1(t.pct), lo: r1(t.lo), hi: r1(t.hi) });

  const API = { measure, fit, kind, dir, slim, Y0, Y1 };
  if (typeof module !== 'undefined' && module.exports) module.exports = API; else root.TREND = API;
})(typeof window !== 'undefined' ? window : globalThis);
