// How well does the in-browser MODIS converter (js/harmonize.js) predict real VIIRS on years it never saw?
//   node tools/validate_harmonizer.js [--write]      --write also saves data/harmonizer_check.json for the page
// The converter is fitted ONLY on 2012-02..2017-12, then asked for 2018-19 (still undrifted) and 2021-25 (drifted) yearly totals,
// which are compared with what Suomi NPP actually counted. The day/night split of each satellite comes from diurnal.json
// (2012-2019 shares for the early years, 2022-2025 shares for the later ones) because the monthly series hold totals only.
const fs = require('fs'), path = require('path');
const root = path.resolve(__dirname, '..'), H = require(path.join(root, 'js', 'harmonize.js')), R = require(path.join(root, 'js', 'rhythm.js'));
const J = (p) => JSON.parse(fs.readFileSync(path.join(root, 'data', p), 'utf8'));
const meta = J('meta.json'), D = J('diurnal.json'), sb = Object.fromEntries(J('scoreboard.json').rows.map((r) => [r.country, r]));
const med = (a) => { if (!a.length) return null; const s = a.slice().sort((x, y) => x - y), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const FIT_B = 201712;
const sumYear = (months, arr, y) => { let t = 0, n = 0; months.forEach((m, i) => { if (Math.floor(m / 100) === y && arr[i] != null) { t += arr[i]; n++; } }); return n === 12 ? t : null; };
const dayShare = (rec, i, p) => { const g = R.groups(rec[i + '|' + p] || {}), t = g.day.n + g.night.n; return t > 0 ? g.day.n / t : null; };
const variants = { full: {}, noClock: { noClock: true }, terraOnly: { only: 'T' }, aquaOnly: { only: 'A' } };
const res = {}, per = {}, signed = [];
for (const c of meta.countries) {
  const s = J('series/' + c.id + '.json'), b = sb[c.id] && sb[c.id].b_adj, d = D[c.id]; if (b == null || !d) continue;
  if (s.S.reduce((a, x) => a + x, 0) < 20000) continue;   // enough VIIRS detections for a yearly total to mean something
  const sh = { pre: [dayShare(d, 0, '2012-2019'), dayShare(d, 1, '2012-2019')], late: [dayShare(d, 0, '2022-2025'), dayShare(d, 1, '2022-2025')] };
  if ([...sh.pre, ...sh.late].some((x) => x == null)) continue;
  const rows = {}; s.months.forEach((m, i) => { if (s.T[i] > 0 || s.A[i] > 0) { const q = m < 202000 ? sh.pre : sh.late; rows[m] = { T: { n: s.T[i], h: s.hours.hT[i], day: q[0] }, A: { n: s.A[i], h: s.hours.hA[i], day: q[1] } }; } });
  for (const v in variants) {
    const { est } = H.run(s, b, rows, Object.assign({ fitB: FIT_B }, variants[v])), arr = s.months.map((m) => (est[m] != null ? est[m] : null));
    const e = (years) => { const o = [], so = []; years.forEach((y) => { const E = sumYear(s.months, arr, y), A = sumYear(s.months, s.S, y); if (E != null && A > 500) { o.push(Math.abs(E / A - 1) * 100); so.push((E / A - 1) * 100); } }); return o.length ? [med(o), med(so)] : [null, null]; };
    const [pre] = e([2018, 2019]), [drift, ds] = e([2021, 2022, 2023, 2024, 2025]);
    const r = (res[v] = res[v] || { pre: [], drift: [], sd: [] }); if (pre != null) r.pre.push(pre); if (drift != null) { r.drift.push(drift); r.sd.push(ds); }
    const rd = (x) => (x == null ? null : Math.round(x * 10) / 10);
    if (v === 'full') per[c.id] = { pre: rd(pre), drift: rd(drift) };
    if (v === 'noClock') per[c.id].driftNoClock = rd(drift);
  }
}
console.log('countries tested', Object.keys(per).length);
for (const v in res) console.log(v.padEnd(10), 'median yearly error | pre-drift holdout (2018-19):', med(res[v].pre).toFixed(1) + '%', '| drift years (2021-25):', med(res[v].drift).toFixed(1) + '%', '(signed ' + med(res[v].sd).toFixed(1) + '%)', '| within 10% in drift years:', Math.round(100 * res[v].drift.filter((x) => x < 10).length / res[v].drift.length) + '%');
const both = Object.values(per).filter((p) => p.drift != null && p.driftNoClock != null);
console.log('drift correction helps (lower error than none) in', both.filter((p) => p.drift < p.driftNoClock).length, 'of', both.length, 'countries');
if (process.argv.includes('--write')) { fs.writeFileSync(path.join(root, 'data', 'harmonizer_check.json'), JSON.stringify({ fit: '2012-02..2017-12', rows: per })); console.log('wrote data/harmonizer_check.json'); }
