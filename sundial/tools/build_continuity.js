// Cross-calibrate NOAA-20 against Suomi NPP for every country: data/continuity.json
// Run after export_static.py:   node tools/build_continuity.js   (from the sundial folder)
const fs = require('fs'), path = require('path');
const root = path.resolve(__dirname, '..'), C = require(path.join(root, 'js', 'continuity.js'));
const J = (p) => JSON.parse(fs.readFileSync(path.join(root, 'data', p), 'utf8'));
const meta = J('meta.json'), rows = {}, pooled = {};
const r3 = (x) => Math.round(x * 1000) / 1000, r1 = (x) => (x == null ? null : Math.round(x * 10) / 10);
for (const c of meta.countries) {
  const s = J('series/' + c.id + '.json'), m = C.measure(s);
  if (!m) continue;
  rows[c.id] = { c: r3(m.c), cFit: r3(m.cFit), n: m.n, ho: r1(m.holdout), sp: r1(m.spread), tot: m.sumS, yr: m.yearly.map((q) => [q.y, r3(q.c)]) };
  m.yearly.forEach((q) => { (pooled[q.y] = pooled[q.y] || []).push(q.c); });
}
const med = C.med, ids = Object.keys(rows);
const out = { fitEnd: C.FIT_END, minMonth: C.MIN_MONTH, rows, pooledByYear: Object.fromEntries(Object.keys(pooled).map((y) => [y, r3(med(pooled[y]))])) };
fs.writeFileSync(path.join(root, 'data', 'continuity.json'), JSON.stringify(out));
const cs = ids.map((i) => rows[i].c).sort((a, b) => a - b), ho = ids.map((i) => rows[i].ho).filter((x) => x != null).sort((a, b) => a - b);
console.log('countries', ids.length, '| c median', med(cs).toFixed(3), 'p10', cs[Math.floor(cs.length * 0.1)], 'p90', cs[Math.floor(cs.length * 0.9)], 'min', cs[0], 'max', cs[cs.length - 1]);
console.log('holdout yearly error: median', med(ho).toFixed(1) + '%', 'p90', ho[Math.floor(ho.length * 0.9)] + '%', 'max', ho[ho.length - 1] + '%', '| share under 5%:', Math.round(100 * ho.filter((x) => x < 5).length / ho.length) + '%');
console.log('pooled c by year', JSON.stringify(out.pooledByYear));
const big = ids.sort((a, b) => rows[b].tot - rows[a].tot).slice(0, 6).map((i) => i + ' c=' + rows[i].c + ' ho=' + rows[i].ho + '%');
console.log('biggest', big.join(' | '));
