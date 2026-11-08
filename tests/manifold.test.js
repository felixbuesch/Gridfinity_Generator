// Prüft mit manifold-3d, dass jedes erzeugte Netz geschlossen und mannigfaltig ist:
// Plattentypen, Leistentypen und pro Druckbett das PLA- und das PETG-Netz,
// für mehrere Boxgrößen, beide Abstandshalter-Modi und alle sepStyle-Varianten.
import { describe, it, expect, beforeAll } from 'vitest';
import Module from 'manifold-3d';
import GF from '../src/gf.js';

const BASE = {
  boxW: 400, boxD: 300, clearance: 1, cornerR: 3, minSpacer: 2, half: false,
  spacers: 'separate', spacerStyle: 'ladder', alignX: 'center', alignY: 'center',
  spacerH: 2.4, rail: 1.2, ribPitch: 40,
  bedX: 235, bedY: 256, bedZ: 256,
  stack: true, sepStyle: 'grow', sepT: 0.6, overhang: 45, maxStack: 8, towerReserve: 40,
};

const BOXES = [
  { boxW: 400, boxD: 300 },
  { boxW: 150, boxD: 100, half: true, cornerR: 5 },
  { boxW: 523.5, boxD: 287.2, half: true, alignX: 'start', alignY: 'end' },
  { boxW: 90, boxD: 300, alignX: 'end', spacerStyle: 'solid' },
  { boxW: 250, boxD: 250, cornerR: 0, minSpacer: 10 },
  { boxW: 400, boxD: 300, maxStack: 30 }, // gedrehte Platten im Stapel
  { boxW: 800, boxD: 500, maxStack: 30, half: true },
];
const SEP_STYLES = ['grow', 'ring', 'wedge', 'sheet'];
const SPACER_MODES = ['separate', 'integrated'];

let wasm;
beforeAll(async () => {
  wasm = await Module();
  wasm.setup();
});

function check(mesh, name) {
  expect(mesh.f.length, `${name}: leeres Netz`).toBeGreaterThan(0);
  const m = new wasm.Mesh({
    numProp: 3,
    vertProperties: Float32Array.from(mesh.v),
    triVerts: Uint32Array.from(mesh.f),
  });
  let man;
  try {
    man = new wasm.Manifold(m);
  } catch (e) {
    throw new Error(`${name}: nicht mannigfaltig (${e.message || e})`);
  }
  expect(man.status().value, `${name}: Status`).toBe(0); // 0 = NoError
  expect(man.isEmpty(), `${name}: leer`).toBe(false);
  // Netz-Volumen (eigene Formel) muss zu manifold passen und positiv sein (Normalen nach außen)
  const vol = GF.volume(mesh) * 1000;
  expect(vol, `${name}: Volumen`).toBeGreaterThan(0);
  expect(Math.abs(man.volume() - vol) / vol, `${name}: Volumen weicht ab`).toBeLessThan(1e-3);
  man.delete();
}

const cases = [];
for (const box of BOXES) for (const spacers of SPACER_MODES) for (const sepStyle of SEP_STYLES) {
  cases.push({ ...BASE, ...box, spacers, sepStyle });
}

describe.each(cases)('Box $boxW × $boxD, $spacers, $sepStyle', (o) => {
  it('alle Netze sind geschlossen', () => {
    const R = GF.compute(o);
    expect(R.error).toBeUndefined();
    R.types.forEach((t) => check(GF.plateMesh(t), `Platte ${t.label}`));
    R.spacers.types.forEach((t) => check(GF.spacerMesh(t), `Leiste ${t.label}`));
    R.stacks.forEach((s) => {
      const m = GF.stackMeshes(s, o);
      check(m.pla, `${s.label} PLA`);
      const stacked = s.items.length > 1 || s.spacers.some((e) => e.level > 0);
      if (stacked) check(m.petg, `${s.label} PETG`);
      else expect(m.petg.f.length).toBe(0);
      expect(m.height).toBeLessThanOrEqual(o.bedZ + 1e-6);
    });
  });
});

describe('Layout', () => {
  it('jedes Druckbett passt aufs Bett (inkl. Prime-Tower-Reserve)', () => {
    for (const box of BOXES) {
      const o = { ...BASE, ...box };
      const R = GF.compute(o);
      for (const s of R.stacks) {
        const bx = s.bed.w, by = s.bed.d;
        for (const it of s.items) {
          expect(it.p.w + it.dx).toBeLessThanOrEqual(bx + 1e-6);
          expect(it.p.d + it.dy).toBeLessThanOrEqual(by + 1e-6);
        }
        expect(Math.min(bx, by)).toBeLessThanOrEqual(Math.min(o.bedX - o.towerReserve, o.bedY) + 1e-6);
      }
    }
  });

  it('"Aus Stegspitze": Stapelabstand = H + 2,85/tan(45°) + Basisschicht', () => {
    const R = GF.compute(BASE);
    const s = R.stacks.find((st) => st.items.length > 1);
    expect(s).toBeTruthy();
    const m = GF.stackMeshes(s, BASE);
    const n = s.items.length;
    expect(m.height).toBeCloseTo(n * GF.H + (n - 1) * (2.85 + 0.6), 6);
  });

  it('Gegenprobe: ein Netz mit Loch wird erkannt', () => {
    const m = GF.plateMesh(GF.compute(BASE).types[0]);
    m.f.splice(0, 3); // ein Dreieck entfernen
    expect(() => check(m, 'kaputt')).toThrow();
  });

  it('Box zu klein liefert Fehlermeldung', () => {
    expect(GF.compute({ ...BASE, boxW: 30 }).error).toMatch(/zu klein/);
  });
});
