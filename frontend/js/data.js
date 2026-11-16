/* SUNDIAL data: loads the static JSON exported from the team's pipeline (see tools/export_static.py). */
(function () {
  const get = (p) => fetch(p).then((r) => { if (!r.ok) throw new Error(p + ' ' + r.status); return r.json(); });
  const D = { series: {}, ready: null };
  D.ready = Promise.all([get('data/meta.json'), get('data/countries.geojson'), get('data/scoreboard.json'), get('data/satellites.json'), get('data/climo.json'), get('data/diurnal.json'), get('data/trends.json').catch(() => null), get('data/continuity.json').catch(() => null), get('data/harmonizer_check.json').catch(() => null), get('data/provenance.json').catch(() => ({}))])
    .then(([meta, geo, sb, sat, climo, diur, trends, cont, hcheck, provenance]) => {
      D.meta = meta; D.geo = geo; D.sat = sat; D.diurnal = diur; D.trends = trends && trends.rows;   // trends, continuity and the harmonizer check are optional: the page works without them
      D.cont = cont; D.hcheck = hcheck && hcheck.rows; D.provenance = provenance || {};
      D.byId = Object.fromEntries(meta.countries.map((c) => [c.id, c]));
      D.score = Object.fromEntries(sb.rows.filter((r) => D.byId[r.country]).map((r) => [r.country, r]));   // only countries that are on the globe
      D.features = Object.fromEntries(geo.features.map((f) => [f.properties.id, f]));
      D.fbox = {};   // bounding box per country, so hover tests can skip shapes that cannot contain the pointer
      for (const id in D.features) {
        let a = 1e9, b = 1e9, c = -1e9, d = -1e9;
        const walk = (x) => { if (typeof x[0] === 'number') { if (x[0] < a) a = x[0]; if (x[0] > c) c = x[0]; if (x[1] < b) b = x[1]; if (x[1] > d) d = x[1]; } else x.forEach(walk); };
        walk(D.features[id].geometry.coordinates); D.fbox[id] = [a, b, c, d];
      }
      /* A box that also works across the antimeridian. Russia, Fiji, New Zealand and the US have points on both sides of 180°, so their plain
         box spans -180..180 and its middle is lon 0. Here longitudes may run past 180 (Russia: 19 to 191). */
      D.wbox = {};
      for (const id in D.features) {
        let s0 = 1e9, s1 = -1e9;
        const walk2 = (x) => { if (typeof x[0] === 'number') { const L = x[0] < 0 ? x[0] + 360 : x[0]; if (L < s0) s0 = L; if (L > s1) s1 = L; } else x.forEach(walk2); };
        walk2(D.features[id].geometry.coordinates);
        const f = D.fbox[id];
        D.wbox[id] = s1 - s0 < f[2] - f[0] - 1 ?[s0, f[1], s1, f[3]] : f.slice();
      }
      /* box of the biggest single landmass: France's full box reaches French Guiana and Réunion (-62 to 56), the US's reaches the Aleutians */
      D.mbox = {};
      for (const id in D.features) {
        const g = D.features[id].geometry, polys = g.type === 'Polygon' ? [g.coordinates] : g.coordinates; let best = null, ba = -1;
        for (const p of polys) {
          let a0 = 1e9, b0 = 1e9, c0 = -1e9, d0 = -1e9; p[0].forEach((q) => { if (q[0] < a0) a0 = q[0]; if (q[0] > c0) c0 = q[0]; if (q[1] < b0) b0 = q[1]; if (q[1] > d0) d0 = q[1]; });
          if ((c0 - a0) * (d0 - b0) > ba) { ba = (c0 - a0) * (d0 - b0); best = [a0, b0, c0, d0]; }
        }
        D.mbox[id] = best;
      }
      const wrap180 = (l) => ((l + 180) % 360 + 360) % 360 - 180;
      D.placeGeom = (id) => {   // where to point the globe, and how many degrees of country to fit
        let w = D.wbox[id]; if (w[2] - w[0] > 90) w = D.mbox[id];   // sprawling countries (Russia, US, France): frame the main landmass
        const width = w[2] - w[0], lat = (w[1] + w[3]) / 2;
        return { lon: wrap180((w[0] + w[2]) / 2), lat, span: Math.max(w[3] - w[1], width * Math.cos(lat * Math.PI / 180)) };
      };
      D.inBox = (id) => { const w = D.wbox[id]; return (lon, lat) => { const L = w[2] > 180 && lon < 0 ? lon + 360 : lon; return L >= w[0] && L <= w[2] && lat >= w[1] && lat <= w[3]; }; };
      D.areas = (id) => {   // FIRMS area boxes [west, south, east, north], split at the antimeridian
        const w = D.wbox[id];
        if (w[2] <= 180) return [w.slice()];
        if (w[0] >= 180) return [[w[0] - 360, w[1], w[2] - 360, w[3]]];
        return [[w[0], w[1], 180, w[3]], [-180, w[1], w[2] - 360, w[3]]];
      };
      // lighter copies of the shapes for drawing the whole globe (the full-detail ones stay for hit-testing and the selected country)
      const TOL = 0.2, simpRing = (r) => { const o = [r[0]]; let l = r[0]; for (let i = 1; i < r.length - 1; i++) { if (Math.abs(r[i][0] - l[0]) + Math.abs(r[i][1] - l[1]) >= TOL) { o.push(r[i]); l = r[i]; } } o.push(r[r.length - 1]); return o.length >= 4 ? o : r; };
      D.lite = {};
      for (const id in D.features) {
        const g = D.features[id].geometry, polys = g.type === 'Polygon' ? [g.coordinates] : g.coordinates;
        const lp = polys.map((p) => p.map(simpRing)).filter((p) => p[0].length >= 4);
        D.lite[id] = { type: 'Feature', properties: D.features[id].properties, geometry: { type: 'MultiPolygon', coordinates: lp } };
      }
      // fire climatology -> typed arrays for the globe
      const cells = climo.cells, n = cells.length;
      const x = new Float32Array(n), y = new Float32Array(n), z = new Float32Array(n), lon = new Float32Array(n), lat = new Float32Array(n);
      const v = new Float32Array(n * 12), all = [];
      cells.forEach((c, i) => {
        const la = c[0] * Math.PI / 180, lo = c[1] * Math.PI / 180;
        x[i] = Math.cos(la) * Math.cos(lo); y[i] = Math.cos(la) * Math.sin(lo); z[i] = Math.sin(la);
        lat[i] = c[0]; lon[i] = c[1];
        for (let m = 0; m < 12; m++) { v[i * 12 + m] = c[2][m]; if (c[2][m] > 0) all.push(c[2][m]); }
      });
      all.sort((a, b) => a - b);
      D.climo = { n, x, y, z, lon, lat, v, years: climo.years, cell_deg: climo.cell_deg, p95: all[Math.floor(all.length * 0.95)] || 1, p50: all[Math.floor(all.length * 0.5)] || 1 };
      return D;
    });
  D.loadSeries = (id) => D.series[id] ? Promise.resolve(D.series[id]) : get('data/series/' + id + '.json').then((s) => (D.series[id] = s));
  window.DATA = D;
})();
