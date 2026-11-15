// Precompute the glued-vs-fair trend for every country so the globe can colour all of them without loading 182 files.
// Run after export_static.py:   node tools/build_trends.js   (from the sundial folder)
const fs = require('fs'), path = require('path');
const root = path.resolve(__dirname, '..'), T = require(path.join(root, 'js', 'trend.js'));
const J = (p) => JSON.parse(fs.readFileSync(path.join(root, 'data', p), 'utf8'));
const meta = J('meta.json'), rows = {}, count = {};
for (const c of meta.countries) {
  const s = J('series/' + c.id + '.json'), m = T.measure(s); if (!m) continue;
  rows[c.id] = { n: T.slim(m.N), h: T.slim(m.H), k: m.kind, nd: m.n, hd: m.h, tot: Math.round(s.summary.total) };
  count[m.kind] = (count[m.kind] || 0) + 1;
}
fs.writeFileSync(path.join(root, 'data', 'trends.json'), JSON.stringify({ years: [T.Y0, T.Y1], rows }));
console.log('trends.json:', Object.keys(rows).length, 'countries', JSON.stringify(count));
