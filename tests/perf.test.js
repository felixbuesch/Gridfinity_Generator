// „Ein Material, Perforation“: Stapel ganz aus PLA, Platten abwechselnd kopfüber mit Luftspalt,
// dazwischen nur Punkte als Sollbruchstellen. Geprüft: kein PETG, Höhen, geschlossene Netze,
// jeder Punkt steht unten auf Material und trägt oben Material, Einstellwerte wirken.
import { describe, it, expect, beforeAll } from 'vitest';
import Module from 'manifold-3d';
import GF from '../src/gf.js';

const BASE = {
  boxW: 400, boxD: 300, clearance: 1, cornerR: 3, minSpacer: 2, half: false,
  spacers: 'separate', spacerStyle: 'ladder', alignX: 'center', alignY: 'center',
  spacerH: 2.4, rail: 1.2, ribPitch: 40, bedX: 235, bedY: 256, bedZ: 256,
  stack: true, sepStyle: 'perf', sepT: 0.6, overhang: 45, maxStack: 30, towerReserve: 40,
};
let wasm;
beforeAll(async () => { wasm = await Module(); wasm.setup(); });
const toMan = (mesh) => new wasm.Manifold(new wasm.Mesh({ numProp: 3, vertProperties: Float32Array.from(mesh.v), triVerts: Uint32Array.from(mesh.f) }));
const chk = (mesh, name) => {
  const man = toMan(mesh);
  expect(man.status().value, name).toBe(0);
  const vol = GF.volume(mesh) * 1000;
  expect(vol, name).toBeGreaterThan(0);
  expect(Math.abs(man.volume() - vol) / vol, name + ': Volumen').toBeLessThan(1e-3);
  return man;
};
// Anteil der Punkte, bei denen direkt unter und direkt über dem Punkt Material ist (Würfel 0,1 mm an der Punktmitte)
function supported(pla, dots) {
  const { Manifold } = wasm, s = 0.1;
  const cubes = (dz) => Manifold.compose(dots.map(([x, y, z0, z1]) => Manifold.cube([s, s, s]).translate([x - s / 2, y - s / 2, dz < 0 ? z0 - s : z1])));
  const full = dots.length * s * s * s;
  return [cubes(-1).intersect(pla).volume() / full, cubes(1).intersect(pla).volume() / full];
}

const CASES = [
  ['Standard 400 × 300', {}],
  ['groß, geteilt 800 × 500', { boxW: 800, boxD: 500 }],
  ['halbe Zellen, unsymmetrisch', { boxW: 523.5, boxD: 287.2, half: true, alignX: 'start', alignY: 'end' }],
  ['Eckradius 12, Raster in der Ecke', { cornerR: 12, alignX: 'start', alignY: 'start' }],
  ['integrierte Ränder', { boxW: 523.5, boxD: 287.2, spacers: 'integrated' }],
  ['mit Zapfen', { boxW: 600, boxD: 450, connect: 'tabs' }],
  ['mit Brücken', { boxW: 600, boxD: 450, connect: 'bridges' }],
  ['mehrere Einsätze', { copies: 3 }],
  ['volle Leisten', { spacerStyle: 'solid' }],
];

describe.each(CASES)('Perforation: %s', (_n, extra) => {
  const o = { ...BASE, ...extra }, R = GF.compute(o);
  const P = GF.perfOpt(o);

  it('rechnet, stapelt abwechselnd kopfüber, ganz ohne PETG', () => {
    expect(R.error).toBeUndefined();
    expect(R.stacks.some((s) => s.items.length > 1)).toBe(true);
    for (const s of R.stacks) {
      s.items.forEach((it, k) => expect(!!it.flip).toBe(k % 2 === 1));
      const m = GF.stackMeshes(s, o);
      expect(m.petg.f.length).toBe(0);
      expect(GF.stackInfo(s, o).petg).toBe(0);
    }
  });

  it('Stapelhöhe = n × 4,4 + (n − 1) × Z-Abstand, passt in die Druckhöhe', () => {
    for (const s of R.stacks) {
      const n = s.items.length; if (!n) continue;
      const m = GF.stackMeshes({ ...s, spacers: [], bridges: [] }, o);
      expect(m.height).toBeCloseTo(n * GF.H + (n - 1) * P.gap, 9);
      expect(GF.stackMeshes(s, o).height).toBeLessThanOrEqual(o.bedZ + 1e-9);
    }
  });

  it('Netze geschlossen; Punkte durchdringen keine Platte; jeder Punkt hat unten und oben Material', () => {
    for (const s of R.stacks) {
      const m = GF.stackMeshes(s, o), dots = GF.perfList(s, o);
      const pla = chk(m.pla, s.label + ' PLA');
      if (!dots.length) { expect(m.perf.f.length).toBe(0); continue; }
      const perf = chk(m.perf, s.label + ' Punkte');
      expect(perf.intersect(pla).volume()).toBeLessThan(1e-6);
      const [below, above] = supported(pla, dots);
      expect(below, 'unten').toBeGreaterThan(0.999);
      expect(above, 'oben').toBeGreaterThan(0.999);
      // jede Fuge zwischen zwei Platten hat Punkte
      const per = GF.H + P.gap;
      for (let k = 1; k < s.items.length; k++) expect(dots.some((d) => Math.abs(d[2] - ((k - 1) * per + GF.H)) < 1e-9 && Math.abs(d[3] - k * per) < 1e-9), 'Fuge ' + k).toBe(true);
    }
  });

  it('stackInfo passt zu den echten Netzen (PLA, Punkte, Höhe)', () => {
    for (const s of R.stacks) {
      const m = GF.stackMeshes(s, o), i = GF.stackInfo(s, o);
      expect(i.pla).toBeCloseTo(GF.volume(m.pla), 6);
      expect(i.perf).toBeCloseTo(m.perf.f.length ? GF.volume(m.perf) : 0, 6);
      expect(i.height).toBeCloseTo(m.height, 9);
    }
  });
});

describe('Perforation: Einstellwerte', () => {
  const o = { ...BASE }, R = GF.compute(o), s = R.stacks.find((x) => x.items.length > 1);
  const count = (x) => GF.perfList(GF.compute({ ...o, ...x }).stacks.find((q) => q.items.length > 1), { ...o, ...x }).length;

  it('Standardwerte: 0,4 mm Z-Abstand, 0,8 mm Punkte, 6 mm Abstand', () => {
    expect(GF.perfOpt({})).toEqual({ gap: 0.4, dot: 0.8, pitch: 6 });
    // Z-Abstand und Plattenhöhe sind Vielfache von 0,2 mm Schichthöhe
    expect(Math.abs(GF.H / 0.2 - Math.round(GF.H / 0.2))).toBeLessThan(1e-9);
    expect(Math.abs(GF.PERF.gap / 0.2 - Math.round(GF.PERF.gap / 0.2))).toBeLessThan(1e-9);
  });
  it('kleinerer Punktabstand gibt mehr Punkte, größerer weniger', () => {
    const a = count({ perfPitch: 4 }), b = count({ perfPitch: 6 }), c = count({ perfPitch: 12 });
    expect(a).toBeGreaterThan(b); expect(b).toBeGreaterThan(c); expect(c).toBeGreaterThan(0);
  });
  it('Punktabstand wird je Zelle gleichmäßig geteilt: höchstens der eingestellte Abstand × 1,5', () => {
    for (const pitch of [4, 6, 9, 12]) {
      const d = GF.perfList(s, { ...o, perfPitch: pitch }).filter((q) => Math.abs(q[2] - GF.H) < 1e-9); // erste Fuge (Steg auf Steg)
      // Punkte auf einer inneren Zelllinie y = 42 (im Plattenbereich)
      const it0 = s.items[1], row = d.filter((q) => Math.abs(q[1] - it0.dy - 42) < 1e-6).map((q) => q[0]).sort((a, b) => a - b);
      expect(row.length).toBeGreaterThan(2);
      const gaps = row.slice(1).map((x, i) => x - row[i]);
      expect(Math.max(...gaps)).toBeLessThanOrEqual(pitch * 1.5 + 1e-6);
      expect(Math.min(...gaps)).toBeGreaterThan(pitch * 0.6);
    }
  });
  it('Durchmesser und Z-Abstand bestimmen das Punktvolumen und die Höhe', () => {
    const i1 = GF.stackInfo(s, o), o2 = { ...o, perfDot: 1.6, perfGap: 0.6 }, s2 = GF.compute(o2).stacks.find((x) => x.items.length > 1), i2 = GF.stackInfo(s2, o2);
    expect(i2.perf / i2.dots / (i1.perf / i1.dots)).toBeCloseTo(4 * 1.5, 6);
    const n = s2.items.length;
    expect(GF.stackMeshes({ ...s2, spacers: [] }, o2).height).toBeCloseTo(n * GF.H + (n - 1) * 0.6, 9);
  });
  it('kein Prime-Tower: das ganze Bett wird genutzt', () => {
    expect(GF.twoMaterials(o)).toBe(false);
    expect(GF.twoMaterials({ ...o, sepStyle: 'flip' })).toBe(true);
    const big = GF.compute({ ...o, boxW: 800, boxD: 500 });
    expect(Math.max(...big.stacks.map((x) => Math.min(x.bed.w, x.bed.d)))).toBeCloseTo(Math.min(o.bedX, o.bedY), 6);
  });
  it('Leisten-Türme: Punkte zwischen den Leisten, Leisten behalten ihre Höhe', () => {
    for (const t of R.spacers.types) expect(t.h).toBeCloseTo(o.spacerH, 9);
    const st = R.stacks.find((x) => x.spacers.some((e) => e.level > 0));
    expect(st).toBeTruthy();
    const d = GF.perfList({ ...st, items: [] }, o);
    expect(d.length).toBeGreaterThan(0);
    const perS = o.spacerH + GF.PERF.gap;
    for (const q of d) { const lv = Math.round(q[3] / perS); expect(q[3]).toBeCloseTo(lv * perS, 9); expect(q[2]).toBeCloseTo((lv - 1) * perS + o.spacerH, 9); }
    const m = GF.stackMeshes({ ...st, items: [] }, o);
    const [below, above] = supported(chk(m.pla, 'Leisten'), d);
    expect(below).toBeGreaterThan(0.999); expect(above).toBeGreaterThan(0.999);
  });
  it('keine Punkte über Verbindungstaschen', () => {
    const o2 = { ...o, boxW: 600, boxD: 450, connect: 'bridges' }, R2 = GF.compute(o2);
    let n = 0;
    for (const st of R2.stacks) {
      const tiles = st.items.map((it) => GF.itemTiles(it));
      for (const [x, y, z0] of GF.perfList({ ...st, spacers: [] }, o2)) {
        const lv = Math.round((z0 - GF.H) / (GF.H + GF.PERF.gap));
        for (const T of [tiles[lv], tiles[lv + 1]]) for (const t of T) {
          if (!t.feat || x < t.x0 || x > t.x1 || y < t.y0 || y > t.y1) continue;
          t.feat.forEach((k, sd) => {
            if (k !== 2) return; n++;
            const mid = sd % 2 === 0 ? (t.x0 + t.x1) / 2 : (t.y0 + t.y1) / 2, u = sd % 2 === 0 ? x : y, v = [y - t.y0, t.x1 - x, t.y1 - y, x - t.x0][sd];
            expect(v < 1.35 + 0.4 && Math.abs(u - mid) < 3 + 1.35 + 0.4, `Punkt ${x},${y}`).toBe(false);
          });
        }
      }
    }
    expect(n).toBeGreaterThan(0);
  });
  it('STL-Netz für den Export: Platten + Punkte ohne verschmolzene Ecken', () => {
    const m = GF.stackMeshes(s, o), all = GF.concat(m.pla, m.perf);
    expect(all.f.length).toBe(m.pla.f.length + m.perf.f.length);
    expect(GF.volume(all)).toBeCloseTo(GF.volume(m.pla) + GF.volume(m.perf), 9);
    chk(all, 'PLA + Punkte');
  });
});

describe('ohne Perforation bleibt alles wie bisher', () => {
  it.each(['grow', 'flip', 'ring', 'wedge', 'sheet'])('%s: keine Punkte, Prime-Tower-Reserve bleibt', (sepStyle) => {
    const o = { ...BASE, sepStyle }, R = GF.compute(o);
    for (const s of R.stacks) { expect(GF.stackMeshes(s, o).perf.f.length).toBe(0); expect(GF.perfList(s, o)).toHaveLength(0); expect(GF.stackInfo(s, o).perf).toBe(0); }
    expect(Math.min(R.stacks[0].bed.w, R.stacks[0].bed.d)).toBeLessThanOrEqual(o.bedX - o.towerReserve + 1e-6);
  });
});
