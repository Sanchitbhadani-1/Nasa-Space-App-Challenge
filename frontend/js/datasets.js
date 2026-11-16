/* SUNDIAL datasets: lists the example training datasets in data/examples/manifest.json (built by tools/build_examples.py)
   so people can download them or load them straight into pandas. Nothing here is computed in the browser. */
(function () {
  const list = document.getElementById('ds-list');
  if (!list) return;
  const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const mb = (b) => (b >= 1e6 ? (b / 1e6).toFixed(1) + ' MB' : Math.max(1, Math.round(b / 1e3)) + ' KB');
  const base = new URL('data/examples/', location.href).href;
  const REPO = 'https://github.com/Sanchitbhadani-1/Nasa-Space-App-Challenge/blob/main/frontend';

  fetch('data/examples/manifest.json').then((r) => { if (!r.ok) throw new Error(r.status); return r.json(); }).then((m) => {
    list.innerHTML = m.files.map((f) => `<li>
      <div class="ds-main"><b>${esc(f.title)}</b><span class="ds-meta">${f.rows.toLocaleString('en-US')} rows · ${f.cols} columns · ${mb(f.bytes)}</span>
        <p>${esc(f.use)}</p>
        <details><summary>Target and notes</summary><p><b>Target:</b> ${esc(f.target)}</p><p>${esc(f.notes)}</p></details></div>
      <a class="btn" href="data/examples/${esc(f.file)}" download>Download</a></li>`).join('');
    const pick = m.files.find((f) => f.file === 'forecast_features.csv') || m.files[0];
    const code = `import pandas as pd\n\nbase = "${base}"\ndf = pd.read_csv(base + "${pick.file}")\ntrain, valid, test = (df[df.split == s] for s in ("train", "valid", "test"))\nprint(len(train), len(valid), len(test))   # time-ordered split, no shuffling needed`;
    document.getElementById('ds-code').textContent = code;
    document.getElementById('ds-quick').hidden = false;
    document.getElementById('ds-copy').addEventListener('click', async (e) => {
      const b = e.currentTarget;
      try { await navigator.clipboard.writeText(code); b.textContent = 'Copied'; } catch (err) { b.textContent = 'Select the code to copy'; }
      setTimeout(() => { b.textContent = 'Copy code'; }, 1800);
    });
    document.getElementById('ds-note').innerHTML = `Counts are VIIRS-equivalent detections per month, ${String(m.first_month).slice(0, 4)} to ${String(m.last_month).slice(0, 4)}, ${m.countries} countries. Source: NASA FIRMS. Read the <a href="${REPO}/data/examples/README.md" target="_blank" rel="noopener">column guide</a>, try <a href="${REPO}/data/examples/train_baseline.py" target="_blank" rel="noopener">train_baseline.py</a> (a five-second gradient-boosting baseline to beat), or rebuild everything with <code>python frontend/tools/build_examples.py</code>.`;
  }).catch(() => { list.innerHTML = '<li class="tiny">The dataset list needs the page to be served over http(s), not opened as a file.</li>'; });
})();
