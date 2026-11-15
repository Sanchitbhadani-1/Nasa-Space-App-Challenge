/* SUNDIAL firms: reads a NASA FIRMS fire-detection CSV in the browser (nothing is uploaded anywhere).

   Works on the files FIRMS hands out: MODIS archive/NRT (satellite = Terra / Aqua) and VIIRS archive/NRT
   (satellite = N for Suomi NPP, N20 for NOAA-20, N21 for NOAA-21). Columns are found by name, so column order and
   extra columns do not matter. It streams the file in chunks and only keeps counts, so large country files are fine.

   For every detection it keeps: month, date, satellite, count, and for daytime detections the local SOLAR hour
   (UTC time + longitude / 15), which is what the drift correction needs.

   Same filters as your pipeline? FIRMS counts depend on the confidence filter. `dropLow` removes low-confidence
   detections (MODIS < 30, VIIRS 'l'). The harmonizer compares your counts with the published ones so a mismatch shows. */
(function (root) {
  const SAT = { terra: 'terra', t: 'terra', aqua: 'aqua', a: 'aqua', n: 'snpp', npp: 'snpp', snpp: 'snpp', 'suomi-npp': 'snpp', 'suomi npp': 'snpp', n20: 'n20', 'noaa-20': 'n20', noaa20: 'n20', n21: 'n21', 'noaa-21': 'n21', noaa21: 'n21' };
  const NEED = ['latitude', 'longitude', 'acq_date', 'satellite'];

  function create(opts) {
    opts = opts || {};
    const st = { monthly: {}, daily: {}, rows: 0, kept: 0, outside: 0, lowConf: 0, unknown: {}, minDate: null, maxDate: null, samples: [], error: null, sats: {} };
    let head = null, tail = '', idx = null;

    function setHeader(line) {
      const cols = line.replace(/\r$/, '').split(',').map((c) => c.trim().toLowerCase().replace(/^"|"$/g, ''));
      const ix = {}; cols.forEach((c, i) => { ix[c] = i; });
      const miss = NEED.filter((n) => ix[n] == null);
      if (miss.length) { st.error = 'This does not look like a FIRMS CSV: missing column ' + miss.join(', ') + '.'; return false; }
      idx = { lat: ix.latitude, lon: ix.longitude, date: ix.acq_date, time: ix.acq_time, sat: ix.satellite, conf: ix.confidence, dn: ix.daynight };
      head = cols; return true;
    }

    function row(line) {
      const f = line.split(','); st.rows++;
      const lat = +f[idx.lat], lon = +f[idx.lon]; if (!(lat === lat) || !(lon === lon)) return;
      if (st.samples.length < 1500 && (st.rows <= 400 || st.rows % 3 === 0)) st.samples.push([lon, lat]);   // every row of a small file, then every third, for country detection
      if (opts.bbox && (lon < opts.bbox[0] || lon > opts.bbox[2] || lat < opts.bbox[1] || lat > opts.bbox[3])) { st.outside++; return; }
      if (opts.inside && !opts.inside(lon, lat)) { st.outside++; return; }
      const raw = (f[idx.sat] || '').trim().toLowerCase().replace(/^"|"$/g, ''), sat = SAT[raw];
      if (!sat) { st.unknown[raw] = (st.unknown[raw] || 0) + 1; return; }
      if (opts.dropLow && idx.conf != null) { const c = (f[idx.conf] || '').trim().toLowerCase(); if (c === 'l' || c === 'low' || (c !== '' && +c === +c && +c < 30)) { st.lowConf++; return; } }
      const date = (f[idx.date] || '').trim(); if (date.length < 10) return;
      let hh = 12, mm = 0;
      if (idx.time != null) { const t = (f[idx.time] || '').trim().replace(/\D/g, '').padStart(4, '0'); hh = +t.slice(0, 2); mm = +t.slice(2, 4); }
      const local = (((hh + mm / 60 + lon / 15) % 24) + 24) % 24;
      let day = local >= 6 && local < 18;
      if (idx.dn != null) { const d = (f[idx.dn] || '').trim().toUpperCase(); if (d === 'D') day = true; else if (d === 'N') day = false; }
      const ym = +date.slice(0, 4) * 100 + +date.slice(5, 7);
      const m = st.monthly[ym] || (st.monthly[ym] = {}), a = m[sat] || (m[sat] = { n: 0, nd: 0, hs: 0 });
      a.n++; if (day) { a.nd++; a.hs += local; }
      const d = st.daily[date] || (st.daily[date] = {}); d[sat] = (d[sat] || 0) + 1;
      st.sats[sat] = (st.sats[sat] || 0) + 1; st.kept++;
      if (st.minDate === null || date < st.minDate) st.minDate = date; if (st.maxDate === null || date > st.maxDate) st.maxDate = date;
    }

    function consume(text, final) {
      if (st.error) return;
      let s = tail + text, from = 0;
      for (;;) {
        const nl = s.indexOf('\n', from); if (nl < 0) break;
        const line = s.slice(from, nl); from = nl + 1;
        if (!line.trim()) continue;
        if (!head) { if (!setHeader(line)) return; } else row(line);
      }
      tail = s.slice(from);
      if (final && tail.trim()) { const l = tail; tail = ''; if (!head) setHeader(l); else row(l); }
    }
    return { push: (t) => consume(t, false), end: () => { consume('', true); return st; }, state: st };
  }

  /* read a File (or Blob) in chunks; onProgress(0..1) */
  async function parseFile(file, opts, onProgress) {
    const p = create(opts);
    if (file.stream && typeof TextDecoderStream !== 'undefined') {
      const reader = file.stream().pipeThrough(new TextDecoderStream()).getReader(); let seen = 0;
      for (;;) { const { value, done } = await reader.read(); if (done) break; p.push(value); seen += value.length; if (onProgress) onProgress(Math.min(1, seen / (file.size || seen))); if (p.state.error) { reader.cancel(); break; } }
    } else p.push(await file.text());
    return p.end();
  }

  /* monthly rows in the shape harmonize.js wants: { yyyymm: { T: {n, h, day}, A: {...} } } */
  function toRows(monthly) {
    const out = {};
    for (const ym in monthly) {
      const m = monthly[ym], one = (a) => (a ? { n: a.n, h: a.nd > 0 ? a.hs / a.nd : null, day: a.n > 0 ? a.nd / a.n : null } : { n: 0, h: null, day: null });
      if (m.terra || m.aqua) out[ym] = { T: one(m.terra), A: one(m.aqua) };
    }
    return out;
  }

  const API = { create, parseFile, toRows, SAT };
  if (typeof module !== 'undefined' && module.exports) module.exports = API; else root.FIRMS = API;
})(typeof window !== 'undefined' ? window : globalThis);
