// Gridfinity-Testbox 1×1 (41,5 × 41,5 mm, Standard-Fuß), passend zur Grundplatte des Planers.
// Aufruf: node scripts/testbox.js [Höheneinheiten=3] -> testdruck/Testbox_1x1_<n>u.(stl|3mf)
import { mkdirSync, writeFileSync } from 'node:fs';
import GF from '../src/gf.js';

const U = +(process.argv[2] || 3);
const S = 41.5, RO = 3.75, ARC = 16, WALL = 1.2, FLOOR = 1.0;
const FOOT = [[0, 2.95], [0.8, 2.15], [2.6, 2.15], [4.75, 0]]; // Standard-Fuß: [z, Einzug vom 41,5er-Umriss]
const HTOP = 7 * U;

const v = [], f = [];
const pt = (p) => (v.push(p[0], p[1], p[2]), v.length / 3 - 1);
// abgerundetes Quadrat (Mitte 0,0), Einzug t, Radius r, Höhe z, gegen den Uhrzeigersinn
function ring(t, z, r) {
  const h = S / 2 - t, out = [];
  const cs = [[h - r, -h + r, -90], [h - r, h - r, 0], [-h + r, h - r, 90], [-h + r, -h + r, 180]];
  for (const [cx, cy, a0] of cs) for (let i = 0; i <= ARC; i++) {
    const a = (a0 + 90 * i / ARC) * Math.PI / 180;
    out.push(pt([cx + r * Math.cos(a), cy + r * Math.sin(a), z]));
  }
  return out;
}
const loft = (A, B, out) => { // A unten, B oben
  for (let i = 0; i < A.length; i++) {
    const j = (i + 1) % A.length;
    if (out) f.push(A[i], A[j], B[j], A[i], B[j], B[i]); else f.push(A[i], B[j], A[j], A[i], B[i], B[j]);
  }
};
const cap = (A, z, up) => { const c = pt([0, 0, z]); for (let i = 0; i < A.length; i++) { const j = (i + 1) % A.length; up ? f.push(c, A[i], A[j]) : f.push(c, A[j], A[i]); } };

const outer = FOOT.map(([z, t]) => ring(t, z, Math.max(0.3, RO - t)));
outer.push(ring(0, HTOP, RO));
for (let k = 0; k < outer.length - 1; k++) loft(outer[k], outer[k + 1], true);
cap(outer[0], 0, false);
const inTop = ring(WALL, HTOP, RO - WALL), inBot = ring(WALL, 4.75 + FLOOR, RO - WALL);
// Oberkante: Ring zwischen außen und innen
const O = outer[outer.length - 1];
for (let i = 0; i < O.length; i++) { const j = (i + 1) % O.length; f.push(O[i], O[j], inTop[j], O[i], inTop[j], inTop[i]); }
loft(inBot, inTop, false);
cap(inBot, 4.75 + FLOOR, true);

const m = { v, f };
const dir = new URL('../testdruck/', import.meta.url); mkdirSync(dir, { recursive: true });
const name = `Testbox_1x1_${U}u`;
writeFileSync(new URL(name + '.stl', dir), GF.stl(m, name));
writeFileSync(new URL(name + '.3mf', dir), GF.threeMF([{ name, mesh: m, extruder: 1 }], name));
console.log(`${name}: ${S} × ${S} × ${HTOP} mm, ${(GF.volume(m) * 1.24).toFixed(1)} g PLA`);
