// Rechnen, Netze zwischenspeichern, Export (STL/3MF/ZIP, Anleitung) und Download.
import GF from '../gf.js';
import { POSNAME } from './opts.ts';

export const PLA_DENSITY = 1.24, PETG_DENSITY = 1.27;
export const fmt = (x, d = 1) => (Math.round(x * 10 ** d) / 10 ** d).toLocaleString('de-DE', { minimumFractionDigits: 0, maximumFractionDigits: d });
const safe = (s) => s.replace(/[^A-Za-z0-9_.-]+/g, '_');

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
    else { const s = GF.stackMeshes(R.stacks[idx], o); res = { pla: s.pla, petg: s.petg, height: s.height }; }
    cache.set(key, res); return res;
  };
  return { R, o, mesh };
}

export const cellsOf = (p) => {
  const f = (a) => { const full = a.cells.filter((c) => c === 42).length, h = a.cells.length - full; return full + (h ? '½' : ''); };
  return f(p.ax) + '×' + f(p.ay);
};
export const plateKey = (P, p) => 'P:' + P.R.types.indexOf(p.type);
export const spacerKey = (P, s) => 'R:' + P.R.spacers.types.indexOf(s.type);

export function stats(P) {
  const { R, o } = P;
  if (R.error) return null;
  // Material aus den fertigen Druckbetten: PLA (Platten + Leisten) und PETG (Trennung bzw. Wendeplatten)
  let pla = 0, petg = 0;
  R.stacks.forEach((s, i) => { const m = P.mesh('S:' + i); pla += GF.volume(m.pla); if (m.petg.f.length) petg += GF.volume(m.petg); });
  const flips = R.stacks.reduce((a, s) => a + s.items.filter((it) => it.flip).length, 0);
  const flipSp = GF.flipMode(o) ? R.stacks.reduce((a, s) => a + s.spacers.filter((e) => (e.level || 0) % 2).length, 0) : 0;
  return {
    nx: R.AX.cells.length, ny: R.AY.cells.length, plates: R.pieces.length, spacers: R.spacers.list.length, jobs: R.stacks.length,
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
      if (k >= 0) return { i, level: k, of: R.stacks[i].items.length, flip: !!R.stacks[i].items[k].flip };
    }
    return null;
  }
  const sp = R.spacers.list[sel.idx], i = R.stacks.indexOf(sp.job);
  const e = sp.job.spacers.find((q) => q.sp === sp);
  const level = e ? e.level || 0 : 0;
  return { i, level, of: sp.job.spacers.filter((q) => e && q.x === e.x && q.y === e.y).length, spacer: true, flip: GF.flipMode(P.o) && level % 2 === 1 };
}
export const jobName = (st) => (st.items.length ? (st.items.length > 1 ? 'Stapel ' : 'Druckjob ') + st.label : 'Leisten-Bett ' + st.label);
export const jobWhat = (st) => [st.items.length ? st.items.length + (st.items.length > 1 ? ' Platten' : ' Platte') : '', st.spacers.length ? st.spacers.length + ' Leisten' : ''].filter(Boolean).join(' + ');

export function filesFor(P, key) {
  const { R } = P, [kind, i] = key.split(':'), out = [];
  if (kind === 'P') {
    const t = R.types[i], p = t.rep;
    out.push([`Platte_${t.label}_${p.ax.cells.length}x${p.ay.cells.length}_${safe(fmt(p.w))}x${safe(fmt(p.d))}mm_${t.pieces.length}x.stl`, GF.stl(P.mesh(key).pla, 'Platte ' + t.label)]);
  } else if (kind === 'R') {
    const t = R.spacers.types[i];
    out.push([`Leiste_${t.label}_${safe(fmt(t.w, 2))}x${safe(fmt(t.d, 2))}mm_${t.items.length}x.stl`, GF.stl(P.mesh(key).spacer, 'Leiste ' + t.label)]);
  } else {
    const s = R.stacks[i], m = P.mesh(key);
    const base = `${s.label}_${s.items.map((it) => it.p.type.label).join('')}${s.spacers.length ? (s.items.length ? '_mit_' : '') + s.spacers.length + 'Leisten' : ''}`;
    out.push([base + '_PLA.stl', GF.stl(m.pla, base + ' PLA')]);
    if (m.petg.f.length) out.push([base + '_PETG.stl', GF.stl(m.petg, base + ' PETG')]);
    // Bambu-Studio-Projekt: PLA-Teil auf Filament 1, PETG-Teil auf Filament 2
    out.push([base + '.3mf', GF.threeMF([{ name: base + ' PLA', mesh: m.pla, extruder: 1 }, { name: base + (P.o.sepStyle === 'flip' ? ' PETG Wendeplatten' : ' PETG Trennschicht'), mesh: m.petg, extruder: 2 }], base)]);
  }
  return out;
}

export function readme(P, use) {
  const { R, o } = P, L = [];
  L.push('Gridfinity Planer – Export', '');
  L.push(`${use ? use.area : 'Innenmaß'}: ${o.boxW} x ${o.boxD} mm, Spiel je Achse ${o.clearance} mm, Raster liegt: ${POSNAME.y[o.alignY]} ${POSNAME.x[o.alignX]}`);
  if (GF.nCopies(o) > 1) L.push(`Anzahl: ${GF.nCopies(o)} gleiche Einsätze (Platten und Leisten mehrfach in den Druckbetten)`);
  L.push(`Raster: ${R.AX.cells.length} x ${R.AY.cells.length} Zellen (${R.AX.cells.join('+')} / ${R.AY.cells.join('+')} mm)`);
  L.push(`Abstandshalter links/rechts: ${R.AX.mLow} / ${R.AX.mHigh} mm, vorne/hinten: ${R.AY.mLow} / ${R.AY.mHigh} mm (${o.spacers === 'separate' ? 'separate Leisten, ' + (o.spacerStyle === 'solid' ? 'voll' : 'Leiter') + ', Höhe ' + o.spacerH + ' mm' : 'in Platten integriert'})`);
  L.push(`Druckbett: ${o.bedX} x ${o.bedY} x ${o.bedZ} mm${o.stack ? ', Reserve Prime-Tower ' + o.towerReserve + ' mm' : ''}`, '');
  const ox = R.AX.gapLow, oy = R.AY.gapLow;
  L.push('Platten (Position = linke vordere Ecke, gemessen ab linker und vorderer Wand, mm):');
  R.pieces.forEach((p) => L.push(`  ${p.type.label}: ${fmt(p.w)} x ${fmt(p.d)} bei x=${fmt(ox + p.x, 2)} y=${fmt(oy + p.y, 2)}`));
  if (R.spacers.list.length) { L.push('', 'Leisten:'); R.spacers.list.forEach((s) => L.push(`  ${s.type.label} (${{ S: 'vorne', N: 'hinten', W: 'links', E: 'rechts' }[s.side]}): ${fmt(s.x1 - s.x0, 2)} x ${fmt(s.y1 - s.y0, 2)} bei x=${fmt(ox + s.x0, 2)} y=${fmt(oy + s.y0, 2)}`)); }
  L.push('', 'Druckbetten (Ordner druckbetten/, je Datei ein Druck; Leisten liegen schon neben den Platten):');
  R.stacks.forEach((s) => L.push(`  ${s.label}: ${s.items.map((it) => it.p.type.label + (it.flip ? ' (PETG, kopfüber)' : '') + (it.rot ? ' (gedreht)' : '')).join(' + ') || '-'}${s.items.length > 1 ? ' (unten -> oben)' : ''}${s.spacers.length ? ' + ' + s.spacers.length + ' Leisten daneben' : ''}`));
  if (o.stack) {
    if (o.sepStyle === 'flip') L.push('', 'Stapel: Wendeplatten. Jede zweite Grundplatte ist aus PETG und liegt kopfüber im Stapel.', 'Sie trennt die PLA-Platten und wird nach dem Druck einfach umgedreht: dann ist sie eine normale Grundplatte für den Einsatz.');
    else L.push('', `Stapel: PETG-Trennschicht ${o.sepT} mm, Form: ${({ sheet: 'durchgehende Folie', wedge: 'Netz mit 45°-Keil', ring: 'Netz unter den Stegen', grow: `wächst aus der Stegspitze mit ${o.overhang}° Überhang` })[o.sepStyle]}.`);
    L.push('', 'Bambu Studio:', '  1. S*.3mf öffnen (PLA-Teil = Filament 1, PETG-Teil = Filament 2).',
      '     Ausweichweg: S*_PLA.stl und S*_PETG.stl zusammen importieren und "als ein Objekt mit mehreren Teilen" laden.',
      '  2. Filament 1 = PLA, Filament 2 = PETG (X2D: PLA linke Düse, PETG rechte Düse).',
      '  3. Stützen aus, Prime-Tower an, Schichthöhe 0,2 mm.', '  4. Nach dem Druck die Platten von oben abziehen' + (o.sepStyle === 'flip' ? ', PETG-Platten umdrehen.' : ', PETG-Reste abziehen.'));
  }
  return L.join('\r\n');
}

export function buildZip(P, use) {
  const { R } = P, files = [];
  R.stacks.forEach((s, i) => filesFor(P, 'S:' + i).forEach(([n, d]) => files.push(['druckbetten/' + n, d])));
  R.types.forEach((t, i) => filesFor(P, 'P:' + i).forEach(([n, d]) => files.push(['einzelteile/platten/' + n, d])));
  R.spacers.types.forEach((t, i) => filesFor(P, 'R:' + i).forEach(([n, d]) => files.push(['einzelteile/leisten/' + n, d])));
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
