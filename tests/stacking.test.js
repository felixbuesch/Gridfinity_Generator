// Ganze Einsätze in einem Druckjob: alle Platten in einem Stapel, jede Platte liegt mit ihren Zellen
// exakt auf Zellen der Platte darunter (kein Überhang, keine Stützen nötig).
import { describe, it, expect } from 'vitest';
import GF from '../src/gf.js';

const BASE = {
  clearance: 1, cornerR: 3, minSpacer: 2, half: false, spacers: 'separate', spacerStyle: 'ladder',
  alignX: 'center', alignY: 'center', spacerH: 2.4, rail: 1.2, ribPitch: 40, bedX: 235, bedY: 256, bedZ: 256,
  stack: true, sepStyle: 'petg', sepT: 0.6, maxStack: 30, towerReserve: 40,
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

describe.each(SIZES.flatMap(([w, d]) => [[w, d, 'petg'], [w, d, 'perf']]))('Einsatz %s × %s mm, %s', (w, d, sepStyle) => {
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

describe('Stapel mehrfarbig: PETG-Zwischenschicht, jede zweite Platte kopfüber', () => {
  const o = { ...BASE, boxW: 800, boxD: 500, sepStyle: 'petg' }, R = GF.compute(o), s = R.stacks[0];
  const per = GF.H + o.sepT;

  it('jede zweite Platte liegt kopfüber, alle Platten sind PLA', () => {
    expect(s.items.length).toBeGreaterThan(2);
    s.items.forEach((it, k) => expect(!!it.flip, `Ebene ${k + 1}`).toBe(k % 2 === 1));
  });

  it('Höhe = Platten + PETG-Schichten dazwischen', () => {
    const n = s.items.length, m = GF.stackMeshes({ ...s, spacers: [] }, o);
    expect(m.height).toBeCloseTo(n * GF.H + (n - 1) * o.sepT, 6);
  });

  it('PETG liegt nur in den Fugen zwischen den Platten, genau sepT dick', () => {
    const m = GF.stackMeshes({ ...s, spacers: [] }, o), V = m.petg.v;
    for (let i = 2; i < V.length; i += 3) {
      const k = Math.ceil(V[i] / per - 1e-9); // Fuge unter Ebene k: von k · per − sepT bis k · per
      expect(V[i]).toBeGreaterThanOrEqual(k * per - o.sepT - 1e-6); expect(V[i]).toBeLessThanOrEqual(k * per + 1e-6);
      expect(k).toBeGreaterThanOrEqual(1); expect(k).toBeLessThan(s.items.length);
    }
  });

  it('Stegoberkanten auf Stegoberkanten, Füße auf Füßen: PETG so groß wie die aufliegende Fläche', () => {
    const m = GF.stackMeshes({ ...s, spacers: [] }, o), sep = GF.volume(m.petg);
    let want = 0;
    s.items.forEach((it, k) => {
      if (!k) return;
      const one = new GF.Mesh(); GF.addSeparator(one, it.p.type.tiles, 0, o.sepT, !!it.flip); want += GF.volume(one);
    });
    expect(sep).toBeCloseTo(want, 4);
    // kopfüber liegt die Platte nur mit den schmalen Stegoberkanten auf, aufrecht mit den breiten Füßen
    const t = s.items[1].p.type.tiles, a = new GF.Mesh(), b = new GF.Mesh();
    GF.addSeparator(a, t, 0, 1, true); GF.addSeparator(b, t, 0, 1, false);
    expect(GF.volume(a)).toBeLessThan(GF.volume(b));
    expect(GF.volume(a)).toBeGreaterThan(0);
  });

  it('PETG berührt PLA nur flächig, keine Durchdringung', () => {
    const m = GF.stackMeshes({ ...s, spacers: [] }, o), V = m.pla.v;
    // keine PLA-Ecke liegt im Inneren einer Fuge
    for (let i = 2; i < V.length; i += 3) {
      const r = V[i] % per;
      expect(r > GF.H + 1e-6 && r < per - 1e-6, `z = ${V[i]}`).toBe(false);
    }
  });

  it('stackInfo zählt das gleiche PETG wie die Netze', () => {
    const m = GF.stackMeshes(s, o), info = GF.stackInfo(s, o);
    expect(info.petg).toBeCloseTo(GF.volume(m.petg), 4);
    expect(info.pla).toBeCloseTo(GF.volume(m.pla), 4);
  });
});

it('mehrfarbig mit integrierten Rändern: ebenfalls jede zweite Platte kopfüber', () => {
  const o = { ...BASE, boxW: 523.5, boxD: 287.2, spacers: 'integrated', sepStyle: 'petg' };
  for (const st of GF.compute(o).stacks) st.items.forEach((it, k) => expect(!!it.flip).toBe(k % 2 === 1));
});

describe('Stapel mehrfarbig: Leisten', () => {
  const o = { ...BASE, boxW: 400, boxD: 300, sepStyle: 'petg' }, R = GF.compute(o), s = R.stacks[0];

  it('Leisten sind so hoch wie eine Platte', () => {
    for (const t of R.spacers.types) expect(t.h).toBeCloseTo(GF.H, 6);
  });

  it('PETG der Leisten-Türme liegt auf denselben Höhen wie das der Platten (wenige Filamentwechsel)', () => {
    const per = GF.H + o.sepT, zs = (m) => new Set(Array.from({ length: m.petg.v.length / 3 }, (_, i) => +m.petg.v[3 * i + 2].toFixed(4)));
    const sp = GF.stackMeshes({ ...s, items: [] }, o), pl = GF.stackMeshes({ ...s, spacers: [] }, o);
    expect(s.spacers.some((e) => e.level > 0)).toBe(true);
    const plateZ = zs(pl);
    for (const z of zs(sp)) expect(plateZ.has(z), `z = ${z}`).toBe(true);
    expect(sp.height).toBeLessThanOrEqual(pl.height + 1e-6 + per * 10);
  });

  it('einfarbig behalten die Leisten ihre eigene Höhe', () => {
    const R2 = GF.compute({ ...o, sepStyle: 'perf' });
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
    // je Exemplar dieselben Teile (die Aufteilung darf sich ändern, z. B. flach statt gestapelt)
    for (let c = 0; c < n; c++) expect(R.pieces.filter((p) => p.copy === c).length).toBe(R.pieces.length / n);
    const ar = (l) => l.reduce((a, q) => a + (q.x1 - q.x0) * (q.y1 - q.y0), 0);
    expect(ar(R.spacers.list)).toBeCloseTo(ar(one.spacers.list) * n, 4);
    expect(R.pieces.reduce((a, p) => a + p.w * p.d, 0)).toBeCloseTo(one.pieces.reduce((a, p) => a + p.w * p.d, 0) * n, 6);
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
    const R = GF.compute({ ...BASE, boxW: 85, boxD: 85, stack: false, cornerR: 0 }); // eckige Wand: Abstand zum Rechteckrand messbar
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

describe('Kundentest-Fixes', () => {
  const ext = (m) => { let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity; for (let i = 0; i < m.v.length; i += 3) { x0 = Math.min(x0, m.v[i]); x1 = Math.max(x1, m.v[i]); y0 = Math.min(y0, m.v[i + 1]); y1 = Math.max(y1, m.v[i + 1]); } return [x1 - x0, y1 - y0]; };
  it.each([[523.5, 287.2, 'petg', true], [400, 300, 'petg', false], [600, 450, 'perf', false], [400, 300, 'petg', false, 'integrated']])('Exportierte Druckbetten passen in X/Y aufs Bett (%s × %s, %s)', (w, d, sepStyle, half, spacers = 'separate') => {
    const o = { ...BASE, boxW: w, boxD: d, sepStyle, half, spacers };
    const R = GF.compute(o);
    for (const s of R.stacks) {
      const m = GF.stackMeshes(s, o);
      const [ex, ey] = ext(GF.toBed(m.pla, s));
      expect(ex).toBeLessThanOrEqual(o.bedX + 1e-6); expect(ey).toBeLessThanOrEqual(o.bedY + 1e-6);
    }
  });
  it('400 × 120 passt flach (mehrere Aufteilungen probiert)', () => {
    const R = GF.compute({ ...BASE, boxW: 400, boxD: 120 });
    expect(R.flat).toBe(true); expect(R.stacks).toHaveLength(1);
  });
  it('zu große Maße und zu kleine Druckhöhe geben eine Meldung statt zu rechnen', () => {
    expect(GF.compute({ ...BASE, boxW: 2500, boxD: 300 }).error).toMatch(/Höchstens/);
    expect(GF.compute({ ...BASE, boxW: 400, boxD: 300, bedZ: 3 }).error).toMatch(/Druckhöhe/);
  });
  it('2000 × 2000 mm rechnet schnell', () => {
    const t = Date.now(); const R = GF.compute({ ...BASE, boxW: 2000, boxD: 2000 });
    expect(R.error).toBeUndefined(); expect(Date.now() - t).toBeLessThan(2000);
  });
  it.each(['petg', 'perf'])('stackInfo = Werte aus den echten Netzen (%s)', (sepStyle) => {
    const o = { ...BASE, boxW: 600, boxD: 450, sepStyle, copies: 2 };
    for (const s of GF.compute(o).stacks) {
      const m = GF.stackMeshes(s, o), i = GF.stackInfo(s, o);
      expect(i.pla).toBeCloseTo(GF.volume(m.pla), 6); expect(i.petg).toBeCloseTo(m.petg.f.length ? GF.volume(m.petg) : 0, 6); expect(i.height).toBeCloseTo(m.height, 9);
    }
  });
});
