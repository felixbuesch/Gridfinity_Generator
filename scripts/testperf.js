// Testdateien für „Ein Material, Perforation“ nach testdruck/:
//   Test_Perforation_4Abstaende   vier Stapel aus je zwei 2×2-Platten (unten aufrecht, oben kopfüber),
//                                 Punktabstand 4, 6, 9 und 12 mm. Fuge: Steg auf Steg.
//   Test_Perforation_3Platten     ein Stapel aus drei 2×2-Platten mit Standardwerten. Enthält beide Fugen
//                                 (Steg auf Steg und Fuß auf Fuß).
// Markierung: kleine Noppen vorne an der untersten Platte, 1 bis 4 Stück = Stapel 1 bis 4.
// Aufruf: node scripts/testperf.js
import { mkdirSync, writeFileSync } from 'node:fs';
import GF from '../src/gf.js';

const PITCHES = [4, 6, 9, 12], GAP = 6; // mm zwischen den Stapeln
const base = {
  boxW: 85, boxD: 85, clearance: 1, cornerR: 0, minSpacer: 2, half: false, spacers: 'separate', spacerStyle: 'ladder',
  alignX: 'center', alignY: 'center', spacerH: 2.4, rail: 1.2, ribPitch: 40, bedX: 256, bedY: 256, bedZ: 256,
  stack: false, sepStyle: 'perf', sepT: 0.6, overhang: 45, maxStack: 30, towerReserve: 0,
};
const R = GF.compute(base);
if (R.error) { console.error(R.error); process.exit(1); }
const p = R.pieces[0]; // 2×2-Platte, 84 × 84 mm

// Stapel aus n Platten, abwechselnd kopfüber
function stack(n, opts) {
  const items = Array.from({ length: n }, (_, k) => ({ p, rot: 0, flip: k % 2, dx: 0, dy: 0 }));
  return GF.stackMeshes({ items, spacers: [], bridges: [] }, { ...base, stack: true, ...opts });
}
function moved(m, dx, dy) { const out = new GF.Mesh(); out.v = m.v.map((c, i) => (i % 3 === 0 ? c + dx : i % 3 === 1 ? c + dy : c)); out.f = m.f.slice(); return out; }
// Noppen 2 × 1,5 × 1,2 mm vorne an der Platte (0,2 mm in die Wand hinein, damit sie sicher verschmelzen)
function bumps(k) {
  const m = new GF.Mesh();
  for (let i = 0; i < k; i++) {
    const x0 = 6 + i * 4, x1 = x0 + 2, y0 = -1.5, y1 = 0.2, z1 = 1.2, P = (x, y, z) => [x, y, z];
    m.quad(P(x0, y0, 0), P(x0, y1, 0), P(x1, y1, 0), P(x1, y0, 0)); m.quad(P(x0, y0, z1), P(x1, y0, z1), P(x1, y1, z1), P(x0, y1, z1));
    m.quad(P(x0, y0, 0), P(x1, y0, 0), P(x1, y0, z1), P(x0, y0, z1)); m.quad(P(x1, y0, 0), P(x1, y1, 0), P(x1, y1, z1), P(x1, y0, z1));
    m.quad(P(x1, y1, 0), P(x0, y1, 0), P(x0, y1, z1), P(x1, y1, z1)); m.quad(P(x0, y1, 0), P(x0, y0, 0), P(x0, y0, z1), P(x0, y1, z1));
  }
  return m;
}
const dir = new URL('../testdruck/', import.meta.url);
mkdirSync(dir, { recursive: true });
const write = (name, pla, perf) => {
  writeFileSync(new URL(name + '.stl', dir), GF.stl(GF.concat(pla, perf), name));
  writeFileSync(new URL(name + '.3mf', dir), GF.threeMF([{ name: name + ' Platten (PLA)', mesh: pla, extruder: 1 }, { name: name + ' Punkte (PLA)', mesh: perf, extruder: 1 }], name));
};

// 1) vier Stapel mit verschiedenen Punktabständen, 2 × 2 angeordnet (174 × 174 mm, passt auch auf den A1 mini)
let pla = new GF.Mesh(), perf = new GF.Mesh();
const info = [];
PITCHES.forEach((pitch, i) => {
  const m = stack(2, { perfPitch: pitch }), dx = (i % 2) * (p.w + GAP), dy = Math.floor(i / 2) * (p.d + GAP) + 1.5;
  pla = GF.concat(pla, GF.concat(moved(m.pla, dx, dy), moved(bumps(i + 1), dx, dy)));
  perf = GF.concat(perf, moved(m.perf, dx, dy));
  info.push(`  Stapel ${i + 1} (${i + 1} Noppe${i ? 'n' : ''}, ${['vorne links', 'vorne rechts', 'hinten links', 'hinten rechts'][i]}): Punktabstand ${pitch} mm, ${m.perf.f.length / 20} Punkte`);
});
write('Test_Perforation_4Abstaende', pla, perf);

// 2) drei Platten, Standardwerte: beide Fugenarten
const m3 = stack(3, {});
write('Test_Perforation_3Platten', m3.pla, m3.perf);

const P = GF.perfOpt({}), g4 = Math.round(GF.volume(pla) * 1.24), g3 = Math.round(GF.volume(m3.pla) * 1.24);
writeFileSync(new URL('LIESMICH_Perforation.txt', dir), [
  'Testdruck „Ein Material, Perforation“', '',
  'Alles PLA, ein Filament. Kein PETG, kein Prime-Tower, keine Stützen.',
  `Platten: 2 × 2 Zellen (84 × 84 × 4,4 mm). Luftspalt ${P.gap} mm, Punktdurchmesser ${P.dot} mm.`, '',
  'Einstellungen in Bambu Studio:',
  '  Schichthöhe 0,2 mm, erste Schicht ebenfalls 0,2 mm (der Luftspalt muss ein Vielfaches der Schichthöhe sein)',
  '  Stützen aus, Wandgenerator Arachne (Standard), Bauteillüfter 100 %',
  '  2 Wände, 15 % Füllung reichen', '',
  `Test_Perforation_4Abstaende.3mf  (174 × 176 mm, etwa ${g4} g)`,
  '  Vier Stapel aus je zwei Platten: unten aufrecht, oben kopfüber. Getestet wird die Fuge „Steg auf Steg“.',
  ...info,
  '  Prüfen: Welcher Stapel lässt sich von Hand oder mit einem Spachtel trennen, ohne dass die obere Platte',
  '  im Druck verrutscht ist? Wie sehen die Stegoberkanten danach aus?', '',
  `Test_Perforation_3Platten.3mf  (84 × 84 mm, ${m3.height.toFixed(1).replace('.', ',')} mm hoch, etwa ${g3} g)`,
  `  Ein Stapel aus drei Platten mit ${P.pitch} mm Punktabstand: aufrecht, kopfüber, aufrecht.`,
  '  Enthält zusätzlich die Fuge „Fuß auf Fuß“ (zwischen Platte 2 und 3). Das ist die kritischere Fuge,',
  '  weil die Fläche größer ist. Prüfen: Löst sich Platte 3? Wie rau ist ihre Unterseite?', '',
  'Den besten Punktabstand danach im Planer unter Profi-Einstellungen eintragen.',
  'Klebt es zu fest: Z-Abstand 0,6 mm oder größerer Punktabstand. Löst es sich im Druck: kleinerer Abstand oder Punkte 1,0 mm.',
].join('\r\n'));
console.log(info.join('\n'));
console.log('3 Platten:', m3.perf.f.length / 20, 'Punkte, Höhe', m3.height.toFixed(1), 'mm');
console.log('PLA 4 Stapel:', (GF.volume(pla) * 1.24).toFixed(0), 'g, 3 Platten:', (GF.volume(m3.pla) * 1.24).toFixed(0), 'g');
