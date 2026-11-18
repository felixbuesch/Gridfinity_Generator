// Halbe Zellen: nur wenn neben den vollen Zellen noch 21 mm frei sind; „mittig“ gibt es dann nicht.
import { describe, it, expect } from 'vitest';
import GF from '../src/gf.js';

const BASE = {
  clearance: 1, cornerR: 0, minSpacer: 2, half: false, spacers: 'separate', spacerStyle: 'ladder',
  alignX: 'center', alignY: 'center', spacerH: 2.4, rail: 1.2, ribPitch: 40, bedX: 256, bedY: 256, bedZ: 256,
  stack: true, sepStyle: 'petg', sepT: 0.6, maxStack: 30, towerReserve: 40, boxW: 420, boxD: 300,
};

describe('Platz für eine halbe Zelle', () => {
  it.each([
    [400, 1, true],   // 399 = 9 × 42 + 21: genau eine halbe Zelle
    [420, 1, true],   // 41 mm Rest: halbe Zelle + 20 mm Leiste
    [398, 1, false],  // 19 mm Rest: zu wenig
    [430, 1, false],  // 9 mm Rest
    [85, 1, false],   // geht genau auf
    [64, 1, true],    // 1 Zelle + 21
    [63, 1, false],   // 1 mm fehlt
    [63, 0, true],    // ohne Spiel (Schreibtisch) reicht es
    [30, 1, false],   // nicht einmal eine volle Zelle
  ])('%s mm, Spiel %s → %s', (inner, cl, want) => {
    expect(GF.halfRoom(inner, cl)).toBe(want);
  });
});

describe('Ausrichtung mit halber Zelle', () => {
  const ax = (o) => GF.compute({ ...BASE, ...o }).AX;

  it('Rest größer als eine halbe Zelle: halbe Zelle plus Leiste auf der Gegenseite', () => {
    const a = ax({ half: true, alignX: 'start' });
    expect(a.cells[a.cells.length - 1]).toBe(21);
    expect(a.mLow).toBe(0);
    expect(a.mHigh).toBeCloseTo(20, 6);
    const e = ax({ half: true, alignX: 'end' });
    expect(e.cells[0]).toBe(21);
    expect(e.mLow).toBeCloseTo(20, 6);
    expect(e.mHigh).toBe(0);
  });

  it('„mittig“ wird mit halber Zelle wie „links“ gerechnet (alte Speicherstände)', () => {
    expect(ax({ half: true, alignX: 'center' })).toEqual(ax({ half: true, alignX: 'start' }));
  });

  it('ohne halbe Zelle bleibt „mittig“ symmetrisch', () => {
    const a = ax({ half: false, alignX: 'center' });
    expect(a.cells.every((c) => c === 42)).toBe(true);
    expect(a.mLow).toBeCloseTo(a.mHigh, 6);
  });

  it('ohne Platz für eine halbe Zelle ändert der Haken nichts, „mittig“ bleibt möglich', () => {
    expect(ax({ boxW: 430, half: true, alignX: 'center' })).toEqual(ax({ boxW: 430, half: false, alignX: 'center' }));
  });

  it('nur die Achse mit halber Zelle verliert „mittig“', () => {
    const R = GF.compute({ ...BASE, boxW: 420, boxD: 300, half: true, alignX: 'center', alignY: 'center' });
    expect(R.AY.mLow).toBeCloseTo(R.AY.mHigh, 6); // 300: kein Platz für eine halbe Zelle
    expect(R.AX.mLow).toBe(0);
  });
});
