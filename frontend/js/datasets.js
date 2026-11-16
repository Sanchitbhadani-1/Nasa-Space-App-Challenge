/* SUNDIAL datasets: Train buttons, results, and the before/after for a region you pick.
   Pressing Train fetches a dataset from data/examples/, fits a real model in a background worker (js/trainer.worker.js), and
   scores it against honest baselines on data it never saw. The region panel then uses the trained world-grid model to show a
   country as the satellites saw it, and as satellites plus model. Nothing leaves the browser. */
(function () {
  const list = document.getElementById('ds-list');
  if (!list) return;
  const $ = (s, r = document) => r.querySelector(s), $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const mb = (b) => (b >= 1e6 ? (b / 1e6).toFixed(1) + ' MB' : Math.max(1, Math.round(b / 1e3)) + ' KB');
  const MONF = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  const TASK_OF = { 'forecast_features.csv': 'forecast', 'country_month_panel.csv': 'panel', 'harmonizer_pairs.csv': 'pairs', 'grid_seasonal.csv': 'grid', 'daily_curves.csv': 'curves', 'country_scorecard.csv': 'scorecard' };
  const REPO = 'https://github.com/Sanchitbhadani-1/Nasa-Space-App-Challenge/blob/main/frontend';

  /* ---------- the worker, shared by every Train button on the page ---------- */
  let worker = null, seq = 0; const waiting = new Map();
  function call(msg, onProgress) {
    if (!worker) {
      worker = new Worker('js/trainer.worker.js');
      worker.onmessage = (e) => { const m = e.data, w = waiting.get(m.id); if (!w) return; if (m.type === 'progress') w.prog && w.prog(m); else { waiting.delete(m.id); m.type === 'error' ? w.rej(new Error(m.message)) : w.res(m); } };
      worker.onerror = (e) => { waiting.forEach((w) => w.rej(new Error(e.message || 'The trainer stopped'))); waiting.clear(); worker = null; };
    }
    return new Promise((res, rej) => { const id = ++seq; waiting.set(id, { res, rej, prog: onProgress }); worker.postMessage(Object.assign({ id }, msg, msg.url ? { url: new URL(msg.url, location.href).href } : {})); });   // a worker resolves paths from its own folder, so hand it absolute ones
  }
  const canTrain = typeof Worker !== 'undefined' && location.protocol !== 'file:';
  const trained = {};   // task -> result

  /* ---------- the chosen region (one country, shared by every chart and the map) ---------- */
  const RG = { id: 'Angola', month: 0, unit: 'cell', pos: 0.5, geom: null, view: null };
  const DATA = () => window.DATA;
  const poss = (n) => n + (/s$/i.test(n) ? '’' : '’s');
  const name = (id) => (DATA().byId[id] ? DATA().byId[id].name : id);

  /* ---------- small SVG charts ---------- */
  function tsChart(rows, title) {
    if (!rows || !rows.length) return '<p class="tiny">No months for this country.</p>';
    const w = 520, h = 190, m = { l: 40, r: 10, t: 12, b: 22 }, xs = rows.map((r) => Math.floor(r.ym / 100) + (r.ym % 100 - 0.5) / 12);
    const x0 = xs[0], x1 = xs[xs.length - 1], mx = Math.max(...rows.map((r) => Math.max(r.y, r.p, r.b))) * 1.06 || 1;
    const X = (v) => m.l + (v - x0) / (x1 - x0) * (w - m.l - m.r), Y = (v) => h - m.b - Math.max(0, v) / mx * (h - m.t - m.b);
    const line = (k, cls) => `<path class="${cls}" d="${rows.map((r, i) => `${i ? 'L' : 'M'}${X(xs[i]).toFixed(1)},${Y(r[k]).toFixed(1)}`).join('')}"/>`;
    const t0 = rows.findIndex((r) => r.s === 2), tx = t0 >= 0 ? X(xs[t0]) : w;
    const fmt = (v) => (v >= 1e6 ? (v / 1e6).toFixed(1) + 'M' : v >= 1e3 ? Math.round(v / 1e3) + 'k' : Math.round(v));
    return `<figure class="ds-fig"><svg viewBox="0 0 ${w} ${h}" role="img" aria-label="${esc(title)}">
      <rect x="${tx}" y="${m.t}" width="${w - m.r - tx}" height="${h - m.t - m.b}" class="test"/>
      ${[0, 0.5, 1].map((f) => `<line x1="${m.l}" x2="${w - m.r}" y1="${Y(mx * f)}" y2="${Y(mx * f)}" class="grid"/><text x="${m.l - 5}" y="${Y(mx * f) + 3}" text-anchor="end">${fmt(mx * f)}</text>`).join('')}
      ${[2005, 2010, 2015, 2020, 2025].map((y) => `<text x="${X(y)}" y="${h - 6}" text-anchor="middle">${y}</text>`).join('')}
      ${line('b', 'base')}${line('y', 'act')}${line('p', 'mod')}
      <text x="${tx + 4}" y="${m.t + 9}" class="tl">test years</text></svg>
      <figcaption><span class="k act"></span>actual <span class="k mod"></span>your model <span class="k base"></span>baseline · ${esc(title)}</figcaption></figure>`;
  }
  function curveChart(v) {
    const w = 520, h = 170, m = { l: 30, r: 10, t: 12, b: 22 }, X = (hh) => m.l + hh / 24 * (w - m.l - m.r), mxv = 1.15, Y = (q) => h - m.b - q / mxv * (h - m.t - m.b);
    const mx = Math.max(...v.curve.map((q) => q[1])), pts = v.pts.filter((p) => p.country === RG.id);
    const ymin = Math.min(...v.curve.map((q) => q[1]));
    return `<figure class="ds-fig"><svg viewBox="0 0 ${w} ${h}" role="img" aria-label="Fitted daily fire curve"><line x1="${m.l}" x2="${w - m.r}" y1="${Y(0)}" y2="${Y(0)}" class="grid"/>
      ${[0, 6, 12, 18, 24].map((t) => `<text x="${X(t)}" y="${h - 6}" text-anchor="middle">${String(t).padStart(2, '0')}:00</text>`).join('')}
      <path class="mod" d="M${v.curve.map(([t, q]) => `${X(t).toFixed(1)},${Y(q / mx).toFixed(1)}`).join('L')}"/>
      ${pts.map((p) => `<circle cx="${X(p.h)}" cy="${Y(Math.exp(p.v - Math.max(...pts.map((z) => z.v))) * 0.9)}" r="4" class="pt"/>`).join('')}</svg>
      <figcaption><span class="k mod"></span>the curve your model learned (peak = 1) · dots are ${esc(name(RG.id))}'s measured passes</figcaption></figure>`;
  }

  /* ---------- result panel under a dataset row ---------- */
  const fmtV = (m) => (m.fmt === 'x' ? m.v.toFixed(2) + '×' : m.v.toFixed(3));
  function renderResult(li, r, view) {
    const box = $('.ds-result', li), ms = r.metrics, top = Math.max(...ms.map((m) => m.v));
    const you = ms.find((m) => m.you), beaten = ms.filter((m) => !m.you && m.v <= you.v);
    const verdict = beaten.length ? `<p class="ds-verdict warn">Honest note: it does not beat “${esc(beaten.map((m) => m.label).join('” or “'))}” here. That is a real result, not a bug.</p>` : '<p class="ds-verdict">It beats every baseline.</p>';
    let chart = '';
    if (view && view.kind === 'ts') chart = tsChart(view.rows, name(RG.id) + ' · ' + r.title);
    else if (view && view.kind === 'scorecard') chart = view.v ? `<p class="ds-fact"><b>${esc(name(RG.id))}</b>: the fix removed <b>${view.v.actual.toFixed(0)}%</b> of Terra's false trend. Your model, never shown ${esc(name(RG.id))}, guessed <b>${view.v.pred.toFixed(0)}%</b>; guessing the average gives ${view.v.base.toFixed(0)}%.</p>` : '';
    else if (view && view.kind === 'curves') chart = view.v ? curveChart(view.v) : '';
    else if (r.task === 'grid') chart = '<p class="ds-fact">The region panel on the right now shows what this model does to a country. Pick another there.</p>';
    box.innerHTML = `<div class="ds-metrics" role="list">${ms.map((m) => `<div class="${m.you ? 'you' : ''}" role="listitem"><span>${esc(m.label)}</span><span class="b"><i style="width:${Math.max(3, m.v / top * 100).toFixed(1)}%"></i></span><b>${fmtV(m)}</b></div>`).join('')}</div>
      <p class="ds-unit">${esc(r.unit)}</p>${verdict}${chart}
      <p class="tiny">Trained on ${(r.rowsTrain || r.rows).toLocaleString('en-US')} rows in ${(r.ms / 1000).toFixed(1)} s, in your browser. Nothing was uploaded.</p>`;
    box.hidden = false;
  }
  async function refreshView(li, task) {
    const r = trained[task]; if (!r) return;
    let view = null;
    try {
      if (['forecast', 'panel', 'pairs'].includes(task)) { const v = (await call({ cmd: 'view', task, country: RG.id })).view; view = { kind: 'ts', rows: v }; }
      else if (task === 'scorecard') view = { kind: 'scorecard', v: (await call({ cmd: 'view', task, country: RG.id })).view };
      else if (task === 'curves') view = { kind: 'curves', v: (await call({ cmd: 'view', task })).view };
    } catch (e) { /* the table is still useful without the chart */ }
    renderResult(li, r, view);
  }
  async function train(li, task, url) {
    const btn = $('.train', li), box = $('.ds-result', li);
    btn.disabled = true; btn.textContent = 'Training…'; box.hidden = false;
    box.innerHTML = '<div class="ds-prog" role="progressbar" aria-valuemin="0" aria-valuemax="100"><i></i><span>Starting…</span></div>';
    const bar = $('.ds-prog', box);
    try {
      const done = await call({ cmd: 'train', task, url }, (m) => { $('i', bar).style.width = m.pct + '%'; $('span', bar).textContent = m.label || 'Training'; bar.setAttribute('aria-valuenow', Math.round(m.pct)); });
      trained[task] = done.result;
      await refreshView(li, task);
      btn.textContent = 'Train again';
      if (task === 'grid') { RG.view = null; loadRegionView(); }
    } catch (e) { box.innerHTML = `<p class="ds-verdict warn">Training did not finish: ${esc(e.message)}</p>`; btn.textContent = 'Try again'; }
    btn.disabled = false;
  }

  /* ---------- the list ---------- */
  fetch('data/examples/manifest.json').then((r) => { if (!r.ok) throw new Error(r.status); return r.json(); }).then((m) => {
    const order = ['forecast_features.csv', 'harmonizer_pairs.csv', 'grid_seasonal.csv', 'country_month_panel.csv', 'daily_curves.csv', 'country_scorecard.csv'];
    const files = order.map((f) => m.files.find((x) => x.file === f)).filter(Boolean);
    list.innerHTML = files.map((f) => `<li data-task="${TASK_OF[f.file]}" data-file="${esc(f.file)}">
      <div class="ds-main"><b>${esc(f.title)}</b><span class="ds-meta">${f.rows.toLocaleString('en-US')} rows · ${f.cols} columns · ${mb(f.bytes)}</span>
        <p>${esc(f.use)}</p><details><summary>Target and notes</summary><p><b>Target:</b> ${esc(f.target)}</p><p>${esc(f.notes)}</p></details></div>
      <div class="ds-actions"><button type="button" class="btn train"${canTrain ? '' : ' disabled'}>Train a model</button><a class="ds-csv" href="data/examples/${esc(f.file)}" download>CSV</a></div>
      <div class="ds-result" hidden aria-live="polite"></div></li>`).join('');
    list.addEventListener('click', (e) => { const b = e.target.closest('.train'); if (!b) return; const li = b.closest('li'); train(li, li.dataset.task, 'data/examples/' + li.dataset.file); });
    if (!canTrain) $('#ds-note').textContent = 'Training needs the page to be served over http(s) (not opened as a file) and a browser with Web Workers.';
    const base = new URL('data/examples/', location.href).href;
    $('#ds-code').textContent = `import pandas as pd\n\nbase = "${base}"\ndf = pd.read_csv(base + "forecast_features.csv")\ntrain, valid, test = (df[df.split == s] for s in ("train", "valid", "test"))\nprint(len(train), len(valid), len(test))   # time-ordered split, no shuffling needed`;
    $('#ds-copy').addEventListener('click', async (e) => { const b = e.currentTarget; try { await navigator.clipboard.writeText($('#ds-code').textContent); b.textContent = 'Copied'; } catch (err) { b.textContent = 'Select to copy'; } setTimeout(() => { b.textContent = 'Copy code'; }, 1800); });
    $('#ds-note').insertAdjacentHTML('beforeend', `${canTrain ? '' : ' '}Counts are VIIRS-equivalent detections per month, ${String(m.first_month).slice(0, 4)} to ${String(m.last_month).slice(0, 4)}, ${m.countries} countries. Source: NASA FIRMS. <a href="${REPO}/data/examples/README.md" target="_blank" rel="noopener">Column guide</a> · <a href="${REPO}/data/examples/train_baseline.py" target="_blank" rel="noopener">the same idea in Python</a>.`);
  }).catch(() => { list.innerHTML = '<li class="tiny">The dataset list needs the page to be served over http(s), not opened as a file.</li>'; });

  /* ---------- the region: satellites only, and satellites plus the trained model ---------- */
  const box = $('#rg-ba'), cv = $('#rg-canvas'), tip = $('#rg-tip');
  if (!box) return;
  const STOPS = [[0, [18, 8, 10]], [0.25, [122, 34, 8]], [0.55, [255, 106, 26]], [0.8, [255, 198, 90]], [1, [243, 234, 217]]];
  const ramp = (l) => { l = Math.max(0, Math.min(1, l)); for (let i = 1; i < STOPS.length; i++) if (l <= STOPS[i][0]) { const [a, A] = STOPS[i - 1], [b, B] = STOPS[i], t = (l - a) / (b - a); return A.map((v, k) => Math.round(v + (B[k] - v) * t)); } return STOPS[4][1]; };

  function geometry(id) {   // the box of 0.5 degree cells around a country and which cells are inside its outline
    const D = DATA(), c = D.byId[id], f = D.features[id]; let b = c.bbox; if (b[2] - b[0] > 100 && D.mbox && D.mbox[id]) b = D.mbox[id];
    const ix0 = Math.floor((b[0] + 180) / 0.5), ix1 = Math.ceil((b[2] + 180) / 0.5), iy0 = Math.floor((b[1] + 90) / 0.5), iy1 = Math.ceil((b[3] + 90) / 0.5), cols = ix1 - ix0, rows = iy1 - iy0, S = 4;
    const oc = document.createElement('canvas'); oc.width = cols * S; oc.height = rows * S; const x = oc.getContext('2d', { willReadFrequently: true });
    const X = (lon) => ((lon + 180) / 0.5 - ix0) * S, Y = (lat) => (iy1 - (lat + 90) / 0.5) * S, g = f.geometry, polys = g.type === 'Polygon' ? [g.coordinates] : g.coordinates;
    x.beginPath(); for (const poly of polys) for (const ring of poly) { ring.forEach((p, i) => (i ? x.lineTo(X(p[0]), Y(p[1])) : x.moveTo(X(p[0]), Y(p[1])))); x.closePath(); } x.fillStyle = '#000'; x.fill('evenodd');
    const px = x.getImageData(0, 0, oc.width, oc.height).data, mask = new Uint8Array(cols * rows); let inside = 0;
    for (let r = 0; r < rows; r++) for (let q = 0; q < cols; q++) { const on = px[((r * S + S / 2) * oc.width + q * S + S / 2) * 4 + 3] > 127; mask[r * cols + q] = on ? 1 : 0; if (on) inside++; }
    // observed values straight from the published grid (no training needed for the "before")
    const C = D.climo, obs = new Float32Array(cols * rows * 12).fill(NaN), kind = new Uint8Array(cols * rows);
    for (let i = 0; i < C.n; i++) {
      const cx = Math.floor((C.lon[i] + 180) / 0.5) - ix0, cy = Math.floor((C.lat[i] + 90) / 0.5), r = iy1 - 1 - cy; if (cx < 0 || cx >= cols || r < 0 || r >= rows || !mask[r * cols + cx]) continue;
      kind[r * cols + cx] = 1; for (let k = 0; k < 12; k++) obs[(r * cols + cx) * 12 + k] = C.v[i * 12 + k];
    }
    return { id, ix0, iy0, iy1, cols, rows, mask, inside, obs, kind, outline: { X, Y, polys }, S };
  }
  const tierF = (id) => ({ measured: 1, blended: 1.2, borrowed: 1.45 }[DATA().byId[id].tier] || 1);
  const cellKm2 = (lat) => 55.66 * 55.3 * Math.cos(lat * Math.PI / 180);
  const latOf = (g, r) => (g.iy0 + (g.rows - 1 - r) + 0.5) * 0.5 - 90;

  async function loadRegionView() {
    const g = RG.geom; if (!g) return;
    if (!trained.grid) { RG.view = null; draw(); stats(); return; }
    const token = ++loadRegionView.t;
    const v = (await call({ cmd: 'view', task: 'grid', ix0: g.ix0, iy0: g.iy0, cols: g.cols, rows: g.rows, mask: g.mask, tierF: tierF(g.id) })).view;
    if (token === loadRegionView.t) { RG.view = v; draw(); stats(); }
  }
  loadRegionView.t = 0;
  function setRegion(id) {
    RG.id = id; RG.geom = geometry(id); RG.view = null;
    const g = RG.geom, sums = Array(12).fill(0); for (let i = 0; i < g.mask.length; i++) if (g.kind[i]) for (let k = 0; k < 12; k++) sums[k] += g.obs[i * 12 + k];
    RG.busiest = sums.indexOf(Math.max(...sums)); draw(); stats(); loadRegionView();
    $$('#ds-list li').forEach((li) => { if (trained[li.dataset.task]) refreshView(li, li.dataset.task); });
  }
  const monthIdx = () => (RG.month === 0 ? RG.busiest : RG.month - 1);

  let raf = 0; const drawSoon = () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(draw); };
  function draw() {
    const g = RG.geom; if (!g) return;
    const W = Math.max(280, box.clientWidth), cs = Math.max(1.4, Math.min(W / g.cols, 340 / g.rows, 18)), H = Math.round(g.rows * cs), dpr = Math.min(devicePixelRatio || 1, 2);
    if (cv.width !== Math.round(W * dpr) || cv.height !== Math.round(H * dpr)) { cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr); cv.style.height = H + 'px'; }
    const x = cv.getContext('2d'), ox = (W - g.cols * cs) / 2, k = monthIdx(), v = RG.view, area = RG.unit === 'area';
    x.setTransform(dpr, 0, 0, dpr, 0, 0); x.clearRect(0, 0, W, H);
    const val = (arr, i, log) => { let q = arr[i * 12 + k]; if (q !== q) return NaN; if (log) q = Math.expm1(q); return area ? q / cellKm2(latOf(g, Math.floor(i / g.cols))) * 1000 : q; };
    const all = []; for (let i = 0; i < g.mask.length; i++) if (g.kind[i]) all.push(val(g.obs, i, false)); all.sort((a, b) => a - b);
    const top = Math.max(1e-6, all[Math.floor(all.length * 0.97)] || 1);
    const hatch = (px, py, s) => { x.strokeStyle = 'rgba(243,234,217,.55)'; x.lineWidth = 0.8; x.beginPath(); for (let t = -s; t < s; t += 3.2) { x.moveTo(px + Math.max(0, t), py + Math.max(0, -t)); x.lineTo(px + Math.min(s, t + s), py + Math.min(s, s - t)); } x.stroke(); };
    const side = (mode) => {
      x.fillStyle = 'rgb(14,11,9)'; x.fillRect(0, 0, W, H);
      for (let r = 0; r < g.rows; r++) for (let q = 0; q < g.cols; q++) {
        const i = r * g.cols + q; if (!g.mask[i]) continue; const px = ox + q * cs, py = r * cs, sz = cs + 0.35;
        if (mode === 'before') {
          if (!g.kind[i]) { x.fillStyle = 'rgba(243,234,217,.05)'; x.fillRect(px, py, sz, sz); if (cs >= 5) { x.fillStyle = 'rgba(243,234,217,.22)'; x.fillRect(px + cs / 2 - 0.7, py + cs / 2 - 0.7, 1.4, 1.4); } continue; }
          const c = ramp(Math.sqrt(val(g.obs, i, false) / top)); x.fillStyle = `rgb(${c})`; x.fillRect(px, py, sz, sz);
        } else if (!v) {
          if (g.kind[i]) { const c = ramp(Math.sqrt(val(g.obs, i, false) / top)); x.fillStyle = `rgba(${c},.45)`; x.fillRect(px, py, sz, sz); }
        } else {
          const kd = v.kind[i]; if (!kd) continue; const c = ramp(Math.sqrt(val(v.after, i, true) / top)), u = v.unc[i];
          x.globalAlpha = 1 - 0.55 * Math.min(1, u); x.fillStyle = `rgb(${c})`; x.fillRect(px, py, sz, sz); x.globalAlpha = 1;
          if (kd === 3 && cs >= 3.5) hatch(px, py, cs);
          if (kd === 2 && cs >= 4) { x.fillStyle = '#fff'; x.fillRect(px + cs - 3, py + 1, 2, 2); }
        }
      }
      x.save(); x.strokeStyle = 'rgba(243,234,217,.55)'; x.lineWidth = 1; x.lineJoin = 'round'; x.beginPath();
      for (const poly of g.outline.polys) for (const ring of poly) { ring.forEach((p, i) => { const X = ox + g.outline.X(p[0]) / g.S * cs, Y = g.outline.Y(p[1]) / g.S * cs; i ? x.lineTo(X, Y) : x.moveTo(X, Y); }); x.closePath(); }
      x.stroke(); x.restore();
    };
    const cut = Math.round(W * RG.pos);
    x.save(); x.beginPath(); x.rect(0, 0, cut, H); x.clip(); side('before'); x.restore();
    x.save(); x.beginPath(); x.rect(cut, 0, W - cut, H); x.clip(); side('after'); x.restore();
    if (!v) { x.fillStyle = 'rgba(10,9,8,.72)'; const t = trained.grid ? 'Building the after…' : 'Train the world-grid model to build the after'; x.font = '600 13px "Hanken Grotesk", system-ui, sans-serif'; const tw = x.measureText(t).width + 24; x.fillRect(Math.max(cut + 8, W - tw - 8), 8, tw, 26); x.fillStyle = '#f3ead9'; x.textBaseline = 'middle'; x.fillText(t, Math.max(cut + 8, W - tw - 8) + 12, 21); }
    $('#rg-handle').style.left = (RG.pos * 100) + '%'; $('#rg-handle').setAttribute('aria-valuenow', Math.round(RG.pos * 100));
    box.style.height = H + 'px';
  }

  function stats() {
    const g = RG.geom, v = RG.view, el = $('#rg-stats'); if (!g) return;
    const obs = g.kind.reduce((s, q) => s + (q ? 1 : 0), 0), gaps = g.inside - obs, lat = latOf(g, Math.floor(g.rows / 2)), km2 = cellKm2(lat);
    const tier = DATA().byId[g.id].tier, tnote = { measured: 'Measured from this country’s own data.', blended: 'Partly borrowed calibration, so the after is drawn a little lighter.', borrowed: 'Borrowed calibration. Cells in the after are drawn noticeably lighter: treat the detail with care.' }[tier];
    const tile = (n, l, cls) => `<div class="${cls || ''}"><b>${n}</b><span>${l}</span></div>`;
    const t = trained.grid, err = t && t.metrics[0];
    el.innerHTML = tile(Math.round(100 * obs / Math.max(1, g.inside)) + '%', `of ${poss(name(g.id))} ${g.inside.toLocaleString('en-US')} cells have a satellite value`)
      + (v ? tile('100%', `have a value after the model (${v.stats.filled.toLocaleString('en-US')} gaps filled)`, 'after') : tile('?', 'after the model: train to see', 'after'))
      + (v ? tile(v.stats.smoothed.toLocaleString('en-US'), 'noisy cells pulled toward their neighbours', 'after') : '')
      + (err ? tile(err.v.toFixed(2) + '×', 'typical error on cells hidden from the fit', 'after') : '')
      + tile(`${Math.round(55.66 * Math.cos(lat * Math.PI / 180))} × 55 km`, `one cell here, ${Math.round(km2).toLocaleString('en-US')} km². Cells shrink toward the poles, so try “per 1,000 km²”`)
      + tile(`≈ ${(Math.round(g.inside * km2 / 1000) * 1000).toLocaleString('en-US')} km²`, 'the country as these cells see it');
    $('#rg-note').innerHTML = `<b>${esc(tnote)}</b> ` + (v
      ? `Hatched cells are gaps: the published grid leaves out a cell whose busiest month averages under four detections, so a filled gap is never drawn above that floor. A white tick marks a noisy cell that was blended halfway toward its neighbours (${v.stats.k} nearest, distance power ${v.stats.pw}, both chosen on held-out cells). Lighter cells are less certain: far from any observed cell, rough neighbourhood, or borrowed calibration.`
      : 'Left of the handle is the grid exactly as the satellites published it, with its gaps. Train the world-grid model to see the after.');
  }

  /* pick a country, a month and a unit */
  const sel = $('#rg-country'), msel = $('#rg-month');
  function ready() {
    const D = DATA(); if (!D || !D.meta) return setTimeout(ready, 150);
    sel.innerHTML = D.meta.countries.slice().sort((a, b) => a.name.localeCompare(b.name)).map((c) => `<option value="${esc(c.id)}">${esc(c.name)}</option>`).join('');
    msel.innerHTML = '<option value="0">Busiest month</option>' + MONF.map((m, i) => `<option value="${i + 1}">${m}</option>`).join('');
    sel.value = D.byId[RG.id] ? RG.id : D.meta.countries[0].id; RG.id = sel.value; D.ready.then(() => setRegion(RG.id));
  }
  sel.addEventListener('change', () => setRegion(sel.value));
  msel.addEventListener('change', () => { RG.month = +msel.value; draw(); });
  $('#rg-unit').addEventListener('click', (e) => { const b = e.target.closest('button[data-u]'); if (!b) return; RG.unit = b.dataset.u; $$('#rg-unit button').forEach((x) => x.classList.toggle('on', x === b)); draw(); });
  $('#rg-train').addEventListener('click', () => { const li = $('#ds-list li[data-task="grid"]'); if (li) { li.scrollIntoView({ behavior: 'smooth', block: 'center' }); $('.train', li).click(); } });
  /* drag the handle (or press the arrow keys) to wipe between before and after */
  let dragging = false;
  const setPos = (clientX) => { const r = box.getBoundingClientRect(); RG.pos = Math.max(0.03, Math.min(0.97, (clientX - r.left) / r.width)); drawSoon(); };
  box.addEventListener('pointerdown', (e) => { dragging = true; box.setPointerCapture(e.pointerId); setPos(e.clientX); tip.hidden = true; });
  box.addEventListener('pointermove', (e) => {
    if (dragging) { setPos(e.clientX); return; }
    const g = RG.geom; if (!g) return; const r = box.getBoundingClientRect(), W = r.width, cs = Math.max(1.4, Math.min(W / g.cols, 340 / g.rows, 18)), ox = (W - g.cols * cs) / 2;
    const q = Math.floor((e.clientX - r.left - ox) / cs), rr = Math.floor((e.clientY - r.top) / cs), i = rr * g.cols + q;
    if (q < 0 || q >= g.cols || rr < 0 || rr >= g.rows || !g.mask[i]) { tip.hidden = true; return; }
    const k = monthIdx(), lat = latOf(g, rr), km2 = cellKm2(lat), before = (e.clientX - r.left) < W * RG.pos, v = RG.view;
    let raw, status;
    if (before || !v) { raw = g.kind[i] ? g.obs[i * 12 + k] : NaN; status = g.kind[i] ? 'satellite value' : 'no value in the published grid'; }
    else { raw = Math.expm1(v.after[i * 12 + k]); status = ['', 'satellite value', 'noisy cell, blended with neighbours', 'gap, filled (never above the floor)'][v.kind[i]]; }
    const num = raw === raw ? `about ${Math.round(RG.unit === 'area' ? raw / km2 * 1000 : raw).toLocaleString('en-US')} detections a month${RG.unit === 'area' ? ' per 1,000 km²' : ''}` : 'under 4 a month, or no data';
    tip.innerHTML = `${num}<small>${status} · ${Math.round(km2).toLocaleString('en-US')} km² cell${!before && v && v.unc[i] > 0.5 ? ' · uncertain' : ''}</small>`;
    tip.style.left = Math.min(W - 140, Math.max(0, e.clientX - r.left + 12)) + 'px'; tip.style.top = (e.clientY - r.top + 14) + 'px'; tip.hidden = false;
  });
  box.addEventListener('pointerup', () => { dragging = false; }); box.addEventListener('pointercancel', () => { dragging = false; });
  box.addEventListener('pointerleave', () => { tip.hidden = true; });
  $('#rg-handle').addEventListener('keydown', (e) => { if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') { RG.pos = Math.max(0.03, Math.min(0.97, RG.pos + (e.key === 'ArrowRight' ? 0.04 : -0.04))); drawSoon(); e.preventDefault(); } });
  addEventListener('resize', drawSoon);
  ready();

  /* ---------- the country sheet's own Train button ---------- */
  window.TRAIN = {
    async forecastInto(el, id, btn) {
      btn.disabled = true; btn.textContent = 'Training…'; el.innerHTML = '<div class="ds-prog"><i></i><span>Starting…</span></div>';
      const bar = $('.ds-prog', el);
      try {
        if (!trained.forecast) trained.forecast = (await call({ cmd: 'train', task: 'forecast', url: 'data/examples/forecast_features.csv' }, (m) => { $('i', bar).style.width = m.pct + '%'; $('span', bar).textContent = m.label || 'Training'; })).result;
        const rows = (await call({ cmd: 'view', task: 'forecast', country: id })).view, r = trained.forecast, me = r.metrics[0], bs = r.metrics.slice(1);
        el.innerHTML = tsChart(rows, name(id) + ' · next-month forecast') + `<p class="ds-fact">A model trained on all ${DATA().meta.countries.length} countries (never tuned on ${esc(name(id))}'s test years) is off by <b>${me.v.toFixed(2)}</b> on the 2023 to 2025 months, against ${bs.map((b) => `${b.v.toFixed(2)} for “${esc(b.label.toLowerCase())}”`).join(' and ')}. Lower is better, log scale.</p>`;
        btn.textContent = 'Train again';
      } catch (e) { el.innerHTML = `<p class="ds-verdict warn">Training did not finish: ${esc(e.message)}</p>`; btn.textContent = 'Try again'; }
      btn.disabled = false;
    },
    available: canTrain
  };
})();
