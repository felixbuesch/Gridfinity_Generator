// Ganze Einsätze in einem Druckjob: alle Platten in einem Stapel, jede Platte liegt mit ihren Zellen
// exakt auf Zellen der Platte darunter (kein Überhang, keine Stützen nötig).
import { describe, it, expect } from 'vitest';
import GF from '../src/gf.js';

const BASE = {
  clearance: 1, cornerR: 3, minSpacer: 2, half: false, spacers: 'separate', spacerStyle: 'ladder',
  alignX: 'center', alignY: 'center', spacerH: 2.4, rail: 1.2, ribPitch: 40, bedX: 235, bedY: 256, bedZ: 256,
  stack: true, sepStyle: 'grow', sepT: 0.6, overhang: 45, maxStack: 30, towerReserve: 40,
};
const SIZES = [[400, 300], [300, 200], [560, 300], [600, 450], [150, 100], [800, 500], [523.5, 287.2], [1200, 600], [380, 380], [700, 120]];

// Rechteck und Zellgrenzen einer liegenden Platte im Bett-Koordinatensystem
function placed(it) {
  const xs = it.rot ? it.p.ay.cells.slice().reverse() : it.p.ax.cells, ys0 = it.rot ? it.p.ax.cells : it.p.ay.cells;
  const ys = it.flip ? ys0.slice().reverse() : ys0;
  const edges = (seq, o) => seq.reduce((a, c) => (a.push(a[a.length - 1] + c), a), [o]);
  return { ex: edges(xs, it.dx), ey: edges(ys, it.dy) };
}
const close = (a, b) => Math.abs(a - b) < 1e-6;

describe.each(SIZES.flatMap(([w, d]) => [[w, d, 'grow'], [w, d, 'flip']]))('Einsatz %s × %s mm, %s', (w, d, sepStyle) => {
  const o = { ...BASE, boxW: w, boxD: d, sepStyle }, R = GF.compute(o);
  const plateJobs = R.stacks.filter((s) => s.items.length);

  it('alle Platten in einem Stapel, alles auf einem Druckbett', () => {
    expect(R.error).toBeUndefined();
    expect(plateJobs).toHaveLength(1);
    expect(plateJobs[0].items).toHaveLength(R.pieces.length);
    expect(R.stacks).toHaveLength(1); // auch die Leisten passen daneben
    expect(GF.stackMeshes(R.stacks[0], o).height).toBeLessThanOrEqual(o.bedZ);
  });

  it('jede Platte liegt zellgenau auf der darunter', () => {
    if (R.flat) return; // flach nebeneinander, nichts gestapelt
    const items = plateJobs[0].items;
    for (let k = 1; k < items.length; k++) {
      const up = placed(items[k]), lo = placed(items[k - 1]);
      // jede Zellgrenze oben ist auch eine Zellgrenze unten -> Stege liegen auf Stegen
      for (const x of up.ex) expect(lo.ex.some((e) => close(e, x)), `x=${x}`).toBe(true);
      for (const y of up.ey) expect(lo.ey.some((e) => close(e, y)), `y=${y}`).toBe(true);
    }
  });
});

describe('gedrehte Platten', () => {
  it('kommen vor und ergeben geschlossene Netze', async () => {
    const o = { ...BASE, boxW: 400, boxD: 300 }, R = GF.compute(o);
    expect(R.stacks[0].items.some((it) => it.rot)).toBe(true);
    const m = GF.stackMeshes(R.stacks[0], o);
    expect(GF.volume(m.pla)).toBeGreaterThan(0);
    expect(GF.volume(m.petg)).toBeGreaterThan(0);
  });
});

describe('Wendeplatte (PETG-Platte kopfüber)', () => {
  const o = { ...BASE, boxW: 800, boxD: 500, sepStyle: 'flip' }, R = GF.compute(o), s = R.stacks[0];

  it('jede zweite Platte ist kopfüber aus PETG, sonst gibt es kein PETG zwischen den Platten', () => {
    s.items.forEach((it, k) => expect(!!it.flip, `Ebene ${k + 1}`).toBe(k % 2 === 1));
  });

  it('Platten liegen direkt aufeinander: Höhe = Anzahl × H', () => {
    const plates = s.items.length * GF.H, m = GF.stackMeshes({ ...s, spacers: [] }, o);
    expect(m.height).toBeCloseTo(plates, 6);
  });

  it('PETG-Netz enthält genau die gewendeten Platten (gleiches Volumen wie aufrecht)', () => {
    const m = GF.stackMeshes({ ...s, spacers: [] }, o);
    const flipVol = s.items.filter((it) => it.flip).reduce((a, it) => a + GF.volume(GF.plateMesh(it.p.type)), 0);
    expect(GF.volume(m.petg)).toBeCloseTo(flipVol, 4);
  });
});

it('Wendeplatte mit integrierten Rändern wechselt ebenfalls das Material', () => {
  const o = { ...BASE, boxW: 523.5, boxD: 287.2, spacers: 'integrated', sepStyle: 'flip' };
  for (const st of GF.compute(o).stacks) st.items.forEach((it, k) => expect(!!it.flip).toBe(k % 2 === 1));
});

describe('Wendeplatte: Leisten', () => {
  const o = { ...BASE, boxW: 400, boxD: 300, sepStyle: 'flip' }, R = GF.compute(o), s = R.stacks[0];

  it('Leisten sind so hoch wie eine Platte', () => {
    for (const t of R.spacers.types) expect(t.h).toBeCloseTo(GF.H, 6);
  });

  it('Leisten-Türme wechseln PLA/PETG auf denselben Höhen wie die Platten, ohne Zwischenlage', () => {
    const only = (sp) => GF.stackMeshes({ ...s, items: [], spacers: sp }, o);
    const lv = (k) => s.spacers.filter((e) => (e.level || 0) === k);
    expect(lv(1).length).toBeGreaterThan(0);
    // Ebene 0 nur PLA, Ebene 1 nur PETG
    expect(only(lv(0)).petg.f.length).toBe(0);
    expect(only(lv(1)).pla.f.length).toBe(0);
    const m = only(s.spacers), top = Math.max(...s.spacers.map((e) => e.level || 0)) + 1;
    expect(m.height).toBeCloseTo(top * GF.H, 6);
  });

  it('ohne Wendeplatte bleiben die Leisten-Türme wie bisher (eigene Höhe, flache PETG-Lagen)', () => {
    const o2 = { ...o, sepStyle: 'grow' }, R2 = GF.compute(o2);
    expect(R2.spacers.types[0].h).toBeCloseTo(2.4, 6);
  });
});

describe('flach statt stapeln', () => {
  const overlap = (a, b) => a.x0 < b.x1 - 1e-6 && b.x0 < a.x1 - 1e-6 && a.y0 < b.y1 - 1e-6 && b.y0 < a.y1 - 1e-6;
  it.each([[150, 100], [380, 90], [200, 120], [379, 85]])('%s × %s mm passt ohne Stapeln auf ein Bett', (w, d) => {
    const o = { ...BASE, boxW: w, boxD: d }, R = GF.compute(o);
    expect(R.flat).toBe(true);
    expect(R.stacks).toHaveLength(1);
    const st = R.stacks[0], rects = st.items.map((it) => {
      const pw = it.rot ? it.p.d : it.p.w, pd = it.rot ? it.p.w : it.p.d;
      return { x0: it.dx, y0: it.dy, x1: it.dx + pw, y1: it.dy + pd };
    });
    // alles auf dem ganzen Bett (ohne Prime-Tower-Reserve), nichts überlappt
    for (const r of rects) { expect(r.x1).toBeLessThanOrEqual(st.bed.w + 1e-6); expect(r.y1).toBeLessThanOrEqual(st.bed.d + 1e-6); }
    for (let i = 0; i < rects.length; i++) for (let j = i + 1; j < rects.length; j++) expect(overlap(rects[i], rects[j])).toBe(false);
    const m = GF.stackMeshes(st, o);
    expect(m.petg.f.length).toBe(0);         // nur PLA
    expect(m.height).toBeCloseTo(GF.H, 6);   // eine Lage
  });
  it('großer Einsatz wird weiter gestapelt', () => {
    expect(GF.compute({ ...BASE, boxW: 400, boxD: 300 }).flat).toBeFalsy();
  });
});

describe('Maße ohne Leisten', () => {
  it('nächstkleineres und nächstgrößeres Maß', () => {
    expect(GF.fitSizes(400, 1, false)).toMatchObject({ lo: 379, hi: 421, exact: false });
    expect(GF.fitSizes(379, 1, false)).toMatchObject({ lo: 379, hi: 421, exact: true });
    expect(GF.fitSizes(400, 1, true)).toMatchObject({ lo: 400, hi: 421, exact: true });
    expect(GF.fitSizes(30, 1, false)).toMatchObject({ lo: null, hi: 43 });
  });
  it('beim kleineren Maß bleibt kein Rest für Leisten', () => {
    for (const v of [137, 400, 555.5]) {
      const f = GF.fitSizes(v, 1, false), R = GF.compute({ ...BASE, boxW: f.lo, boxD: f.hi });
      expect(R.AX.mLow + R.AX.mHigh).toBe(0); expect(R.AY.mLow + R.AY.mHigh).toBe(0);
    }
  });
});

describe('mehrere Einsätze', () => {
  it.each([[150, 100, 3], [400, 300, 3], [300, 200, 4]])('%s × %s mm, %s Stück: alles da, möglichst in einem Druckjob', (w, d, n) => {
    const one = GF.compute({ ...BASE, boxW: w, boxD: d }), R = GF.compute({ ...BASE, boxW: w, boxD: d, copies: n });
    expect(R.pieces).toHaveLength(one.pieces.length * n);
    expect(R.spacers.list).toHaveLength(one.spacers.list.length * n);
    const placedP = R.stacks.reduce((a, s) => a + s.items.length, 0), placedS = R.stacks.reduce((a, s) => a + s.spacers.length, 0);
    expect(placedP).toBe(R.pieces.length); expect(placedS).toBe(R.spacers.list.length);
    expect(R.stacks).toHaveLength(1);
    for (const s of R.stacks) expect(GF.stackMeshes(s, { ...BASE, boxW: w, boxD: d, copies: n }).height).toBeLessThanOrEqual(256);
  });
});

describe('flache Stegoberkante (kein Absatz oben)', () => {
  it('Platte endet überall auf derselben Höhe, Oberkante ist ein durchgehender Kamm', () => {
    const R = GF.compute({ ...BASE, boxW: 400, boxD: 300, stack: false });
    const t = R.types.find((x) => x.rep.ax.cells.every((c) => c === 42) && x.rep.ay.cells.every((c) => c === 42));
    const m = GF.plateMesh(t), v = m.v, f = m.f;
    let zmax = -Infinity; for (let i = 2; i < v.length; i += 3) zmax = Math.max(zmax, v[i]);
    expect(zmax).toBeCloseTo(GF.H, 9);
    // Fläche aller Dreiecke ganz oben = Stegoberkante
    let top = 0;
    for (let k = 0; k < f.length; k += 3) {
      const [a, b, c] = [f[k], f[k + 1], f[k + 2]].map((i) => [v[3 * i], v[3 * i + 1], v[3 * i + 2]]);
      if ([a, b, c].every((p) => Math.abs(p[2] - GF.H) < 1e-6)) top += Math.abs((b[0] - a[0]) * (c[1] - a[1]) - (c[0] - a[0]) * (b[1] - a[1])) / 2;
    }
    const n = t.rep.ax.cells.length * t.rep.ay.cells.length, perim = 4 * 42;
    // je Zelle mindestens ein 0,25 mm breiter Rand ringsum (Steg 0,5 mm zwischen zwei Zellen)
    expect(top).toBeGreaterThan(n * perim * 0.25 * 0.95);
  });
});

describe('Außenrand oben', () => {
  it('Außenkante ist oben 0,5 mm breit wie ein innerer Steg', () => {
    const R = GF.compute({ ...BASE, boxW: 85, boxD: 85, stack: false });
    const m = GF.plateMesh(R.types[0]), v = m.v;
    // kleinster Abstand eines Taschen-Oberkantenpunkts (z = H, innerhalb) zum Außenrand
    const P = R.types[0].rep;
    let dmin = Infinity;
    for (let i = 0; i < v.length; i += 3) {
      if (Math.abs(v[i + 2] - GF.H) > 1e-6) continue;
      const x = v[i], y = v[i + 1], d = Math.min(x, y, P.w - x, P.d - y);
      if (d > 1e-6) dmin = Math.min(dmin, d);
    }
    expect(dmin).toBeCloseTo(0.5, 6);
  });
});
