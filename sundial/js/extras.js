/* SUNDIAL extras: continuity past Suomi NPP, the MODIS harmonizer and the this-week check.
   Everything here runs in the browser on files the visitor chooses. Nothing is uploaded. */
(function () {
  'use strict';
  const $ = (s, r = document) => r.querySelector(s);
  const D3 = window.d3, S = window.SUN, FIRMS = window.FIRMS, HARM = window.HARM, CONT = window.CONT;
  const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const nf = (n) => Math.round(n).toLocaleString('en-US');
  const pct = (x, d) => (x > 0 ? '+' : x < 0 ? '−' : '') + Math.abs(x).toFixed(d == null ? 0 : d) + '%';
  const med = (a) => { if (!a.length) return null; const s = a.slice().sort((x, y) => x - y), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
  const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const yf = (ym) => Math.floor(ym / 100) + (ym % 100 - 0.5) / 12;
  const SNPP_END = 2026 + 306 / 365;   // 2 November 2026, as stated in the "Why now" section
  let DATA = null;

  function fillSelect(sel, keepFirst) {
    const first = keepFirst ? sel.options[0].outerHTML : '';
    sel.innerHTML = first + DATA.meta.countries.slice().sort((a, b) => a.name.localeCompare(b.name)).map((c) => `<option value="${c.id}">${esc(c.name)}</option>`).join('');
  }

  /* ============ 07 continuity ============ */
  function initContinuity() {
    const C = DATA.cont, sec = $('#continuity'); if (!sec) return;
    if (!C) { sec.remove(); return; }
    const rows = Object.entries(C.rows), cs = rows.map(([, r]) => r.c), ho = rows.map(([, r]) => r.ho).filter((x) => x != null);
    const mc = med(cs), mho = med(ho), under5 = Math.round(100 * ho.filter((x) => x < 5).length / ho.length), n = rows.length, N = DATA.meta.countries.length;
    const yrs = Object.entries(C.pooledByYear).map(([y, v]) => [+y, v]), lo = Math.min(...yrs.map((p) => p[1])), hi = Math.max(...yrs.map((p) => p[1]));
    $('#ct-title').textContent = `When Suomi NPP stops, NOAA-20 can carry the record, to within about ${Math.round(mho)}%.`;
    $('#ct-lede').textContent = `Suomi NPP stopped on 2 November 2026, and every month since 2012 in the record comes from it. NOAA-20 carries the same VIIRS camera about 50 minutes ahead of it, and the two flew together for 93 months. We fitted one conversion factor per country on 2018 to 2022, then asked how well it predicts Suomi NPP's yearly totals for 2023 to 2025, years it never saw.`;
    const tl = $('#ct-timeline'), W = Math.max(300, tl.clientWidth || 640), ml = W < 480 ? 62 : 84, mr = 10, H = 196;
    const x = D3.scaleLinear().domain([2000, 2027.8]).range([ml, W - mr]);
    const svg = D3.select(tl).html('').append('svg').attr('viewBox', `0 0 ${W} ${H}`).attr('class', 'ctl').attr('role', 'img');
    svg.append('g').selectAll('line').data([2000, 2005, 2010, 2015, 2020, 2025]).join('line').attr('class', 'gl').attr('x1', (d) => x(d)).attr('x2', (d) => x(d)).attr('y1', 6).attr('y2', H - 22);
    svg.append('g').selectAll('text').data([2000, 2005, 2010, 2015, 2020, 2025]).join('text').attr('class', 'ax').attr('x', (d) => x(d)).attr('y', H - 8).attr('text-anchor', 'middle').text((d) => d);
    const bars = [
      ['Terra', 2000.85, 2026.0, 2027.0, 'terra'], ['Aqua', 2002.5, 2026.0, 2027.0, 'aqua'], ['Suomi NPP', 2012.0, 2026.0, SNPP_END, 'viirs'],
      ['NOAA-20', 2018.25, 2026.0, 2027.8, 'viirs'], ['NOAA-21', 2022.85, 2022.85, 2027.8, 'dim']
    ];
    bars.forEach(([name, a, solidEnd, end, cls], i) => {
      const y = 12 + i * 21;
      svg.append('text').attr('class', 'nm').attr('x', ml - 8).attr('y', y + 11).attr('text-anchor', 'end').text(name);
      svg.append('rect').attr('class', 'soon ' + cls).attr('x', x(a)).attr('y', y).attr('width', Math.max(0, x(end) - x(a))).attr('height', 14).attr('rx', 5);
      if (solidEnd > a) svg.append('rect').attr('class', 'bar ' + cls).attr('x', x(a)).attr('y', y).attr('width', x(solidEnd) - x(a)).attr('height', 14).attr('rx', 5);
    });
    svg.append('text').attr('class', 'note').attr('x', x(2022.85) - 6).attr('y', 12 + 4 * 21 + 11).attr('text-anchor', 'end').text(W < 480 ? 'not in the record' : 'launched Nov 2022 · not in the record');
    const ry = 12 + 5 * 21 + 8;
    svg.append('text').attr('class', 'nm strong').attr('x', ml - 8).attr('y', ry + 12).attr('text-anchor', 'end').text('The record');
    [['MODIS (Terra + Aqua)', 2000.85, 2012.0, 'terra'], ['Suomi NPP', 2012.0, SNPP_END, 'viirs'], ['NOAA-20 × c', SNPP_END, 2027.8, 'next']].forEach(([t, a, b, cls]) => {
      svg.append('rect').attr('class', 'src ' + cls).attr('x', x(a)).attr('y', ry).attr('width', x(b) - x(a) - 1).attr('height', 17).attr('rx', 5);
      if (x(b) - x(a) > 54) svg.append('text').attr('class', 'srct').attr('x', (x(a) + x(b)) / 2).attr('y', ry + 12).attr('text-anchor', 'middle').text(t);
    });
    svg.append('line').attr('class', 'end').attr('x1', x(SNPP_END)).attr('x2', x(SNPP_END)).attr('y1', 4).attr('y2', ry + 21);
    $('#ct-stats').innerHTML = `<div><div class="n">${mc.toFixed(2)}</div><div class="l">median ratio Suomi NPP ÷ NOAA-20 across ${n} countries (1.00 = identical)</div></div><div><div class="n">${mho.toFixed(1)}%</div><div class="l">median error on years held out of the fit (2023 to 2025)</div></div><div><div class="n">${under5}%</div><div class="l">of countries within 5% on those years</div></div>`;
    const sel = $('#ct-country'); fillSelect(sel, false);
    const show = () => {
      const id = sel.value, r = C.rows[id], name = DATA.byId[id].name;
      if (!r) { $('#ct-read').innerHTML = `<b>${esc(name)}</b>: not enough overlap to calibrate (needs 24 months with at least ${C.minMonth} detections on both satellites). Use the median factor ${mc.toFixed(2)} with care.`; return; }
      const yr = r.yr.map(([y, c]) => `${y}: ${c.toFixed(2)}`).join(' · ');
      $('#ct-read').innerHTML = `<b>${esc(name)}</b>: NOAA-20 × <b>${r.c.toFixed(3)}</b> = Suomi NPP equivalent. Held-out yearly error ${r.ho == null ? 'n/a' : r.ho.toFixed(1) + '%'}, month-to-month spread of the ratio ${r.sp == null ? 'n/a' : r.sp.toFixed(1) + '%'}, from ${r.n} overlap months.<br><span class="yrs">By year: ${yr}</span>`;
    };
    sel.value = C.rows.Brazil ? 'Brazil' : rows[0][0]; sel.addEventListener('change', show); show();
    $('#ct-note').textContent = `The factor for the world as a whole wobbles from ${lo.toFixed(2)} to ${hi.toFixed(2)} between years, so expect a few percent of extra uncertainty in any single year. ${N - n} small countries lack enough overlap and would borrow the median. NOAA-21 is not in the record yet, so it would need the same cross-calibration before it takes over from NOAA-20. Terra and Aqua are expected to end around late 2026 or early 2027.`;
  }

  /* ============ shared: country detection from sample points ============ */
  function detectCountry(samples) {
    if (!samples || !samples.length) return null;
    const votes = {};
    samples.slice(0, 400).forEach((p) => {
      for (const id in DATA.fbox) { const b = DATA.fbox[id]; if (p[0] < b[0] || p[0] > b[2] || p[1] < b[1] || p[1] > b[3]) continue; if (D3.geoContains(DATA.features[id], p)) { votes[id] = (votes[id] || 0) + 1; break; } }
    });
    const top = Object.entries(votes).sort((a, b) => b[1] - a[1])[0];
    return top && top[1] >= samples.slice(0, 400).length * 0.4 ? top[0] : null;
  }
  const insideOf = (id) => { const f = DATA.features[id], b = DATA.fbox[id]; return (lon, lat) => lon >= b[0] && lon <= b[2] && lat >= b[1] && lat <= b[3] && D3.geoContains(f, [lon, lat]); };
  function wire(dropId, fileId, run) {
    const drop = $(dropId), inp = $(fileId);
    inp.addEventListener('change', () => { if (inp.files[0]) run(inp.files[0]); });
    ['dragenter', 'dragover'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add('over'); }));
    ['dragleave', 'drop'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.remove('over'); }));
    drop.addEventListener('drop', (e) => { const f = e.dataTransfer && e.dataTransfer.files[0]; if (f) run(f); });
  }
  const say = (id, t, bad) => { const el = $(id); el.textContent = t; el.classList.toggle('bad', !!bad); };

  /* ============ 08a harmonizer ============ */
  function initHarmonizer() {
    fillSelect($('#hz-country'), true);
    wire('#hz-drop', '#hz-file', runHarmonize);
  }
  let hzLast = null;
  async function runHarmonize(file) {
    const out = $('#hz-out'); out.hidden = true; say('#hz-prog', `Reading ${file.name}…`);
    try {
      let cid = $('#hz-country').value, opts = { dropLow: $('#hz-low').checked };
      if (cid) opts.inside = DATA.inBox(cid);   // a box that survives the antimeridian (Russia, Fiji, NZ, US)
      const st = await FIRMS.parseFile(file, opts, (p) => say('#hz-prog', `Reading ${file.name}… ${Math.round(p * 100)}%`));
      if (st.error) return say('#hz-prog', st.error, true);
      if (!st.kept && st.outside) return say('#hz-prog', `None of the ${nf(st.outside)} detections in this file fall inside ${DATA.byId[cid].name}. Pick the right country, or leave it on "Detect from the file".`, true);
      if (!cid) { cid = detectCountry(st.samples); if (!cid) return say('#hz-prog', 'Could not tell which country this file covers. Pick one above and drop the file again.', true); $('#hz-country').value = cid; }
      const rows = FIRMS.toRows(st.monthly), months = Object.keys(rows).map(Number).sort((a, b) => a - b);
      if (!months.length) return say('#hz-prog', st.sats.snpp || st.sats.n20 || st.sats.n21 ? 'This looks like a VIIRS file. This tool converts MODIS (Terra and Aqua); use the weekly check below for VIIRS.' : 'No Terra or Aqua detections found in this file.', true);
      const s = await DATA.loadSeries(cid), sc = DATA.score[cid] || {}, b = sc.b_adj, ck = DATA.hcheck && DATA.hcheck[cid];
      const run = HARM.run(s, b, rows, {});
      hzLast = { cid, s, rows, run, months, st };
      say('#hz-prog', `Read ${nf(st.rows)} rows, kept ${nf(st.kept)}.`);
      drawHarmonized(out, cid, s, rows, run, st, b, ck);
    } catch (e) { console.error(e); say('#hz-prog', 'Something went wrong reading that file: ' + e.message, true); }
  }
  function drawHarmonized(out, cid, s, rows, run, st, b, ck) {
    const name = DATA.byId[cid].name, idx = new Map(s.months.map((m, i) => [m, i])), months = Object.keys(run.est).map(Number).sort((a, c) => a - c);
    // 1. do the user's raw counts match the published raw counts? (same filters, same coverage)
    const rt = [], ra = [];
    months.forEach((m) => { const i = idx.get(m); if (i == null) return; if (s.T[i] >= 20 && rows[m].T.n >= 0) rt.push(rows[m].T.n / s.T[i]); if (s.A[i] >= 20 && rows[m].A.n >= 0) ra.push(rows[m].A.n / s.A[i]); });
    const mt = med(rt), ma = med(ra), match = mt != null && ma != null ? (Math.abs(mt - 1) < 0.1 && Math.abs(ma - 1) < 0.1 ? 'ok' : 'off') : 'none';
    // 2. how close is the result to the published record?
    const gap = [], yearly = {};
    months.forEach((m) => { const i = idx.get(m); if (i == null || !(s.harm[i] >= 100)) return; gap.push(Math.abs(run.est[m] / s.harm[i] - 1) * 100); const y = Math.floor(m / 100); (yearly[y] = yearly[y] || { e: 0, h: 0, n: 0 }); yearly[y].e += run.est[m]; yearly[y].h += s.harm[i]; yearly[y].n++; });
    const yg = Object.values(yearly).filter((q) => q.n === 12).map((q) => Math.abs(q.e / q.h - 1) * 100);
    const k = (arr) => arr.map((v) => v.toFixed(1)).join(' / ');
    const matchMsg = match === 'ok' ? `Your counts match SUNDIAL's own raw counts (Terra ×${mt.toFixed(2)}, Aqua ×${ma.toFixed(2)}), so the filters agree.`
      : match === 'off' ? `<b>Your counts differ from SUNDIAL's raw counts</b> (Terra ×${mt.toFixed(2)}, Aqua ×${ma.toFixed(2)} of ours). Different confidence filter or only part of the country? The conversion factors assume SUNDIAL's own filters, so treat the result as rough.`
        : 'There are too few months in common with the published record to compare raw counts.';
    out.innerHTML = `<div class="stats"><div><div class="n">${months.length}</div><div class="l">months converted, ${ymL(months[0])} to ${ymL(months[months.length - 1])}</div></div>
      <div><div class="n">${yg.length ? med(yg).toFixed(1) + '%' : gap.length ? med(gap).toFixed(0) + '%' : 'n/a'}</div><div class="l">${yg.length ? 'median yearly gap to the published record' : 'median monthly gap to the published record (no full year)'}</div></div>
      <div><div class="n">${ck && ck.drift != null ? ck.drift.toFixed(1) + '%' : 'n/a'}</div><div class="l">typical error of this converter in ${esc(name)} on years it never saw (2021 to 2025)</div></div></div>
      <p class="${match === 'off' ? 'warn' : ''}">${matchMsg}</p>
      <div class="chart" id="hz-chart"></div>
      <div class="keys"><span><i style="background:#1c1510"></i>SUNDIAL record</span><span><i style="background:#d9480f"></i>Your file, converted</span></div>
      <p>Seasonal factors for Terra (Dec-Feb / Mar-May / Jun-Aug / Sep-Nov): ${k(run.kT.k)}. For Aqua: ${k(run.kA.k)}. ${b == null ? 'No swath slope exists for this country, so Terra was not corrected for its clock slide.' : `Terra's clock slide is undone with slope ${b.toFixed(2)} per hour, on daytime detections only.`}</p>
      <div class="dl"><button type="button" class="btn" id="hz-dl">Download the monthly table (CSV)</button></div>
      <p class="tiny">${gap.length && yg.length ? `The gap to the published record is partly circular: the factors were fitted on 2012 to 2019 from that same record. The honest number is the third one, which fits on 2012 to 2017 only and tests on later years. ` : ''}Monthly totals only: night is not split from day in the factors, and Aqua's smaller slide is not corrected (the two slides mostly cancel). Cell counts that are very small make single months noisy.</p>`;
    out.hidden = false;
    const ser = [{ c: '#1c1510', pts: months.map((m) => [yf(m), s.harm[idx.get(m)]]).filter((p) => p[1] != null) }, { c: '#d9480f', pts: months.map((m) => [yf(m), run.est[m]]) }];
    lines($('#hz-chart'), ser);
    $('#hz-dl').addEventListener('click', downloadHarmonized);
  }
  const ymL = (ym) => `${MON[ym % 100 - 1]} ${Math.floor(ym / 100)}`;
  function downloadHarmonized() {
    const L = hzLast; if (!L) return; const idx = new Map(L.s.months.map((m, i) => [m, i])), r = (x) => (x == null ? '' : Math.round(x * 10) / 10);
    const head = 'month,terra_count,aqua_count,terra_mean_local_hour,aqua_mean_local_hour,harmonized_viirs_equiv,sundial_published_harmonized';
    const lines = Object.keys(L.run.est).map(Number).sort((a, b) => a - b).map((m) => { const t = L.rows[m].T, a = L.rows[m].A, i = idx.get(m); return [`${Math.floor(m / 100)}-${String(m % 100).padStart(2, '0')}`, t.n, a.n, t.h == null ? '' : t.h.toFixed(2), a.h == null ? '' : a.h.toFixed(2), r(L.run.est[m]), i == null ? '' : r(L.s.harm[i])].join(','); });
    const url = URL.createObjectURL(new Blob([[head].concat(lines).join('\n')], { type: 'text/csv' })), a = document.createElement('a');
    a.href = url; a.download = `sundial_${L.cid}_your_modis_harmonized.csv`; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 2000);
  }
  /* a plain multi-line chart on a paper card */
  function lines(el, ser) {
    const W = Math.max(300, el.clientWidth || 640), H = Math.round(Math.max(190, Math.min(250, W * 0.36))), m = { l: 44, r: 10, t: 10, b: 22 };
    const all = ser.flatMap((q) => q.pts), x = D3.scaleLinear().domain(D3.extent(all, (p) => p[0])).range([m.l, W - m.r]), y = D3.scaleLinear().domain([0, D3.max(all, (p) => p[1]) * 1.05 || 1]).range([H - m.b, m.t]).nice();
    const svg = D3.select(el).html('').append('svg').attr('viewBox', `0 0 ${W} ${H}`).attr('class', 'xc').attr('role', 'img').attr('aria-label', 'Monthly fire counts: SUNDIAL record against your converted file');
    svg.append('g').selectAll('line').data(y.ticks(4)).join('line').attr('class', 'gl').attr('x1', m.l).attr('x2', W - m.r).attr('y1', (d) => y(d)).attr('y2', (d) => y(d));
    svg.append('g').selectAll('text').data(y.ticks(4)).join('text').attr('class', 'ax').attr('x', m.l - 6).attr('y', (d) => y(d) + 3).attr('text-anchor', 'end').text((d) => D3.format('~s')(d));
    const xt = x.ticks(W < 480 ? 4 : 6).filter((d) => Number.isInteger(d)); svg.append('g').selectAll('text').data(xt).join('text').attr('class', 'ax').attr('x', (d) => x(d)).attr('y', H - 6).attr('text-anchor', 'middle').text((d) => d);
    ser.forEach((q) => svg.append('path').attr('fill', 'none').attr('stroke', q.c).attr('stroke-width', 1.7).attr('stroke-linejoin', 'round').attr('d', D3.line().x((p) => x(p[0])).y((p) => y(p[1]))(q.pts)));
  }

  /* ============ 08b this week against the fair normal ============ */
  function initWeek() {
    fillSelect($('#wk-country'), true);
    wire('#wk-drop', '#wk-file', (f) => runWeek({ file: f }));
    $('#wk-go').addEventListener('click', fetchWeek);
  }
  const daysIn = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate();
  /* expected fires per day on a given calendar date in year y, smoothly interpolated between mid-month values
     (so a week at the start of a steep season is not compared with the whole month's average) */
  function ratePerDay(s, idx, y, mo, dom) {
    const rate = (yy, mm) => { while (mm < 1) { mm += 12; yy--; } while (mm > 12) { mm -= 12; yy++; } const i = idx.get(yy * 100 + mm); return i == null ? null : s.harm[i] / daysIn(yy, mm); };
    const here = rate(y, mo); if (here == null) return null;
    const mid = (daysIn(y, mo) + 1) / 2, other = dom >= mid ? rate(y, mo + 1) : rate(y, mo - 1);
    if (other == null) return here;
    const t = Math.abs(dom - mid) / daysIn(y, mo); return here * (1 - t) + other * t;
  }
  async function fetchWeek() {
    const cid = $('#wk-country').value, key = $('#wk-key').value.trim();
    if (!cid) return say('#wk-prog', 'Pick a country first (the fetch asks FIRMS for that country’s bounding box).', true);
    if (!key) return say('#wk-prog', 'Enter your FIRMS MAP_KEY first.', true);
    const areas = DATA.areas(cid).map((b) => b.map((v) => v.toFixed(3)).join(',')), texts = [];   // two boxes for countries that straddle 180°; the plain bbox of Russia is the whole northern hemisphere
    say('#wk-prog', 'Asking FIRMS for the last 7 days…');
    try {
      for (const src of ['VIIRS_NOAA20_NRT', 'VIIRS_NOAA21_NRT', 'VIIRS_SNPP_NRT']) for (const area of areas) {
        const r = await fetch(`https://firms.modaps.eosdis.nasa.gov/api/area/csv/${encodeURIComponent(key)}/${src}/${area}/7`);
        if (!r.ok) continue; const t = await r.text(); if (/^latitude,/i.test(t)) texts.push(t);
      }
    } catch (e) { return say('#wk-prog', 'The browser blocked the request (FIRMS may not allow calls from web pages). Download the country CSV from FIRMS and drop it above instead.', true); }
    if (!texts.length) return say('#wk-prog', 'FIRMS returned no data. Check the MAP_KEY, or download the CSV from FIRMS and drop it above.', true);
    runWeek({ text: texts.join('\n'), clip: cid });
  }
  async function runWeek(src) {
    const out = $('#wk-out'); out.hidden = true;
    try {
      let cid = $('#wk-country').value; const opts = {};
      if (src.clip) { cid = src.clip; opts.inside = insideOf(cid); } else if (cid) opts.inside = DATA.inBox(cid);
      let st;
      if (src.file) { say('#wk-prog', `Reading ${src.file.name}…`); st = await FIRMS.parseFile(src.file, opts, (p) => say('#wk-prog', `Reading ${src.file.name}… ${Math.round(p * 100)}%`)); }
      else { const p = FIRMS.create(opts); p.push(src.text); st = p.end(); }
      if (st.error) return say('#wk-prog', st.error, true);
      if (!st.kept && st.outside) return say('#wk-prog', `None of the ${nf(st.outside)} detections in this file fall inside ${DATA.byId[cid].name}. Pick the right country, or leave it on "Detect from the file".`, true);
      if (!cid) { cid = detectCountry(st.samples); if (!cid) return say('#wk-prog', 'Could not tell which country this file covers. Pick one above and drop the file again.', true); $('#wk-country').value = cid; }
      const use = ['snpp', 'n20'].concat($('#wk-21').checked ? ['n21'] : []).filter((k) => st.sats[k] > 0);
      if (!use.length) return say('#wk-prog', st.sats.terra || st.sats.aqua ? 'This is a MODIS file. The weekly check needs VIIRS (NOAA-20, NOAA-21 or Suomi NPP); MODIS counts are a different scale.' : st.sats.n21 ? 'Only NOAA-21 detections found. Tick the NOAA-21 box to include them (they are not calibrated).' : 'No VIIRS detections found in this file.', true);
      say('#wk-prog', `Read ${nf(st.rows)} rows, kept ${nf(st.kept)}.`);
      const s = await DATA.loadSeries(cid); weekResult(out, cid, s, st, use);
    } catch (e) { console.error(e); say('#wk-prog', 'Something went wrong: ' + e.message, true); }
  }
  function weekResult(out, cid, s, st, use) {
    const name = DATA.byId[cid].name, C = DATA.cont, cr = C && C.rows[cid], pooled = C ? med(Object.values(C.rows).map((r) => r.c)) : 1;
    const cN = cr ? cr.c : pooled, factor = { snpp: 1, n20: cN, n21: cN };
    // days in the window: every date from the first to the last in the file (a day with no detections still counts)
    const d0 = new Date(st.minDate + 'T00:00:00Z'), d1 = new Date(st.maxDate + 'T00:00:00Z'), W = Math.round((d1 - d0) / 864e5) + 1;
    if (W < 1 || W > 31) return say('#wk-prog', `That file spans ${W} days. The check is meant for about a week (1 to 31 days).`, true);
    const idx = new Map(s.months.map((m, i) => [m, i])), dates = []; for (let t = 0; t < W; t++) dates.push(new Date(d0.getTime() + t * 864e5));
    // this window in the record's units: Suomi NPP counts as is, NOAA-20 times its factor. With several satellites, average them (they see the same fires).
    let total = 0; const per = {}; use.forEach((k) => { per[k] = 0; });
    // average over the satellites that were reporting that day, not all of them: when Suomi NPP stops mid-window, the days after it are NOAA-20 alone and must not be halved
    dates.forEach((d) => { const key = d.toISOString().slice(0, 10), row = st.daily[key] || {}; let v = 0, act = 0; use.forEach((k) => { const r = st.satRange[k]; if (r && key >= r[0] && key <= r[1]) act++; const x = (row[k] || 0) * factor[k]; per[k] += row[k] || 0; v += x; }); total += v / Math.max(1, act); });
    const lastY = Math.max(...s.months.map((m) => Math.floor(m / 100))), expected = [], y0 = dates[0].getUTCFullYear();
    for (let y = 2001; y <= 2025; y++) {
      let e = 0, ok = true;
      /* a 28 Dec to 3 Jan window compares its January days with the NEXT year's January */
      dates.forEach((d) => { const mo = d.getUTCMonth() + 1; let dom = d.getUTCDate(); if (mo === 2 && dom === 29) dom = 28; const r = ratePerDay(s, idx, y + (d.getUTCFullYear() - y0), mo, dom); if (r == null) ok = false; else e += r; });
      if (ok) expected.push({ y, v: e });
    }
    if (expected.length < 10) return say('#wk-prog', 'Not enough history for these dates in this country.', true);
    const vals = expected.map((q) => q.v), m = med(vals), ratio = m > 0 ? total / m : null, below = vals.filter((v) => v < total).length;
    const hi = total >= m, ref = expected.slice().reverse().find((q) => (hi ? q.v >= total : q.v <= total));
    const range = `${dates[0].getUTCDate()} ${MON[dates[0].getUTCMonth()]} to ${dates[W - 1].getUTCDate()} ${MON[dates[W - 1].getUTCMonth()]} ${dates[W - 1].getUTCFullYear()}`;
    const rel = ratio == null ? '' : ratio >= 1.15 ? `${ratio.toFixed(1)}× the typical level` : ratio <= 0.87 ? `only ${Math.round(ratio * 100)}% of the typical level` : 'close to the typical level';
    const since = ratio == null ? '' : below === vals.length ? `Higher than any of the ${vals.length} years, 2001 to 2025.` : below === 0 ? `Lower than any of the ${vals.length} years, 2001 to 2025.` : `${hi ? 'Higher' : 'Lower'} than ${hi ? below : vals.length - below} of ${vals.length} years${ref ? (hi ? `; the last year with more was ${ref.y}.` : `; the last year with less was ${ref.y}.`) : '.'}`;
    const sources = use.map((k) => `${{ snpp: 'Suomi NPP', n20: 'NOAA-20', n21: 'NOAA-21' }[k]} ${nf(per[k])} detections${k === 'snpp' ? '' : ` × ${cN.toFixed(3)}`}`).join(', ');
    out.innerHTML = `<div class="verdict"><div class="big">${nf(total)}</div><div class="vt"><b>${esc(name)}: fire detections, ${range}</b><br>in the record's units (VIIRS-equivalent) · ${rel} for these dates</div></div>
      <p>${since}</p><div class="chart" id="wk-chart"></div>
      <div class="keys"><span><i style="background:#8a7a68"></i>same dates in each past year (from the harmonized record)</span><span><i style="background:#d9480f"></i>this window</span></div>
      <p class="tiny">Counted: ${esc(sources)}${use.length > 1 ? '; with several satellites the converted counts are averaged, because they see the same fires.' : '.'} ${cr ? `The NOAA-20 factor comes from this country's own overlap with Suomi NPP (held-out error ${cr.ho == null ? 'n/a' : cr.ho.toFixed(1) + '%'}).` : 'This country has too little overlap for its own factor, so the world median was used.'}${use.includes('n21') ? ' NOAA-21 is assumed to match NOAA-20, which has not been checked.' : ''} Past years are interpolated between monthly totals, so a week inside a steep season is approximate. Counts assume the same confidence filter as the published record; if yours differs, expect a shift of some percent. Latest year in the record: ${lastY}.</p>`;
    out.hidden = false;
    // bars: expected per year + this window
    const el = $('#wk-chart'), Wd = Math.max(300, el.clientWidth || 640), H = 190, mg = { l: 44, r: 10, t: 12, b: 22 };
    const data = expected.map((q) => ({ y: q.y, v: q.v })).concat([{ y: 'now', v: total, now: true }]);   // keyed 'now', not a year: a window in 2025 would otherwise collide with the 2025 bar
    const x = D3.scaleBand().domain(data.map((q) => q.y)).range([mg.l, Wd - mg.r]).padding(0.18), y = D3.scaleLinear().domain([0, D3.max(data, (q) => q.v) * 1.08 || 1]).range([H - mg.b, mg.t]).nice();
    const svg = D3.select(el).html('').append('svg').attr('viewBox', `0 0 ${Wd} ${H}`).attr('class', 'xc').attr('role', 'img').attr('aria-label', `Fire detections for the same dates in each year, with this window highlighted`);
    svg.append('g').selectAll('line').data(y.ticks(4)).join('line').attr('class', 'gl').attr('x1', mg.l).attr('x2', Wd - mg.r).attr('y1', (d) => y(d)).attr('y2', (d) => y(d));
    svg.append('g').selectAll('text').data(y.ticks(4)).join('text').attr('class', 'ax').attr('x', mg.l - 6).attr('y', (d) => y(d) + 3).attr('text-anchor', 'end').text((d) => D3.format('~s')(d));
    svg.append('g').selectAll('text').data(data.filter((q) => q.y % 5 === 0 || q.now)).join('text').attr('class', 'ax').attr('x', (q) => x(q.y) + x.bandwidth() / 2).attr('y', H - 6).attr('text-anchor', 'middle').text((q) => (q.now ? 'now' : q.y));
    svg.append('g').selectAll('rect').data(data).join('rect').attr('x', (q) => x(q.y)).attr('width', x.bandwidth()).attr('y', (q) => y(q.v)).attr('height', (q) => y(0) - y(q.v)).attr('rx', 2).attr('fill', (q) => (q.now ? '#d9480f' : '#8a7a68')).append('title').text((q) => `${q.now ? 'This window' : q.y}: ${nf(q.v)}`);
    svg.append('line').attr('class', 'medl').attr('x1', mg.l).attr('x2', Wd - mg.r).attr('y1', y(m)).attr('y2', y(m));
    svg.append('text').attr('class', 'ax').attr('x', Wd - mg.r).attr('y', y(m) - 4).attr('text-anchor', 'end').text('typical');
  }

  window.EXTRAS = { init(data) { DATA = data; initContinuity(); initHarmonizer(); initWeek(); } };
})();
