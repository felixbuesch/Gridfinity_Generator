// Intro: schwarzer Startbildschirm mit drei 3D-Modellen (Schreibtisch, Schublade, Box).
// Klick auf ein Modell -> Kamera fährt heran, die anderen verschwinden, Maße eingeben,
// das Gridfinity-Raster erscheint live im Modell. "Plan erstellen" übergibt an den Planer.
import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import GF from './gf.js';

const ACCENT = 0xf2a65a;   // warmes Bernstein, kein Blau
const LAMP = 0xffc48a;     // Farbe der Lampe über den Modellen

// gleiche Grundwerte wie das Formular des Planers
export const DEFAULTS = {
  boxW: 400, boxD: 300, clearance: 1, cornerR: 3, minSpacer: 2, half: false,
  spacers: 'separate', spacerStyle: 'ladder', alignX: 'center', alignY: 'center',
  spacerH: 2.4, rail: 1.2, ribPitch: 40, bedX: 235, bedY: 256, bedZ: 256,
  stack: true, sepStyle: 'grow', sepT: 0.6, overhang: 45, maxStack: 8, towerReserve: 40,
};

export const USES = [
  {
    id: 'desk', name: 'Schreibtisch', tag: 'Raster direkt auf der Tischplatte', W: 500, D: 300,
    q: 'Welche Fläche soll das Raster belegen?', area: 'Fläche auf dem Tisch',
    hint: 'Freie Fläche auf der Tischplatte. Ohne Wände braucht es keine Abstandshalter, der Rest bleibt frei.',
  },
  {
    id: 'drawer', name: 'Schublade', tag: 'Einsatz passgenau für die Schublade', W: 400, D: 300,
    q: 'Wie groß ist die Schublade innen?', area: 'Schublade innen',
    hint: 'Innenmaß am Boden messen, dort ist die Schublade meist am engsten.',
  },
  {
    id: 'box', name: 'Box', tag: 'Ordnung in jeder Kiste', W: 300, D: 200,
    q: 'Wie groß ist die Box innen?', area: 'Box innen',
    hint: 'Innenmaß am Boden messen. Abstandshalter füllen den Rest bis zur Wand.',
  },
];

// Planer-Einstellungen, die sich aus dem Einsatzort ergeben
export function planOptions(use, W, D) {
  if (use === 'desk') return { boxW: W, boxD: D, clearance: 0, cornerR: 0, minSpacer: 999 };
  if (use === 'drawer') return { boxW: W, boxD: D, clearance: 1, cornerR: 2, minSpacer: 2 };
  return { boxW: W, boxD: D, clearance: 1, cornerR: 3, minSpacer: 2 };
}

const $ = (id) => document.getElementById(id);
const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
const lerp = (a, b, k) => a + (b - a) * k;
const E = {
  inOut: (k) => (k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2),
  out: (k) => 1 - Math.pow(1 - k, 3),
  back: (k) => { const c = 1.70158; return 1 + (c + 1) * Math.pow(k - 1, 3) + c * Math.pow(k - 1, 2); },
};
const REDUCED = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
const fmt = (x) => (Math.round(x * 10) / 10).toLocaleString('de-DE');

// ---------- Materialien (pro Modell, damit jedes einzeln ausblenden kann) ----------
function makeMats() {
  const M = {
    body: new THREE.MeshStandardMaterial({ color: 0x26221f, roughness: 0.5, metalness: 0.35 }),
    wood: new THREE.MeshStandardMaterial({ color: 0x5e3d26, roughness: 0.6, metalness: 0.02 }),
    woodIn: new THREE.MeshStandardMaterial({ color: 0x9c7552, roughness: 0.7, metalness: 0.02 }),
    shell: new THREE.MeshStandardMaterial({ color: 0xd6cdbf, roughness: 0.42, metalness: 0.0 }),
    rim: new THREE.MeshStandardMaterial({ color: 0x3b332c, roughness: 0.4, metalness: 0.1 }),
    label: new THREE.MeshStandardMaterial({ color: 0xf6efe4, roughness: 0.8, metalness: 0.0 }),
    metal: new THREE.MeshStandardMaterial({ color: 0xb8aa98, roughness: 0.25, metalness: 0.95 }),
    screen: new THREE.MeshStandardMaterial({ color: 0x050403, emissive: 0x2a1708, emissiveIntensity: 1, roughness: 0.15, metalness: 0.2 }),
    edge: new THREE.LineBasicMaterial({ color: ACCENT }),
    tile: new THREE.MeshStandardMaterial({ color: 0xece6dc, roughness: 0.55, metalness: 0.0 }),
    pocket: new THREE.MeshStandardMaterial({ color: 0x4d463f, roughness: 0.85 }),
    spacer: new THREE.MeshStandardMaterial({ color: 0xd9b27c, roughness: 0.6 }),
    plate: new THREE.LineBasicMaterial({ color: 0xffb35c }),
    area: new THREE.MeshBasicMaterial({ color: ACCENT, side: THREE.DoubleSide }),
  };
  // Kanten nur als warmer Schimmer beim Überfahren, sonst wirken die Modelle gerendert statt als Drahtgitter
  const base = { edge: 0, plate: 0.9, area: 0.08 };
  for (const [k, m] of Object.entries(M)) { m.transparent = true; m.userData.base = base[k] ?? 1; m.opacity = m.userData.base; }
  return M;
}

function box(g, M, w, h, d, x, y, z, mat, edges = true) {
  const geo = new THREE.BoxGeometry(w, h, d), m = new THREE.Mesh(geo, mat || M.body);
  m.position.set(x, y, z); m.castShadow = m.receiveShadow = true; g.add(m);
  if (edges) { const e = new THREE.LineSegments(new THREE.EdgesGeometry(geo), M.edge); e.position.copy(m.position); g.add(e); }
  return m;
}

// ---------- Modelle (Millimeter, y nach oben, +z = vorne). Rückgabe: Gruppe + Ort der Rasterfläche ----------
// abgerundeter Quader, sonst wie box()
function rbox(g, w, h, d, x, y, z, mat, r = 3) {
  const rr = Math.max(0.1, Math.min(r, w / 2 - 0.01, h / 2 - 0.01, d / 2 - 0.01));
  const m = new THREE.Mesh(new RoundedBoxGeometry(w, h, d, 3, rr), mat);
  m.position.set(x, y, z); m.castShadow = m.receiveShadow = true; g.add(m);
  return m;
}

// Aufbewahrungsbox: abgerundet, Stapelrand oben, Rippen außen, Griffmulden seitlich, Etikett vorne
function buildBoxModel(W, D, M) {
  const g = new THREE.Group(), t = 6, H = clamp(Math.min(W, D) * 0.2, 42, 78), Wo = W + 2 * t, Do = D + 2 * t;
  rbox(g, Wo, t, Do, 0, -t / 2, 0, M.shell, 6);
  rbox(g, Wo, H, t, 0, H / 2, D / 2 + t / 2, M.shell);
  rbox(g, Wo, H, t, 0, H / 2, -D / 2 - t / 2, M.shell);
  rbox(g, t, H, D + 2, -W / 2 - t / 2, H / 2, 0, M.shell);
  rbox(g, t, H, D + 2, W / 2 + t / 2, H / 2, 0, M.shell);
  // Stapelrand: dunkler, steht etwas über
  const L = 7, o = 3;
  rbox(g, Wo + 2 * o, L, t + o, 0, H + L / 2 - 2, D / 2 + t / 2 + o / 2, M.rim, 2.5);
  rbox(g, Wo + 2 * o, L, t + o, 0, H + L / 2 - 2, -D / 2 - t / 2 - o / 2, M.rim, 2.5);
  rbox(g, t + o, L, Do, -W / 2 - t / 2 - o / 2, H + L / 2 - 2, 0, M.rim, 2.5);
  rbox(g, t + o, L, Do, W / 2 + t / 2 + o / 2, H + L / 2 - 2, 0, M.rim, 2.5);
  // senkrechte Rippen vorne und hinten
  const n = Math.max(2, Math.round(W / 75)), step = W / n;
  for (let i = 1; i < n; i++) for (const z of [D / 2 + t + 1.2, -D / 2 - t - 1.2]) {
    if (z > 0 && Math.abs(-W / 2 + i * step) < 50) continue; // Platz fürs Etikett
    rbox(g, 5, H - 10, 2.6, -W / 2 + i * step, (H - 10) / 2 + 2, z, M.shell, 1.2);
  }
  // Griffmulden links und rechts
  for (const sx of [-1, 1]) rbox(g, 2.4, 16, Math.min(90, D * 0.4), sx * (W / 2 + t + 0.6), H - 18, 0, M.rim, 6);
  // Etikett vorne
  rbox(g, Math.min(80, W * 0.3), Math.min(26, H * 0.4), 1.6, 0, H * 0.45, D / 2 + t + 0.9, M.label, 1.5);
  return { g, parent: g, cx: 0, cz: 0 };
}

function buildDrawerModel(W, D, M) {
  const g = new THREE.Group(), t = 10, b = 18, Hd = clamp(Math.min(W, D) * 0.24, 60, 110);
  const Wc = W + 2 * t + 40, Dc = D + 2 * t + 50, slot = Hd + 44;
  const y1 = Hd + 30, y0 = y1 - slot, yb = y0 - slot, hc = y1 - yb;
  // Korpus mit zwei Fächern
  box(g, M, Wc, b, Dc, 0, y1 + b / 2, 0, M.wood);
  box(g, M, Wc, b, Dc, 0, yb - b / 2, 0, M.wood);
  box(g, M, b, hc, Dc, -Wc / 2 + b / 2, yb + hc / 2, 0, M.wood);
  box(g, M, b, hc, Dc, Wc / 2 - b / 2, yb + hc / 2, 0, M.wood);
  box(g, M, Wc - 2 * b, hc, b, 0, yb + hc / 2, -Dc / 2 + b / 2, M.wood, false);
  box(g, M, Wc - 2 * b, 10, Dc - b, 0, y0 - 5, b / 2, M.wood, false);
  // untere, geschlossene Schublade
  box(g, M, Wc - 2 * b - 4, slot - 14, 16, 0, yb + slot / 2, Dc / 2 - 8, M.wood);
  box(g, M, Math.min(160, W * 0.4), 10, 12, 0, yb + slot / 2, Dc / 2 + 6, M.metal, false);
  // obere Schublade: eigene Gruppe, Ursprung = Bodenmitte innen, fährt in z heraus
  const dr = new THREE.Group();
  box(dr, M, W + 2 * t, t, D + 2 * t, 0, -t / 2, 0, M.woodIn);
  box(dr, M, W + 2 * t, Hd, t, 0, Hd / 2, -D / 2 - t / 2, M.woodIn);
  box(dr, M, t, Hd, D, -W / 2 - t / 2, Hd / 2, 0, M.woodIn);
  box(dr, M, t, Hd, D, W / 2 + t / 2, Hd / 2, 0, M.woodIn);
  box(dr, M, Wc - 2 * b - 4, slot - 14, 16, 0, (slot - 14) / 2 - t - 4, D / 2 + t + 8, M.wood);
  box(dr, M, Math.min(160, W * 0.4), 10, 12, 0, slot / 2 - 18, D / 2 + t + 22, M.metal, false);
  const closedZ = Dc / 2 - 16 - D / 2 - t;
  dr.position.set(0, 0, closedZ);
  g.add(dr);
  return { g, parent: dr, cx: 0, cz: 0, drawer: dr, closedZ, travel: D * 0.75 };
}

function buildDeskModel(W, D, M) {
  const g = new THREE.Group(), dw = Math.max(W + 420, 1100), dd = Math.max(D + 280, 620), legH = 560;
  box(g, M, dw, 30, dd, 0, -15, 0, M.wood);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) box(g, M, 44, legH, 44, sx * (dw / 2 - 50), -30 - legH / 2, sz * (dd / 2 - 50), M.body);
  box(g, M, dw - 140, 60, 20, 0, -60, -dd / 2 + 60, M.body, false);
  // Monitor hinten
  const mz = -dd / 2 + 95, sw = Math.min(dw * 0.5, 720), sh = sw * 0.46;
  box(g, M, 240, 8, 150, 0, 4, mz, M.metal, false);
  box(g, M, 44, 150, 26, 0, 80, mz - 20, M.metal, false);
  box(g, M, sw, sh, 18, 0, 150 + sh / 2, mz, M.body);
  const scr = new THREE.Mesh(new THREE.PlaneGeometry(sw - 20, sh - 20), M.screen);
  scr.position.set(0, 150 + sh / 2, mz + 9.5); g.add(scr);
  // Zielfläche fürs Raster (vorne mittig)
  const cz = dd / 2 - 70 - D / 2;
  const area = new THREE.Mesh(new THREE.PlaneGeometry(W, D), M.area);
  area.rotation.x = -Math.PI / 2; area.position.set(0, 0.3, cz); g.add(area);
  const ol = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.PlaneGeometry(W, D)), M.edge);
  ol.rotation.x = -Math.PI / 2; ol.position.set(0, 0.4, cz); g.add(ol);
  return { g, parent: g, cx: 0, cz };
}

const BUILD = { desk: buildDeskModel, drawer: buildDrawerModel, box: buildBoxModel };

function dispose(o) {
  o.traverse((c) => { if (c.geometry) c.geometry.dispose(); });
}

// ---------- Gridfinity-Raster als Instanzen, mit "Pop"-Animation ----------
const UNIT_BOX = new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0);
const UNIT_PLANE = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
const TILE_H = 6;

function buildGrid(slot, W, D, animate) {
  if (slot.grid) { slot.grid.parent.remove(slot.grid); dispose(slot.grid); slot.grid = null; }
  const R = GF.compute({ ...DEFAULTS, ...planOptions(slot.use.id, W, D) });
  slot.R = R;
  if (R.error) return;
  const M = slot.M, g = new THREE.Group(), AX = R.AX, AY = R.AY;
  const ox = -W / 2 + AX.gapLow, front = D / 2 - AY.gapLow; // Planer-y wächst nach hinten (-z)
  const cells = [];
  let x = ox + AX.mLow;
  AX.cells.forEach((cw, i) => {
    let y = AY.mLow;
    AY.cells.forEach((ch, j) => { cells.push({ x: x + cw / 2, z: front - (y + ch / 2), w: cw - 1.2, d: ch - 1.2, h: TILE_H, k: i + j }); y += ch; });
    x += cw;
  });
  const spacers = R.spacers.list.map((s) => ({
    x: ox + (s.x0 + s.x1) / 2, z: front - (s.y0 + s.y1) / 2, w: s.x1 - s.x0 - 0.8, d: s.y1 - s.y0 - 0.8, h: 3, k: 0,
  }));
  const maxK = Math.max(1, AX.cells.length + AY.cells.length - 2);
  for (const c of cells) c.delay = (c.k / maxK) * 650;
  for (const s of spacers) s.delay = 700;
  const inst = (geo, mat, items) => {
    const m = new THREE.InstancedMesh(geo, mat, Math.max(1, items.length));
    m.castShadow = m.receiveShadow = true;
    m.count = items.length; m.userData.items = items; g.add(m); return m;
  };
  const body = inst(UNIT_BOX, M.tile, cells), pocket = inst(UNIT_PLANE, M.pocket, cells), sp = inst(UNIT_BOX, M.spacer, spacers);
  // Grenzen der druckbaren Platten
  const pts = [];
  for (const p of R.pieces) {
    const x0 = ox + p.x + 0.8, x1 = ox + p.x + p.w - 0.8, z0 = front - p.y - 0.8, z1 = front - p.y - p.d + 0.8, yy = TILE_H + 0.8;
    pts.push(x0, yy, z0, x1, yy, z0, x1, yy, z0, x1, yy, z1, x1, yy, z1, x0, yy, z1, x0, yy, z1, x0, yy, z0);
  }
  const lg = new THREE.BufferGeometry(); lg.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
  const lines = new THREE.LineSegments(lg, M.plate); g.add(lines);
  g.position.set(slot.model.cx, 0.2, slot.model.cz);
  g.userData = { body, pocket, sp, lines, t0: animate && !REDUCED ? performance.now() : -1e9, done: false };
  slot.model.parent.add(g);
  slot.grid = g;
  updateGrid(slot, performance.now());
}

const _m = new THREE.Matrix4(), _p = new THREE.Vector3(), _q = new THREE.Quaternion(), _s = new THREE.Vector3();
function updateGrid(slot, now) {
  const g = slot.grid; if (!g || g.userData.done) return;
  const u = g.userData, t = now - u.t0;
  let all = true;
  const put = (mesh, top) => {
    mesh.userData.items.forEach((c, n) => {
      const k = clamp((t - c.delay) / 420, 0, 1), kk = Math.max(0.001, E.back(k));
      if (k < 1) all = false;
      if (top) { _p.set(c.x, c.h * kk + 0.15, c.z); _s.set(Math.max(0.01, c.w - 9), 1, Math.max(0.01, c.d - 9)).multiplyScalar(k > 0.05 ? 1 : 0.001); }
      else { _p.set(c.x, 0, c.z); _s.set(c.w, c.h * kk, c.d); }
      mesh.setMatrixAt(n, _m.compose(_p, _q, _s));
    });
    mesh.instanceMatrix.needsUpdate = true;
  };
  put(u.body, false); put(u.pocket, true); put(u.sp, false);
  u.lineK = clamp((t - 650) / 500, 0, 1);
  if (all && u.lineK >= 1) u.done = true;
}

// ---------- Intro ----------
export function createIntro({ onDone }) {
  const root = $('intro'), canvas = $('introCanvas');
  let renderer;
  try { renderer = new THREE.WebGLRenderer({ canvas, antialias: true }); }
  catch (e) { // ohne WebGL direkt in den Planer
    root.hidden = true;
    const u = USES[2];
    setTimeout(() => onDone({ use: u, W: u.W, D: u.D, opts: planOptions(u.id, u.W, u.D) }));
    return { show() {} };
  }
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.1;
  renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x000000);
  scene.fog = new THREE.Fog(0x000000, 10, 30);
  const camera = new THREE.PerspectiveCamera(35, 1, 0.1, 200);
  // Licht: jede Auswahl hat ihre eigene warme Lampe direkt darüber (siehe Slots), dazu nur ein Hauch Grundlicht
  scene.add(new THREE.HemisphereLight(0xffd8a8, 0x000000, 0.4));
  const fill = new THREE.DirectionalLight(0xffcf9e, 0.45); fill.position.set(0, 3, 10); scene.add(fill);

  // schwarzer Boden, auf dem nur der Lichtkegel der Lampen sichtbar wird
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(120, 120).rotateX(-Math.PI / 2),
    new THREE.MeshStandardMaterial({ color: 0x15110d, roughness: 0.92, metalness: 0 }));
  floor.position.y = -0.01; floor.receiveShadow = true; scene.add(floor);

  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  const bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.18, 0.6, 0.9);
  composer.addPass(bloom);
  composer.addPass(new OutputPass());

  // gespeicherte Maße je Einsatzort
  const STORE = 'gf-intro-v1';
  let saved = {};
  try { saved = JSON.parse(localStorage.getItem(STORE) || '{}') || {}; } catch (e) { saved = {}; }
  const dims = (u) => ({ W: saved[u.id]?.W ?? u.W, D: saved[u.id]?.D ?? u.D });

  let state = 'select', sel = null, hovered = null, running = false, W0 = 1, H0 = 1;
  // ---- Modelle anlegen ----
  const labelsEl = $('iLabels');
  const slots = USES.map((use, i) => {
    const s = { use, i, M: makeMats(), root: new THREE.Group(), spin: new THREE.Group(), scaler: new THREE.Group(), content: new THREE.Group() };
    s.root.add(s.spin); s.spin.add(s.scaler); s.scaler.add(s.content); scene.add(s.root);
    const ring = new THREE.Mesh(new THREE.RingGeometry(1.95, 2.02, 128).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: ACCENT, transparent: true, opacity: 0.2, blending: THREE.AdditiveBlending, depthWrite: false }));
    ring.position.y = 0.01; s.root.add(ring); s.ring = ring;
    // warme Lampe senkrecht über dem Modell, weicher Lichtkegel mit Schatten
    const lamp = new THREE.SpotLight(LAMP, 0, 14, 0.5, 0.75, 0);
    lamp.position.set(0.3, 8, 0.8); lamp.target.position.set(0, 0, 0);
    lamp.castShadow = true; lamp.shadow.mapSize.set(1024, 1024); lamp.shadow.bias = -0.0004; lamp.shadow.radius = 4;
    lamp.shadow.camera.near = 2; lamp.shadow.camera.far = 14;
    s.root.add(lamp, lamp.target); s.lamp = lamp;
    s.alpha = 0; s.alphaT = 1; s.hover = 0; s.lift = -3; s.liftT = 0; s.pull = 0.45; s.pullT = 0.45; s.yaw = 0; s.drag = 0;
    const d = dims(use); s.W = d.W; s.D = d.D;
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'i-label';
    b.innerHTML = `<span class="i-num">0${i + 1}</span><span class="i-name">${use.name}</span><span class="i-tag">${use.tag}</span>`;
    b.addEventListener('click', () => select(i));
    b.addEventListener('pointerenter', () => { hovered = s; });
    b.addEventListener('pointerleave', () => { if (hovered === s) hovered = null; });
    b.style.setProperty('--d', (0.9 + i * 0.15) + 's');
    labelsEl.appendChild(b); s.label = b;
    rebuild(s, false);
    return s;
  });

  function rebuild(s, animate) {
    if (s.model) { s.content.remove(s.model.g); dispose(s.model.g); s.grid = null; }
    s.model = BUILD[s.use.id](s.W, s.D, s.M);
    if (s.model.drawer) s.model.drawer.position.z = s.model.closedZ + s.pull * s.model.travel;
    s.model.g.updateMatrixWorld(true); // noch ohne Eltern messen, also in Millimetern
    const bb = new THREE.Box3().setFromObject(s.model.g), size = bb.getSize(new THREE.Vector3());
    s.content.add(s.model.g);
    s.content.position.set(-(bb.min.x + bb.max.x) / 2, -bb.min.y, -(bb.min.z + bb.max.z) / 2);
    s.scaleT = 3.1 / Math.max(size.x, size.z, size.y * 1.1);
    if (!s.scaleInit) { s.scaler.scale.setScalar(s.scaleT); s.scaleInit = true; }
    buildGrid(s, s.W, s.D, animate);
    applyAlpha(s);
  }
  function applyAlpha(s) {
    const a = s.alpha;
    for (const m of Object.values(s.M)) {
      let o = m.userData.base * a;
      if (m === s.M.edge) o = Math.min(1, (m.userData.base + s.hover * 0.25) * a);
      if (m === s.M.plate) o *= s.grid ? s.grid.userData.lineK ?? 1 : 1;
      m.opacity = m.userData.base >= 1 && o >= 0.97 ? 1 : o;
      // feste Körper nur beim Ein-/Ausblenden durchsichtig, sonst sauber deckend (keine Sortierfehler)
      if (m.userData.base >= 1) { const tr = o < 0.97; if (m.transparent !== tr) { m.transparent = tr; m.needsUpdate = true; } }
    }
    s.ring.material.opacity = s.hover * 0.35 * a * (state === 'select' ? 1 : 0);
    s.lamp.intensity = (state === 'select' ? 11 + s.hover * 5 : 9) * a;
    s.root.visible = a > 0.005;
  }

  // ---- Zustand, Layout, Kamera ----
  const cam = { pos: new THREE.Vector3(), tgt: new THREE.Vector3() }, anims = [];
  const tanV = Math.tan((camera.fov / 2) * Math.PI / 180);
  const portrait = () => camera.aspect < 0.85;
  function slotHome(i) {
    return portrait() ? new THREE.Vector3(0, 2.9 - i * 3.6, 0) : new THREE.Vector3((i - 1) * 4.4, 0, 0);
  }
  function pose(st) {
    const a = camera.aspect;
    if (st === 'select') {
      if (portrait()) {
        const dist = Math.max(21, 2.2 / (tanV * a));
        return { tgt: new THREE.Vector3(0, 0.2, 0), pos: new THREE.Vector3(0, 0.4, 0).add(new THREE.Vector3(0, 0.22, 1).normalize().multiplyScalar(dist)) };
      }
      const dist = Math.max(12.5, 6.9 / (tanV * a));
      return { tgt: new THREE.Vector3(0, 1.1, 0), pos: new THREE.Vector3(0, 1.1, 0).add(new THREE.Vector3(0, 0.36, 1).normalize().multiplyScalar(dist)) };
    }
    if (portrait()) {
      const dist = Math.max(9.5, 2.6 / (tanV * a));
      const t = new THREE.Vector3(0, 0.6 - tanV * dist * 0.42, 0);
      return { tgt: t, pos: t.clone().add(new THREE.Vector3(0, 0.95, 1).normalize().multiplyScalar(dist)) };
    }
    const dist = 9.6 * Math.max(1, 1.45 / a), halfW = tanV * a * dist;
    const t = new THREE.Vector3(halfW * 0.28, 0.5, 0);
    return { tgt: t, pos: t.clone().add(new THREE.Vector3(0, 1.0, 1).normalize().multiplyScalar(dist)) };
  }
  function anim(dur, fn, ease = E.inOut, done) {
    const a = { t0: performance.now(), dur: REDUCED ? 1 : dur, fn, ease, done }; anims.push(a); return a;
  }
  function moveCam(st, dur) {
    const from = { pos: cam.pos.clone(), tgt: cam.tgt.clone() }, to = pose(st);
    anim(dur, (k) => { cam.pos.lerpVectors(from.pos, to.pos, k); cam.tgt.lerpVectors(from.tgt, to.tgt, k); });
  }
  function moveSlot(s, to, dur) {
    const from = s.root.position.clone();
    anim(dur, (k) => s.root.position.lerpVectors(from, to, k));
  }
  function resize() {
    const w = root.clientWidth, h = root.clientHeight; if (!w || !h) return;
    W0 = w; H0 = h;
    renderer.setSize(w, h, false); composer.setSize(w, h); bloom.setSize(w, h);
    camera.aspect = w / h; camera.updateProjectionMatrix();
    floor.visible = !portrait();
    if (!anims.length) {
      const p = pose(state); cam.pos.copy(p.pos); cam.tgt.copy(p.tgt);
      slots.forEach((s) => { if (state === 'select') s.root.position.copy(slotHome(s.i)); });
    }
  }
  new ResizeObserver(resize).observe(root);

  // ---- Auswahl ----
  const panel = $('iPanel'), backBtn = $('iBack'), inW = $('iW'), inD = $('iD');
  function select(i) {
    if (state !== 'select') return;
    state = 'detail'; sel = slots[i]; hovered = null;
    root.classList.add('detail');
    for (const s of slots) {
      if (s === sel) continue;
      s.alphaT = 0; s.liftT = -1.6;
    }
    moveSlot(sel, new THREE.Vector3(0, 0, 0), 1300);
    moveCam('detail', 1400);
    sel.pullT = 0.85; sel.liftT = 0; sel.yaw = 0;
    $('iKicker').textContent = sel.use.name;
    $('iQ').textContent = sel.use.q;
    $('iHint').textContent = sel.use.hint;
    inW.value = sel.W; inD.value = sel.D;
    stats();
    setTimeout(() => { if (state === 'detail') { panel.hidden = false; requestAnimationFrame(() => panel.classList.add('on')); if (matchMedia('(pointer:fine)').matches) inW.focus({ preventScroll: true }); } }, REDUCED ? 0 : 750);
    buildGrid(sel, sel.W, sel.D, true);
  }
  function back() {
    if (state !== 'detail') return;
    state = 'select';
    root.classList.remove('detail');
    panel.classList.remove('on'); setTimeout(() => { if (state === 'select') panel.hidden = true; }, 300);
    for (const s of slots) { s.alphaT = 1; s.liftT = 0; if (s !== sel) s.root.position.copy(slotHome(s.i)); }
    moveSlot(sel, slotHome(sel.i), 1200);
    moveCam('select', 1300);
    sel.pullT = 0.45; sel = null;
  }
  backBtn.addEventListener('click', back);
  window.addEventListener('keydown', (e) => { if (e.key === 'Escape' && running) back(); });

  function readDims() {
    const W = parseFloat(String(inW.value).replace(',', '.')), D = parseFloat(String(inD.value).replace(',', '.'));
    return { W: isFinite(W) ? W : 0, D: isFinite(D) ? D : 0 };
  }
  function stats() {
    const R = sel.R, el = $('iStats'), go = $('iGo');
    if (!R || R.error) {
      el.innerHTML = `<span class="i-err">${R ? R.error : ''}</span>`; go.disabled = true; return;
    }
    go.disabled = false;
    const nx = R.AX.cells.length, ny = R.AY.cells.length;
    el.innerHTML = `<div><b>${nx} × ${ny}</b><span>Felder</span></div><div><b>${R.pieces.length}</b><span>Platten <i class="i-sw"></i></span></div><div><b>${R.stacks.length}</b><span>Druckjobs</span></div>`;
  }
  let tIn = null;
  const onInput = () => {
    clearTimeout(tIn);
    tIn = setTimeout(() => {
      const { W, D } = readDims();
      if (W < 1 || D < 1 || W > 3000 || D > 3000) { sel.R = { error: 'Bitte Maße zwischen 42 und 3000 mm eingeben.' }; stats(); return; }
      const prev = sel.R && !sel.R.error ? sel.R.AX.cells.length + 'x' + sel.R.AY.cells.length : '';
      sel.W = W; sel.D = D;
      rebuild(sel, false);
      const now = sel.R && !sel.R.error ? sel.R.AX.cells.length + 'x' + sel.R.AY.cells.length : '';
      if (now !== prev) buildGrid(sel, W, D, true);
      stats();
    }, 140);
  };
  inW.addEventListener('input', onInput); inD.addEventListener('input', onInput);
  $('iForm').addEventListener('submit', (e) => { e.preventDefault(); go(); });

  function go() {
    if (!sel || !sel.R || sel.R.error) return;
    const { use, W, D } = sel;
    saved[use.id] = { W, D };
    try { localStorage.setItem(STORE, JSON.stringify(saved)); } catch (e) {}
    root.classList.add('leaving');
    setTimeout(() => {
      running = false; root.hidden = true; root.classList.remove('leaving');
      onDone({ use, W, D, opts: planOptions(use.id, W, D) });
    }, REDUCED ? 0 : 650);
  }

  // ---- Maus: Hover, Klick, Drehen in der Detailansicht ----
  const ray = new THREE.Raycaster(), ndc = new THREE.Vector2();
  const hit = (e) => {
    const r = canvas.getBoundingClientRect();
    ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(ndc, camera);
    let best = null, bd = Infinity;
    for (const s of slots) {
      if (!s.root.visible) continue;
      const h = ray.intersectObject(s.content, true)[0];
      if (h && h.distance < bd) { bd = h.distance; best = s; }
    }
    return best;
  };
  let down = null;
  canvas.addEventListener('pointermove', (e) => {
    if (state === 'select') { if (e.pointerType !== 'touch') { hovered = hit(e); canvas.style.cursor = hovered ? 'pointer' : 'default'; } }
    else if (down && sel) { sel.drag += (e.clientX - down.x) * 0.008; down.x = e.clientX; down.moved = true; }
  });
  canvas.addEventListener('pointerdown', (e) => { down = { x: e.clientX, x0: e.clientX, y0: e.clientY }; if (state === 'detail') canvas.setPointerCapture(e.pointerId); });
  canvas.addEventListener('pointerup', (e) => {
    const d = down; down = null; if (!d) return;
    if (state === 'select' && Math.hypot(e.clientX - d.x0, e.clientY - d.y0) < 6) { const s = hit(e); if (s) select(s.i); }
  });
  canvas.addEventListener('pointerleave', () => { if (state === 'select') hovered = null; });

  // ---- Bildschleife ----
  const proj = new THREE.Vector3();
  let tStart = performance.now(), last = tStart;
  function frame(now) {
    if (!running) return;
    requestAnimationFrame(frame);
    const dt = Math.min(0.05, (now - last) / 1000), t = (now - tStart) / 1000; last = now;
    for (let i = anims.length - 1; i >= 0; i--) {
      const a = anims[i], k = clamp((now - a.t0) / a.dur, 0, 1);
      a.fn(a.ease(k));
      if (k >= 1) { anims.splice(i, 1); a.done && a.done(); }
    }
    const f = (rate) => 1 - Math.exp(-rate * dt);
    for (const s of slots) {
      const intro = clamp((now - tStart - 250 - s.i * 180) / 1100, 0, 1);
      s.hover = lerp(s.hover, state === 'select' && hovered === s ? 1 : 0, f(10));
      s.alpha = lerp(s.alpha, s.alphaT * E.out(intro), f(state === 'detail' && s !== sel ? 7 : 5));
      s.lift = lerp(s.lift, s.liftT, f(4)) * (intro < 1 ? 1 : 1);
      const enter = (1 - E.out(intro)) * -2.5;
      s.pull = lerp(s.pull, s.pullT, f(3));
      if (s.model.drawer) s.model.drawer.position.z = s.model.closedZ + s.pull * s.model.travel;
      s.scaler.scale.setScalar(lerp(s.scaler.scale.x, s.scaleT * (portrait() && state === 'select' ? 0.85 : 1) * (1 + s.hover * 0.06), f(8)));
      const bob = state === 'select' ? Math.sin(t * 1.1 + s.i * 2) * 0.06 + s.hover * 0.28 : 0;
      s.spin.position.y = s.lift + enter + bob;
      const yaw = state === 'select' ? -0.5 + Math.sin(t * 0.35 + s.i * 1.7) * 0.22 + s.hover * 0.25 : -0.42 + Math.sin(t * 0.25) * 0.05 + s.drag;
      s.yaw = lerp(s.yaw, yaw, f(state === 'detail' && down ? 30 : 3));
      s.spin.rotation.y = s.yaw;
      s.ring.scale.setScalar(1 + s.hover * 0.08 + Math.sin(t * 2 + s.i) * 0.01);
      updateGrid(s, now);
      applyAlpha(s);
      // Beschriftung unter dem Modell
      if (state === 'select') {
        proj.copy(s.root.position); if (portrait()) proj.y -= 0.3; else proj.z += 2.15; proj.project(camera);
        s.label.style.transform = `translate(${((proj.x + 1) / 2) * W0}px, ${((1 - proj.y) / 2) * H0}px) translate(-50%, 0)`;
      }
      s.label.classList.toggle('on', hovered === s);
    }
    camera.position.copy(cam.pos); camera.lookAt(cam.tgt);
    composer.render();
  }

  function show() {
    root.hidden = false; state = 'select'; sel = null; hovered = null;
    root.classList.remove('detail', 'leaving'); panel.classList.remove('on'); panel.hidden = true;
    for (const s of slots) { s.alphaT = 1; s.liftT = 0; s.pullT = 0.45; s.alpha = 0; s.root.position.copy(slotHome(s.i)); }
    for (const s of slots) { s.label.style.animation = 'none'; void s.label.offsetWidth; s.label.style.animation = ''; }
    resize();
    const p = pose('select'); cam.pos.copy(p.pos).add(new THREE.Vector3(0, 1.5, 4)); cam.tgt.copy(p.tgt);
    moveCam('select', 2200);
    tStart = last = performance.now();
    if (!running) { running = true; requestAnimationFrame(frame); }
  }

  resize();
  show();
  const api = { show, select, back, go, get state() { return state; }, slots };
  window.__intro = api;
  return api;
}
