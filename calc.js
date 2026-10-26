// calc.js - pure calculation logic (no DOM, no chrome.* APIs). Works in the popup and in Node tests.
// All lengths are in millimetres and all weights in kilograms inside this file.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.PalletCalc = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  const EPS = 1e-6;
  const MAX_DRAW = 600;
  const MM = { in: 25.4, cm: 10, mm: 1 };
  const KG = { lb: 0.45359237, kg: 1 };

  // Standard pallet footprints (mm): US 48x40 in, EUR 1200x800, ISO 1200x1000.
  const PALLET_PRESETS = {
    us: { l: 1219.2, w: 1016 },
    eur: { l: 1200, w: 800 },
    iso: { l: 1200, w: 1000 }
  };

  // Typical internal container sizes (mm), see README for sources. Not exact: sizes vary by manufacturer.
  const CONTAINERS = {
    c20: { l: 5900, w: 2350, h: 2393 },
    c40: { l: 12030, w: 2350, h: 2393 },
    c40hc: { l: 12030, w: 2350, h: 2690 }
  };

  const toMm = (value, unit) => value * (MM[unit] || 1);
  const fromMm = (mm, unit) => mm / (MM[unit] || 1);
  const toKg = (value, unit) => value * (KG[unit] || 1);
  const fromKg = (kg, unit) => kg / (KG[unit] || 1);

  // Count boxes in a rectangle RL x RW filled with one orientation (l along RL).
  function countUniform(RL, RW, l, w) {
    return Math.floor(RL / l + EPS) * Math.floor(RW / w + EPS);
  }

  // Plan = small description of a layout; rectangles are built only once at the end (fast).
  // Block pattern: cut the area in two along one axis (at multiples of box sides), fill each part
  // with its best orientation. depth > 0 allows each part to be cut again.
  function plan(RL, RW, l, w, depth) {
    const a = countUniform(RL, RW, l, w);
    const b = countUniform(RL, RW, w, l);
    let best = b > a ? { count: b, kind: 'u', RL, RW, bl: w, bw: l } : { count: a, kind: 'u', RL, RW, bl: l, bw: w };
    if (depth <= 0) return best;
    const cutsL = new Set();
    const cutsW = new Set();
    for (const s of [l, w]) {
      for (let c = s; c < RL - EPS; c += s) cutsL.add(Math.round(c * 1000) / 1000);
      for (let c = s; c < RW - EPS; c += s) cutsW.add(Math.round(c * 1000) / 1000);
    }
    const nextDepth = cutsL.size + cutsW.size > 60 ? 0 : depth - 1;
    for (const c of cutsL) {
      const p1 = plan(c, RW, l, w, nextDepth);
      const p2 = plan(RL - c, RW, l, w, nextDepth);
      if (p1.count + p2.count > best.count) best = { count: p1.count + p2.count, kind: 's', axis: 'x', c, p1, p2 };
    }
    for (const c of cutsW) {
      const p1 = plan(RL, c, l, w, nextDepth);
      const p2 = plan(RL, RW - c, l, w, nextDepth);
      if (p1.count + p2.count > best.count) best = { count: p1.count + p2.count, kind: 's', axis: 'y', c, p1, p2 };
    }
    return best;
  }

  function build(p, ox, oy, out) {
    if (p.kind === 'u') {
      const nx = Math.floor(p.RL / p.bl + EPS);
      const ny = Math.floor(p.RW / p.bw + EPS);
      for (let i = 0; i < nx; i++) {
        for (let j = 0; j < ny; j++) out.push({ x: ox + i * p.bl, y: oy + j * p.bw, w: p.bl, h: p.bw });
      }
    } else if (p.axis === 'x') {
      build(p.p1, ox, oy, out);
      build(p.p2, ox + p.c, oy, out);
    } else {
      build(p.p1, ox, oy, out);
      build(p.p2, ox, oy + p.c, out);
    }
    return out;
  }

  // Returns the list of box rectangles {x, y, w, h} for the best layout found.
  function pack(RL, RW, l, w, depth) {
    return build(plan(RL, RW, l, w, depth), 0, 0, []);
  }

  // input (all in mm / kg): { box:{l,w,h}, boxWeight?, pallet:{l,w}, palletHeight, maxHeight, maxWeight?, mixed }
  function calculate(input) {
    const { box, pallet } = input;
    const palletHeight = input.palletHeight || 0;
    if (![box.l, box.w, box.h].every(v => v > 0)) return { error: 'errBoxEmpty' };
    if (![pallet.l, pallet.w].every(v => v > 0)) return { error: 'errPalletEmpty' };
    if (!(input.maxHeight > 0)) return { error: 'errHeightEmpty' };

    const singlePlan = plan(pallet.l, pallet.w, box.l, box.w, 0);
    let bestPlan = singlePlan;
    if (input.mixed) {
      const mixedPlan = plan(pallet.l, pallet.w, box.l, box.w, 2);
      if (mixedPlan.count > bestPlan.count) bestPlan = mixedPlan;
    }
    const single = { length: singlePlan.count };
    // Drawing thousands of boxes freezes the window, so very dense layers get no picture (numbers are still exact).
    const layout = bestPlan.count <= MAX_DRAW ? build(bestPlan, 0, 0, []) : null;
    const perLayer = bestPlan.count;
    if (perLayer === 0) return { error: 'errNoFit' };

    const layersByHeight = Math.floor((input.maxHeight - palletHeight) / box.h + EPS);
    if (layersByHeight < 1) return { error: 'errTooTall' };
    const totalByHeight = perLayer * layersByHeight;

    const hasWeight = input.boxWeight > 0;
    const byWeight = hasWeight && input.maxWeight > 0 ? Math.floor(input.maxWeight / input.boxWeight + EPS) : null;
    let total = totalByHeight;
    let limitedBy = 'height';
    if (byWeight !== null && byWeight < totalByHeight) {
      total = byWeight;
      limitedBy = 'weight';
    }
    if (total < 1) return { error: 'errTooHeavy' };

    const layers = Math.ceil(total / perLayer);
    const lastLayerPartial = total % perLayer !== 0;
    const boxArea = box.l * box.w;
    const result = {
      perLayer,
      layers,
      lastLayerPartial,
      total,
      totalByHeight,
      byWeight,
      limitedBy,
      layout,
      areaUsedPct: Math.round(((perLayer * boxArea) / (pallet.l * pallet.w)) * 1000) / 10,
      loadHeight: layers * box.h + palletHeight,
      loadWeight: hasWeight ? total * input.boxWeight : null,
      weightByHeight: hasWeight ? totalByHeight * input.boxWeight : null,
      single: single.length
    };
    result.mixedGain = Math.max(0, perLayer - single.length);
    return result;
  }

  // How many pallet footprints fit on the container floor; stackLevels = loaded pallets that fit in height.
  function palletsInContainer(pallet, loadHeight, container, mixed) {
    const floorCount = plan(container.l, container.w, pallet.l, pallet.w, mixed ? 2 : 0).count;
    const stackLevels = Math.max(0, Math.floor(container.h / loadHeight + EPS));
    return { floorCount, stackLevels, tooTall: loadHeight > container.h };
  }

  return { calculate, palletsInContainer, pack, toMm, fromMm, toKg, fromKg, PALLET_PRESETS, CONTAINERS };
});
