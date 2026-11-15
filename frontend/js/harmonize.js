/* SUNDIAL harmonize: turn a country's raw MODIS (Terra + Aqua) monthly counts into VIIRS-equivalent counts.

   It re-fits the first two steps of the method from the published record, in the browser:
   1. Convert the camera. For every season (Dec-Feb, Mar-May, Jun-Aug, Sep-Nov) the factor k is
      (Suomi NPP detections) / (this satellite's detections) over the overlap years 2012-02 to 2019-12, when both flew and
      neither had started to drift. One k for Terra, one for Aqua.
   2. Undo Terra's clock slide: multiply Terra by exp(-b (h - h_ref)), h = the month's mean local pass time and h_ref the
      pass time Terra had over the fit years. b is the country's fitted swath slope (b_terra in the scoreboard).
   Terra and Aqua then give two estimates of the same fire in VIIRS units; they are blended with weights that favour the one
   with more detections (inverse variance, treating counts as Poisson).

   What it does NOT do: split day from night (monthly totals only), or correct Aqua's smaller slide (the page says the two
   slides mostly cancel). Checked against held-out VIIRS years in tools/validate_harmonizer.js. */
(function (root) {
  const FIT_A = 201202, FIT_B = 201912;
  const seasonOf = (mo) => Math.floor((mo % 12) / 3);   // Dec, Jan, Feb -> 0 ... Sep, Oct, Nov -> 3

  /* k per season for one satellite ('T' or 'A'), plus the pooled value used where a season has too little data.
     fitB lets the validation fit on a shorter window than the published factors use. */
  function fitK(s, sat, fitB) {
    const num = [0, 0, 0, 0], den = [0, 0, 0, 0], end = fitB || FIT_B; let hs = 0, hw = 0;
    s.months.forEach((m, i) => {
      if (m < FIT_A || m > end) return;
      const v = s.S[i], c = s[sat][i]; if (!(v > 0) || !(c > 0)) return;
      const q = seasonOf(m % 100); num[q] += v; den[q] += c;
      if (sat === 'T' && s.hours.hT[i] != null) { hs += c * s.hours.hT[i]; hw += c; }
    });
    const pn = num.reduce((a, b) => a + b, 0), pd = den.reduce((a, b) => a + b, 0), pooled = pd > 0 ? pn / pd : null;
    const k = num.map((n, q) => (den[q] >= 30 ? n / den[q] : pooled));
    return { k, pooled, href: hw > 0 ? hs / hw : 10.5, n: pd };
  }

  /* one month: t, a = { n, h, day } for Terra and Aqua (n = detections, h = mean local pass time of the daytime ones,
     day = share of the detections that are daytime, or omitted) */
  function monthEstimate(mo, t, a, kT, kA, b, opt) {
    opt = opt || {};
    const q = seasonOf(mo), kt = opt.pooledK ? kT.pooled : kT.k[q], ka = opt.pooledK ? kA.pooled : kA.k[q];
    // the slope b describes how DAYTIME detections change with the clock, so it only multiplies the daytime share
    const dayShare = t.day == null ? 1 : t.day;
    const clock = opt.noClock || t.h == null || b == null ? 1 : dayShare * Math.exp(-b * (t.h - kT.href)) + (1 - dayShare);
    const eT = t.n > 0 && kt ? kt * t.n * clock : null, eA = a.n > 0 && ka ? ka * a.n : null;
    if (opt.only === 'T') return eT; if (opt.only === 'A') return eA;
    if (eT == null) return eA; if (eA == null) return eT;
    const wT = 1 / (kt * kt * t.n), wA = 1 / (ka * ka * a.n);   // variance of k*n for Poisson n is k^2 * n
    return (wT * eT + wA * eA) / (wT + wA);
  }

  /* run the whole thing on a country's monthly rows: rows = { yyyymm: { T: {n,h}, A: {n,h} } } */
  function run(s, b, rows, opt) {
    const kT = fitK(s, 'T', opt && opt.fitB), kA = fitK(s, 'A', opt && opt.fitB), out = {};
    for (const ym in rows) { const r = rows[ym], v = monthEstimate(+ym % 100, r.T || { n: 0 }, r.A || { n: 0 }, kT, kA, b, opt); if (v != null) out[ym] = v; }
    return { est: out, kT, kA };
  }

  /* what a user's file would look like if it were the published raw counts: used by the checks */
  function rowsFromSeries(s) {
    const o = {};
    s.months.forEach((m, i) => { if (s.T[i] > 0 || s.A[i] > 0) o[m] = { T: { n: s.T[i], h: s.hours.hT[i] }, A: { n: s.A[i], h: s.hours.hA[i] } }; });
    return o;
  }

  const API = { fitK, monthEstimate, run, rowsFromSeries, seasonOf, FIT_A, FIT_B };
  if (typeof module !== 'undefined' && module.exports) module.exports = API; else root.HARM = API;
})(typeof window !== 'undefined' ? window : globalThis);
