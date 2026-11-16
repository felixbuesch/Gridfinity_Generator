// Verbindungen zwischen Grundplatten: Zapfen (Schwalbenschwanz an der Platte) und Brücken (Extrateile in Taschen).
// Geprüft wird an den echten Netzen mit manifold-3d: geschlossene Netze, Passung mit Spiel, Verriegelung,
// unveränderte Oberseite, keine Kollision mit Eckradien, Druck ohne Stützen, Platz auf dem Bett.
import { describe, it, expect, beforeAll } from 'vitest';
import Module from 'manifold-3d';
import GF from '../src/gf.js';

const BASE = {
  boxW: 600, boxD: 450, clearance: 1, cornerR: 3, minSpacer: 2, half: false,
  spacers: 'separate', spacerStyle: 'ladder', alignX: 'center', alignY: 'center',
  spacerH: 2.4, rail: 1.2, ribPitch: 40, bedX: 235, bedY: 256, bedZ: 256,
  stack: true, sepStyle: 'grow', sepT: 0.6, overhang: 45, maxStack: 30, towerReserve: 40,
};
const C = GF.CONN;
let wasm;
beforeAll(async () => { wasm = await Module(); wasm.setup(); });
const toMan = (mesh, dx = 0, dy = 0, dz = 0) => {
  const v = Float32Array.from(mesh.v);
  for (let i = 0; i < v.length; i += 3) { v[i] += dx; v[i + 1] += dy; v[i + 2] += dz; }
  return new wasm.Manifold(new wasm.Mesh({ numProp: 3, vertProperties: v, triVerts: Uint32Array.from(mesh.f) }));
};
const chk = (mesh, name) => {
  const man = toMan(mesh);
  expect(man.status().value, name).toBe(0);
  const vol = GF.volume(mesh) * 1000;
  expect(vol, name).toBeGreaterThan(0);
  expect(Math.abs(man.volume() - vol) / vol, name + ': Volumen').toBeLessThan(1e-3);
};
const topVerts = (m) => { const s = []; for (let i = 0; i < m.v.length; i += 3) if (Math.abs(m.v[i + 2] - GF.H) < 1e-9) s.push(m.v[i].toFixed(4) + ',' + m.v[i + 1].toFixed(4)); return s.sort().join(' '); };
const ext = (m) => { let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity; for (let i = 0; i < m.v.length; i += 3) { x0 = Math.min(x0, m.v[i]); x1 = Math.max(x1, m.v[i]); y0 = Math.min(y0, m.v[i + 1]); y1 = Math.max(y1, m.v[i + 1]); } return { x0, x1, y0, y1 }; };
// Platten des ersten Einsatzes an ihrem Platz im Raster
const placedPlates = (R) => R.pieces.filter((p) => !p.copy).map((p) => ({ p, man: toMan(GF.plateMesh(p.type), p.x, p.y) }));
// Nachbarpaare: [links/vorne, rechts/hinten, Richtung]
function pairs(R) {
  const P = R.pieces.filter((p) => !p.copy), out = [];
  for (const a of P) for (const b of P) {
    if (Math.abs(a.x + a.w - b.x) < 1e-6 && a.iy === b.iy) out.push([a, b, [1, 0]]);
    if (Math.abs(a.y + a.d - b.y) < 1e-6 && a.ix === b.ix) out.push([a, b, [0, 1]]);
  }
  return out;
}

describe('ohne Verbindungen bleibt alles wie bisher', () => {
  it.each([undefined, 'none'])('connect = %s: Netze identisch zu vorher, keine Brücken', (connect) => {
    const R0 = GF.compute(BASE), R = GF.compute({ ...BASE, connect });
    expect(R.bridges.count).toBe(0);
    R.types.forEach((t, i) => { const a = GF.plateMesh(t), b = GF.plateMesh(R0.types[i]); expect(a.v).toEqual(b.v); expect(a.f).toEqual(b.f); });
    R.stacks.forEach((s) => expect(s.bridges).toHaveLength(0));
  });
});

describe.each(['tabs', 'bridges'])('Verbindung %s', (connect) => {
  const o = { ...BASE, connect }, R = GF.compute(o), R0 = GF.compute(BASE);

  it('es gibt Stoßkanten mit Verbindungen', () => {
    expect(R.error).toBeUndefined();
    expect(pairs(R).length).toBeGreaterThan(0);
    const kinds = new Set(R.types.flatMap((t) => t.tiles.flatMap((q) => q.feat || [])));
    expect(kinds.has(2)).toBe(true); expect(kinds.has(1)).toBe(connect === 'tabs');
  });

  it('Oberseite bleibt flach auf 4,4 mm und unverändert (gleiche Punkte wie ohne Verbindung), Außenrand 0,5 mm', () => {
    const tv0 = R0.types.map((t) => topVerts(GF.plateMesh(t)));
    for (const t of R.types) {
      const m = GF.plateMesh(t); let zmax = -Infinity;
      for (let i = 2; i < m.v.length; i += 3) zmax = Math.max(zmax, m.v[i]);
      expect(zmax).toBeCloseTo(GF.H, 9);
      expect(tv0).toContain(topVerts(m));
      // nichts von Zapfen oder Tasche liegt höher als die Taschenhöhe
      const P = t.rep;
      for (let i = 0; i < m.v.length; i += 3) if (m.v[i] < -1e-6 || m.v[i] > P.w + 1e-6 || m.v[i + 1] < -1e-6 || m.v[i + 1] > P.d + 1e-6) expect(m.v[i + 2]).toBeLessThanOrEqual(C.height + 1e-9);
    }
  });

  it('alle Netze geschlossen: Einzelteile, Stapel in jeder Trennart, Flachdruck, integrierte Ränder', () => {
    R.types.forEach((t) => chk(GF.plateMesh(t), 'Platte ' + t.label));
    for (const extra of [{}, { sepStyle: 'flip' }, { sepStyle: 'ring' }, { sepStyle: 'wedge' }, { sepStyle: 'sheet' }, { stack: false }, { spacers: 'integrated' }, { spacers: 'integrated', sepStyle: 'flip' }, { boxW: 300, boxD: 200 }, { half: true, boxW: 523.5, boxD: 287.2 }, { copies: 2, boxW: 400, boxD: 300 }]) {
      const o2 = { ...o, ...extra }, R2 = GF.compute(o2);
      expect(R2.error).toBeUndefined();
      R2.stacks.forEach((s) => { const m = GF.stackMeshes(s, o2); chk(m.pla, JSON.stringify(extra) + ' PLA'); if (m.petg.f.length) chk(m.petg, JSON.stringify(extra) + ' PETG'); });
    }
  });

  it('zusammengesetzt überschneiden sich die Platten nicht', () => {
    const P = placedPlates(R); let v = 0;
    for (let i = 0; i < P.length; i++) for (let j = i + 1; j < P.length; j++) v += P[i].man.intersect(P[j].man).volume();
    expect(v).toBeLessThan(1e-6);
  });

  it('stapel- und flachgedruckte Dateien passen aufs Bett', () => {
    for (const extra of [{}, { sepStyle: 'flip' }, { boxW: 300, boxD: 200 }]) {
      const o2 = { ...o, ...extra }, R2 = GF.compute(o2);
      for (const s of R2.stacks) { const e = ext(GF.toBed(GF.stackMeshes(s, o2).pla, s)); expect(e.x1 - e.x0).toBeLessThanOrEqual(o2.bedX + 1e-6); expect(e.y1 - e.y0).toBeLessThanOrEqual(o2.bedY + 1e-6); }
    }
  });

  it('stackInfo passt weiter zu den echten Netzen', () => {
    for (const sepStyle of ['grow', 'flip']) {
      const o2 = { ...o, sepStyle };
      for (const s of GF.compute(o2).stacks) { const m = GF.stackMeshes(s, o2), i = GF.stackInfo(s, o2); expect(i.pla).toBeCloseTo(GF.volume(m.pla), 6); expect(i.petg).toBeCloseTo(m.petg.f.length ? GF.volume(m.petg) : 0, 6); expect(i.height).toBeCloseTo(m.height, 9); }
    }
  });

  it('Eckradius: beschnittene Zellen und ihre Nachbarn bekommen keine Verbindung, nichts überschneidet sich', () => {
    const o2 = { ...o, boxW: 505, boxD: 337, cornerR: 15, alignX: 'start', alignY: 'start' }, R2 = GF.compute(o2);
    expect(R2.error).toBeUndefined();
    for (const t of R2.types) for (const q of t.tiles) if (q.clips.length) expect(GF.plateMesh({ tiles: [q] }).f.length).toBeGreaterThan(0);
    const cut = (x0, y0, x1, y1) => GF.wallClips(R2.AX, R2.AY, R2.totalW, R2.totalD, o2).some((c) => { const sx = c.q === 0 || c.q === 3 ? 1 : -1, sy = c.q < 2 ? 1 : -1, px = sx > 0 ? x0 : x1, py = sy > 0 ? y0 : y1; return sx * (px - c.cx) < 0 && sy * (py - c.cy) < 0 && Math.hypot(px - c.cx, py - c.cy) > c.r; });
    let checked = 0;
    for (const p of R2.pieces) for (const q of p.type.tiles) {
      if (!q.feat || !q.feat.some(Boolean)) continue;
      expect(q.clips.length).toBe(0); checked++;
      // Nachbarzelle gegenüber jeder Verbindung ist nicht beschnitten
      q.feat.forEach((k, s) => { if (!k) return; const w = q.x1 - q.x0, d = q.y1 - q.y0, r = [[q.x0, q.y0 - 21, q.x1, q.y0], [q.x1, q.y0, q.x1 + 21, q.y1], [q.x0, q.y1, q.x1, q.y1 + 21], [q.x0 - 21, q.y0, q.x0, q.y1]][s]; expect(cut(r[0] + p.x, r[1] + p.y, r[2] + p.x, r[3] + p.y), `${w}x${d}`).toBe(false); });
    }
    expect(checked).toBeGreaterThan(0);
    const P = placedPlates(R2); let v = 0;
    for (let i = 0; i < P.length; i++) for (let j = i + 1; j < P.length; j++) v += P[i].man.intersect(P[j].man).volume();
    expect(v).toBeLessThan(1e-6);
    R2.types.forEach((t) => chk(GF.plateMesh(t), 'Platte ' + t.label));
  });
});

describe('Zapfen: Passung und Verriegelung', () => {
  const o = { ...BASE, connect: 'tabs' }, R = GF.compute(o);
  const inter = (a, b, sh) => toMan(GF.plateMesh(a.type), a.x, a.y).intersect(toMan(GF.plateMesh(b.type), b.x + sh[0], b.y + sh[1])).volume();

  it('Standardspiel 0,15 mm je Flanke: knapp darunter verschoben frei, darüber Kollision', () => {
    const [a, b, dir] = pairs(R)[0], along = [dir[1], dir[0]];
    // längs der Stoßkante: Flanke (45°) berührt nach Spiel / cos 45° = 0,212 mm
    expect(inter(a, b, [0, 0])).toBeLessThan(1e-6);
    expect(inter(a, b, along.map((x) => x * 0.2))).toBeLessThan(1e-6);
    expect(inter(a, b, along.map((x) => x * 0.23))).toBeGreaterThan(1e-4);
    expect(inter(a, b, along.map((x) => x * -0.2))).toBeLessThan(1e-6);
    expect(inter(a, b, along.map((x) => x * -0.23))).toBeGreaterThan(1e-4);
  });
  it('verriegelt: Auseinanderziehen quer zur Stoßkante geht nicht', () => {
    for (const [a, b, dir] of pairs(R)) {
      expect(inter(a, b, dir.map((x) => x * 0.2))).toBeLessThan(1e-6);  // Spiel bis zur Flanke
      expect(inter(a, b, dir.map((x) => x * 0.5))).toBeGreaterThan(1e-3); // dann hält der Hinterschnitt
    }
  });
  it('Spiel ist einstellbar', () => {
    const R2 = GF.compute({ ...o, connFit: 0.3 }), [a, b, dir] = pairs(R2)[0], along = [dir[1], dir[0]];
    const it2 = (sh) => toMan(GF.plateMesh(a.type), a.x, a.y).intersect(toMan(GF.plateMesh(b.type), b.x + sh[0], b.y + sh[1])).volume();
    expect(it2(along.map((x) => x * 0.4))).toBeLessThan(1e-6);
    expect(it2(along.map((x) => x * 0.45))).toBeGreaterThan(1e-4);
  });
  it('hinter der Tasche bleiben mindestens 0,8 mm Wand bis zur Zellöffnung', () => {
    expect(2.15 - (C.depth + C.fit)).toBeGreaterThanOrEqual(0.8 - 1e-9);
    expect(C.pocketH).toBeLessThanOrEqual(2.5); // darüber wird der Rand schmaler
  });
  it('druckt ohne Stützen: überstehende Zapfen haben nach unten nur 45°-Flächen, außer direkt auf dem Bett', () => {
    for (const sepStyle of ['grow', 'flip', 'sheet']) {
      const o2 = { ...o, sepStyle }, R2 = GF.compute(o2);
      let flatDown = 0, sloped = 0;
      for (const s of R2.stacks) {
        const m = GF.stackMeshes(s, o2);
        const rects = s.items.map((it) => { const w = it.rot ? it.p.d : it.p.w, d = it.rot ? it.p.w : it.p.d; return [it.dx, it.dy, it.dx + w, it.dy + d]; });
        const lo = Math.min(...rects.map((r) => r[0])), lo2 = Math.min(...rects.map((r) => r[1]));
        const outside = (x, y) => !rects.some((r) => x > r[0] - 1e-6 && x < r[2] + 1e-6 && y > r[1] - 1e-6 && y < r[3] + 1e-6);
        // nur der Bereich direkt um die Platten (Leisten liegen weiter weg)
        const near = (x, y) => rects.some((r) => x > r[0] - C.depth - 1e-3 && x < r[2] + C.depth + 1e-3 && y > r[1] - C.depth - 1e-3 && y < r[3] + C.depth + 1e-3);
        for (const mesh of [m.pla, m.petg]) for (let k = 0; k < mesh.f.length; k += 3) {
          const p = [0, 1, 2].map((q) => [mesh.v[3 * mesh.f[k + q]], mesh.v[3 * mesh.f[k + q] + 1], mesh.v[3 * mesh.f[k + q] + 2]]);
          const cx = (p[0][0] + p[1][0] + p[2][0]) / 3, cy = (p[0][1] + p[1][1] + p[2][1]) / 3;
          if (!outside(cx, cy) || !near(cx, cy)) continue;
          const u = [p[1][0] - p[0][0], p[1][1] - p[0][1], p[1][2] - p[0][2]], w = [p[2][0] - p[0][0], p[2][1] - p[0][1], p[2][2] - p[0][2]];
          const n = [u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]], l = Math.hypot(...n); if (l < 1e-12) continue;
          const nz = n[2] / l, zmin = Math.min(p[0][2], p[1][2], p[2][2]);
          if (nz < -0.75 && zmin > 1e-6) flatDown++;
          if (nz < -0.5 && nz > -0.75) sloped++;
        }
        void lo; void lo2;
      }
      expect(flatDown, sepStyle).toBe(0);
      expect(sloped, sepStyle).toBeGreaterThan(0);
    }
  });
});

describe('Brücken: Extrateile', () => {
  const o = { ...BASE, connect: 'bridges' }, R = GF.compute(o);

  it('Platten behalten ihren Umriss (nichts steht über)', () => {
    for (const t of R.types) { const e = ext(GF.plateMesh(t)); expect(e.x0).toBeCloseTo(0, 9); expect(e.y0).toBeCloseTo(0, 9); expect(e.x1).toBeCloseTo(t.rep.w, 9); expect(e.y1).toBeCloseTo(t.rep.d, 9); }
  });
  it('eine Brücke je Taschenpaar plus Reserve, alle liegen auf einem Druckbett und sind im PLA-Netz', () => {
    const sockets = R.pieces.reduce((a, p) => a + p.type.tiles.reduce((b, q) => b + (q.feat || []).filter((k) => k === 2).length, 0), 0);
    expect(sockets % 2).toBe(0);
    expect(R.bridges.count).toBe(sockets / 2);
    const placed = R.stacks.reduce((a, s) => a + s.bridges.reduce((b, e) => b + e.sp.type.n, 0), 0);
    expect(placed).toBe(R.bridges.count + C.spare);
    const one = GF.volume(GF.bridgeMesh(o.connFit));
    for (const s of R.stacks) {
      const n = s.bridges.reduce((b, e) => b + e.sp.type.n, 0); if (!n) continue;
      const withB = GF.volume(GF.stackMeshes(s, o).pla), without = GF.volume(GF.stackMeshes({ ...s, bridges: [] }, o).pla);
      expect(withB - without).toBeCloseTo(n * one, 6);
      // Brücken liegen auf dem Bett neben den Platten, nicht darunter oder darüber
      for (const e of s.bridges) for (const it of s.items) {
        const w = it.rot ? it.p.d : it.p.w, d = it.rot ? it.p.w : it.p.d, bw = e.rot ? e.sp.type.d : e.sp.type.w, bd = e.rot ? e.sp.type.w : e.sp.type.d;
        expect(e.x >= it.dx + w - 1e-6 || e.y >= it.dy + d - 1e-6 || e.x + bw <= it.dx + 1e-6 || e.y + bd <= it.dy + 1e-6).toBe(true);
      }
    }
    chk(GF.bridgeMesh(o.connFit), 'Brücke');
  });
  it('Brücke passt mit Spiel in beide Taschen und verriegelt', () => {
    const [bw, bd] = GF.bridgeSize(o.connFit), B = GF.bridgeMesh(o.connFit);
    let n = 0;
    for (const [a, b, dir] of pairs(R)) {
      const A = toMan(GF.plateMesh(a.type), a.x, a.y).add(toMan(GF.plateMesh(b.type), b.x, b.y));
      // erste Zelle an der Stoßkante: Mitte der Zelle längs der Kante
      const cells = dir[0] ? a.ay.cells : a.ax.cells, mid = cells[0] / 2;
      const jx = dir[0] ? a.x + a.w : a.x + mid, jy = dir[0] ? a.y + mid : a.y + a.d;
      const feat = a.type.tiles.some((q) => q.feat && q.feat[dir[0] ? 1 : 2] === 2 && (dir[0] ? Math.abs(q.y0) < 1e-6 : Math.abs(q.x0) < 1e-6));
      if (!feat) continue;
      n++;
      // Brückenhals liegt längs x: an senkrechten Stoßkanten ist er richtig, an waagrechten um 90° gedreht
      let br = toMan(B, -bw / 2, -bd / 2);
      if (dir[0]) br = br.rotate([0, 0, 90]);
      const at = (sx, sy) => br.translate([jx + sx, jy + sy, 0]).intersect(A).volume();
      expect(at(0, 0)).toBeLessThan(1e-6);
      const along = [dir[1], dir[0]];
      expect(at(along[0] * 0.2, along[1] * 0.2)).toBeLessThan(1e-6);
      expect(at(along[0] * 0.23, along[1] * 0.23)).toBeGreaterThan(1e-4);
      // Platte b 0,6 mm wegziehen: Brücke (bleibt mittig) hält beide
      const A2 = toMan(GF.plateMesh(a.type), a.x - dir[0] * 0.3, a.y - dir[1] * 0.3).add(toMan(GF.plateMesh(b.type), b.x + dir[0] * 0.3, b.y + dir[1] * 0.3));
      expect(br.translate([jx, jy, 0]).intersect(A2).volume()).toBeGreaterThan(1e-3);
    }
    expect(n).toBeGreaterThan(0);
  });
  it('Brücken sind flach (2,2 mm) und brauchen keine Stützen', () => {
    const m = GF.bridgeMesh(0.15); let zmax = -Infinity;
    for (let i = 2; i < m.v.length; i += 3) zmax = Math.max(zmax, m.v[i]);
    expect(zmax).toBeCloseTo(C.height, 9);
    expect(C.height).toBeLessThan(C.pocketH);
  });
  it('auch flach gedruckt und mit mehreren Einsätzen werden die Brücken mit aufs Bett gelegt', () => {
    for (const extra of [{ boxW: 300, boxD: 200 }, { boxW: 400, boxD: 300, copies: 2 }, { sepStyle: 'flip' }]) {
      const R2 = GF.compute({ ...o, ...extra });
      const placed = R2.stacks.reduce((a, s) => a + s.bridges.reduce((b, e) => b + e.sp.type.n, 0), 0);
      expect(placed).toBe(R2.bridges.count ? R2.bridges.count + C.spare : 0);
    }
  });
});
