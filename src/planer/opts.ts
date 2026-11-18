// Einstellungen des Planers: Grundwerte, Speichern im Browser, Texte für Hover-Hilfen.
import { DEFAULTS } from '../intro.js';
import GF from '../gf.js';

export type Align = 'start' | 'center' | 'end';
export interface Opts {
  boxW: number; boxD: number; clearance: number; cornerR: number; minSpacer: number; half: boolean;
  spacers: 'separate' | 'integrated'; spacerStyle: 'ladder' | 'solid'; alignX: Align; alignY: Align;
  spacerH: number; rail: number; ribPitch: number; bedX: number; bedY: number; bedZ: number;
  printer: string; connect: 'none' | 'tabs' | 'bridges'; connFit: number;
  copies: number; stack: boolean; sepStyle: 'petg' | 'perf'; perfGap: number; perfDot: number; perfPitch: number; sepT: number; overhang: number; maxStack: number; towerReserve: number;
}

export const defaults = (): Opts => ({ ...(DEFAULTS as Opts) });

const STORE = 'gf-planer-v7';
export function loadOpts(): Opts {
  const o = defaults();
  try {
    const saved = JSON.parse(localStorage.getItem(STORE) || '{}') || {};
    Object.assign(o, saved);
    // ältere Speicherstände kennen noch keinen Drucker: aus den Bettmaßen ableiten, sonst „eigener Drucker“
    if (o.sepStyle !== 'perf') o.sepStyle = 'petg'; // ältere Trennarten gibt es nicht mehr
    if (!saved.printer && ('bedX' in saved || 'bedY' in saved || 'bedZ' in saved)) o.printer = GF.printerFor(o);
  } catch { /* ohne Speicher */ }
  return o;
}
export function saveOpts(o: Opts) { try { localStorage.setItem(STORE, JSON.stringify(o)); } catch { /* egal */ } }

const num = (v: unknown, d: number) => { const x = typeof v === 'number' ? v : parseFloat(String(v ?? '').replace(',', '.')); return Number.isFinite(x) ? x : d; };
const lim = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));
export const MAX_DIM = 2000; // mm je Richtung; größer wird mit Hinweis abgelehnt
// Werte so aufbereiten, wie der Rechenkern sie erwartet: ungültige Eingaben -> Grundwert, alles in sinnvollen Grenzen
export function clean(o: Opts) {
  const d = defaults(), r: Record<string, unknown> = { ...o };
  for (const k of Object.keys(d) as (keyof Opts)[]) if (typeof d[k] === 'number') r[k] = num(o[k], d[k] as number);
  const c = GF.applyPrinter(r) as unknown as Opts;
  c.boxW = lim(c.boxW, 0, 100000); c.boxD = lim(c.boxD, 0, 100000);
  c.clearance = lim(c.clearance, 0, 20); c.cornerR = lim(c.cornerR, 0, 50); c.minSpacer = lim(c.minSpacer, 0, 42);
  c.bedX = lim(c.bedX, 50, 1000); c.bedY = lim(c.bedY, 50, 1000); c.bedZ = lim(c.bedZ, 10, 1000);
  c.towerReserve = lim(c.towerReserve, 0, c.bedX - 50);
  c.maxStack = lim(Math.round(c.maxStack), 1, 100);
  c.copies = lim(Math.round(c.copies), 1, 20);
  c.sepT = lim(c.sepT, 0.1, 5); c.overhang = lim(c.overhang, 20, 70);
  c.spacerH = lim(c.spacerH, 0.6, 4.4); // höher als die Platte stört die Boxen
  c.connFit = lim(c.connFit, 0, 0.5);
  c.perfGap = lim(c.perfGap, 0.1, 1.2); c.perfDot = lim(c.perfDot, 0.4, 3); c.perfPitch = lim(c.perfPitch, 2, 30);
  if (!['none', 'tabs', 'bridges'].includes(c.connect)) c.connect = 'none';
  c.rail = lim(c.rail, 0.8, 20); c.ribPitch = lim(c.ribPitch, 8, 500);
  // ältere Trennarten (Stegspitze, Wendeplatte, Netz, Folie) gibt es nicht mehr: sie werden zur PETG-Zwischenschicht
  if (c.sepStyle !== 'perf') c.sepStyle = 'petg';
  return c;
}

// Maße je Einsatzort merken, damit der Startbildschirm sie beim nächsten Mal wieder anbietet
export function saveDims(useId: string, W: number, D: number) {
  if (!(Number.isFinite(W) && Number.isFinite(D) && W > 0 && D > 0)) return;
  try {
    const k = 'gf-intro-v1', v = JSON.parse(localStorage.getItem(k) || '{}') || {};
    v[useId] = { W, D }; localStorage.setItem(k, JSON.stringify(v));
  } catch { /* egal */ }
}

export const POSNAME = { x: { start: 'links', center: 'mittig', end: 'rechts' }, y: { start: 'vorne', center: 'mittig', end: 'hinten' } } as const;
export const posText = (x: Align, y: Align) => (x === 'center' && y === 'center' ? 'Mitte' : `${POSNAME.y[y]} ${POSNAME.x[x]}`.replace('mittig ', '').replace(' mittig', ''));

// Hover-Hilfen für jedes Bedienelement
export const TIPS: Record<string, string> = {
  boxW: 'Innenmaß von links nach rechts. Am Boden messen, dort ist es meist am engsten.',
  boxD: 'Innenmaß von vorne nach hinten.',
  clearance: 'Luft, die pro Richtung abgezogen wird, damit nichts klemmt. Je Seite ist es die Hälfte.',
  cornerR: 'Rundung der Innenecken. Die Leisten in den Ecken werden passend abgerundet.',
  spacers: 'Separate Leisten: eigene dünne Teile am Rand, die Platten bleiben gleich groß und lassen sich gut stapeln. Integriert: der Rand wird fest an die Randplatten angedruckt.',
  pos: 'Wähle, an welcher Wand oder Ecke das Raster anliegt. Der Rest wird auf der Gegenseite mit Leisten aufgefüllt.',
  minSpacer: 'Ist der Rest schmaler als dieser Wert, wird keine Leiste gedruckt und es bleibt ein Spalt.',
  half: 'Erscheint nur, wenn neben den vollen Zellen noch mindestens 21 mm frei sind. Dann kommt dort eine halbe Reihe hin, der Rest wird mit Leisten aufgefüllt. Die halbe Reihe liegt auf der Seite gegenüber der gewählten Wand, deshalb gibt es dann kein „mittig“.',
  spacerStyle: 'Leiter: zwei dünne Schienen mit Querstreben, sehr wenig Material. Voll: massiver Streifen.',
  spacerH: 'Höhe der Leisten, 0,6 bis 4,4 mm. Sie müssen nicht so hoch wie die Platten sein (4,4 mm), weil sie nur seitlich anliegen.',
  rail: 'Breite der beiden Längsschienen einer Leiter-Leiste. 1,2 mm sind drei Bahnen mit 0,4-mm-Düse.',
  ribPitch: 'Abstand der Querstreben. Größer spart Material, kleiner macht die Leiste steifer.',
  bedX: 'Nutzbare Breite des Druckbetts. X2D mit beiden Düsen: 235 mm.',
  bedY: 'Nutzbare Tiefe des Druckbetts. X2D: 256 mm.',
  bedZ: 'Maximale Druckhöhe. Begrenzt, wie viele Platten in einen Stapel passen.',
  stack: 'Einzeln: jede Platte ist ein eigener Druck, nur PLA. Ein Material, Perforation: alle Platten in einem Druck übereinander, nur PLA, getrennt durch einen Luftspalt mit Sollbruch-Punkten. Multimaterial (PETG-Trennschicht): getrennt durch eine dünne PETG-Schicht, braucht AMS oder zwei Düsen. In beiden Stapeln liegt jede zweite Platte kopfüber.',
  sepT: 'Dicke der PETG-Zwischenschicht zwischen zwei Platten. 0,6 mm sind drei Schichten bei 0,2 mm Schichthöhe.',
  maxStack: 'Höchstens so viele Platten pro Druckjob. Weniger heißt kürzere Jobs, aber evtl. mehr Druckjobs.',
  towerReserve: 'Platz, der auf dem Bett für den Prime-Tower frei bleibt. Er wird beim Wechsel PLA/PETG gebraucht.',
  connect: 'Hält die einzelnen Grundplatten an der Unterseite zusammen. Zapfen: Schwalbenschwanz direkt an der Platte, greift in die Nachbarplatte. Brücken: kleine Extrateile, die von unten in Taschen beider Platten gesteckt werden; die Platten selbst bleiben ohne Überstand. Oberseite und Außenrand bleiben gleich.',
  connFit: 'Luft zwischen Zapfen bzw. Brücke und Tasche je Seite. 0,15 mm sitzt bei 0,4-mm-Düse stramm, lässt sich aber noch von Hand fügen. Klemmt es: größer. Wackelt es: kleiner.',
  perf: 'Ein Material, Perforation: alles aus PLA, kein PETG, kein Prime-Tower. Die Platten liegen abwechselnd kopfüber mit einem kleinen Luftspalt. Dazwischen stehen nur Punkte als Sollbruchstellen, an denen man die Platten einzeln abzieht. Noch nicht am Drucker erprobt.',
  petg: 'Multimaterial (PETG-Trennschicht): zwischen zwei Platten liegt eine dünne PETG-Schicht, die kaum am PLA haftet. Jede zweite Platte liegt kopfüber, so liegen immer gleiche Flächen aufeinander (Füße auf Füßen, Stege auf Stegen). Braucht AMS oder zwei Düsen und einen Prime-Tower.',
  perfGap: 'Luftspalt zwischen zwei Platten. Muss ein Vielfaches der Schichthöhe sein: 0,4 mm sind zwei Schichten à 0,2 mm. Größer löst sich leichter, die Unterseite wird aber rauer.',
  perfDot: 'Durchmesser der Punkte. 0,8 mm sind zwei Bahnen einer 0,4-mm-Düse. Kleiner druckt der Slicer nicht sicher, größer hält fester.',
  perfPitch: 'Abstand der Punkte. Wird je Zelle auf einen gleichmäßigen Teiler gerundet. Kleiner stützt besser und hält fester, größer löst sich leichter.',
  printer: 'Dein Drucker. Bestimmt die Bettgröße und damit, wie die Platten geteilt werden, ob gestapelt oder flach gedruckt wird und wie die Dateien auf dem Bett liegen. „Eigener Drucker“: Bettmaße selbst eintragen.',
  toIntro: 'Zurück zur Auswahl Schreibtisch, Schublade oder Box.',
  fit: 'Bei diesen Innenmaßen geht das Raster genau auf und es braucht keine Leisten: ↓ das nächstkleinere Maß, ↑ das nächstgrößere (eine Reihe mehr). Klick übernimmt das Maß.',
  copiesDesk: 'So oft wird das ganze Raster gedruckt, z. B. für mehrere gleiche Schreibtische. Alle Exemplare werden zusammen so dicht wie möglich aufs Bett gepackt.',
  copies: 'So oft wird der ganze Einsatz mit Rahmen (Platten + Leisten) gedruckt, z. B. für mehrere gleiche Schubladen. Alle Exemplare werden zusammen so dicht wie möglich aufs Bett gepackt.',
  flat: 'Alle Platten passen nebeneinander auf ein Druckbett. Dann wird nicht gestapelt: nur PLA, kein PETG, kein Prime-Tower.',
  profi: 'Alle weiteren Einstellungen: Leistenform, Bett, Verbindung, Stapeln.',
  zip: 'Alle Druckbetten, Einzelteile und eine Anleitung als STL/3MF in einem ZIP.',
  job: 'Nur diese Druckdatei als ZIP laden (PLA- und PETG-STL plus 3MF fürs Bambu Studio).',
  view: 'Ziehen dreht, Mausrad oder zwei Finger zoomen, Rechtsklick verschiebt.',
};
