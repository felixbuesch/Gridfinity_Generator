// Reihenfolge und Lage im Stapel: Wandrundungen übereinander, Leisten gewendet, Leistentürme nicht höher als der Plattenstapel
import { describe, it, expect } from 'vitest';
import GF from '../src/gf.js';

const BASE = {
  clearance: 1, cornerR: 0, minSpacer: 2, half: false, spacers: 'separate', spacerStyle: 'ladder',
  alignX: 'center', alignY: 'center', spacerH: 2.4, rail: 1.2, ribPitch: 40, bedX: 180, bedY: 180, bedZ: 180,
  stack: true, sepStyle: 'petg', sepT: 0.6, maxStack: 30, towerReserve: 40, connect: 'none', connFit: 0.15,
};
const key = (c) => `${c.q}:${c.cx.toFixed(3)}:${c.cy.toFixed(3)}:${c.r.toFixed(3)}`;
// alle Rundungen eines liegenden Teils (aus seinen Kacheln, doppelte zusammengefasst)
const clipsOf = (tiles) => [...new Map(tiles.flatMap((t) => t.clips || []).map((c) => [key(c), c])).values()];
const cuts = (c, x0, y0, x1, y1) => { // schneidet die Rundung in das Rechteck? (wie clipCuts im Rechenkern)
  const sx = c.q === 0 || c.q === 3 ? 1 : -1, sy = c.q < 2 ? 1 : -1, px = sx > 0 ? x0 : x1, py = sy > 0 ? y0 : y1;
  return sx * (px - c.cx) < -1e-9 && sy * (py - c.cy) < -1e-9 && Math.hypot(px - c.cx, py - c.cy) > c.r + 1e-9;
};
const bbox = (tiles) => [Math.min(...tiles.map((t) => t.x0)), Math.min(...tiles.map((t) => t.y0)), Math.max(...tiles.map((t) => t.x1)), Math.max(...tiles.map((t) => t.y1))];
// Rundungen unten, über deren weggeschnittenem Bereich oben Material liegt (geprüft auf einem 0,5-mm-Raster,
// 0,3 mm Abstand zum Kreis) / Rundungen oben genau über gleicher Rundung unten
const away = (cl, x, y, m) => cl.some((c) => { const sx = c.q === 0 || c.q === 3 ? 1 : -1, sy = c.q < 2 ? 1 : -1; return sx * (x - c.cx) < 0 && sy * (y - c.cy) < 0 && Math.hypot(x - c.cx, y - c.cy) > c.r + m; });
function compare(loT, upT) {
  const lo = clipsOf(loT), up = clipsOf(upT), loK = new Set(lo.map(key)), [x0, y0, x1, y1] = bbox(upT);
  let hang = 0;
  for (const c of lo) {
    if (!cuts(c, x0, y0, x1, y1)) continue;
    let bad = false;
    for (let x = Math.max(x0, c.cx - c.r) + 0.25; x < Math.min(x1, c.cx + c.r) && !bad; x += 0.5)
      for (let y = Math.max(y0, c.cy - c.r) + 0.25; y < Math.min(y1, c.cy + c.r) && !bad; y += 0.5)
        if (away([c], x, y, 0.3) && !away(up, x, y, 0)) bad = true;
    if (bad) hang++;
  }
  return { hang, match: up.filter((c) => loK.has(key(c))).length };
}

describe('Wandrundungen liegen im Stapel übereinander', () => {
  for (const [w, d, r, sepStyle, al] of [[600, 450, 20, 'petg', 'start'], [600, 450, 20, 'perf', 'end'], [500, 400, 10, 'perf', 'start'], [464, 328, 15, 'petg', 'end'], [365, 265, 25, 'petg', 'start'], [365, 265, 25, 'petg', 'center']]) {
    it(`${w} × ${d}, Radius ${r}, ${sepStyle}, Raster ${al}: nichts hängt über einer Rundung, gleiche Rundungen liegen aufeinander`, () => {
      const o = { ...BASE, boxW: w, boxD: d, cornerR: r, sepStyle, alignX: al, alignY: al }, R = GF.compute(o);
      expect(R.error).toBeUndefined();
      for (const s of R.stacks) for (let k = 1; k < s.items.length; k++) {
        const f = compare(GF.itemTiles(s.items[k - 1]), GF.itemTiles(s.items[k]));
        expect(f.hang, `${s.label} Ebene ${k + 1}`).toBe(0);
      }
      // gleich große Platten: die mit Rundung liegen zusammen oben, keine ungerundete darüber
      for (const s of R.stacks) {
        const seen = new Set();
        s.items.forEach((it) => {
          const sz = `${it.p.w}x${it.p.d}`, round = !!(it.p.clips && it.p.clips.length);
          if (round) seen.add(sz); else expect(seen.has(sz), `${s.label}: ungerundete ${it.p.type.label} über gerundeter`).toBe(false);
        });
      }
    });
  }

  it('um 180° gedreht (r2): Kacheln und Netz zeigen dieselbe Platte, Rundung in der Gegenecke', () => {
    const o = { ...BASE, boxW: 365, boxD: 265, cornerR: 25, alignX: 'start', alignY: 'start' }, R = GF.compute(o);
    const p = R.pieces.find((q) => q.clips && q.clips.length), it = { p, rot: 0, r2: 1, flip: 0, dx: 0, dy: 0 };
    const T = GF.itemTiles(it), [x0, y0, x1, y1] = bbox(T);
    expect([x0, y0, x1, y1].map((v) => +v.toFixed(6))).toEqual([0, 0, +p.w.toFixed(6), +p.d.toFixed(6)]);
    const c0 = p.clips[0], c = clipsOf(T)[0];
    expect(c.q).toBe((c0.q + 2) % 4); expect(c.cx).toBeCloseTo(p.w - c0.cx, 6); expect(c.cy).toBeCloseTo(p.d - c0.cy, 6);
    const st = { items: [it], spacers: [], bridges: [] }, m = GF.stackMeshes(st, o);
    expect(GF.volume(m.pla)).toBeCloseTo(GF.volume(GF.plateMesh(p.type)), 2); // Rundung gedreht etwas anders in Dreiecke zerlegt
    // Netz: kein Punkt im weggeschnittenen Bereich der gedrehten Rundung
    for (let i = 0; i < m.pla.v.length; i += 3) expect(away([c], m.pla.v[i], m.pla.v[i + 1], 0.01), `Punkt ${i / 3}`).toBe(false);
  });

  it('um 180° gedreht: Netz und Kacheln stimmen überein (gleiches Volumen, gleicher Umriss)', () => {
    const o = { ...BASE, boxW: 600, boxD: 450, cornerR: 20 }, R = GF.compute(o);
    for (const s of R.stacks) {
      const m = GF.stackMeshes(s, o), info = GF.stackInfo(s, o);
      expect(info.pla).toBeCloseTo(GF.volume(m.pla), 4);
      expect(info.petg).toBeCloseTo(GF.volume(m.petg), 4);
    }
  });
});

describe('Leisten im Turm: gewendet, damit die Rundungen übereinander liegen', () => {
  for (const [w, d, r, sepStyle] of [[600, 450, 20, 'petg'], [464, 328, 15, 'perf'], [365, 265, 25, 'petg']]) {
    it(`${w} × ${d}, Radius ${r}, ${sepStyle}`, () => {
      const o = { ...BASE, boxW: w, boxD: d, cornerR: r, sepStyle }, R = GF.compute(o);
      for (const s of R.stacks) for (const e of s.spacers) {
        if (!e.level) continue;
        const lo = s.spacers.find((q) => q.x === e.x && q.y === e.y && q.level === e.level - 1);
        expect(GF.spacerPlaced(e).length).toBe(e.sp.type.tiles.length);
        expect(compare(GF.spacerPlaced(lo), GF.spacerPlaced(e)).hang, `${s.label} Leiste Ebene ${e.level + 1}`).toBe(0);
      }
    });
  }
  it('gewendete Leiste hat dasselbe Volumen und bleibt in ihrem Platz', () => {
    const o = { ...BASE, boxW: 600, boxD: 450, cornerR: 20 }, R = GF.compute(o);
    const s = R.stacks.find((x) => x.spacers.some((e) => e.tf));
    expect(s).toBeTruthy();
    const m = GF.stackMeshes({ ...s, items: [] }, o), info = GF.stackInfo({ ...s, items: [] }, o);
    expect(info.pla).toBeCloseTo(GF.volume(m.pla), 4);
    for (const e of s.spacers) {
      const [x0, y0, x1, y1] = bbox(GF.spacerPlaced(e)), t = e.sp.type;
      expect(x0).toBeCloseTo(e.x, 6); expect(y0).toBeCloseTo(e.y, 6);
      expect(x1 - x0).toBeCloseTo(e.rot ? t.d : t.w, 6); expect(y1 - y0).toBeCloseTo(e.rot ? t.w : t.d, 6);
    }
  });
});

describe('Mehrfarbig: Leistentürme nicht höher als der Plattenstapel daneben (kleiner Prime-Tower)', () => {
  for (const [w, d, bed] of [[400, 300, 256], [600, 450, 180], [1150, 560, 256], [300, 200, 256]]) {
    it(`${w} × ${d}, Bett ${bed}`, () => {
      const o = { ...BASE, boxW: w, boxD: d, bedX: bed, bedY: bed }, R = GF.compute(o);
      expect(R.error).toBeUndefined();
      for (const s of R.stacks) {
        if (!s.items.length) continue;
        const plates = GF.stackMeshes({ ...s, spacers: [], bridges: [] }, o).height;
        const strips = GF.stackMeshes({ ...s, items: [], bridges: [] }, o).height;
        expect(strips, s.label).toBeLessThanOrEqual(plates + 1e-6);
      }
      // keine Leiste geht verloren
      expect(R.stacks.reduce((a, s) => a + s.spacers.length, 0)).toBe(R.spacers.list.length);
    });
  }
});

describe('Turm-Grenze macht nie ein zusätzliches Leisten-Bett auf', () => {
  it('über viele Schubladen, Drucker und Radien: gleich viele Druckjobs wie ohne Grenze', () => {
    let n = 0, capped = 0;
    for (const w of [300, 350, 400, 452, 523.5, 600]) for (const d of [200, 250, 300, 340, 420]) for (const bed of [180, 235, 256]) for (const r of [0, 15]) {
      const o = { ...BASE, boxW: w, boxD: d, bedX: bed, bedY: 256, bedZ: 256, cornerR: r }, R = GF.compute(o), R0 = GF.compute({ ...o, _noTowerCap: true });
      if (R.error) continue;
      n++;
      expect(R.stacks.length, `${w} × ${d}, Bett ${bed}, Radius ${r}`).toBe(R0.stacks.length);
      expect(R.stacks.reduce((a, s) => a + s.spacers.length, 0)).toBe(R.spacers.list.length);
      const h = (RR) => Math.max(...RR.stacks.map((s) => GF.stackInfo({ ...s, items: [] }, o).height));
      if (h(R) < h(R0) - 1e-6) capped++;
    }
    expect(n).toBeGreaterThan(100);
    expect(capped).toBeGreaterThan(0); // die Grenze greift tatsächlich irgendwo
  });
});

