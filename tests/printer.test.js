// Druckerauswahl: Das Profil bestimmt die Bettgröße, und die läuft durch Aufteilung, Stapel/Flach-Entscheidung,
// Ausrichtung der Exportdateien und die 3MF-Datei.
import { describe, it, expect } from 'vitest';
import GF from '../src/gf.js';
import { clean, defaults } from '../src/planer/opts.ts';
import { plan, filesFor, readme } from '../src/planer/core.js';

const unzip = (u8) => {
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength), dec = new TextDecoder(), out = {};
  let p = 0;
  while (dv.getUint32(p, true) === 0x04034b50) {
    const size = dv.getUint32(p + 18, true), nl = dv.getUint16(p + 26, true), xl = dv.getUint16(p + 28, true);
    out[dec.decode(u8.subarray(p + 30, p + 30 + nl))] = dec.decode(u8.subarray(p + 30 + nl + xl, p + 30 + nl + xl + size));
    p += 30 + nl + xl + size;
  }
  return out;
};
const stlExt = (u8) => { // Ausdehnung eines binären STL
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength), n = dv.getUint32(80, true);
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (let t = 0; t < n; t++) for (let k = 0; k < 3; k++) { const o = 84 + 50 * t + 12 + 12 * k, x = dv.getFloat32(o, true), y = dv.getFloat32(o + 4, true); x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
  return { w: x1 - x0, d: y1 - y0 };
};
const opts = (x) => clean({ ...defaults(), ...x });

describe('Druckerprofile', () => {
  it('gängige Bambu-Drucker sind hinterlegt', () => {
    const by = Object.fromEntries(GF.PRINTERS.map((p) => [p.id, p]));
    expect(by.a1mini).toMatchObject({ bedX: 180, bedY: 180, bedZ: 180 });
    expect(by.a1).toMatchObject({ bedX: 256, bedY: 256, bedZ: 256 });
    expect(by.p1s).toMatchObject({ bedX: 256, bedY: 256, bedZ: 256 });
    expect(by.x2d).toMatchObject({ bedX: 235, bedY: 256, bedZ: 256, nozzles: 2 });
  });
  it('Standard bleibt wie bisher (235 × 256 × 256)', () => {
    const o = opts({});
    expect(o.printer).toBe('x2d'); expect([o.bedX, o.bedY, o.bedZ]).toEqual([235, 256, 256]);
  });
  it('Profil setzt die Bettmaße, eigene Eingaben gelten nur bei „Eigener Drucker“', () => {
    expect(opts({ printer: 'a1mini', bedX: 999 })).toMatchObject({ bedX: 180, bedY: 180, bedZ: 180 });
    expect(opts({ printer: 'custom', bedX: 300, bedY: 320, bedZ: 400 })).toMatchObject({ printer: 'custom', bedX: 300, bedY: 320, bedZ: 400 });
    expect(opts({ printer: 'gibtsnicht', bedX: 300 })).toMatchObject({ printer: 'custom', bedX: 300 });
    expect(opts({ printer: 'custom', bedX: 5 }).bedX).toBe(50); // Grenzen gelten weiter
  });
  it('alte Speicherstände ohne Druckerangabe: Profil aus den Bettmaßen', () => {
    expect(GF.printerFor({ bedX: 180, bedY: 180, bedZ: 180 })).toBe('a1mini');
    expect(GF.printerFor({ bedX: 235, bedY: 256, bedZ: 256 })).toBe('x2d');
    expect(GF.printerFor({ bedX: 220, bedY: 220, bedZ: 250 })).toBe('custom');
  });
});

describe.each([['a1mini'], ['a1'], ['p1s'], ['x2d'], ['custom']])('Drucker %s läuft durch die ganze Kette', (printer) => {
  const extra = printer === 'custom' ? { bedX: 300, bedY: 200, bedZ: 150 } : {};
  for (const [w, d, sepStyle, connect] of [[400, 300, 'grow', 'none'], [523.5, 287.2, 'flip', 'tabs'], [200, 120, 'grow', 'none'], [600, 450, 'perf', 'bridges']]) {
    it(`${w} × ${d}, ${sepStyle}, ${connect}: Platten, Stapelhöhe und Exportdateien passen aufs Bett`, () => {
      const o = opts({ printer, ...extra, boxW: w, boxD: d, sepStyle, connect }), P = plan(o), R = P.R;
      expect(R.error).toBeUndefined();
      const pr = GF.printerOf(o);
      for (const p of R.pieces) expect(Math.min(p.w, p.d) <= Math.min(o.bedX, o.bedY) + 1e-6 && Math.max(p.w, p.d) <= Math.max(o.bedX, o.bedY) + 1e-6).toBe(true);
      const [aw, ad] = GF.printArea(o, R.flat);
      R.stacks.forEach((s, i) => {
        expect(GF.stackInfo(s, o).height).toBeLessThanOrEqual(o.bedZ + 1e-9);
        const files = Object.fromEntries(filesFor(P, 'S:' + i));
        const stl = Object.keys(files).find((n) => n.endsWith('_PLA.stl')), e = stlExt(files[stl]);
        // Datei liegt richtig herum: X höchstens die Druckfläche in X, Y höchstens Bett Y
        expect(e.w).toBeLessThanOrEqual(aw + 1e-3); expect(e.d).toBeLessThanOrEqual(ad + 1e-3);
        // 3MF: Objekt mittig auf der Druckfläche, ganz auf dem Bett, Drucker als Angabe
        const z = unzip(files[Object.keys(files).find((n) => n.endsWith('.3mf'))]), model = z['3D/3dmodel.model'];
        const t = model.match(/<item [^>]*transform="([^"]+)"/)[1].split(' ').map(Number);
        expect(t[9]).toBeCloseTo(aw / 2, 3); expect(t[10]).toBeCloseTo(ad / 2, 3); expect(t[11]).toBeCloseTo(0, 6);
        const xs = [...z['3D/Objects/object_1.model'].matchAll(/<vertex x="([^"]+)" y="([^"]+)"/g)].map((m) => [+m[1] + t[9], +m[2] + t[10]]);
        expect(Math.min(...xs.map((q) => q[0]))).toBeGreaterThanOrEqual(-1e-3); expect(Math.max(...xs.map((q) => q[0]))).toBeLessThanOrEqual(aw + 1e-3);
        expect(Math.min(...xs.map((q) => q[1]))).toBeGreaterThanOrEqual(-1e-3); expect(Math.max(...xs.map((q) => q[1]))).toBeLessThanOrEqual(o.bedY + 1e-3);
        expect(model).toContain(`<metadata name="GridfinityPlaner:Printer">${pr.name}</metadata>`);
        expect(model).toContain(`<metadata name="GridfinityPlaner:Bed">${o.bedX}x${o.bedY}x${o.bedZ}</metadata>`);
      });
      expect(readme(P, null)).toContain('Drucker: ' + pr.name);
    });
  }
});

describe('Bettgröße entscheidet über Aufteilung und Stapeln', () => {
  it('kleineres Bett teilt in mehr Platten', () => {
    const n = (printer) => plan(opts({ printer, boxW: 600, boxD: 450 })).R.pieces.length;
    expect(n('a1mini')).toBeGreaterThan(n('a1'));
  });
  it('200 × 200 mm: auf dem A1 flach (eine Platte), auf dem A1 mini gestapelt', () => {
    const a1 = plan(opts({ printer: 'a1', boxW: 200, boxD: 200 })).R, mini = plan(opts({ printer: 'a1mini', boxW: 200, boxD: 200 })).R;
    expect(a1.flat).toBe(true); expect(a1.pieces).toHaveLength(1);
    expect(mini.flat).toBeFalsy(); expect(mini.pieces.length).toBeGreaterThan(1);
  });
  it('Prime-Tower-Streifen bleibt nur bei zwei Materialien frei', () => {
    const o = opts({ printer: 'a1', boxW: 600, boxD: 450 });
    expect(GF.printArea(o, false)).toEqual([256 - o.towerReserve, 256]);
    expect(GF.printArea(o, true)).toEqual([256, 256]);
    expect(GF.printArea({ ...o, sepStyle: 'perf' }, false)).toEqual([256, 256]);
  });
  it('Anleitung nennt Düsen nur beim Zwei-Düsen-Drucker', () => {
    const txt = (printer) => readme(plan(opts({ printer, boxW: 600, boxD: 450, sepStyle: 'flip' })), null);
    expect(txt('x2d')).toMatch(/linke Düse/); expect(txt('a1')).not.toMatch(/linke Düse/); expect(txt('a1')).toMatch(/AMS/);
  });
});
