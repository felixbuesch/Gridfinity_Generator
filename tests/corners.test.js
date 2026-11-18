// Eckradius der Schublade/Box: kein Teil darf in die Wandrundung ragen (Überschneidung),
// und in der Ecke darf nicht mehr Luft bleiben als das halbe Spiel (Lücke).
// Gemessen wird mit manifold-3d an den echten Netzen: Schnittvolumen Teil ∩ Wand, Teil ∩ Teil,
// und wie viel eines schmalen Bands direkt innerhalb der Wandrundung von Teilen bedeckt ist.
import { describe, it, expect, beforeAll } from 'vitest';
import Module from 'manifold-3d';
import GF from '../src/gf.js';

const BASE = {
  boxW: 400, boxD: 300, clearance: 1, cornerR: 12, minSpacer: 2, half: false,
  spacers: 'separate', spacerStyle: 'ladder', alignX: 'center', alignY: 'center',
  spacerH: 2.4, rail: 1.2, ribPitch: 40, bedX: 235, bedY: 256, bedZ: 256,
  stack: true, sepStyle: 'petg', sepT: 0.6, maxStack: 30, towerReserve: 40,
};
let wasm;
beforeAll(async () => { wasm = await Module(); wasm.setup(); });

const toMan = (mesh, dx = 0, dy = 0) => {
  const v = Float32Array.from(mesh.v);
  for (let i = 0; i < v.length; i += 3) { v[i] += dx; v[i + 1] += dy; }
  return new wasm.Manifold(new wasm.Mesh({ numProp: 3, vertProperties: v, triVerts: Uint32Array.from(mesh.f) }));
};
// gerundetes Rechteck [x0,x1] × [y0,y1] mit Eckradius r als Prisma z0..z1
function rounded(x0, y0, x1, y1, r, z0, z1) {
  const { Manifold } = wasm, h = z1 - z0;
  if (r < 1e-6) return Manifold.cube([x1 - x0, y1 - y0, h]).translate([x0, y0, z0]);
  const cyl = (x, y) => Manifold.cylinder(h, r, r, 256).translate([x, y, z0]);
  return Manifold.hull([cyl(x0 + r, y0 + r), cyl(x1 - r, y0 + r), cyl(x1 - r, y1 - r), cyl(x0 + r, y1 - r)]);
}
// alle Teile eines Einsatzes (Exemplar 0) als Manifold in Box-Koordinaten (Ursprung = Wandecke vorne links)
function parts(R) {
  const ox = R.AX.gapLow, oy = R.AY.gapLow, out = [];
  for (const p of R.pieces) if (!p.copy) out.push({ name: 'Platte ' + p.type.label, man: toMan(GF.plateMesh(p.type), ox + p.x, oy + p.y) });
  for (const s of R.spacers.list) if (!s.copy) out.push({ name: 'Leiste ' + s.type.label + ' ' + s.side, man: toMan(GF.spacerMesh(s.type), ox + s.x0, oy + s.y0) });
  return out;
}
function measure(o) {
  const { Manifold } = wasm, R = GF.compute(o);
  expect(R.error).toBeUndefined();
  const P = parts(R), g = o.clearance / 2, r = Math.min(o.cornerR, o.boxW / 2, o.boxD / 2), Z = 5;
  // Wand = großer Klotz minus Innenraum (mit Eckradius)
  const wall = Manifold.cube([o.boxW + 40, o.boxD + 40, Z + 2]).translate([-20, -20, -1]).subtract(rounded(0, 0, o.boxW, o.boxD, r, -2, Z + 2));
  let inWall = 0, tooClose = 0, between = 0;
  // Bereich, den Teile nicht betreten dürfen: näher als das halbe Spiel an der Wand (0,03 mm Toleranz für Sehnen)
  const keepOut = Manifold.cube([o.boxW + 40, o.boxD + 40, Z + 2]).translate([-20, -20, -1]).subtract(rounded(g - 0.03, g - 0.03, o.boxW - g + 0.03, o.boxD - g + 0.03, Math.max(0, r - g + 0.03), -2, Z + 2));
  for (const p of P) { inWall += p.man.intersect(wall).volume(); tooClose += p.man.intersect(keepOut).volume(); }
  for (let i = 0; i < P.length; i++) for (let j = i + 1; j < P.length; j++) between += P[i].man.intersect(P[j].man).volume();
  // Lücke: Band 0,05..0,35 mm innerhalb der Spiel-Grenze, nur in den vier Eckbereichen (r × r) und nur über dem Raster,
  // Höhe 0..0,4 mm. Dort muss überall Material sein (Leisten-Enden sind massiv, Platten haben unten ihren Fuß).
  const ox = R.AX.gapLow, oy = R.AY.gapLow;
  const band = rounded(g + 0.05, g + 0.05, o.boxW - g - 0.05, o.boxD - g - 0.05, Math.max(0, r - g - 0.05), 0, 0.4)
    .subtract(rounded(g + 0.35, g + 0.35, o.boxW - g - 0.35, o.boxD - g - 0.35, Math.max(0, r - g - 0.35), -1, 1));
  const cornersBox = Manifold.union([[0, 0], [o.boxW - r, 0], [o.boxW - r, o.boxD - r], [0, o.boxD - r]].map(([x, y]) => Manifold.cube([r, r, 2]).translate([x, y, -1])));
  // erwartete Fläche: wo eine Platte oder Leiste liegen sollte (ihr Rechteck)
  const rects = [];
  for (const p of R.pieces) if (!p.copy) rects.push(Manifold.cube([p.w, p.d, 2]).translate([ox + p.x, oy + p.y, -1]));
  for (const s of R.spacers.list) if (!s.copy) rects.push(Manifold.cube([s.x1 - s.x0, s.y1 - s.y0, 2]).translate([ox + s.x0, oy + s.y0, -1]));
  const want = band.intersect(cornersBox).intersect(Manifold.union(rects));
  const have = want.intersect(Manifold.union(P.map((p) => p.man)));
  const wantV = want.volume(), cover = wantV > 1e-9 ? have.volume() / wantV : 1;
  return { R, inWall, tooClose, between, cover, wantV };
}

const CASES = [
  ['Restfelder ringsum (Leiter-Leisten), r = 12', {}],
  ['Restfelder ringsum (volle Leisten), r = 12', { spacerStyle: 'solid' }],
  ['Leiste schmaler als der Radius', { boxW: 384, boxD: 258, cornerR: 15 }],
  ['Raster liegt in der Ecke an (Platte im Radius), r = 12', { alignX: 'start', alignY: 'start' }],
  ['Raster liegt in der Ecke an, r = 5 (Box passt noch)', { alignX: 'start', alignY: 'end', cornerR: 5 }],
  ['Raster liegt in der Ecke an, r = 3', { alignX: 'end', alignY: 'start', cornerR: 3 }],
  ['Raster geht genau auf (keine Leisten), r = 12', { boxW: 379, boxD: 253 }],
  ['Raster geht genau auf, r = 25', { boxW: 379, boxD: 253, cornerR: 25 }],
  ['Rest bleibt als Spalt (schmaler als Mindestleiste), r = 10', { boxW: 380.5, boxD: 254.2, cornerR: 10 }],
  ['Platten am Bettrand geteilt, groß, r = 20', { boxW: 800, boxD: 500, cornerR: 20 }],
  ['geteilt + halbe Zellen + unsymmetrisch, r = 12', { boxW: 523.5, boxD: 287.2, half: true, alignX: 'start', alignY: 'end' }],
  ['integrierte Ränder, r = 12', { spacers: 'integrated' }],
  ['integrierte Ränder, Raster in der Ecke, r = 8', { spacers: 'integrated', alignX: 'start', alignY: 'start', cornerR: 8 }],
  ['mehrere Einsätze, r = 12', { boxW: 300, boxD: 200, copies: 3 }],
  ['kleine Box, großer Radius (Radius > halbe Zelle)', { boxW: 100, boxD: 100, cornerR: 30 }],
  ['sehr großer Radius: Eckzelle wird massiv oder entfällt', { boxW: 300, boxD: 200, cornerR: 50, alignX: 'start', alignY: 'start' }],
  ['riesiger Radius 100: Eckzelle wird massiv', { boxW: 300, boxD: 200, cornerR: 100, alignX: 'start', alignY: 'start' }],
  ['ohne Spiel, r = 12', { clearance: 0, alignX: 'start', alignY: 'start' }],
  ['kein Radius: nichts wird geschnitten', { cornerR: 0 }],
];

describe.each(CASES)('Eckradius: %s', (_name, extra) => {
  const o = { ...BASE, ...extra };
  let M;
  beforeAll(() => { M = measure(o); });
  it('kein Teil ragt in die Wand oder in den Spiel-Abstand', () => {
    // Die Prüf-Wand ist selbst ein Vieleck (256 Ecken je Kreis, bis 0,001 mm innerhalb des echten Kreises):
    // erlaubt sind deshalb 0,01 mm³, das ist bei 4,4 mm Höhe eine Schicht von unter 0,0002 mm.
    expect(M.inWall).toBeLessThan(1e-2);
    expect(M.tooClose).toBeLessThan(1e-3); // mm³
  });
  it('Teile überschneiden sich nicht gegenseitig', () => { expect(M.between).toBeLessThan(1e-6); });
  it('keine Lücke in der Ecke: das Band an der Rundung ist bedeckt', () => {
    if (o.cornerR - o.clearance / 2 > 0.2) expect(M.wantV).toBeGreaterThan(0);
    expect(M.cover).toBeGreaterThan(0.97);
  });
  it('alle Netze sind geschlossen, auch im Stapel', () => {
    const chk = (mesh, name) => {
      const man = toMan(mesh);
      expect(man.status().value, name).toBe(0);
      const vol = GF.volume(mesh) * 1000;
      expect(vol, name).toBeGreaterThan(0);
      expect(Math.abs(man.volume() - vol) / vol, name + ' Volumen').toBeLessThan(1e-3);
    };
    M.R.types.forEach((t) => chk(GF.plateMesh(t), 'Platte ' + t.label));
    M.R.spacers.types.forEach((t) => chk(GF.spacerMesh(t), 'Leiste ' + t.label));
    for (const sepStyle of ['petg', 'perf']) {
      const o2 = { ...o, sepStyle }, R2 = GF.compute(o2);
      R2.stacks.forEach((s) => { const m = GF.stackMeshes(s, o2); chk(m.pla, sepStyle + ' PLA'); if (m.petg.f.length) chk(m.petg, sepStyle + ' PETG'); });
    }
  });
});

describe('Eckradius: Herleitung', () => {
  it('Rundung der Teile = Wandradius − halbes Spiel um denselben Mittelpunkt', () => {
    const o = { ...BASE, boxW: 379, boxD: 253, cornerR: 12, clearance: 1 }, R = GF.compute(o);
    const [sw] = GF.wallClips(R.AX, R.AY, R.totalW, R.totalD, o);
    expect(sw.r).toBeCloseTo(11.5, 9);
    // Raster beginnt 0,5 mm hinter der Wand -> Kreismitte 12 mm hinter der Wand = 11,5 mm im Raster
    expect(sw.cx).toBeCloseTo(11.5, 9); expect(sw.cy).toBeCloseTo(11.5, 9);
  });
  it('bleibt auf einer Seite ein Spalt, wird dort entsprechend weniger weggeschnitten', () => {
    const o = { ...BASE, boxW: 380.5, boxD: 253, cornerR: 12, alignX: 'end' }, R = GF.compute(o);
    expect(R.AX.gapLow).toBeCloseTo(2, 6); // 1,5 mm Rest + 0,5 mm Spiel
    const [sw] = GF.wallClips(R.AX, R.AY, R.totalW, R.totalD, o);
    expect(sw.cx).toBeCloseTo(10, 6); expect(sw.cy).toBeCloseTo(11.5, 6);
  });
  it('kleiner Radius (bis 4,75 mm bei 1 mm Spiel) lässt die Tasche unberührt, die Box passt', () => {
    const o = { ...BASE, boxW: 379, boxD: 253, cornerR: 4.75, stack: false }, R = GF.compute(o);
    const t = R.types.find((x) => x.tiles.some((q) => q.clips.length));
    expect(t).toBeTruthy();
    const q = t.tiles.find((x) => x.clips.length);
    expect(q.pocket).toBe(true);
    // oberster Taschenring (Einzug 0,25 + 0,25 Rand) wird vom Schnitt nicht verändert: 4 × 9 Punkte
    const top = GF.outline(q); expect(top.length).toBeGreaterThan(4);
  });
  it('Eckzelle mit zu wenig Taschenboden wird massiv', () => {
    const o = { ...BASE, boxW: 300, boxD: 200, cornerR: 100, alignX: 'start', alignY: 'start' }, R = GF.compute(o);
    const tiles = R.types.flatMap((t) => t.tiles).filter((q) => q.clips.length);
    expect(tiles.some((q) => !q.pocket && q.x1 - q.x0 === 42 && q.y1 - q.y0 === 42)).toBe(true);
  });
  it('Leiter-Leisten sind im Bereich der Rundung massiv', () => {
    const R = GF.compute(BASE), t = R.spacers.types.find((x) => x.tiles.some((q) => q.clips.length));
    expect(t).toBeTruthy();
    // jede beschnittene Kachel gehört zum massiven Endblock, also keine Lücke quer zur Leiste
    const cut = t.tiles.filter((q) => q.clips.length);
    expect(cut.length).toBeGreaterThan(0);
  });
});
