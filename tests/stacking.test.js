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
  const xs = it.rot ? it.p.ay.cells.slice().reverse() : it.p.ax.cells, ys = it.rot ? it.p.ax.cells : it.p.ay.cells;
  const edges = (seq, o) => seq.reduce((a, c) => (a.push(a[a.length - 1] + c), a), [o]);
  return { ex: edges(xs, it.dx), ey: edges(ys, it.dy) };
}
const close = (a, b) => Math.abs(a - b) < 1e-6;

describe.each(SIZES)('Einsatz %s × %s mm', (w, d) => {
  const o = { ...BASE, boxW: w, boxD: d }, R = GF.compute(o);
  const plateJobs = R.stacks.filter((s) => s.items.length);

  it('alle Platten in einem Stapel, alles auf einem Druckbett', () => {
    expect(R.error).toBeUndefined();
    expect(plateJobs).toHaveLength(1);
    expect(plateJobs[0].items).toHaveLength(R.pieces.length);
    expect(R.stacks).toHaveLength(1); // auch die Leisten passen daneben
    expect(GF.stackMeshes(R.stacks[0], o).height).toBeLessThanOrEqual(o.bedZ);
  });

  it('jede Platte liegt zellgenau auf der darunter', () => {
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
