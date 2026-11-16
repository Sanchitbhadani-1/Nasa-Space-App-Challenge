/* SUNDIAL trainer: fits real models on the example datasets, in a background thread, in the visitor's browser.
   Nothing is uploaded: the CSV is fetched from this site, parsed here, and the model lives only in this worker.

   Messages in:  { id, cmd: 'train', task, url }  or  { id, cmd: 'view', task, ... }
   Messages out: { id, type: 'progress' | 'done' | 'error', ... }
   Models: histogram gradient-boosted trees (the same family as scikit-learn's HistGradientBoostingRegressor), ridge regression on
   Fourier features, and inverse-distance neighbours on the grid. Every task reports its error next to an honest baseline. */
'use strict';

const ST = {};                       // trained state per task, kept for 'view' requests
const send = (id, m) => postMessage(Object.assign({ id }, m));
const SPLIT = (ym) => (ym <= 201912 ? 0 : ym <= 202212 ? 1 : 2);   // train, valid, test: time-ordered, no shuffling
const mean = (a) => { let s = 0; for (let i = 0; i < a.length; i++) s += a[i]; return a.length ? s / a.length : NaN; };
const mae = (p, y, idx) => { let s = 0, n = 0; for (const i of idx) { if (isFinite(p[i]) && isFinite(y[i])) { s += Math.abs(p[i] - y[i]); n++; } } return n ? s / n : NaN; };
const l1 = Math.log1p;

/* ---------- CSV: our files have no quoted fields ---------- */
function parseCSV(text) {
  const lines = text.split('\n'); while (lines.length && lines[lines.length - 1] === '') lines.pop();
  const head = lines[0].split(','), n = lines.length - 1, raw = head.map(() => new Array(n));
  for (let i = 0; i < n; i++) { const f = lines[i + 1].split(','); for (let j = 0; j < head.length; j++) raw[j][i] = f[j]; }
  const cols = {};
  head.forEach((h, j) => {
    const a = raw[j]; let num = true;
    for (let i = 0; i < Math.min(n, 60); i++) if (a[i] !== '' && isNaN(+a[i])) { num = false; break; }
    if (num) { const t = new Float64Array(n); for (let i = 0; i < n; i++) t[i] = a[i] === '' ? NaN : +a[i]; cols[h] = t; } else cols[h] = a;
  });
  return { n, cols };
}
async function load(id, url) {
  const t0 = performance.now(), r = await fetch(url); if (!r.ok) throw new Error(url + ' ' + r.status);
  const text = await r.text(); send(id, { type: 'progress', pct: 8, label: `Downloaded ${(text.length / 1e6).toFixed(1)} MB` });
  const d = parseCSV(text); d.loadMs = performance.now() - t0; return d;
}

/* ---------- histogram gradient-boosted trees ---------- */
function makeBins(X, n, p, B) {
  const edges = [], Xb = new Uint8Array(n * p), step = Math.max(1, Math.floor(n / 20000));
  for (let j = 0; j < p; j++) {
    const v = []; for (let i = 0; i < n; i += step) { const x = X[i * p + j]; if (x === x) v.push(x); } v.sort((a, b) => a - b);
    const e = []; for (let b = 1; b < B; b++) { const x = v[Math.floor(b * v.length / B)]; if (x !== undefined && (!e.length || x > e[e.length - 1])) e.push(x); }
    edges.push(e);
    for (let i = 0; i < n; i++) Xb[i * p + j] = binOf(e, X[i * p + j]);
  }
  return { edges, Xb };
}
function binOf(e, x) { if (x !== x) return 0; let lo = 0, hi = e.length; while (lo < hi) { const m = (lo + hi) >> 1; if (e[m] <= x) lo = m + 1; else hi = m; } return 1 + lo; }
function growTree(Xb, p, r, idx, depth, nb, minLeaf) {
  const sum = idx.reduce((s, i) => s + r[i], 0), cnt = idx.length, leaf = { v: sum / (cnt + 1) };
  if (depth === 0 || cnt < 2 * minLeaf) return leaf;
  let best = 0, bf = -1, bt = 0; const hs = new Float64Array(nb), hc = new Int32Array(nb), base = sum * sum / cnt;
  for (let j = 0; j < p; j++) {
    hs.fill(0); hc.fill(0);
    for (let k = 0; k < cnt; k++) { const i = idx[k], b = Xb[i * p + j]; hs[b] += r[i]; hc[b]++; }
    let ls = 0, lc = 0;
    for (let t = 0; t < nb - 1; t++) {
      ls += hs[t]; lc += hc[t]; const rc = cnt - lc; if (lc < minLeaf || rc < minLeaf) continue;
      const g = ls * ls / lc + (sum - ls) * (sum - ls) / rc - base; if (g > best) { best = g; bf = j; bt = t; }
    }
  }
  if (bf < 0) return leaf;
  const L = [], R = []; for (let k = 0; k < cnt; k++) { const i = idx[k]; (Xb[i * p + bf] <= bt ? L : R).push(i); }
  return { f: bf, t: bt, l: growTree(Xb, p, r, L, depth - 1, nb, minLeaf), r: growTree(Xb, p, r, R, depth - 1, nb, minLeaf) };
}
const walk = (node, row, off, Xb, p) => { while (node.f !== undefined) node = Xb[off + node.f] <= node.t ? node.l : node.r; return node.v; };
/* X: Float64 rows of p features, y: targets, rows: indices to train on. Returns a model that predicts any X. */
function fitGBT(X, y, n, p, rows, opt, onTick) {
  const o = Object.assign({ trees: 120, depth: 4, lr: 0.1, bins: 32, minLeaf: 20 }, opt), { edges, Xb } = makeBins(X, n, p, o.bins), nb = o.bins + 2;
  const base = mean(rows.map((i) => y[i])), F = new Float64Array(n).fill(base), r = new Float64Array(n), trees = [];
  for (let m = 0; m < o.trees; m++) {
    for (const i of rows) r[i] = y[i] - F[i];
    const tree = growTree(Xb, p, r, rows.slice(), o.depth, nb, o.minLeaf); trees.push(tree);
    for (let i = 0; i < n; i++) F[i] += o.lr * walk(tree, null, i * p, Xb, p);
    if (onTick && m % 10 === 9) onTick((m + 1) / o.trees);
  }
  return { base, lr: o.lr, trees, edges, p, predictAll: () => Float64Array.from(F) };
}
function predictGBT(model, X, n) {
  const { edges, p, trees, base, lr } = model, out = new Float64Array(n), Xb = new Uint8Array(p);
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < p; j++) Xb[j] = binOf(edges[j], X[i * p + j]);
    let s = base; for (const t of trees) s += lr * walk(t, null, 0, Xb, p); out[i] = s;
  }
  return out;
}

/* ---------- tiny ridge regression (closed form) ---------- */
function ridge(A, y, lam) {   // A: array of feature rows
  const p = A[0].length, M = Array.from({ length: p }, () => new Float64Array(p + 1));
  for (let k = 0; k < A.length; k++) for (let a = 0; a < p; a++) { for (let b = 0; b < p; b++) M[a][b] += A[k][a] * A[k][b]; M[a][p] += A[k][a] * y[k]; }
  for (let a = 1; a < p; a++) M[a][a] += lam;
  for (let c = 0; c < p; c++) {
    let piv = c; for (let r = c + 1; r < p; r++) if (Math.abs(M[r][c]) > Math.abs(M[piv][c])) piv = r;
    [M[c], M[piv]] = [M[piv], M[c]];
    for (let r = 0; r < p; r++) if (r !== c) { const f = M[r][c] / M[c][c]; for (let k = c; k <= p; k++) M[r][k] -= f * M[c][k]; }
  }
  return M.map((row, i) => row[p] / row[i]);
}

/* ---------- time-series tasks share one shape ---------- */
function finishTS(id, name, d, rows, y, pred, base, extra) {
  const idxBy = [[], [], []]; for (let i = 0; i < d.n; i++) if (isFinite(y[i])) idxBy[SPLIT(d.cols.ym[i])].push(i);
  const m = (a) => mae(a, y, idxBy[2]), model = m(pred), bs = base.map((b) => m(b.vals));
  ST[name] = { d, y, pred, base, country: d.cols.country, ym: d.cols.ym };
  return { rows: rows.length, metrics: [{ label: 'Your model', v: model, you: true }].concat(base.map((b, i) => ({ label: b.label, v: bs[i] }))), valid: mae(pred, y, idxBy[1]), test: idxBy[2].length, extra };
}
const TIER = { measured: 0, blended: 1, borrowed: 2 };

const TASKS = {
  async forecast(id, url) {
    const d = await load(id, url), c = d.cols, n = d.n, F = ['lag1', 'lag2', 'lag3', 'lag6', 'lag12', 'mean3', 'mean12', 'same_month_before'], p = F.length + 7;
    const X = new Float64Array(n * p), y = c.y_log1p, rows = [];
    for (let i = 0; i < n; i++) {
      F.forEach((f, j) => { X[i * p + j] = l1(c[f][i]); });
      let k = F.length; [c.month_sin[i], c.month_cos[i], c.year[i], c.viirs_era[i], c.lat[i], c.lon[i], TIER[c.tier[i]] || 0].forEach((v) => { X[i * p + k++] = v; });
      if (SPLIT(c.ym[i]) === 0) rows.push(i);
    }
    const model = fitGBT(X, y, n, p, rows, {}, (f) => send(id, { type: 'progress', pct: 12 + 80 * f, label: 'Boosting trees' }));
    const pred = model.predictAll(), last = new Float64Array(n), ly = new Float64Array(n);
    for (let i = 0; i < n; i++) { last[i] = l1(c.lag1[i]); ly[i] = l1(c.lag12[i]); }
    const r = finishTS(id, 'forecast', d, rows, y, pred, [{ label: 'Repeat last month', vals: last }, { label: 'Repeat same month last year', vals: ly }]);
    r.title = 'Next-month forecast'; r.unit = 'mean absolute error on the 2023 to 2025 test months, log scale (lower is better)'; r.rowsTrain = rows.length; return r;
  },

  async panel(id, url) {
    const d = await load(id, url), c = d.cols, n = d.n, y = new Float64Array(n), rows = [];
    for (let i = 0; i < n; i++) { y[i] = c.harmonized[i] === c.harmonized[i] ? l1(c.harmonized[i]) : NaN; if (y[i] === y[i] && SPLIT(c.ym[i]) === 0) rows.push(i); }
    const cm = new Map(), cmm = new Map();   // country mean and country-by-calendar-month mean, from training years only
    for (const i of rows) { const k = c.country[i], k2 = k + '|' + c.month[i]; for (const [m, key] of [[cm, k], [cmm, k2]]) { const e = m.get(key) || [0, 0]; e[0] += y[i]; e[1]++; m.set(key, e); } }
    const g = (m, key) => { const e = m.get(key); return e ? e[0] / e[1] : NaN; };
    const p = 9, X = new Float64Array(n * p), clim = new Float64Array(n), flat = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      const m = c.month[i], k = c.country[i]; let j = 0;
      [c.year[i], Math.sin(2 * Math.PI * (m - 1) / 12), Math.cos(2 * Math.PI * (m - 1) / 12), c.source[i] === 'modis' ? 0 : 1, g(cm, k), g(cmm, k + '|' + m), c.terra_n[i] > 0 ? l1(c.terra_n[i]) : NaN, c.aqua_n[i] > 0 ? l1(c.aqua_n[i]) : NaN, c.month[i]].forEach((v) => { X[i * p + j++] = v; });
      clim[i] = g(cmm, k + '|' + m); flat[i] = g(cm, k);
    }
    // raw satellite counts are inputs here on purpose: this model learns how much of the harmonized record each camera explains
    const model = fitGBT(X, y, n, p, rows, {}, (f) => send(id, { type: 'progress', pct: 12 + 80 * f, label: 'Boosting trees' }));
    const r = finishTS(id, 'panel', d, rows, y, model.predictAll(), [{ label: 'Typical value for that country and month', vals: clim }, { label: 'Country average', vals: flat }]);
    r.title = 'Fill the record from the cameras'; r.unit = 'mean absolute error on the 2023 to 2025 test months, log scale (lower is better)'; return r;
  },

  async pairs(id, url) {
    const d = await load(id, url), c = d.cols, n = d.n, y = new Float64Array(n), rows = [], p = 9, X = new Float64Array(n * p);
    let sT = 0, sS = 0;
    for (let i = 0; i < n; i++) {
      y[i] = l1(c.suomi_npp_n[i]); const m = c.month[i], yr = Math.floor(c.ym[i] / 100); let j = 0;
      [l1(c.terra_n[i]), l1(c.aqua_n[i]), c.terra_pass_h[i], c.aqua_pass_h[i], Math.sin(2 * Math.PI * (m - 1) / 12), Math.cos(2 * Math.PI * (m - 1) / 12), c.lat[i], c.lon[i], yr].forEach((v) => { X[i * p + j++] = v; });
      if (SPLIT(c.ym[i]) === 0) { rows.push(i); sT += c.terra_n[i] + c.aqua_n[i]; sS += c.suomi_npp_n[i]; }
    }
    const k = sS / Math.max(1, sT), ratio = new Float64Array(n), noPass = new Float64Array(n);
    for (let i = 0; i < n; i++) ratio[i] = l1(k * (c.terra_n[i] + c.aqua_n[i]));
    // a second honest baseline: the same model without the drifting pass times
    const X2 = X.slice(); for (let i = 0; i < n; i++) { X2[i * p + 2] = NaN; X2[i * p + 3] = NaN; X2[i * p + 8] = NaN; }
    const m1 = fitGBT(X, y, n, p, rows, {}, (f) => send(id, { type: 'progress', pct: 12 + 40 * f, label: 'Boosting trees' }));
    const m2 = fitGBT(X2, y, n, p, rows, { trees: 90 }, (f) => send(id, { type: 'progress', pct: 55 + 40 * f, label: 'Checking without the pass times' }));
    const r = finishTS(id, 'pairs', d, rows, y, m1.predictAll(), [{ label: 'One fixed ratio (' + k.toFixed(1) + '×)', vals: ratio }, { label: 'Same model without pass times', vals: m2.predictAll() }]);
    r.title = 'MODIS to VIIRS conversion'; r.unit = 'mean absolute error predicting the VIIRS count on the 2023 to 2025 test months, log scale (lower is better)'; return r;
  },

  async scorecard(id, url) {
    const d = await load(id, url), c = d.cols, n = d.n, p = 9, X = new Float64Array(n * p), y = new Float64Array(n), ok = [];
    for (let i = 0; i < n; i++) {
      let j = 0; [TIER[c.tier[i]] || 0, Math.log10(1 + c.calib_n[i]), c.lat[i], c.lon[i], c.b_terra[i], c.b_aqua_swath[i], c.b_adj[i], c.b_adj_se[i], Math.log10(1 + c.total_detections[i])].forEach((v) => { X[i * p + j++] = v; });
      y[i] = Math.max(-100, Math.min(100, c.terra_drift_gap_closed_pct[i])); if (y[i] === y[i]) ok.push(i);
    }
    const pred = new Float64Array(n).fill(NaN), base = new Float64Array(n).fill(NaN), K = 5, fold = (i) => (i * 7 + 3) % K;
    for (let f = 0; f < K; f++) {   // 5-fold cross-validation: every country is predicted by a model that never saw it
      const tr = ok.filter((i) => fold(i) !== f), te = ok.filter((i) => fold(i) === f), mdl = fitGBT(X, y, n, p, tr, { trees: 60, depth: 3, minLeaf: 5 });
      const pr = predictGBT(mdl, te.map((i) => Array.from(X.subarray(i * p, i * p + p))).flat(), te.length), mu = mean(tr.map((i) => y[i]));
      te.forEach((i, k) => { pred[i] = pr[k]; base[i] = mu; });
      send(id, { type: 'progress', pct: 15 + 80 * (f + 1) / K, label: `Fold ${f + 1} of ${K}` });
    }
    ST.scorecard = { d, y, pred, base, country: c.country };
    return { title: 'Where the correction works', rows: ok.length, unit: 'mean absolute error predicting the percent of Terra\'s false trend removed, 5-fold cross-validated (lower is better)',
      metrics: [{ label: 'Your model', v: mae(pred, y, ok), you: true }, { label: 'Guess the average', v: mae(base, y, ok) }], plain: true };
  },

  async curves(id, url) {
    const d = await load(id, url), c = d.cols, groups = new Map();
    for (let i = 0; i < d.n; i++) { const k = c.country[i] + '|' + c.period[i], g = groups.get(k) || {}; (g[c.satellite[i]] = g[c.satellite[i]] || []).push([c.local_hour[i] + 0.25, c.detections[i]]); groups.set(k, g); }
    const isDay = (h) => h >= 6 && h < 18, pts = [];
    const grp = (h) => { const o = { day: [0, 0, 0], night: [0, 0, 0] }; for (const [t, n] of h) { const g = isDay(t) ? o.day : o.night, a = t / 24 * 2 * Math.PI; g[0] += n; g[1] += n * Math.cos(a); g[2] += n * Math.sin(a); } for (const k in o) o[k][3] = o[k][0] ? ((Math.atan2(o[k][2], o[k][1]) / (2 * Math.PI)) * 24 + 24) % 24 : NaN; return o; };
    for (const [key, g] of groups) {   // eight points per country: Terra and Aqua, day and night, before and after the drift, scaled by what VIIRS saw by day
      const ref = g.suomi_npp && grp(g.suomi_npp).day[0]; if (!ref || ref < 1000) continue;
      for (const sat of ['terra', 'aqua']) { if (!g[sat]) continue; const o = grp(g[sat]); for (const part of ['day', 'night']) if (o[part][0] >= 150) pts.push({ country: key.split('|')[0], h: o[part][3], v: Math.log(o[part][0] / ref), period: key.split('|')[1], sat, part }); }
    }
    const basis = (h) => { const a = h / 24 * 2 * Math.PI; return [1, Math.cos(a), Math.sin(a), Math.cos(2 * a), Math.sin(2 * a)]; };
    const hash = (s) => { let x = 7; for (let i = 0; i < s.length; i++) x = (x * 31 + s.charCodeAt(i)) >>> 0; return x; };
    const hold = (p) => hash(p.country) % 5 === 0, tr = pts.filter((p) => !hold(p)), te = pts.filter(hold);
    send(id, { type: 'progress', pct: 60, label: 'Fitting the daily curve' });
    const w = ridge(tr.map((p) => basis(p.h)), tr.map((p) => p.v), 0.3), f = (h) => basis(h).reduce((s, b, i) => s + b * w[i], 0), mu = mean(tr.map((p) => p.v));
    let best = 0, bh = 0; const curve = []; for (let h = 0; h <= 24; h += 0.5) { const v = f(h); curve.push([h, v]); if (v > best || h === 0) { best = v; bh = h; } }
    const mx = Math.max(...curve.map((q) => q[1]));
    ST.curves = { pts, curve: curve.map(([h, v]) => [h, Math.exp(v - mx)]) };
    const err = (fn) => mean(te.map((p) => Math.abs(fn(p) - p.v)));
    return { title: 'The daily fire rhythm', rows: pts.length, unit: `mean absolute error in log ratio on ${new Set(te.map((p) => p.country)).size} countries held out of the fit (lower is better)`,
      metrics: [{ label: 'Your curve', v: err((p) => f(p.h)), you: true }, { label: 'A flat line (no daily rhythm)', v: err(() => mu) }], plain: true,
      extra: { peak: bh, points: pts.length } };
  },

  /* 0.5 degree world grid: learn to predict a cell from its neighbours, check on cells hidden from the fit, then fill and smooth a region */
  async grid(id, url) {
    const d = await load(id, url), c = d.cols, n = d.n, MON = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
    const NX = 720, key = (ix, iy) => iy * NX + ix, at = new Map(), ix = new Int32Array(n), iy = new Int32Array(n), V = new Float32Array(n * 12), A = new Float32Array(n);
    for (let i = 0; i < n; i++) { ix[i] = Math.floor((c.lon[i] + 180) / 0.5); iy[i] = Math.floor((c.lat[i] + 90) / 0.5); at.set(key(ix[i], iy[i]), i); let s = 0; MON.forEach((m, j) => { V[i * 12 + j] = l1(c[m][i]); s += c[m][i]; }); A[i] = l1(s / 12); }
    const known = new Uint8Array(n).fill(1);
    /* inverse-distance neighbours: the k nearest known cells within `R` rings, weight 1/d^pw. Returns the log value of one month column set. */
    function near(x, y, self, k, pw, R, out) {
      let found = 0; const cand = [];
      for (let r = 1; r <= R && found < k * 2; r++) {
        for (let dx = -r; dx <= r; dx++) for (let dy = -r; dy <= r; dy++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
          const j = at.get(key(x + dx, y + dy)); if (j === undefined || j === self || !known[j]) continue;
          cand.push([Math.hypot(dx, dy), j]); found++;
        }
      }
      cand.sort((a, b) => a[0] - b[0]); const use = cand.slice(0, k); out.n = use.length; if (!use.length) return false;
      out.md = mean(use.map((u) => u[0])); let ws = 0; out.v = new Float64Array(12);
      for (const [dd, j] of use) { const w = 1 / Math.pow(dd, pw); ws += w; for (let m = 0; m < 12; m++) out.v[m] += w * V[j * 12 + m]; }
      for (let m = 0; m < 12; m++) out.v[m] /= ws;
      out.rough = Math.sqrt(mean(use.map((u) => { const d1 = A[u[1]] - mean(use.map((q) => A[q[1]])); return d1 * d1; })));
      return true;
    }
    // hold out cells: 15% to choose k and the distance power, a different 15% to report an honest error
    const rnd = (i) => ((i * 2654435761) >>> 0) / 4294967296, val = [], test = [];
    for (let i = 0; i < n; i++) { const r = rnd(i); if (r < 0.15) val.push(i); else if (r < 0.3) test.push(i); }
    const hide = (list) => list.forEach((i) => { known[i] = 0; }), show = (list) => list.forEach((i) => { known[i] = 1; });
    const evalSet = (list, k, pw) => { const o = {}, errs = []; for (const i of list) if (near(ix[i], iy[i], i, k, pw, 6, o)) errs.push(Math.abs(mean(Array.from(o.v)) - mean(Array.from(V.subarray(i * 12, i * 12 + 12))))); return errs; };
    hide(val); hide(test); let bestCfg = null, bestErr = Infinity, tried = 0;
    for (const k of [4, 8, 12]) for (const pw of [1, 2, 3]) {
      const e = mean(evalSet(val.slice(0, 1500), k, pw)); if (e < bestErr) { bestErr = e; bestCfg = { k, pw }; }
      send(id, { type: 'progress', pct: 14 + 56 * (++tried) / 9, label: `Trying k=${k}, power ${pw}` });
    }
    show(val);
    const te = evalSet(test, bestCfg.k, bestCfg.pw).sort((a, b) => a - b), mu = mean(Array.from(A)), base = Array.from(test, (i) => Math.abs(mu - mean(Array.from(V.subarray(i * 12, i * 12 + 12))))).sort((a, b) => a - b);
    show(test);
    const med = (a) => a[Math.floor(a.length / 2)];
    ST.grid = { n, ix, iy, V, A, at, near, key, cfg: bestCfg, known };
    send(id, { type: 'progress', pct: 96, label: 'Ready' });
    return { title: 'World grid, neighbours model', rows: n, unit: 'typical error on cells hidden from the fit, as a ratio (1.0× is perfect)', plain: true,
      metrics: [{ label: 'Your model', v: Math.exp(med(te)), you: true, fmt: 'x' }, { label: 'Guess the world average', v: Math.exp(med(base)), fmt: 'x' }],
      extra: { k: bestCfg.k, pw: bestCfg.pw } };
  }
};

/* ---------- views: what to draw for the region the visitor chose ---------- */
const VIEWS = {
  /* a time series for one country: actual, model, baseline */
  ts(task, m) {
    const s = ST[task]; if (!s) return null; const out = [];
    for (let i = 0; i < s.d.n; i++) if (s.country[i] === m.country && isFinite(s.y[i])) out.push({ ym: s.ym[i], y: Math.expm1(s.y[i]), p: Math.expm1(s.pred[i]), b: Math.expm1(s.base[0].vals[i]), s: SPLIT(s.ym[i]) });
    return out;
  },
  scorecard(task, m) {
    const s = ST.scorecard; if (!s) return null; const i = s.country.indexOf(m.country); return i < 0 ? null : { actual: s.y[i], pred: s.pred[i], base: s.base[i] };
  },
  curves() { return ST.curves ? { curve: ST.curves.curve, pts: ST.curves.pts } : null; },
  /* before and after for a box of cells: observed, gaps filled (capped at the publication floor), noisy cells smoothed, uncertainty */
  grid(task, m) {
    const g = ST.grid; if (!g) return null; const { ix0, iy0, cols, rows, mask, tierF } = m, N = cols * rows, near = g.near;
    const before = new Float32Array(N * 12).fill(NaN), after = new Float32Array(N * 12).fill(NaN), kind = new Uint8Array(N), unc = new Float32Array(N), o = {};
    const FLOOR = Math.log1p(3.9);   // a cell the published grid leaves out has a busiest month under four detections: that is all a gap can mean
    let observed = 0, filled = 0, smoothed = 0, inside = 0, farthest = 0;
    for (let r = 0; r < rows; r++) for (let q = 0; q < cols; q++) {
      const cell = r * cols + q; if (!mask[cell]) continue; inside++;
      const x = ix0 + q, y = iy0 + (rows - 1 - r), j = g.at.get(g.key(x, y)), has = near(x, y, j === undefined ? -1 : j, g.cfg.k, g.cfg.pw, 6, o);
      if (j !== undefined) {
        observed++; kind[cell] = 1;
        for (let k = 0; k < 12; k++) { before[cell * 12 + k] = g.V[j * 12 + k]; after[cell * 12 + k] = g.V[j * 12 + k]; }
        if (has) {   // an isolated low value that disagrees with all its neighbours is probably noise: blend it toward them
          const mv = Math.expm1(g.A[j]), surprise = Math.abs(g.A[j] - mean(Array.from(o.v)));
          if (mv < 30 && surprise > 1.0) { smoothed++; kind[cell] = 2; for (let k = 0; k < 12; k++) after[cell * 12 + k] = 0.5 * g.V[j * 12 + k] + 0.5 * o.v[k]; }
        }
        unc[cell] = has ? Math.min(1, (o.md - 1) / 3 + o.rough / 3) * tierF : 0.3 * tierF;
      } else if (has) {
        filled++; kind[cell] = 3;
        for (let k = 0; k < 12; k++) after[cell * 12 + k] = Math.min(o.v[k], FLOOR);   // a gap is never promoted above the floor
        unc[cell] = Math.min(1, o.md / 4 + 0.3) * tierF; farthest = Math.max(farthest, o.md);
      }
    }
    return { before, after, kind, unc, stats: { observed, filled, smoothed, inside, farthest, k: g.cfg.k, pw: g.cfg.pw } };
  }
};

self.onmessage = async (e) => {
  const { id, cmd, task, url } = e.data;
  try {
    if (cmd === 'train') {
      const t0 = performance.now(); send(id, { type: 'progress', pct: 3, label: 'Downloading' });
      const r = await TASKS[task](id, url); r.ms = performance.now() - t0; r.task = task; send(id, { type: 'done', result: r });
    } else if (cmd === 'view') {
      const v = VIEWS[['forecast', 'panel', 'pairs'].includes(task) ? 'ts' : task](task, e.data);
      send(id, { type: 'view', view: v });
    }
  } catch (err) { send(id, { type: 'error', message: String(err && err.message || err) }); }
};
