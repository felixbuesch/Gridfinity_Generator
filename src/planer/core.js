// Rechnen, Netze zwischenspeichern, Export (STL/3MF/ZIP, Anleitung) und Download.
import GF from '../gf.js';
import { posText } from './opts.ts';

export const PLA_DENSITY = 1.24, PETG_DENSITY = 1.27;
export const fmt = (x, d = 1) => (Math.round(x * 10 ** d) / 10 ** d).toLocaleString('de-DE', { minimumFractionDigits: 0, maximumFractionDigits: d });
const safe = (s) => s.replace(/[^A-Za-z0-9_.-]+/g, '_');
// Zahl für Dateinamen: Punkt statt Komma, ohne unnötige Nullen (174.17, 6.6, 42)
export const fnum = (x, d = 2) => String(Math.round(x * 10 ** d) / 10 ** d);
// Zellen einer Achse zählen, halbe Zellen als ½ (Anzeige) bzw. .5 (Dateiname)
export const cellCount = (cells, dot = false) => { const full = cells.filter((c) => c === 42).length, h = (cells.length - full) / 2; return dot ? String(full + h) : h ? (full || '') + (h === 0.5 ? '½' : '+' + h) : String(full); };

// Ein Rechenstand: Layout + zwischengespeicherte Netze
export function plan(o) {
  const R = GF.compute(o);
  const cache = new Map();
  const mesh = (key) => {
    if (cache.has(key)) return cache.get(key);
    const [kind, idx] = key.split(':');
    let res;
    if (kind === 'P') res = { pla: GF.plateMesh(R.types[idx]) };
    else if (kind === 'R') res = { spacer: GF.spacerMesh(R.spacers.types[idx]) };
    else { const s = GF.stackMeshes(R.stacks[idx], o); res = { pla: s.pla, petg: s.petg, perf: s.perf, height: s.height }; }
    cache.set(key, res); return res;
  };
  return { R, o, mesh };
}

export const cellsOf = (p) => cellCount(p.ax.cells) + '×' + cellCount(p.ay.cells);
export const plateKey = (P, p) => 'P:' + P.R.types.indexOf(p.type);
export const spacerKey = (P, s) => 'R:' + P.R.spacers.types.indexOf(s.type);

// Material und Höhe je Druckjob, ohne Netze zu bauen
export function info(P, i) { P._info = P._info || []; return P._info[i] || (P._info[i] = GF.stackInfo(P.R.stacks[i], P.o)); }

export function stats(P) {
  const { R, o } = P;
  if (R.error) return null;
  // Material aus den fertigen Druckbetten: PLA (Platten + Leisten) und PETG (Trennung bzw. Wendeplatten)
  let pla = 0, petg = 0;
  R.stacks.forEach((s, i) => { const m = info(P, i); pla += m.pla + (m.perf || 0); petg += m.petg; });
  const flips = o.sepStyle === 'perf' ? 0 : R.stacks.reduce((a, s) => a + s.items.filter((it) => it.flip).length, 0);
  const flipSp = GF.flipMode(o) ? R.stacks.reduce((a, s) => a + s.spacers.filter((e) => (e.level || 0) % 2).length, 0) : 0;
  return {
    nx: cellCount(R.AX.cells), ny: cellCount(R.AY.cells), plates: R.pieces.length, spacers: R.spacers.list.length, jobs: R.stacks.length,
    pla: pla * PLA_DENSITY, petg: petg * PETG_DENSITY, flips, flipSp,
  };
}

// Druckjob, in dem ein Teil liegt
export function jobOf(P, sel) {
  const { R } = P;
  if (sel.kind === 'P') {
    const p = R.pieces[sel.idx];
    for (let i = 0; i < R.stacks.length; i++) {
      const k = R.stacks[i].items.findIndex((it) => it.p === p);
      if (k >= 0) return { i, level: k, of: R.stacks[i].items.length, flip: !!R.stacks[i].items[k].flip, petg: !!R.stacks[i].items[k].flip && P.o.sepStyle !== 'perf' };
    }
    return null;
  }
  const sp = R.spacers.list[sel.idx], i = R.stacks.indexOf(sp.job);
  const e = sp.job.spacers.find((q) => q.sp === sp);
  const level = e ? e.level || 0 : 0;
  const fl = GF.flipMode(P.o) && level % 2 === 1;
  return { i, level, of: sp.job.spacers.filter((q) => e && q.x === e.x && q.y === e.y).length, spacer: true, flip: fl, petg: fl };
}
export const jobName = (st) => (st.items.length ? (st.items.length > 1 ? 'Stapel ' : 'Druckjob ') + st.label : 'Leisten-Bett ' + st.label);
export const bridgeCount = (st) => (st.bridges || []).reduce((a, e) => a + e.sp.type.n, 0);
export const jobWhat = (st) => [st.items.length ? st.items.length + (st.items.length > 1 ? ' Platten' : ' Platte') : '', st.spacers.length ? st.spacers.length + ' Leisten' : '', bridgeCount(st) ? bridgeCount(st) + ' Brücken' : ''].filter(Boolean).join(' + ');

export function filesFor(P, key) {
  const { R } = P, [kind, i] = key.split(':'), out = [];
  if (kind === 'P') {
    const t = R.types[i], p = t.rep;
    out.push([`Platte_${t.label}_${cellCount(p.ax.cells, true)}x${cellCount(p.ay.cells, true)}Zellen_${fnum(p.w)}x${fnum(p.d)}mm_${t.pieces.length}Stueck.stl`, GF.stl(P.mesh(key).pla, 'Platte ' + t.label)]);
  } else if (kind === 'R') {
    const t = R.spacers.types[i];
    out.push([`Leiste_${t.label}_${fnum(t.w)}x${fnum(t.d)}x${fnum(t.h)}mm_${t.items.length}Stueck.stl`, GF.stl(P.mesh(key).spacer, 'Leiste ' + t.label)]);
  } else {
    const s = R.stacks[i], m = P.mesh(key);
    // liegt der Job intern quer, für die Datei richtig herum aufs Bett drehen (X <= Bett X)
    const perf = m.perf && m.perf.f.length ? GF.toBed(m.perf, s) : null;
    // Perforation: Punkte sind eigene Körper aus demselben Material, in der STL hängen sie am PLA-Netz
    const pla0 = GF.toBed(m.pla, s), pla = perf ? GF.concat(pla0, perf) : pla0, petg = GF.toBed(m.petg, s);
    const base = `${s.label}_${s.items.map((it) => it.p.type.label).join('')}${s.spacers.length ? (s.items.length ? '_mit_' : '') + s.spacers.length + 'Leisten' : ''}${bridgeCount(s) ? '_' + bridgeCount(s) + 'Bruecken' : ''}`;
    out.push([base + '_PLA.stl', GF.stl(pla, base + ' PLA')]);
    if (petg.f.length) out.push([base + '_PETG.stl', GF.stl(petg, base + ' PETG')]);
    // Bambu-Studio-Projekt: PLA-Teil auf Filament 1, PETG-Teil auf Filament 2
    // Lage in der Datei: mittig auf der Druckfläche des gewählten Druckers (bei zwei Materialien bleibt rechts Platz für den Prime-Tower)
    const pr = GF.printerOf(P.o), place = { bed: GF.printArea(P.o, R.flat), meta: { 'GridfinityPlaner:Printer': pr.name, 'GridfinityPlaner:Bed': `${fnum(pr.bedX)}x${fnum(pr.bedY)}x${fnum(pr.bedZ)}` } };
    out.push([base + '.3mf', GF.threeMF([{ name: base + ' PLA', mesh: pla0, extruder: 1 }, ...(perf ? [{ name: base + ' Perforation (PLA)', mesh: perf, extruder: 1 }] : []), { name: base + (P.o.sepStyle === 'flip' ? ' PETG Wendeplatten' : ' PETG Trennschicht'), mesh: petg, extruder: 2 }], base, place)]);
  }
  return out;
}

// Projektname für Dateien, z. B. Schublade_523.5x287.2
export const projName = (P, use) => `${use ? safe(use.name) : 'Gridfinity'}_${fnum(P.o.boxW, 1)}x${fnum(P.o.boxD, 1)}`;

export function readme(P, use) {
  const { R, o } = P, L = [], n = GF.nCopies(o), side = { S: 'vorne', N: 'hinten', W: 'links', E: 'rechts' };
  const mm = (x, d = 2) => fmt(x, d);
  const flat = !!R.flat, stacked = o.stack && !flat;
  L.push('Gridfinity Planer – Export', '');
  L.push(`${use ? use.area : 'Innenmaß'}: ${mm(o.boxW)} × ${mm(o.boxD)} mm, Spiel je Achse ${mm(o.clearance)} mm, Raster liegt: ${posText(o.alignX, o.alignY)}`);
  if (n > 1) L.push(`Anzahl: ${n} gleiche Einsätze. Jede Platte und Leiste unten gibt es ${n}-mal (Exemplar 1 bis ${n}).`);
  L.push(`Raster: ${cellCount(R.AX.cells)} × ${cellCount(R.AY.cells)} Zellen (${R.AX.cells.map((c) => mm(c)).join(' + ')} / ${R.AY.cells.map((c) => mm(c)).join(' + ')} mm)`);
  L.push(`Abstandshalter links/rechts: ${mm(R.AX.mLow)} / ${mm(R.AX.mHigh)} mm, vorne/hinten: ${mm(R.AY.mLow)} / ${mm(R.AY.mHigh)} mm (${o.spacers === 'separate' ? 'separate Leisten, ' + (o.spacerStyle === 'solid' ? 'voll' : 'Leiter') + ', Höhe ' + mm(GF.spacerHeight(o)) + ' mm' : 'in Platten integriert'})`);
  if (o.connect === 'tabs') L.push(`Verbindung: Zapfen (Schwalbenschwanz) an der Unterseite der Stoßkanten, Spiel ${mm(o.connFit)} mm je Seite. Zapfen rechts und hinten, Taschen links und vorne. Platten von oben ineinander setzen.`);
  if (o.connect === 'bridges') L.push(`Verbindung: ${R.bridges.count} Brücken (${mm(R.bridges.size[0], 1)} × ${mm(R.bridges.size[1], 1)} × ${mm(R.bridges.size[2], 1)} mm) plus ${R.bridges.total - R.bridges.count} Reserve, Spiel ${mm(o.connFit)} mm je Seite. Brücken an den Stoßkanten auf den Boden legen und die Platten darauf drücken, oder von unten in die Taschen stecken.`);
  const pr = GF.printerOf(o);
  L.push(`Drucker: ${pr.name}. In Bambu Studio diesen Drucker auswählen, die Datei stellt ihn nicht selbst ein.`);
  L.push(`Druckbett: ${mm(o.bedX)} × ${mm(o.bedY)} × ${mm(o.bedZ)} mm${stacked ? ', Reserve Prime-Tower ' + mm(o.towerReserve) + ' mm' : ''}`, '');
  const ox = R.AX.gapLow, oy = R.AY.gapLow, one = R.pieces.filter((p) => !p.copy);
  L.push('Platten (Position = linke vordere Ecke, gemessen ab linker und vorderer Wand, mm):');
  one.forEach((p) => L.push(`  ${p.type.label}: ${mm(p.w)} × ${mm(p.d)} bei x = ${mm(ox + p.x)}, y = ${mm(oy + p.y)}${n > 1 ? `  (${n}×)` : ''}`));
  const sp1 = R.spacers.list.filter((x) => !x.copy);
  if (sp1.length) { L.push('', 'Leisten:'); sp1.forEach((x) => L.push(`  ${x.type.label} (${side[x.side]}): ${mm(x.x1 - x.x0)} × ${mm(x.y1 - x.y0)} bei x = ${mm(ox + x.x0)}, y = ${mm(oy + x.y0)}${n > 1 ? `  (${n}×)` : ''}`)); }
  L.push('', 'Druckbetten (Ordner druckbetten/, je Datei ein Druck; Leisten liegen schon neben den Platten):');
  R.stacks.forEach((x) => L.push(`  ${x.label}: ${x.items.map((it) => it.p.type.label + (n > 1 ? `/${(it.p.copy || 0) + 1}` : '') + (it.flip ? ' (PETG, kopfüber)' : '') + (it.rot ? ' (gedreht)' : '')).join(' + ') || '-'}${x.items.length > 1 && !x.flat ? ' (unten -> oben)' : ''}${x.spacers.length ? ' + ' + x.spacers.length + ' Leisten daneben' : ''}`));
  if (n > 1) L.push('  (Platte/Nummer = Plattentyp/Exemplar)');
  L.push('', 'Bambu Studio:');
  if (!stacked) {
    L.push(flat ? '  Alles passt flach auf ein Druckbett: nur PLA, kein PETG, kein Prime-Tower.' : '  Nicht gestapelt: jede Datei ist ein Druck in PLA.',
      `  1. ${R.stacks[0] ? R.stacks[0].label : 'J1'}*.3mf (oder die PLA-STL) öffnen.`, '  2. Stützen aus, Schichthöhe 0,2 mm.');
  } else {
    if (o.sepStyle === 'perf') {
      const pf = GF.perfOpt(o);
      L.push('  Stapel aus einem Material (Perforation): alles PLA, kein PETG, kein Prime-Tower.',
        `  Die Platten liegen abwechselnd kopfüber mit ${mm(pf.gap)} mm Luftspalt. Dazwischen stehen Punkte (Durchmesser ${mm(pf.dot)} mm, Abstand etwa ${mm(pf.pitch)} mm) als Sollbruchstellen.`,
        '  1. S*.3mf öffnen (oder S*_PLA.stl). Alles ist Filament 1 = PLA.',
        `  2. Schichthöhe 0,2 mm, auch die erste Schicht (der Luftspalt muss ein Vielfaches der Schichthöhe sein). Stützen aus, kein Prime-Tower.`,
        '  3. Wandgenerator Arachne (Standard) lassen, damit die kleinen Punkte gedruckt werden. Bauteillüfter 100 %.',
        '  4. Nach dem Druck die Platten einzeln von oben abhebeln (Spachtel in den Spalt), jede zweite umdrehen, Punktreste abbrechen.');
      return L.join('\r\n');
    }
    if (o.sepStyle === 'flip') L.push('  Stapel mit Wendeplatten: Jede zweite Grundplatte ist aus PETG und liegt kopfüber im Stapel.', '  Sie trennt die PLA-Platten und wird nach dem Druck einfach umgedreht: dann ist sie eine normale Grundplatte für den Einsatz.');
    else L.push(`  Stapel mit PETG-Trennschicht ${mm(o.sepT)} mm, Form: ${({ sheet: 'durchgehende Folie', wedge: 'Netz mit 45°-Keil', ring: 'Netz unter den Stegen', grow: `wächst aus der Stegkante mit ${mm(o.overhang, 0)}° Überhang` })[o.sepStyle]}.`);
    L.push('  1. S*.3mf öffnen (PLA-Teil = Filament 1, PETG-Teil = Filament 2).',
      '     Ausweichweg: S*_PLA.stl und S*_PETG.stl zusammen importieren und "als ein Objekt mit mehreren Teilen" laden.',
      pr.nozzles > 1 ? '  2. Filament 1 = PLA auf die linke Düse, Filament 2 = PETG auf die rechte Düse.' : '  2. Filament 1 = PLA, Filament 2 = PETG (beide im AMS).',
      '  3. Stützen aus, Prime-Tower an, Schichthöhe 0,2 mm.', '  4. Nach dem Druck die Platten von oben abziehen' + (o.sepStyle === 'flip' ? ', PETG-Platten umdrehen.' : ', PETG-Reste abziehen.'));
  }
  return L.join('\r\n');
}

export function buildZip(P, use) {
  const { R } = P, files = [];
  R.stacks.forEach((s, i) => filesFor(P, 'S:' + i).forEach(([n, d]) => files.push(['druckbetten/' + n, d])));
  R.types.forEach((t, i) => filesFor(P, 'P:' + i).forEach(([n, d]) => files.push(['einzelteile/platten/' + n, d])));
  R.spacers.types.forEach((t, i) => filesFor(P, 'R:' + i).forEach(([n, d]) => files.push(['einzelteile/leisten/' + n, d])));
  if (R.bridges && R.bridges.count) files.push([`einzelteile/Bruecke_${fnum(R.bridges.size[0], 1)}x${fnum(R.bridges.size[1], 1)}x${fnum(R.bridges.size[2], 1)}mm_${R.bridges.total}Stueck.stl`, GF.stl(GF.bridgeMesh(P.o.connFit), 'Bruecke')]);
  files.push(['LIESMICH.txt', readme(P, use)]);
  return GF.zip(files);
}
export const jobZip = (P, i) => GF.zip(filesFor(P, 'S:' + i));

// Datei anbieten: im Claude-Artifact über die Download-Fähigkeit, sonst normaler Browser-Download
export async function offer(filename, bytes) {
  let dl = null;
  try { dl = window.claude && window.claude.use ? await window.claude.use('downloads') : null; } catch (e) { dl = null; }
  if (dl) {
    try { await dl.save({ filename, data: new Blob([bytes], { type: 'application/zip' }) }); return 'Gespeichert.'; }
    catch (e) { return e && e.code === 'declined' ? 'Download abgebrochen.' : 'Download nicht möglich (' + ((e && e.code) || 'Fehler') + ').'; }
  }
  const url = URL.createObjectURL(new Blob([bytes], { type: 'application/zip' }));
  const a = document.createElement('a'); a.href = url; a.download = filename; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
  return 'Download gestartet.';
}

export { GF };
