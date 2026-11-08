// Einstellungen des Planers: Grundwerte, Speichern im Browser, Texte für Hover-Hilfen.
import { DEFAULTS } from '../intro.js';

export type Align = 'start' | 'center' | 'end';
export interface Opts {
  boxW: number; boxD: number; clearance: number; cornerR: number; minSpacer: number; half: boolean;
  spacers: 'separate' | 'integrated'; spacerStyle: 'ladder' | 'solid'; alignX: Align; alignY: Align;
  spacerH: number; rail: number; ribPitch: number; bedX: number; bedY: number; bedZ: number;
  stack: boolean; sepStyle: 'grow' | 'ring' | 'wedge' | 'sheet'; sepT: number; overhang: number; maxStack: number; towerReserve: number;
}

export const defaults = (): Opts => ({ ...(DEFAULTS as Opts) });

const STORE = 'gf-planer-v6';
export function loadOpts(): Opts {
  const o = defaults();
  try { Object.assign(o, JSON.parse(localStorage.getItem(STORE) || '{}') || {}); } catch { /* ohne Speicher */ }
  return o;
}
export function saveOpts(o: Opts) { try { localStorage.setItem(STORE, JSON.stringify(o)); } catch { /* egal */ } }

const num = (v: unknown, d: number) => { const x = typeof v === 'number' ? v : parseFloat(String(v).replace(',', '.')); return Number.isFinite(x) ? x : d; };
// Werte so aufbereiten, wie der Rechenkern sie erwartet (wie bisher readOpts)
export function clean(o: Opts) {
  const d = defaults(), r: Record<string, unknown> = { ...o };
  for (const k of Object.keys(d) as (keyof Opts)[]) if (typeof d[k] === 'number') r[k] = num(o[k], 0);
  const c = r as unknown as Opts & { wedgeDepth: number };
  c.maxStack = Math.max(1, Math.round(c.maxStack));
  c.sepT = Math.max(0.1, c.sepT);
  c.spacerH = Math.max(0.6, c.spacerH || 4.65);
  c.rail = Math.max(0.8, c.rail); c.ribPitch = Math.max(8, c.ribPitch);
  c.wedgeDepth = c.sepStyle === 'wedge' ? 1 : 0;
  return c;
}

export const POSNAME = { x: { start: 'links', center: 'mittig', end: 'rechts' }, y: { start: 'vorne', center: 'mittig', end: 'hinten' } } as const;
export const posText = (x: Align, y: Align) => (x === 'center' && y === 'center' ? 'Mitte' : `${POSNAME.y[y]} ${POSNAME.x[x]}`.replace('mittig ', '').replace(' mittig', ''));

// Hover-Hilfen für jedes Bedienelement
export const TIPS = {
  boxW: 'Innenmaß von links nach rechts. Am Boden messen, dort ist es meist am engsten.',
  boxD: 'Innenmaß von vorne nach hinten.',
  clearance: 'Luft, die pro Richtung abgezogen wird, damit nichts klemmt. Je Seite ist es die Hälfte.',
  cornerR: 'Rundung der Innenecken. Die Leisten in den Ecken werden passend abgerundet.',
  spacers: 'Separate Leisten: eigene dünne Teile am Rand, die Platten bleiben gleich groß und lassen sich gut stapeln. Integriert: der Rand wird fest an die Randplatten angedruckt.',
  pos: 'Wähle, an welcher Wand oder Ecke das Raster anliegt. Der Rest wird auf der Gegenseite mit Leisten aufgefüllt.',
  minSpacer: 'Ist der Rest schmaler als dieser Wert, wird keine Leiste gedruckt und es bleibt ein Spalt.',
  half: 'Passt am Rand noch eine halbe Zelle (21 mm), wird eine halbe Reihe statt einer breiten Leiste eingesetzt.',
  spacerStyle: 'Leiter: zwei dünne Schienen mit Querstreben, sehr wenig Material. Voll: massiver Streifen.',
  spacerH: 'Höhe der Leisten. Sie müssen nicht so hoch wie die Platten sein (4,65 mm), weil sie nur seitlich anliegen.',
  rail: 'Breite der beiden Längsschienen einer Leiter-Leiste. 1,2 mm sind drei Bahnen mit 0,4-mm-Düse.',
  ribPitch: 'Abstand der Querstreben. Größer spart Material, kleiner macht die Leiste steifer.',
  bedX: 'Nutzbare Breite des Druckbetts. X2D mit beiden Düsen: 235,5 mm.',
  bedY: 'Nutzbare Tiefe des Druckbetts. X2D: 256 mm.',
  bedZ: 'Maximale Druckhöhe. Begrenzt, wie viele Platten in einen Stapel passen.',
  stack: 'Mehrere Platten in einem Druck übereinander, getrennt durch eine dünne PETG-Schicht. Spart Druckjobs.',
  sepT: 'Dicke der PETG-Basisschicht zwischen zwei Platten. 0,6 mm sind drei Schichten bei 0,2 mm Schichthöhe.',
  sepStyle: 'Aus Stegspitze: PETG startet oben auf den Stegen und wächst ohne Stützen schräg nach außen bis unter die nächste Platte. Netz: flaches Gitter unter den Stegen. Netz + Keil: zusätzlich Keile auf der Schräge. Folie: ganze Fläche.',
  overhang: 'Wie flach das PETG nach außen wachsen darf, gemessen von der Senkrechten. 45° druckt sicher ohne Stützen.',
  maxStack: 'Höchstens so viele Platten pro Druckjob. Weniger heißt kürzere Jobs und weniger Risiko bei einem Fehldruck.',
  towerReserve: 'Platz, der auf dem Bett für den Prime-Tower frei bleibt. Er wird beim Wechsel PLA/PETG gebraucht.',
};
