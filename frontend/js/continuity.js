/* SUNDIAL continuity: can NOAA-20 carry the record once Suomi NPP stops?

   Both satellites carry the same VIIRS camera and fly within about an hour of each other, so the question is how close
   to 1 the ratio  c = (Suomi NPP detections) / (NOAA-20 detections)  is, how steady it stays, and whether a ratio fitted
   on the early overlap predicts the later one. The series files hold monthly counts for both from April 2018.

   Fit window  : months 2018-04 to 2022-12  -> c_fit
   Held-out    : 2023, 2024, 2025 (each year's total, predicted as c_fit x NOAA-20, compared with the real Suomi NPP total)
   Published c : all overlap months, 2018-04 to 2025-12

   NOAA-21 (launched Nov 2022) is not in the record, so it is not calibrated here. */
(function (root) {
  const FIT_END = 202212, MIN_MONTH = 30;   // a month needs this many detections on BOTH satellites to count
  const med = (a) => { if (!a.length) return null; const s = a.slice().sort((x, y) => x - y), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };

  /* months where both satellites reported enough: [{m, y, s, n}] */
  function overlap(s) {
    const o = [];
    s.months.forEach((m, i) => { if (s.S[i] >= MIN_MONTH && s.N[i] >= MIN_MONTH) o.push({ m, y: Math.floor(m / 100), s: s.S[i], n: s.N[i] }); });
    return o;
  }
  const ratio = (rows) => { let a = 0, b = 0; rows.forEach((r) => { a += r.s; b += r.n; }); return b > 0 ? a / b : null; };

  function measure(s) {
    const ov = overlap(s); if (ov.length < 24) return null;
    const fitRows = ov.filter((r) => r.m <= FIT_END), cFit = ratio(fitRows), c = ratio(ov);
    if (!fitRows.length || cFit == null) return null;
    // held-out years: whole-year totals, only years with all 12 overlap months
    const errs = [];
    [2023, 2024, 2025].forEach((y) => { const r = ov.filter((q) => q.y === y); if (r.length === 12) { const S = r.reduce((a, q) => a + q.s, 0), N = r.reduce((a, q) => a + q.n, 0); errs.push(Math.abs(cFit * N / S - 1) * 100); } });
    // month-to-month spread of the ratio (steadiness), as a percentage of c
    const mr = ov.map((r) => r.s / r.n), mm = med(mr), spread = med(mr.map((x) => Math.abs(x - mm))) / mm * 100;
    // trend of the ratio across years (is NOAA-20 drifting relative to Suomi NPP?): yearly ratio, first vs last full year
    const yr = {}; ov.forEach((r) => { (yr[r.y] = yr[r.y] || []).push(r); });
    const ys = Object.keys(yr).map(Number).filter((y) => yr[y].length === 12).sort();
    const yearly = ys.map((y) => ({ y, c: ratio(yr[y]) }));
    return { c, cFit, n: ov.length, nFit: fitRows.length, holdout: errs.length ? med(errs) : null, holdoutYears: errs.length, spread, yearly, sumS: ov.reduce((a, r) => a + r.s, 0) };
  }

  const API = { measure, overlap, ratio, med, FIT_END, MIN_MONTH };
  if (typeof module !== 'undefined' && module.exports) module.exports = API; else root.CONT = API;
})(typeof window !== 'undefined' ? window : globalThis);
