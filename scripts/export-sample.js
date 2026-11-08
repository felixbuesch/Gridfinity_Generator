// Schreibt die Dateien des ersten Stapels als Beispiel nach tests/out/ (S1.3mf, S1_PLA.stl, S1_PETG.stl).
// Aufruf: node scripts/export-sample.js [BreiteX] [TiefeY]
import { mkdirSync, writeFileSync } from 'node:fs';
import GF from '../src/gf.js';

const o = {
  boxW: +(process.argv[2] || 400), boxD: +(process.argv[3] || 300), clearance: 1, cornerR: 3, minSpacer: 2, half: false,
  spacers: 'separate', spacerStyle: 'ladder', alignX: 'center', alignY: 'center', spacerH: 2.4, rail: 1.2, ribPitch: 40,
  bedX: 235, bedY: 256, bedZ: 256, stack: true, sepStyle: 'grow', sepT: 0.6, overhang: 45, maxStack: 8, towerReserve: 40,
};
const R = GF.compute(o);
if (R.error) { console.error(R.error); process.exit(1); }
const s = R.stacks[0], m = GF.stackMeshes(s, o), dir = new URL('../tests/out/', import.meta.url);
mkdirSync(dir, { recursive: true });
writeFileSync(new URL('S1_PLA.stl', dir), GF.stl(m.pla, 'S1 PLA'));
writeFileSync(new URL('S1_PETG.stl', dir), GF.stl(m.petg, 'S1 PETG'));
writeFileSync(new URL('S1.3mf', dir), GF.threeMF([
  { name: 'S1 PLA Platten', mesh: m.pla, extruder: 1 },
  { name: 'S1 PETG Trennschicht', mesh: m.petg, extruder: 2 },
], 'Stapel S1'));
console.log(`${s.label}: ${s.items.length} Platten, ${s.spacers.length} Leisten, Höhe ${m.height.toFixed(2)} mm -> tests/out/`);
