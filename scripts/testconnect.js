// Testdateien für die Verbindungen nach testdruck/: zwei Platten 1×2 Zellen, die zusammen 2×2 ergeben.
//   Test_Verbindung_Zapfen    eine Platte mit Zapfen, eine mit Taschen
//   Test_Verbindung_Bruecken  zwei Platten mit Taschen + Brücken (2 nötig, 2 Reserve)
// Aufruf: node scripts/testconnect.js [Spiel=0.15]
import { mkdirSync, writeFileSync } from 'node:fs';
import GF from '../src/gf.js';

const fit = +(process.argv[2] || GF.CONN.fit);
const dir = new URL('../testdruck/', import.meta.url);
mkdirSync(dir, { recursive: true });
for (const [connect, name] of [['tabs', 'Test_Verbindung_Zapfen'], ['bridges', 'Test_Verbindung_Bruecken']]) {
  const o = {
    boxW: 85, boxD: 85, clearance: 1, cornerR: 0, minSpacer: 2, half: false, spacers: 'separate', spacerStyle: 'ladder',
    alignX: 'center', alignY: 'center', spacerH: 2.4, rail: 1.2, ribPitch: 40, bedX: 70, bedY: 200, bedZ: 100,
    stack: false, sepStyle: 'grow', sepT: 0.6, overhang: 45, maxStack: 30, towerReserve: 0, connect, connFit: fit,
  };
  const R = GF.compute(o);
  if (R.error || R.pieces.length !== 2 || R.stacks.length !== 1) { console.error('unerwartete Aufteilung', R.error, R.pieces && R.pieces.length); process.exit(1); }
  const m = GF.stackMeshes(R.stacks[0], o);
  writeFileSync(new URL(name + '.stl', dir), GF.stl(m.pla, name));
  writeFileSync(new URL(name + '.3mf', dir), GF.threeMF([{ name, mesh: m.pla, extruder: 1 }], name));
  console.log(name, R.pieces.map((p) => p.w + '×' + p.d).join(' + '), connect === 'bridges' ? R.bridges.total + ' Brücken' : '', (GF.volume(m.pla) * 1.24).toFixed(0) + ' g');
}
