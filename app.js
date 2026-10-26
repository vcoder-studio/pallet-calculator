// app.js - free web version of Pallet Calculator (same calc.js as the extension, no server, no tracking).
(() => {
  // 🔴 УТОЧНИТЬ: Chrome Web Store page of the extension. Fill in before publishing the site.
  const STORE_URL = '';

  const C = window.PalletCalc;
  const $ = id => document.getElementById(id);
  const UNITS = { imperial: { len: 'in', wt: 'lb' }, metric: { len: 'cm', wt: 'kg' } };
  const DEFAULTS = { unit: 'imperial', preset: 'us', boxL: 12, boxW: 10, boxH: 8, boxWt: '', palL: 48, palW: 40, palH: 5.5, maxH: 96, maxWt: '' };
  const FIELDS = ['boxL', 'boxW', 'boxH', 'boxWt', 'palL', 'palW', 'palH', 'maxH', 'maxWt'];
  const LEN_FIELDS = ['boxL', 'boxW', 'boxH', 'palL', 'palW', 'palH', 'maxH'];
  const WT_FIELDS = ['boxWt', 'maxWt'];
  const ERRORS = {
    errBoxEmpty: 'Enter box length, width and height.',
    errPalletEmpty: 'Enter pallet length and width.',
    errHeightEmpty: 'Enter the max height.',
    errNoFit: 'The box does not fit on this pallet.',
    errTooTall: 'The box is taller than the max height.',
    errTooHeavy: 'One box is heavier than the max load weight.'
  };

  let state = Object.assign({}, DEFAULTS);
  try {
    const saved = JSON.parse(localStorage.getItem('palletCalc') || 'null');
    if (saved) state = Object.assign(state, saved);
  } catch (e) { /* storage blocked: use defaults */ }
  const persist = () => { try { localStorage.setItem('palletCalc', JSON.stringify(state)); } catch (e) { /* ignore */ } };

  const round = (n, d = 2) => Number(Number(n).toFixed(d));
  const fmt = (n, d = 1) => round(n, d).toLocaleString('en-US', { maximumFractionDigits: d });
  const num = v => { const x = parseFloat(v); return Number.isFinite(x) && x >= 0 ? x : ''; };

  function diagram(res, pallet) {
    const pad = Math.max(pallet.l, pallet.w) * 0.02;
    const vb = `${-pad} ${-pad} ${pallet.l + 2 * pad} ${pallet.w + 2 * pad}`;
    if (!res.layout) {
      return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${vb}"><rect width="${pallet.l}" height="${pallet.w}" fill="#bcd2ff" stroke="#a8884c" stroke-width="1.5" vector-effect="non-scaling-stroke"/>` +
        `<text x="${pallet.l / 2}" y="${pallet.w / 2}" text-anchor="middle" font-size="${pallet.l * 0.06}" fill="#1d4ed8">Too many boxes to draw</text></svg>`;
    }
    const boxes = res.layout.map(r => `<rect x="${r.x.toFixed(1)}" y="${r.y.toFixed(1)}" width="${r.w.toFixed(1)}" height="${r.h.toFixed(1)}" fill="#bcd2ff" stroke="#1d4ed8" stroke-width="1" vector-effect="non-scaling-stroke"/>`).join('');
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${vb}"><rect width="${pallet.l}" height="${pallet.w}" fill="#e9d8b4" stroke="#a8884c" stroke-width="1.5" vector-effect="non-scaling-stroke"/>${boxes}</svg>`;
  }

  function input(mixed) {
    const u = UNITS[state.unit];
    const mm = v => (v === '' ? 0 : C.toMm(v, u.len));
    const kg = v => (v === '' ? 0 : C.toKg(v, u.wt));
    const pallet = state.preset === 'custom' ? { l: mm(state.palL), w: mm(state.palW) } : C.PALLET_PRESETS[state.preset];
    return {
      box: { l: mm(state.boxL), w: mm(state.boxW), h: mm(state.boxH) },
      boxWeight: kg(state.boxWt), pallet, palletHeight: mm(state.palH), maxHeight: mm(state.maxH), maxWeight: kg(state.maxWt), mixed
    };
  }

  function render() {
    const u = UNITS[state.unit];
    document.querySelectorAll('.u-len').forEach(e => { e.textContent = `(${u.len})`; });
    document.querySelectorAll('.u-wt').forEach(e => { e.textContent = `(${u.wt})`; });
    document.querySelectorAll('#unitSeg button').forEach(b => b.classList.toggle('on', b.dataset.unit === state.unit));
    $('customPallet').hidden = state.preset !== 'custom';

    const inp = input(false);
    const res = C.calculate(inp);
    if (res.error) {
      $('error').textContent = ERRORS[res.error] || res.error;
      $('error').hidden = false;
      $('resultBody').hidden = true;
      return;
    }
    $('error').hidden = true;
    $('resultBody').hidden = false;
    $('rTiHi').textContent = `${res.perLayer} × ${res.layers}`;
    $('diagram').innerHTML = diagram(res, inp.pallet);
    $('diagramCaption').textContent = `Top view of one layer · pallet ${fmt(C.fromMm(inp.pallet.l, u.len))} × ${fmt(C.fromMm(inp.pallet.w, u.len))} ${u.len}`;
    $('rPerLayer').textContent = res.perLayer.toLocaleString('en-US');
    $('rLayers').textContent = res.layers;
    $('rTotal').textContent = res.total.toLocaleString('en-US');
    $('mWeight').hidden = res.loadWeight === null;
    if (res.loadWeight !== null) $('rWeight').textContent = `${fmt(C.fromKg(res.loadWeight, u.wt))} ${u.wt}`;
    $('rHeight').textContent = `${fmt(C.fromMm(res.loadHeight, u.len))} ${u.len}`;
    $('rArea').textContent = `${fmt(res.areaUsedPct)} %`;

    const notes = $('notes');
    notes.innerHTML = '';
    const add = (t, cls) => { const p = document.createElement('p'); p.textContent = t; if (cls) p.className = cls; notes.appendChild(p); };
    if (res.limitedBy === 'weight') {
      add(`Limited by weight: ${res.total.toLocaleString('en-US')} boxes allowed. By height ${res.totalByHeight.toLocaleString('en-US')} boxes would fit (${fmt(C.fromKg(res.weightByHeight, u.wt))} ${u.wt}).`, 'warn');
    }
    if (res.lastLayerPartial) add('The top layer is partial.');
    const mixed = C.calculate(input(true));
    if (!mixed.error && mixed.mixedGain > 0) add(`A mixed pattern (some boxes turned 90°) fits +${mixed.mixedGain} per layer. The PRO extension draws it.`, 'tease');
  }

  function writeInputs() {
    FIELDS.forEach(f => { $(f).value = state[f]; });
    $('preset').value = state.preset;
  }

  function setUnit(unit) {
    if (unit === state.unit) return;
    const toMetric = unit === 'metric';
    LEN_FIELDS.forEach(f => { if (state[f] !== '') state[f] = round(toMetric ? state[f] * 2.54 : state[f] / 2.54); });
    WT_FIELDS.forEach(f => { if (state[f] !== '') state[f] = round(toMetric ? state[f] * 0.45359237 : state[f] / 0.45359237); });
    state.unit = unit;
    writeInputs();
    persist();
    render();
  }

  FIELDS.forEach(f => $(f).addEventListener('input', () => { state[f] = num($(f).value); persist(); render(); }));
  $('preset').addEventListener('change', () => { state.preset = $('preset').value; persist(); render(); });
  document.querySelectorAll('#unitSeg button').forEach(b => b.addEventListener('click', () => setUnit(b.dataset.unit)));

  if (STORE_URL) {
    document.querySelectorAll('.store-link').forEach(a => { a.href = STORE_URL; a.target = '_blank'; a.rel = 'noopener'; });
  }

  writeInputs();
  render();
})();
