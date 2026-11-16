// Prüfung vor dem ersten echten Testdruck: Dinge, die erst im Slicer oder auf dem Drucker auffallen würden.
import { describe, it, expect, beforeAll } from 'vitest';
import Module from 'manifold-3d';
import GF from '../src/gf.js';
import { clean, defaults } from '../src/planer/opts.ts';
import { plan, filesFor } from '../src/planer/core.js';

const B = {
  boxW: 400, boxD: 300, clearance: 1, cornerR: 3, minSpacer: 2, half: false, spacers: 'separate', spacerStyle: 'ladder',
  alignX: 'center', alignY: 'center', spacerH: 2.4, rail: 1.2, ribPitch: 40, bedX: 235, bedY: 256, bedZ: 256,
  stack: true, sepStyle: 'grow', sepT: 0.6, overhang: 45, maxStack: 30, towerReserve: 40,
};
const LAYER = 0.2;
let wasm;
beforeAll(async () => { wasm = await Module(); wasm.setup(); });
const man = (m) => new wasm.Manifold(new wasm.Mesh({ numProp: 3, vertProperties: Float32Array.from(m.v), triVerts: Uint32Array.from(m.f) }));
// Höhen aller waagrechten Flächen (mit nennenswerter Größe)
function flatLevels(m) {
  const s = new Map();
  for (let k = 0; k < m.f.length; k += 3) {
    const p = [0, 1, 2].map((q) => [m.v[3 * m.f[k + q]], m.v[3 * m.f[k + q] + 1], m.v[3 * m.f[k + q] + 2]]);
    if (Math.abs(p[0][2] - p[1][2]) > 1e-9 || Math.abs(p[0][2] - p[2][2]) > 1e-9) continue;
    const z = +p[0][2].toFixed(4);
    s.set(z, (s.get(z) || 0) + Math.abs((p[1][0] - p[0][0]) * (p[2][1] - p[0][1]) - (p[2][0] - p[0][0]) * (p[1][1] - p[0][1])) / 2);
  }
  return [...s].filter(([, a]) => a > 0.05).map(([z]) => z);
}
const STYLES = ['grow', 'flip', 'perf', 'ring', 'wedge', 'sheet'];
const VARIANTS = [{}, { connect: 'tabs', boxW: 600, boxD: 450 }, { connect: 'bridges', boxW: 600, boxD: 450 }, { cornerR: 12, alignX: 'start', alignY: 'start' }, { spacers: 'integrated', boxW: 523.5, boxD: 287.2 }];

describe.each(STYLES)('Stapel %s', (sepStyle) => {
  it.each(VARIANTS)('%o: Schichtraster, Materialtrennung, Auflage', (x) => {
    const o = { ...B, ...x, sepStyle }, R = GF.compute(o);
    expect(R.error).toBeUndefined();
    for (const s of R.stacks) {
      const m = GF.stackMeshes(s, o);
      // 1. jede waagrechte Fläche liegt auf einer Schichtgrenze (0,2 mm): sonst rundet der Slicer Höhen und Spalte
      for (const mesh of [m.pla, m.petg, m.perf]) for (const z of flatLevels(mesh)) expect(Math.abs(z / LAYER - Math.round(z / LAYER)), `z = ${z}`).toBeLessThan(1e-6);
      // 2. PLA und PETG durchdringen sich nicht (sonst entscheidet der Slicer, welches Material gewinnt)
      if (m.petg.f.length) expect(man(m.pla).intersect(man(m.petg)).volume()).toBeLessThan(0.01);
      // 3. keine Platte hängt über einer beschnittenen Ecke der Platte darunter frei in der Luft
      const area = (T) => wasm.Manifold.union(T.map((t) => { const O = GF.outline(t), pts = O ? O.map((p) => [p.x, p.y]) : [[t.x0, t.y0], [t.x1, t.y0], [t.x1, t.y1], [t.x0, t.y1]]; return new wasm.CrossSection([pts]).extrude(1); }));
      for (let k = 1; k < s.items.length; k++) expect(area(GF.itemTiles(s.items[k])).subtract(area(GF.itemTiles(s.items[k - 1]))).volume(), `Platte ${k + 1} über ${k}`).toBeLessThan(0.5);
      // 4. Stapel beginnt auf dem Bett und passt in die Höhe
      let zmin = Infinity; for (let i = 2; i < m.pla.v.length; i += 3) zmin = Math.min(zmin, m.pla.v[i]);
      expect(zmin).toBeCloseTo(0, 9); expect(m.height).toBeLessThanOrEqual(o.bedZ + 1e-9);
    }
  });
});

describe('Maße der Verbindungen und der Perforation liegen auf Schichtgrenzen', () => {
  it('Plattenhöhe, Zapfen, Tasche, Luftspalt', () => {
    for (const v of [GF.H, GF.CONN.height, GF.CONN.pocketH, GF.PERF.gap, GF.CONN.pocketH - GF.CONN.height]) expect(Math.abs(v / LAYER - Math.round(v / LAYER))).toBeLessThan(1e-9);
    expect(GF.CONN.pocketH - GF.CONN.height).toBeGreaterThanOrEqual(LAYER - 1e-9); // eine Schicht Luft über dem Zapfen
  });
  it('gekappter Zapfen im Stapel ist an der Spitze noch 1 mm dick', () => {
    expect(GF.CONN.height - GF.CONN.depth).toBeGreaterThanOrEqual(1 - 1e-9);
  });
});

describe('Exportdateien', () => {
  const unzip = (u8) => { const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength), dec = new TextDecoder(), out = {}; let p = 0; while (dv.getUint32(p, true) === 0x04034b50) { const size = dv.getUint32(p + 18, true), nl = dv.getUint16(p + 26, true); out[dec.decode(u8.subarray(p + 30, p + 30 + nl))] = dec.decode(u8.subarray(p + 30 + nl, p + 30 + nl + size)); p += 30 + nl + size; } return out; };
  it('Perforation: 3MF hat Platten und Punkte als zwei Teile, beide Filament 1, kein PETG; STL enthält beides', () => {
    const o = clean({ ...defaults(), boxW: 400, boxD: 300, sepStyle: 'perf' }), P = plan(o), files = Object.fromEntries(filesFor(P, 'S:0'));
    expect(Object.keys(files).some((n) => n.endsWith('_PETG.stl'))).toBe(false);
    const z = unzip(files[Object.keys(files).find((n) => n.endsWith('.3mf'))]), cfg = z['Metadata/model_settings.config'];
    const parts = [...cfg.matchAll(/<part id="(\d+)"[\s\S]*?key="name" value="([^"]*)"[\s\S]*?key="extruder" value="(\d+)"/g)].map((x) => [x[2], x[3]]);
    expect(parts).toHaveLength(2); expect(parts.every((q) => q[1] === '1')).toBe(true); expect(parts[1][0]).toMatch(/Perforation/);
    const m = P.mesh('S:0'), stl = files[Object.keys(files).find((n) => n.endsWith('_PLA.stl'))];
    expect(new DataView(stl.buffer).getUint32(80, true)).toBe((m.pla.f.length + m.perf.f.length) / 3);
  });
  it('jede 3MF verweist nur auf vorhandene Punkte (Indizes im Bereich), Dreiecke nicht entartet', () => {
    for (const x of [{ sepStyle: 'flip', connect: 'tabs', boxW: 600, boxD: 450 }, { sepStyle: 'perf', connect: 'bridges', boxW: 600, boxD: 450, printer: 'a1mini' }]) {
      const P = plan(clean({ ...defaults(), ...x }));
      P.R.stacks.forEach((s, i) => {
        const files = Object.fromEntries(filesFor(P, 'S:' + i)), z = unzip(files[Object.keys(files).find((n) => n.endsWith('.3mf'))]);
        for (const obj of z['3D/Objects/object_1.model'].split('<object ').slice(1)) {
          const nv = (obj.match(/<vertex /g) || []).length;
          for (const t of obj.matchAll(/<triangle v1="(\d+)" v2="(\d+)" v3="(\d+)"/g)) { const a = +t[1], b = +t[2], c = +t[3]; if (a >= nv || b >= nv || c >= nv || a === b || b === c || a === c) throw new Error('Dreieck ' + t[0]); }
          expect(nv).toBeGreaterThan(0);
        }
      });
    }
  });
});

describe('Stapelreihenfolge bei Wandrundungen', () => {
  it('kleinere Platte liegt nicht über der beschnittenen Ecke der größeren', () => {
    const o = { ...B, cornerR: 12, alignX: 'start', alignY: 'start', sepStyle: 'flip' }, R = GF.compute(o), s = R.stacks[0];
    expect(s.items[0].p.clips.length).toBeGreaterThan(0);        // unterste Platte hat die Rundung
    expect(s.items.slice(1).some((it) => it.dx > 0 || it.dy > 0)).toBe(true); // eine Platte darüber weicht aus
  });
});
