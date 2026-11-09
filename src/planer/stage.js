// 3D-Bühne des Planers: Box/Schublade/Tisch mit den Platten, warme Lampe von oben, Kamerafahrt je Schritt,
// im Schritt "Drucken" die Druckbetten daneben, die sich Schicht für Schicht aufbauen.
// Koordinaten wie im Rechenkern: Millimeter, z nach oben, x nach rechts, y nach hinten.
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { plateKey, spacerKey, fmt, cellsOf, GF } from './core.js';

const COL = {
  pla: 0xf1ece4, petg: 0xe0703a, spacer: 0xd9b27c, amber: 0xf2a65a, hover: 0xfff1d6, lamp: 0xffdcb8,
  floor: 0x120f0c, wood: 0x5e3d26, woodIn: 0x8f6a49, shell: 0xd6cdbf, rim: 0x3b332c, bed: 0x1d1915, muted: 0x8f867c,
};
const REDUCED = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
const ease = (k) => (k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2);

export function toGeo(m) {
  const g = new THREE.BufferGeometry(), pos = new Float32Array(m.f.length * 3);
  for (let i = 0; i < m.f.length; i++) { const v = m.f[i] * 3; pos[i * 3] = m.v[v]; pos[i * 3 + 1] = m.v[v + 1]; pos[i * 3 + 2] = m.v[v + 2]; }
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.computeVertexNormals(); return g;
}
const std = (color, extra) => new THREE.MeshStandardMaterial(Object.assign({ color, roughness: 0.6, metalness: 0.02 }, extra || {}));

// Schrift als Sprite (Weltmaße)
export function textSprite(text, hWorld, color = '#a0968b') {
  const fs = 64, c = document.createElement('canvas'), ctx = c.getContext('2d');
  const font = `600 ${fs}px "JetBrains Mono", ui-monospace, monospace`;
  ctx.font = font; c.width = Math.ceil(ctx.measureText(text).width) + 24; c.height = fs + 20;
  ctx.font = font; ctx.fillStyle = color; ctx.textBaseline = 'middle'; ctx.fillText(text, 12, c.height / 2 + 2);
  const tex = new THREE.CanvasTexture(c); tex.anisotropy = 4; tex.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true }));
  s.scale.set((hWorld * c.width) / c.height, hWorld, 1); s.renderOrder = 10; return s;
}
// Maßlinien vorne (Breite) und links (Tiefe) an einem Rechteck
export function dims(g, x0, y0, w, d, off, txtW, txtD, color = '#a0968b', z = 0) {
  const k = Math.max(w, d), th = k * 0.055, tick = k * 0.018;
  const lm = new THREE.LineBasicMaterial({ color: new THREE.Color(color), transparent: true, opacity: 0.8 });
  const seg = (pts) => g.add(new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(pts.map((p) => new THREE.Vector3(p[0], p[1], z))), lm));
  const yy = y0 - off, xx = x0 - off;
  seg([[x0, yy], [x0 + w, yy], [x0, yy - tick], [x0, yy + tick], [x0 + w, yy - tick], [x0 + w, yy + tick]]);
  seg([[xx, y0], [xx, y0 + d], [xx - tick, y0], [xx + tick, y0], [xx - tick, y0 + d], [xx + tick, y0 + d]]);
  const l1 = textSprite(txtW, th, color); l1.position.set(x0 + w / 2, yy - th * 0.9, z); g.add(l1);
  const l2 = textSprite(txtD, th, color); l2.position.set(xx - th * 0.4 - l2.scale.x / 2, y0 + d / 2, z); g.add(l2);
}

function disposeTree(o) {
  o.traverse((c) => {
    if (c.geometry && !c.geometry.userData.shared) c.geometry.dispose();
    if (c.material && c.material.map) c.material.map.dispose();
  });
}

function makeRenderer(canvas) {
  const r = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false, preserveDrawingBuffer: true });
  r.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
  r.toneMapping = THREE.ACESFilmicToneMapping; r.toneMappingExposure = 1.05;
  r.shadowMap.enabled = true; r.shadowMap.type = THREE.PCFSoftShadowMap;
  r.setClearColor(0x000000, 1);
  return r;
}

// Kamera so stellen, dass box (Box3) in Richtung dir gut ins Bild passt
function poseFor(camera, box, dir, aspect, fill = 0.9) {
  const c = box.getCenter(new THREE.Vector3()), sz = box.getSize(new THREE.Vector3());
  const r = Math.max(sz.x / Math.max(0.6, aspect), sz.y * 1.05, sz.z * 2.5, 40);
  const d = new THREE.Vector3(...dir).normalize();
  const dist = (r / (2 * Math.tan((camera.fov * Math.PI) / 360))) / fill;
  return { pos: c.clone().add(d.multiplyScalar(dist)), tgt: c };
}

export default class Stage {
  constructor(canvas, { onHover, onPick } = {}) {
    this.canvas = canvas; this.onHover = onHover; this.onPick = onPick;
    this.renderer = makeRenderer(canvas);
    this.renderer.localClippingEnabled = true;
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x000000);
    this.camera = new THREE.PerspectiveCamera(32, 1, 1, 20000);
    this.camera.up.set(0, 0, 1);
    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.enableDamping = true; this.controls.screenSpacePanning = true;
    this.controls.maxPolarAngle = Math.PI * 0.49;

    this.scene.add(new THREE.HemisphereLight(0xffe2c0, 0x000000, 0.55));
    this.fill = new THREE.DirectionalLight(0xffd9b0, 0.5); this.scene.add(this.fill);
    this.lamp = this.makeLamp(); this.lampBeds = this.makeLamp();
    this.floor = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), std(COL.floor, { roughness: 0.95 }));
    this.floor.receiveShadow = true; this.scene.add(this.floor);

    this.mats = {
      pla: std(COL.pla, { roughness: 0.5 }), spacer: std(COL.spacer), petg: std(COL.petg, { roughness: 0.45 }),
      hover: std(COL.hover, { emissive: new THREE.Color(COL.hover), emissiveIntensity: 0.18 }),
      sel: std(COL.amber, { emissive: new THREE.Color(COL.amber), emissiveIntensity: 0.35 }),
    };
    this.root = new THREE.Group(); this.scene.add(this.root);
    this.beds = new THREE.Group(); this.scene.add(this.beds);
    this.pickables = []; this.hover = null; this.sel = null; this.step = 1; this.anims = []; this.printers = [];
    this.panel = 0; // Pixel, die rechts vom Panel verdeckt sind (Bild wird nach links verschoben)

    this.bindPointer();
    this.ro = new ResizeObserver(() => this.resize()); this.ro.observe(canvas);
    this.resize();
    this.running = true;
    const loop = (t) => { if (!this.running) return; requestAnimationFrame(loop); this.frame(t); };
    requestAnimationFrame(loop);
  }

  makeLamp() {
    const l = new THREE.SpotLight(COL.lamp, 0, 0, 0.55, 0.8, 0);
    l.castShadow = true; l.shadow.mapSize.set(2048, 2048); l.shadow.bias = -0.0002; l.shadow.radius = 5;
    this.scene.add(l, l.target); return l;
  }
  placeLamp(l, cx, cy, R, intensity) {
    l.position.set(cx + R * 0.08, cy - R * 0.12, R * 1.7); l.target.position.set(cx, cy, 0);
    l.distance = R * 4; l.shadow.camera.near = R * 0.5; l.shadow.camera.far = R * 3.5; l.shadow.camera.updateProjectionMatrix();
    l.userData.full = intensity;
  }

  resize() {
    const w = this.canvas.clientWidth, h = this.canvas.clientHeight; if (!w || !h) return;
    this.renderer.setSize(w, h, false); this.camera.aspect = w / h;
    this.applyOffset(); this.camera.updateProjectionMatrix();
    this.w = w; this.h = h;
    if (this.P && !this.anims.length) this.goStep(this.step, true);
  }
  setPanel(px) { this.panel = px; this.applyOffset(); this.camera.updateProjectionMatrix(); if (this.P) this.goStep(this.step, true); }
  applyOffset() {
    const w = this.canvas.clientWidth, h = this.canvas.clientHeight;
    if (this.panel > 0 && w && h) this.camera.setViewOffset(w, h, this.panel / 2, 0, w, h); else this.camera.clearViewOffset();
  }
  visibleAspect() { const w = this.canvas.clientWidth || 1, h = this.canvas.clientHeight || 1; return Math.max(0.5, (w - this.panel) / h); }

  // ---------- Inhalt ----------
  setPlan(P, use) {
    this.P = P; this.use = use;
    disposeTree(this.root); this.root.clear(); this.pickables = []; this.hits = []; this.hover = null;
    const { R, o } = P;
    const W = o.boxW, D = o.boxD, Rm = Math.max(W, D);
    this.Rm = Rm;
    this.floor.scale.set(Rm * 30, Rm * 30, 1); this.floor.position.set(W / 2, D / 2, -30);
    this.placeLamp(this.lamp, W / 2, D / 2, Rm, 6);
    this.fill.position.set(W / 2 - Rm, -Rm * 2, Rm);
    this.buildHousing(W, D, use ? use.id : 'box');
    if (R.error) { this.buildBeds(); this.goStep(this.step, true); return; }
    const ox = R.AX.gapLow, oy = R.AY.gapLow, geos = new Map();
    // Wendeplatten (PETG) in der Schublade in PETG-Farbe zeigen
    const flipped = new Set(); R.stacks.forEach((s) => s.items.forEach((it) => { if (it.flip) flipped.add(it.p); }));
    if (GF.flipMode(o)) R.stacks.forEach((s) => s.spacers.forEach((e) => { if ((e.level || 0) % 2) flipped.add(e.sp); }));
    const gget = (key, which) => { const k = key + which; if (!geos.has(k)) { const g = toGeo(P.mesh(key)[which]); g.userData.shared = false; geos.set(k, g); } return geos.get(k); };
    R.pieces.forEach((p, i) => {
      const base = flipped.has(p) ? this.mats.petg : this.mats.pla;
      const m = new THREE.Mesh(gget(plateKey(P, p), 'pla'), base);
      m.position.set(ox + p.x, oy + p.y, 0); m.castShadow = m.receiveShadow = true;
      m.userData = { kind: 'P', idx: i, base }; this.root.add(m); this.pickables.push(m);
      this.addHit(ox + p.x, oy + p.y, p.w, p.d, 4.65, m.userData);
    });
    R.spacers.list.forEach((s, i) => {
      const base = flipped.has(s) ? this.mats.petg : this.mats.spacer;
      const m = new THREE.Mesh(gget(spacerKey(P, s), 'spacer'), base);
      m.position.set(ox + s.x0, oy + s.y0, 0); m.castShadow = m.receiveShadow = true;
      m.userData = { kind: 'R', idx: i, base }; this.root.add(m); this.pickables.push(m);
      this.addHit(ox + s.x0, oy + s.y0, s.x1 - s.x0, s.y1 - s.y0, s.type.h, m.userData);
    });
    dims(this.root, 0, 0, W, D, Rm * 0.07 + 8, `${fmt(W)} mm`, `${fmt(D)} mm`, '#a0968b', 0.5);
    this.paint();
    this.buildBeds();
    this.goStep(this.step, !this.started); this.started = true;
  }

  // unsichtbare Trefferfläche: Platten sind offene Rahmen, ein Klick in eine Tasche soll trotzdem treffen
  addHit(x, y, w, d, h, ud) {
    if (!this.hitMat) this.hitMat = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false, colorWrite: false });
    const b = new THREE.Mesh(new THREE.BoxGeometry(w, d, h), this.hitMat);
    b.position.set(x + w / 2, y + d / 2, h / 2); b.userData = ud; this.root.add(b); this.hits.push(b);
  }

  buildHousing(W, D, kind) {
    const g = new THREE.Group(), add = (w, d, h, x, y, z, mat) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, d, h), mat); m.position.set(x, y, z); m.castShadow = m.receiveShadow = true; g.add(m); return m;
    };
    if (kind === 'desk') {
      const m = 160, top = std(COL.wood, { roughness: 0.55 });
      add(W + 2 * m, D + 2 * m, 28, W / 2, D / 2, -14.5, top);
      const ol = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.PlaneGeometry(W, D)), new THREE.LineBasicMaterial({ color: COL.amber, transparent: true, opacity: 0.6 }));
      ol.position.set(W / 2, D / 2, 0.2); g.add(ol);
    } else {
      const t = kind === 'drawer' ? 12 : 6, h = kind === 'drawer' ? 34 : 28;
      const wall = kind === 'drawer' ? std(COL.woodIn, { roughness: 0.65 }) : std(COL.shell, { roughness: 0.45 });
      const floorM = kind === 'drawer' ? std(0x2e2117, { roughness: 0.85 }) : std(0x3a3631, { roughness: 0.7 });
      add(W + 2 * t, D + 2 * t, 4, W / 2, D / 2, -2.2, floorM);
      add(W + 2 * t, t, h, W / 2, -t / 2, h / 2 - 2.2, wall);
      add(W + 2 * t, t, h, W / 2, D + t / 2, h / 2 - 2.2, wall);
      add(t, D, h, -t / 2, D / 2, h / 2 - 2.2, wall);
      add(t, D, h, W + t / 2, D / 2, h / 2 - 2.2, wall);
      if (kind === 'drawer') { // Schubladenfront
        add(W + 2 * t + 30, 18, h + 46, W / 2, -t - 9, (h + 46) / 2 - 22, std(COL.wood, { roughness: 0.55 }));
        add(Math.min(180, W * 0.4), 12, 10, W / 2, -t - 24, h / 2, std(0xb8aa98, { roughness: 0.25, metalness: 0.95 }));
      }
    }
    this.root.add(g);
  }

  // Druckbetten neben der Box: jeder Druckjob baut sich mit einer wandernden Schnittebene auf
  buildBeds() {
    disposeTree(this.beds); this.beds.clear(); this.printers = [];
    const P = this.P; if (!P || P.R.error) return;
    const { R, o } = P, gap = 60, cols = Math.min(R.stacks.length, 3);
    const bw = Math.max(o.bedX, o.bedY) + gap;
    const x0 = o.boxW + Math.max(220, this.Rm * 0.45), y0 = o.boxD / 2 - o.bedY / 2;
    R.stacks.forEach((s, i) => {
      const m = P.mesh('S:' + i), g = new THREE.Group();
      const cx = x0 + (i % cols) * bw, cy = y0 - Math.floor(i / cols) * (o.bedY + gap);
      g.position.set(cx, cy, 0);
      const plate = new THREE.Mesh(new THREE.BoxGeometry(s.bed.w, s.bed.d, 6), std(COL.bed, { roughness: 0.35, metalness: 0.5 }));
      plate.position.set(s.bed.w / 2, s.bed.d / 2, -3.1); plate.receiveShadow = true; g.add(plate);
      const edge = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.PlaneGeometry(s.bed.w, s.bed.d)), new THREE.LineBasicMaterial({ color: COL.amber, transparent: true, opacity: 0.45 }));
      edge.position.set(s.bed.w / 2, s.bed.d / 2, 0.15); g.add(edge);
      const lab = textSprite(s.label, 26, '#f2a65a'); lab.position.set(14 + lab.scale.x / 2, s.bed.d + 24, 0); g.add(lab);
      const plane = new THREE.Plane(new THREE.Vector3(0, 0, -1), 0);
      const mk = (mesh, color) => {
        if (!mesh.f.length) return;
        const mat = std(color, { roughness: 0.5, clippingPlanes: [plane], clipShadows: true, side: THREE.DoubleSide });
        const mm = new THREE.Mesh(toGeo(mesh), mat); mm.castShadow = mm.receiveShadow = true; g.add(mm);
      };
      mk(m.pla, COL.pla); mk(m.petg, COL.petg);
      // leuchtende Schichtlinie: Rechteck der Druckfläche auf aktueller Höhe
      const bb = new THREE.Box3();
      for (const it of s.items) bb.expandByPoint(new THREE.Vector3(it.dx, it.dy, 0)).expandByPoint(new THREE.Vector3(it.dx + (it.rot ? it.p.d : it.p.w), it.dy + (it.rot ? it.p.w : it.p.d), 0));
      for (const e of s.spacers) bb.expandByPoint(new THREE.Vector3(e.x, e.y, 0)).expandByPoint(new THREE.Vector3(e.x + (e.rot ? e.sp.type.d : e.sp.type.w), e.y + (e.rot ? e.sp.type.w : e.sp.type.d), 0));
      const sz = bb.getSize(new THREE.Vector3()), ctr = bb.getCenter(new THREE.Vector3());
      const glow = new THREE.Mesh(new THREE.PlaneGeometry(sz.x + 6, sz.y + 6), new THREE.MeshBasicMaterial({ color: COL.amber, transparent: true, opacity: 0.22, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
      glow.position.set(ctr.x, ctr.y, 0); g.add(glow);
      const gl = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.PlaneGeometry(sz.x + 6, sz.y + 6)), new THREE.LineBasicMaterial({ color: 0xffd9a8, transparent: true, opacity: 0.9 }));
      glow.add(gl);
      this.beds.add(g);
      this.printers.push({ g, plane, glow, H: m.height, t0: 0 });
    });
    const bb = new THREE.Box3().setFromObject(this.beds), c = bb.getCenter(new THREE.Vector3()), sz = bb.getSize(new THREE.Vector3());
    this.bedBox = bb;
    this.placeLamp(this.lampBeds, c.x, c.y, Math.max(sz.x, sz.y), 6);
    this.beds.updateMatrixWorld(true);
    this.setPrint(this.step === 3 ? 0 : 1, this.step === 3);
  }
  // Druckfortschritt: k = 0..1 (0 = leer), animate = neu starten
  setPrint(k, animate) {
    const now = performance.now();
    this.printers.forEach((p, i) => { p.t0 = animate && !REDUCED ? now + i * 250 : -1e9; p.k = k; this.updatePrinter(p, now); });
  }
  updatePrinter(p, now) {
    const dur = 1800 + Math.min(2600, p.H * 22);
    const k = p.t0 < 0 ? 1 : Math.max(0, Math.min(1, (now - p.t0) / dur));
    const h = (k >= 1 ? p.H + 1 : ease(k) * p.H) + 0.01;
    p.plane.constant = h; // wirkt in Weltkoordinaten: Bett liegt auf z = 0
    p.glow.position.z = h; p.glow.visible = k > 0 && k < 1;
    p.done = k >= 1;
  }

  // ---------- Schritte und Kamera ----------
  goStep(n, instant) {
    this.step = n; this.beds.visible = n === 3; // Druckbetten nur im Schritt Drucken
    const target = n === 3 && this.bedBox && !this.bedBox.isEmpty() ? this.bedBox : new THREE.Box3().setFromObject(this.root);
    if (target.isEmpty()) return;
    const dir = n === 2 ? [0, -0.18, 1] : n === 3 ? [-0.35, -1.1, 1.0] : [-0.32, -1.15, 0.95];
    const to = poseFor(this.camera, target, dir, this.visibleAspect(), n === 2 ? 0.9 : n === 3 ? 0.62 : 0.85);
    this.lamp.userData.want = n === 3 ? 1.5 : 4; this.lampBeds.userData.want = n === 3 ? 4 : 0;
    if (instant || REDUCED) {
      this.camera.position.copy(to.pos); this.controls.target.copy(to.tgt); this.controls.update();
      this.lamp.intensity = this.lamp.userData.want; this.lampBeds.intensity = this.lampBeds.userData.want;
    } else {
      const fp = this.camera.position.clone(), ft = this.controls.target.clone(), t0 = performance.now(), dur = 1300;
      this.controls.enabled = false;
      this.anims = [{ t0, dur, fn: (k) => { this.camera.position.lerpVectors(fp, to.pos, k); this.controls.target.lerpVectors(ft, to.tgt, k); }, done: () => { this.controls.enabled = true; } }];
    }
    if (n === 3) this.setPrint(0, !instant); else this.setPrint(1, false);
  }
  replayPrint() { this.setPrint(0, true); }

  // ---------- Auswahl und Hover ----------
  setSelected(sel) { this.sel = sel; this.paint(); }
  paint() {
    for (const m of this.pickables) {
      const u = m.userData, isSel = this.sel && u.kind === this.sel.kind && u.idx === this.sel.idx;
      const isHov = this.hover && u.kind === this.hover.kind && u.idx === this.hover.idx;
      m.material = isSel ? this.mats.sel : isHov ? this.mats.hover : u.base;
    }
  }
  bindPointer() {
    const cv = this.canvas, ray = new THREE.Raycaster(), ndc = new THREE.Vector2();
    let down = null;
    const pick = (e) => {
      const r = cv.getBoundingClientRect();
      ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
      ray.setFromCamera(ndc, this.camera);
      const h = ray.intersectObjects(this.hits || [], false)[0];
      return h ? { kind: h.object.userData.kind, idx: h.object.userData.idx } : null;
    };
    cv.addEventListener('pointermove', (e) => {
      if (e.pointerType === 'touch' || e.buttons || !this.P || this.P.R.error) return;
      const h = this.step === 3 ? null : pick(e), same = (h && this.hover && h.kind === this.hover.kind && h.idx === this.hover.idx) || (!h && !this.hover);
      if (!same) { this.hover = h; this.paint(); cv.style.cursor = h ? 'pointer' : 'grab'; }
      if (this.onHover) this.onHover(h ? this.hoverText(h) : null, e.clientX, e.clientY);
    });
    cv.addEventListener('pointerleave', () => { if (this.hover) { this.hover = null; this.paint(); } if (this.onHover) this.onHover(null); });
    cv.addEventListener('pointerdown', (e) => { down = [e.clientX, e.clientY]; });
    cv.addEventListener('pointerup', (e) => {
      if (!down) return; const moved = Math.hypot(e.clientX - down[0], e.clientY - down[1]); down = null;
      if (moved > 5 || this.step === 3) return;
      if (this.onPick) this.onPick(pick(e));
    });
  }
  hoverText(h) {
    const { R } = this.P;
    if (h.kind === 'P') { const p = R.pieces[h.idx]; return `Platte ${p.type.label} · ${cellsOf(p)} · ${fmt(p.w)} × ${fmt(p.d)} mm`; }
    const s = R.spacers.list[h.idx]; return `Leiste ${s.type.label} · ${fmt(s.x1 - s.x0, 1)} × ${fmt(s.y1 - s.y0, 1)} mm`;
  }

  frame(now) {
    for (let i = this.anims.length - 1; i >= 0; i--) {
      const a = this.anims[i], k = Math.min(1, (now - a.t0) / a.dur);
      a.fn(ease(k)); if (k >= 1) { this.anims.splice(i, 1); a.done && a.done(); }
    }
    for (const l of [this.lamp, this.lampBeds]) l.intensity += ((l.userData.want ?? 0) - l.intensity) * 0.08;
    for (const p of this.printers) if (!p.done) this.updatePrinter(p, now);
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
  }
  dispose() { this.running = false; this.ro.disconnect(); this.controls.dispose(); this.renderer.dispose(); }
}

// Kleine Ansicht für die Teilekarte und die Druckübersicht
export class MiniView {
  constructor(canvas) {
    this.canvas = canvas; this.renderer = makeRenderer(canvas);
    this.renderer.setClearColor(0x0b0907, 1);
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(30, 1, 1, 20000); this.camera.up.set(0, 0, 1);
    this.scene.add(new THREE.HemisphereLight(0xffe2c0, 0x1a120b, 2.2));
    const d = new THREE.DirectionalLight(0xffd9b0, 2.2); d.position.set(-0.6, -1, 1.6); this.scene.add(d);
    this.controls = new OrbitControls(this.camera, canvas); this.controls.enableDamping = true;
    this.group = null; this.dir = [-0.35, -1.1, 1.2];
    this.ro = new ResizeObserver(() => this.resize()); this.ro.observe(canvas); this.resize();
    this.running = true;
    const loop = () => { if (!this.running) return; requestAnimationFrame(loop); this.controls.update(); this.renderer.render(this.scene, this.camera); };
    loop();
  }
  resize() {
    const w = this.canvas.clientWidth, h = this.canvas.clientHeight; if (!w || !h) return;
    this.renderer.setSize(w, h, false); this.camera.aspect = w / h; this.camera.updateProjectionMatrix(); this.fit();
  }
  show(group, dir) {
    if (this.group) { this.scene.remove(this.group); disposeTree(this.group); }
    this.group = group; if (dir) this.dir = dir; if (group) this.scene.add(group); this.fit();
  }
  fit() {
    if (!this.group) return;
    const bb = new THREE.Box3().setFromObject(this.group); if (bb.isEmpty()) return;
    const p = poseFor(this.camera, bb, this.dir, this.camera.aspect, 0.85);
    this.camera.position.copy(p.pos); this.controls.target.copy(p.tgt); this.controls.update();
  }
  dispose() { this.running = false; this.ro.disconnect(); this.controls.dispose(); this.renderer.dispose(); }
}

// Gruppen für die kleine Ansicht
export function partGroup(P, key, withDims) {
  const m = P.mesh(key), g = new THREE.Group();
  if (m.pla && m.pla.f.length) g.add(new THREE.Mesh(toGeo(m.pla), std(COL.pla, { roughness: 0.5 })));
  if (m.petg && m.petg.f.length) g.add(new THREE.Mesh(toGeo(m.petg), std(COL.petg, { roughness: 0.45 })));
  if (m.spacer) g.add(new THREE.Mesh(toGeo(m.spacer), std(COL.spacer)));
  if (withDims) {
    const bb = new THREE.Box3().setFromObject(g), sz = bb.getSize(new THREE.Vector3());
    dims(g, 0, 0, sz.x, sz.y, Math.max(sz.x, sz.y) * 0.07, `${fmt(sz.x)} mm`, `${fmt(sz.y)} mm`);
  }
  return g;
}
export function bedsGroup(P) {
  const { R, o } = P, g = new THREE.Group(), gap = 30, cols = Math.min(R.stacks.length, 3), step = Math.max(o.bedX, o.bedY) + gap;
  R.stacks.forEach((s, i) => {
    const pg = partGroup(P, 'S:' + i, false), cx = (i % cols) * step, cy = -Math.floor(i / cols) * step;
    pg.position.set(cx, cy, 0); g.add(pg);
    const e = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.PlaneGeometry(s.bed.w, s.bed.d)), new THREE.LineBasicMaterial({ color: COL.amber, transparent: true, opacity: 0.5 }));
    e.position.set(cx + s.bed.w / 2, cy + s.bed.d / 2, 0); g.add(e);
    const lab = textSprite(s.label, o.bedY * 0.11, '#f2a65a'); lab.position.set(cx + lab.scale.x / 2 + 6, cy + s.bed.d + o.bedY * 0.09, 0); g.add(lab);
  });
  return g;
}
