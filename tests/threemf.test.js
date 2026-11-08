// Prüft den 3MF-Export im Bambu-Studio-Projektformat: Paketstruktur, Verweise, Extruder je Teil.
import { describe, it, expect } from 'vitest';
import GF from '../src/gf.js';

// liest ein ZIP ohne Kompression (so schreibt es gf.js)
function unzip(u8) {
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength), dec = new TextDecoder(), out = {};
  let p = 0;
  while (dv.getUint32(p, true) === 0x04034b50) {
    const size = dv.getUint32(p + 18, true), nl = dv.getUint16(p + 26, true), xl = dv.getUint16(p + 28, true);
    const name = dec.decode(u8.subarray(p + 30, p + 30 + nl)), start = p + 30 + nl + xl;
    out[name] = dec.decode(u8.subarray(start, start + size));
    p = start + size;
  }
  return out;
}
const attrs = (xml, tag) => [...xml.matchAll(new RegExp(`<${tag}\\b([^>]*)/?>`, 'g'))].map((m) =>
  Object.fromEntries([...m[1].matchAll(/([\w:]+)="([^"]*)"/g)].map((a) => [a[1], a[2]])));

const o = {
  boxW: 400, boxD: 300, clearance: 1, cornerR: 3, minSpacer: 2, half: false, spacers: 'separate', spacerStyle: 'ladder',
  alignX: 'center', alignY: 'center', spacerH: 2.4, rail: 1.2, ribPitch: 40, bedX: 235, bedY: 256, bedZ: 256,
  stack: true, sepStyle: 'grow', sepT: 0.6, overhang: 45, maxStack: 8, towerReserve: 40,
};

describe('3MF (Bambu-Studio-Projektformat)', () => {
  const R = GF.compute(o), s = R.stacks.find((st) => st.items.length > 1), m = GF.stackMeshes(s, o);
  const files = unzip(GF.threeMF([
    { name: 'PLA Platten', mesh: m.pla, extruder: 1 },
    { name: 'PETG Trennschicht', mesh: m.petg, extruder: 2 },
  ], 'Stapel S1 <&>'));

  it('enthält alle Dateien des Pakets', () => {
    expect(Object.keys(files).sort()).toEqual([
      '3D/3dmodel.model', '3D/Objects/object_1.model', '3D/_rels/3dmodel.model.rels',
      'Metadata/model_settings.config', '[Content_Types].xml', '_rels/.rels',
    ]);
    expect(files['3D/3dmodel.model']).toMatch(/<metadata name="Application">BambuStudio-/);
    expect(files['3D/_rels/3dmodel.model.rels']).toContain('Target="/3D/Objects/object_1.model"');
    expect(files['3D/3dmodel.model']).toContain('Stapel S1 &lt;&amp;&gt;');
  });

  it('Komponenten verweisen auf die Netze in object_1.model', () => {
    const comps = attrs(files['3D/3dmodel.model'], 'component');
    const objs = attrs(files['3D/Objects/object_1.model'], 'object');
    expect(comps.map((c) => c.objectid)).toEqual(objs.map((x) => x.id));
    for (const c of comps) expect(c['p:path']).toBe('/3D/Objects/object_1.model');
    const verts = files['3D/Objects/object_1.model'].split('<mesh>').slice(1).map((b) => (b.match(/<vertex /g) || []).length);
    expect(verts).toEqual([m.pla.v.length / 3, m.petg.v.length / 3]);
  });

  it('PLA auf Extruder 1, PETG auf Extruder 2, Objekt auf Platte 1', () => {
    const cfg = files['Metadata/model_settings.config'];
    const asm = attrs(files['3D/3dmodel.model'], 'object').find((x) => !files['3D/Objects/object_1.model'].includes(`id="${x.id}" p:UUID`));
    expect(cfg).toContain(`<object id="${asm.id}">`);
    const parts = [...cfg.matchAll(/<part id="(\d+)"[\s\S]*?key="name" value="([^"]*)"[\s\S]*?key="extruder" value="(\d+)"/g)].map((x) => [x[1], x[2], x[3]]);
    expect(parts).toEqual([['1', 'PLA Platten', '1'], ['2', 'PETG Trennschicht', '2']]);
    expect(cfg).toMatch(new RegExp(`key="object_id" value="${asm.id}"`));
  });

  it('Netz liegt auf z = 0, Build-Item setzt es an die Layoutposition', () => {
    const zs = attrs(files['3D/Objects/object_1.model'], 'vertex').map((v) => +v.z);
    expect(Math.min(...zs)).toBeCloseTo(0, 6);
    const item = attrs(files['3D/3dmodel.model'], 'item')[0];
    const t = item.transform.split(' ').map(Number);
    expect(t.slice(0, 9)).toEqual([1, 0, 0, 0, 1, 0, 0, 0, 1]);
    expect(t[9]).toBeGreaterThan(0); expect(t[10]).toBeGreaterThan(0);
  });

  it('leere Teile werden weggelassen', () => {
    const f = unzip(GF.threeMF([{ name: 'PLA', mesh: m.pla, extruder: 1 }, { name: 'PETG', mesh: new GF.Mesh(), extruder: 2 }], 'x'));
    expect(attrs(f['3D/3dmodel.model'], 'component')).toHaveLength(1);
  });
});
