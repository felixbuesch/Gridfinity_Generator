import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import GF from './gf.js';
import { createIntro } from './intro.js';

(() => {
  const $ = (id) => document.getElementById(id);
  const css = (n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
  const fmt = (x, d = 1) => (Math.round(x * 10 ** d) / 10 ** d).toLocaleString('de-DE', { minimumFractionDigits: 0, maximumFractionDigits: d });
  const esc = (t) => String(t).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const segVal = { spacersSeg: 'separate', styleSeg: 'ladder', sepSeg: 'grow' };
  const pos = { x: 'center', y: 'center' };
  const NUM = ['boxW', 'boxD', 'clearance', 'cornerR', 'minSpacer', 'spacerH', 'rail', 'ribPitch', 'bedX', 'bedY', 'bedZ', 'sepT', 'overhang', 'maxStack', 'towerReserve'];
  const STORE = 'gf-planer-v6';
  const POSNAME = { x: { start: 'links', center: 'mittig', end: 'rechts' }, y: { start: 'vorne', center: 'mittig', end: 'hinten' } };

  function readOpts() {
    const o = {};
    for (const k of NUM) { const v = parseFloat($(k).value); o[k] = isFinite(v) ? v : 0; }
    o.half = $('half').checked; o.stack = $('stack').checked;
    o.spacers = segVal.spacersSeg; o.spacerStyle = segVal.styleSeg;
    o.alignX = pos.x; o.alignY = pos.y;
    o.sepStyle = segVal.sepSeg; o.wedgeDepth = o.sepStyle === 'wedge' ? 1 : 0;
    o.maxStack = Math.max(1, Math.round(o.maxStack));
    o.sepT = Math.max(0.1, o.sepT);
    o.spacerH = Math.max(0.6, o.spacerH || GF.H);
    o.rail = Math.max(0.8, o.rail); o.ribPitch = Math.max(8, o.ribPitch);
    return o;
  }
  function save() { try { localStorage.setItem(STORE, JSON.stringify(readOpts())); } catch (e) {} }
  function load() {
    try {
      const o = JSON.parse(localStorage.getItem(STORE) || 'null'); if (!o) return;
      for (const k of NUM) if (k in o) $(k).value = o[k];
      $('half').checked = !!o.half; if (o.sepStyle) setSeg('sepSeg', o.sepStyle); $('stack').checked = o.stack !== false;
      if (o.spacers) setSeg('spacersSeg', o.spacers); if (o.spacerStyle) setSeg('styleSeg', o.spacerStyle);
      if (o.alignX) pos.x = o.alignX; if (o.alignY) pos.y = o.alignY;
    } catch (e) {}
  }
  function setSeg(id, v) {
    segVal[id] = v;
    for (const b of $(id).querySelectorAll('button')) b.setAttribute('aria-pressed', b.dataset.v === v ? 'true' : 'false');
  }
  function drawPos() {
    for (const b of $('posGrid').querySelectorAll('button')) b.setAttribute('aria-pressed', b.dataset.x === pos.x && b.dataset.y === pos.y ? 'true' : 'false');
    $('posTxt').textContent = pos.x === 'center' && pos.y === 'center' ? 'Mitte' : `${POSNAME.y[pos.y]} ${POSNAME.x[pos.x]}`.replace('mittig mittig', 'Mitte');
  }
  for (const id of Object.keys(segVal)) $(id).addEventListener('click', (e) => { const b = e.target.closest('button'); if (!b) return; setSeg(id, b.dataset.v); update(); });
  $('posGrid').addEventListener('click', (e) => { const b = e.target.closest('button'); if (!b) return; pos.x = b.dataset.x; pos.y = b.dataset.y; drawPos(); update(); });

  let R = null, O = null, sel = null; // sel = {kind:'P'|'R', idx}
  const meshCache = new Map();
  function getMesh(key) {
    if (meshCache.has(key)) return meshCache.get(key);
    let res;
    const [kind, idx] = key.split(':');
    if (kind === 'P') res = { pla: GF.plateMesh(R.types[idx]) };
    else if (kind === 'R') res = { spacer: GF.spacerMesh(R.spacers.types[idx]) };
    else { const s = GF.stackMeshes(R.stacks[idx], O); res = { pla: s.pla, petg: s.petg, height: s.height }; }
    meshCache.set(key, res); return res;
  }
  const stackOfPiece = (p) => { for (let i = 0; i < R.stacks.length; i++) { const k = R.stacks[i].items.findIndex(it => it.p === p); if (k >= 0) return { i, level: k }; } return null; };

  function update() {
    O = readOpts(); save();
    meshCache.clear(); geoCache.clear();
    R = GF.compute(O);
    if (R.error) {
      $('stats').innerHTML = `<p class="err" style="margin:0">${R.error}</p>`;
      $('parts').innerHTML = ''; $('planMsg').textContent = ''; $('dlAll').disabled = true; buildBox(); showInfo(); return;
    }
    $('dlAll').disabled = false;
    if (sel && !(sel.kind === 'P' ? R.pieces[sel.idx] : R.spacers.list[sel.idx])) sel = null;
    drawStats(); drawParts(); buildBox(); showInfo();
    const a = R.AX, b = R.AY;
    const d = (m, g) => fmt(m + g, 2);
    $('planMsg').textContent = `Abstand Raster bis Boxwand: links ${d(a.mLow, a.gapLow)}, rechts ${d(a.mHigh, a.gapHigh)}, vorne ${d(b.mLow, b.gapLow)}, hinten ${d(b.mHigh, b.gapHigh)} mm (inkl. Spiel).`;
  }

  function drawStats() {
    const nx = R.AX.cells.length, ny = R.AY.cells.length;
    const halfX = R.AX.cells.filter(c => c < 42).length, halfY = R.AY.cells.filter(c => c < 42).length;
    let pla = 0, sp = 0, petg = 0;
    R.pieces.forEach(p => { pla += GF.volume(getMesh('P:' + R.types.indexOf(p.type)).pla); });
    R.spacers.list.forEach(s => { sp += GF.volume(getMesh('R:' + R.spacers.types.indexOf(s.type)).spacer); });
    R.stacks.forEach((s, i) => { if (s.items.length > 1) petg += GF.volume(getMesh('S:' + i).petg); });
    const items = [
      ['Raster', `${nx - halfX}${halfX ? '½' : ''} × ${ny - halfY}${halfY ? '½' : ''}`],
      ['Druckteile', `${R.pieces.length} Platten${R.spacers.list.length ? ' + ' + R.spacers.list.length + ' Leisten' : ''}`],
      ['Druckbetten', String(R.stacks.length)],
      ['PLA Platten', `${fmt(pla * 1.24, 0)} g`],
      ...(R.spacers.list.length ? [['PLA Leisten', `${fmt(sp * 1.24, 0)} g`]] : []),
      ...(O.stack ? [['PETG', `${fmt(petg * 1.27, 0)} g`]] : [])
    ];
    $('stats').innerHTML = items.map(([k, v]) => `<div><span class="hint">${k}</span><b>${v}</b></div>`).join('');
  }

  const cellsOf = (p) => { const f = (a) => { const full = a.cells.filter(c => c === 42).length, h = a.cells.length - full; return full + (h ? '½' : ''); }; return f(p.ax) + '×' + f(p.ay); };
  function drawParts() {
    const rows = [`<tr><th>Teil</th><th>Raster</th><th>Maße (mm)</th><th>Anzahl</th></tr>`];
    R.types.forEach((t, i) => {
      const p = t.rep;
      rows.push(`<tr data-k="P:${R.pieces.indexOf(t.pieces[0])}"><td><span class="tag">${t.label}</span> Platte</td><td class="num">${cellsOf(p)}</td><td class="num">${fmt(p.w)} × ${fmt(p.d)}</td><td class="num">${t.pieces.length}×</td></tr>`);
    });
    R.spacers.types.forEach((t) => {
      rows.push(`<tr data-k="R:${R.spacers.list.indexOf(t.items[0])}"><td><span class="tag">${t.label}</span> Leiste</td><td class="num">–</td><td class="num">${fmt(t.w, 2)} × ${fmt(t.d, 2)}</td><td class="num">${t.items.length}×</td></tr>`);
    });
    rows.push(`<tr><th colspan="4" style="padding-top:16px">Druckbetten (je ein Druckjob)</th></tr>`);
    R.stacks.forEach((s, i) => {
      const m = getMesh('S:' + i);
      const petg = m.petg && m.petg.f.length ? ` · PETG ${fmt(GF.volume(m.petg) * 1.27, 0)} g` : '';
      const what = [s.items.length ? s.items.map(it => it.p.type.label).join('+') : '', s.spacers.length ? s.spacers.length + ' Leisten' : ''].filter(Boolean).join(' + ');
      const k = s.items.length ? 'P:' + R.pieces.indexOf(s.items[0].p) : 'R:' + R.spacers.list.indexOf(s.spacers[0].sp);
      rows.push(`<tr data-k="${k}"><td><span class="tag st">${s.label}</span></td><td class="num">${what}</td><td class="num">H ${fmt(m.height, 2)}${petg}</td><td class="num">${s.items.length ? s.items.length + ' Pl.' : '–'}</td></tr>`);
    });
    $('parts').innerHTML = rows.join('');
    markRows();
  }
  function markRows() {
    const k = sel ? sel.kind + ':' + sel.idx : '';
    for (const tr of $('parts').querySelectorAll('tr[data-k]')) tr.classList.toggle('sel', tr.dataset.k === k);
  }
  $('parts').addEventListener('click', (e) => { const tr = e.target.closest('tr[data-k]'); if (!tr) return; const [k, i] = tr.dataset.k.split(':'); select({ kind: k, idx: +i }); });

  // ---------- 3D helpers ----------
  const geoCache = new Map();
  function geo(m) {
    const g = new THREE.BufferGeometry();
    const pos = new Float32Array(m.f.length * 3);
    for (let i = 0; i < m.f.length; i++) { const v = m.f[i] * 3; pos[i * 3] = m.v[v]; pos[i * 3 + 1] = m.v[v + 1]; pos[i * 3 + 2] = m.v[v + 2]; }
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.computeVertexNormals(); return g;
  }
  function cachedGeo(key, which) { const k = key + which; if (!geoCache.has(k)) geoCache.set(k, geo(getMesh(key)[which])); return geoCache.get(k); }
  const mat = (color, extra) => new THREE.MeshStandardMaterial(Object.assign({ color: new THREE.Color(color), roughness: 0.8, metalness: 0, flatShading: true }, extra || {}));

  function makeViewer(canvas) {
    const v = {};
    v.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, preserveDrawingBuffer: true });
    v.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    v.scene = new THREE.Scene();
    v.camera = new THREE.PerspectiveCamera(32, 4 / 3, 1, 5000);
    v.camera.up.set(0, 0, 1);
    v.scene.add(new THREE.HemisphereLight(0xffffff, 0x445566, 0.8 * Math.PI));
    const d1 = new THREE.DirectionalLight(0xffffff, 0.7 * Math.PI); d1.position.set(-0.6, -1, 1.5); v.scene.add(d1);
    const d2 = new THREE.DirectionalLight(0xffffff, 0.25 * Math.PI); d2.position.set(1, 0.7, 0.6); v.scene.add(d2);
    { v.controls = new OrbitControls(v.camera, canvas); v.controls.enableDamping = true; v.controls.screenSpacePanning = true; }
    const resize = () => { const w = canvas.clientWidth, h = canvas.clientHeight; if (w && h) { v.renderer.setSize(w, h, false); v.camera.aspect = w / h; v.camera.updateProjectionMatrix(); } };
    new ResizeObserver(resize).observe(canvas); resize();
    v.group = null;
    v.set = (g) => { if (v.group) v.scene.remove(v.group); v.group = g; if (g) v.scene.add(g); };
    v.fit = (dir, target) => {
      if (!v.group) return;
      const box = new THREE.Box3().setFromObject(target || v.group), c = box.getCenter(new THREE.Vector3()), sz = box.getSize(new THREE.Vector3());
      const r = Math.max(sz.x / Math.max(1, v.camera.aspect * 0.8), sz.y, sz.z * 2.5, 30);
      const d = dir || [-0.45, -1.25, 1.05];
      const k = r / (2 * Math.tan(v.camera.fov * Math.PI / 360)) / Math.hypot(...d) * 0.95 / Math.min(1, v.camera.aspect);
      v.camera.position.set(c.x + d[0] * k, c.y + d[1] * k, c.z + d[2] * k);
      v.camera.near = r / 200; v.camera.far = r * 30; v.camera.updateProjectionMatrix();
      if (v.controls) { v.controls.target.copy(c); v.controls.update(); } else v.camera.lookAt(c);
    };
    const loop = () => { requestAnimationFrame(loop); v.controls && v.controls.update(); v.renderer.render(v.scene, v.camera); };
    loop();
    return v;
  }
  let BV = null, MV = null, pickables = [], hitboxes = [], selColorMat = null;
  const has3D = () => true;

  function buildBox() {
    if (!has3D()) { $('infoBody').innerHTML = '<p class="msg">3D-Ansicht nicht verfügbar (three.js nicht geladen).</p>'; return; }
    if (!BV) BV = makeViewer($('box3d'));
    const g = new THREE.Group(); pickables = []; hitboxes = []; hover = null; const tipEl = $('hoverTip'); if (tipEl) tipEl.hidden = true;
    if (R && !R.error) {
      const W = O.boxW, D = O.boxD, wallH = 22, t = 3;
      // floor + walls of the box
      const floor = new THREE.Mesh(new THREE.BoxGeometry(W, D, 1), mat(css('--grid'))); floor.position.set(W / 2, D / 2, -0.55); g.add(floor);
      const wm = mat(css('--muted'), { transparent: true, opacity: 0.18, depthWrite: false });
      const walls = [[W / 2, -t / 2, W + 2 * t, t], [W / 2, D + t / 2, W + 2 * t, t], [-t / 2, D / 2, t, D], [W + t / 2, D / 2, t, D]];
      for (const [x, y, w, d] of walls) { const m = new THREE.Mesh(new THREE.BoxGeometry(w, d, wallH), wm); m.position.set(x, y, wallH / 2 - 1); g.add(m); }
      const edges = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(W, D, wallH)), new THREE.LineBasicMaterial({ color: new THREE.Color(css('--muted')) }));
      edges.position.set(W / 2, D / 2, wallH / 2 - 1); g.add(edges);
      addDims(g, 0, 0, W, D, t + Math.max(W, D) * 0.05, `${fmt(W, 1)} mm innen`, `${fmt(D, 1)} mm`, css('--ink'));

      const ox = R.AX.gapLow, oy = R.AY.gapLow;
      const plaM = mat(css('--pla')), spM = mat(css('--spacer'));
      selColorMat = mat(css('--accent'), { emissive: new THREE.Color(css('--accent')), emissiveIntensity: 0.25 });
      hoverMat = mat(css('--hover'), { emissive: new THREE.Color(css('--hover')), emissiveIntensity: 0.08 });
      const hitM = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false, colorWrite: false });
      R.pieces.forEach((p, i) => {
        const m = new THREE.Mesh(cachedGeo('P:' + R.types.indexOf(p.type), 'pla'), plaM);
        m.position.set(ox + p.x, oy + p.y, 0); m.userData = { kind: 'P', idx: i, base: plaM }; g.add(m); pickables.push(m);
        const hb = new THREE.Mesh(new THREE.BoxGeometry(p.w, p.d, GF.H), hitM); hb.position.set(ox + p.x + p.w / 2, oy + p.y + p.d / 2, GF.H / 2);
        hb.userData = { kind: 'P', idx: i, hit: true }; g.add(hb); hitboxes.push(hb);
        const e = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(p.w, p.d, GF.H)), new THREE.LineBasicMaterial({ color: new THREE.Color(css('--ink')), transparent: true, opacity: 0.35 }));
        e.position.set(ox + p.x + p.w / 2, oy + p.y + p.d / 2, GF.H / 2); g.add(e);
      });
      R.spacers.list.forEach((s, i) => {
        const m = new THREE.Mesh(cachedGeo('R:' + R.spacers.types.indexOf(s.type), 'spacer'), spM);
        m.position.set(ox + s.x0, oy + s.y0, 0); m.userData = { kind: 'R', idx: i, base: spM }; g.add(m); pickables.push(m);
        const hh = s.type.h, hb = new THREE.Mesh(new THREE.BoxGeometry(s.x1 - s.x0, s.y1 - s.y0, hh), hitM); hb.position.set(ox + (s.x0 + s.x1) / 2, oy + (s.y0 + s.y1) / 2, hh / 2);
        hb.userData = { kind: 'R', idx: i, hit: true }; g.add(hb); hitboxes.push(hb);
      });
    }
    BV.set(g); paintSel();
    const dk = O ? O.boxW + 'x' + O.boxD : '';
    if (BV.dimKey !== dk) { BV.fit(); BV.dimKey = dk; }
  }
  let hover = null, hoverMat = null;
  function paintSel() {
    for (const m of pickables) {
      const u = m.userData, isSel = sel && u.kind === sel.kind && u.idx === sel.idx, isHov = hover && u.kind === hover.kind && u.idx === hover.idx;
      m.material = isSel ? selColorMat : isHov ? hoverMat : u.base;
    }
  }

  // click picking (ignore drags)
  (() => {
    const cv = $('box3d'); let down = null;
    const pick = (e) => {
      const r = cv.getBoundingClientRect(), ndc = new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
      const rc = new THREE.Raycaster(); rc.setFromCamera(ndc, BV.camera);
      const hit = rc.intersectObjects(hitboxes, false)[0];
      return hit ? { kind: hit.object.userData.kind, idx: hit.object.userData.idx } : null;
    };
    const setHover = (h) => {
      if ((h && hover && h.kind === hover.kind && h.idx === hover.idx) || (!h && !hover)) return;
      hover = h; cv.style.cursor = h ? 'pointer' : 'grab'; paintSel();
      const tip = $('hoverTip');
      if (h) {
        const t = h.kind === 'P' ? R.pieces[h.idx] : R.spacers.list[h.idx];
        tip.textContent = h.kind === 'P' ? `Platte ${t.type.label} · ${cellsOf(t)} · ${fmt(t.w)} × ${fmt(t.d)} mm` : `Leiste ${t.type.label} · ${fmt(t.x1 - t.x0, 2)} × ${fmt(t.y1 - t.y0, 2)} mm`;
        tip.hidden = false;
      } else tip.hidden = true;
    };
    cv.addEventListener('pointermove', (e) => { if (!BV || e.pointerType === 'touch' || e.buttons) return; setHover(pick(e)); });
    cv.addEventListener('pointerleave', () => setHover(null));
    cv.addEventListener('pointerdown', (e) => { down = [e.clientX, e.clientY]; });
    cv.addEventListener('pointerup', (e) => {
      if (!down || !BV) return; const moved = Math.hypot(e.clientX - down[0], e.clientY - down[1]); down = null; if (moved > 5) return;
      select(pick(e));
    });
  })();
  $('vTop').addEventListener('click', () => BV && BV.fit([0, -0.001, 1]));
  $('vIso').addEventListener('click', () => BV && BV.fit());

  function select(s) { sel = s; paintSel(); markRows(); showInfo(); }

  // ---------- info card + mini preview ----------
  const jobName = (st) => st.items.length ? (st.items.length > 1 ? 'Stapel ' : 'Druckjob ') + st.label : 'Leisten-Bett ' + st.label;
  function fileFor(s) {
    if (s.kind === 'P') {
      const p = R.pieces[s.idx];
      const st = stackOfPiece(p);
      return { key: 'S:' + st.i, label: jobName(R.stacks[st.i]), level: st.level, stack: R.stacks[st.i] };
    }
    const sp = R.spacers.list[s.idx], i = R.stacks.indexOf(sp.job);
    const e = sp.job.spacers.find(q => q.sp === sp), tower = sp.job.spacers.filter(q => q.x === e.x && q.y === e.y).length;
    return { key: 'S:' + i, label: jobName(sp.job), job: sp.job, spacer: true, slevel: e.level || 0, tower };
  }
  // text label sprite (world units)
  function label(text, hWorld, color) {
    const fs = 64, c = document.createElement('canvas'), ctx = c.getContext('2d');
    ctx.font = `600 ${fs}px ${css('--f-mono') || 'monospace'}`;
    const w = Math.ceil(ctx.measureText(text).width) + 24; c.width = w; c.height = fs + 20;
    ctx.font = `600 ${fs}px ${css('--f-mono') || 'monospace'}`; ctx.fillStyle = color; ctx.textBaseline = 'middle'; ctx.fillText(text, 12, c.height / 2 + 2);
    const tex = new THREE.CanvasTexture(c); tex.anisotropy = 4;
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true }));
    s.scale.set(hWorld * c.width / c.height, hWorld, 1); s.renderOrder = 10; return s;
  }
  // dimension lines along the front (width) and left (depth) of a rectangle x0..x0+w, y0..y0+d
  function addDims(g, x0, y0, w, d, off, txtW, txtD, color) {
    const k = Math.max(w, d), th = k * 0.06, tick = k * 0.02;
    const lm = new THREE.LineBasicMaterial({ color: new THREE.Color(color) });
    const seg = (pts) => { const geo = new THREE.BufferGeometry().setFromPoints(pts.map(p => new THREE.Vector3(...p))); g.add(new THREE.LineSegments(geo, lm)); };
    const yy = y0 - off, xx = x0 - off;
    seg([[x0, yy, 0], [x0 + w, yy, 0], [x0, yy - tick, 0], [x0, yy + tick, 0], [x0 + w, yy - tick, 0], [x0 + w, yy + tick, 0], [x0, y0, 0], [x0, yy - tick, 0], [x0 + w, y0, 0], [x0 + w, yy - tick, 0]]);
    seg([[xx, y0, 0], [xx, y0 + d, 0], [xx - tick, y0, 0], [xx + tick, y0, 0], [xx - tick, y0 + d, 0], [xx + tick, y0 + d, 0], [x0, y0, 0], [xx - tick, y0, 0], [x0, y0 + d, 0], [xx - tick, y0 + d, 0]]);
    const l1 = label(txtW, th, color); l1.position.set(x0 + w / 2, yy - th * 0.9, 0); g.add(l1);
    const l2 = label(txtD, th, color); l2.position.set(xx - th * 0.4 - l2.scale.x / 2, y0 + d / 2, 0); g.add(l2);
  }

  let PV = null;
  function partGroup(key) {
    if (key === 'LEISTEN') { // all spacer strips side by side
      const g = new THREE.Group(); let y = 0;
      R.spacers.list.forEach((s) => {
        const ti = R.spacers.types.indexOf(s.type), m = new THREE.Mesh(cachedGeo('R:' + ti, 'spacer'), mat(css('--spacer')));
        const w = s.x1 - s.x0, d = s.y1 - s.y0;
        if (w < d) { m.rotation.z = Math.PI / 2; m.position.set(d, y, 0); y += w + 4; } else { m.position.set(0, y, 0); y += d + 4; }
        g.add(m);
      });
      return g;
    }
    const m = getMesh(key), g = new THREE.Group();
    if (m.pla && m.pla.f.length) g.add(new THREE.Mesh(cachedGeo(key, 'pla'), mat(css('--pla'))));
    if (m.petg && m.petg.f.length) g.add(new THREE.Mesh(cachedGeo(key, 'petg'), mat(css('--petg'))));
    if (m.spacer) g.add(new THREE.Mesh(cachedGeo(key, 'spacer'), mat(css('--spacer'))));
    return g;
  }
  function bedOutline(cx, cy, w, d) {
    const bp = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.PlaneGeometry(w || O.bedX, d || O.bedY)), new THREE.LineBasicMaterial({ color: new THREE.Color(css('--muted')) }));
    bp.position.set(cx, cy, 0); return bp;
  }
  // all print jobs side by side, each on its own bed outline
  function jobs() {
    return R.stacks.map((s, i) => ({ key: 'S:' + i, name: s.label, bed: s.bed }));
  }
  function showPrint() {
    if (!has3D() || !R || R.error) return;
    if (!MV) MV = makeViewer($('mini'));
    const g = new THREE.Group(), gap = 25;
    let f = sel ? fileFor(sel) : null;
    if (f) {
      const job = f.stack || f.job, pg = partGroup(f.key), bw = job.bed.w, bd = job.bed.d;
      g.add(pg); g.add(bedOutline(bw / 2, bd / 2, bw, bd));
      MV.set(g); MV.fit([-0.35, -1.1, 1.1]);
      let cap = f.label;
      if (f.stack && f.stack.items.length > 1) cap += ` · Ebene ${f.level + 1}/${f.stack.items.length}`;
      if (job.spacers.length) cap += f.spacer ? (f.tower > 1 ? ` · Leiste im Turm, Ebene ${f.slevel + 1}/${f.tower}` : ' · Leiste liegt mit auf dem Bett') : ` · + ${job.spacers.length} Leisten`;
      $('pwCap').textContent = cap;
      $('pwDl').innerHTML = `<button class="btn ghost" type="button" id="dlOne" data-tip="Nur diese Druckdatei als ZIP laden (bei Stapeln PLA- und PETG-STL plus 3MF).">Druckdatei laden</button><span class="msg" id="dlOneMsg"></span>`;
      $('dlOne').addEventListener('click', async () => {
        const b = $('dlOne'); b.disabled = true; $('dlOneMsg').textContent = 'Erzeuge …';
        await new Promise(r => setTimeout(r, 20));
        try { $('dlOneMsg').textContent = await offer(safe(f.label.replace(' ', '_')) + '.zip', GF.zip(filesFor(f.key))); }
        catch (e) { $('dlOneMsg').textContent = 'Fehler: ' + e.message; }
        b.disabled = false;
      });
    } else {
      const js = jobs(), cols = Math.min(js.length, 3);
      js.forEach((jb, n) => {
        const pg = partGroup(jb.key), bw = jb.bed.w, bd = jb.bed.d;
        const cx = (n % cols) * (Math.max(O.bedX, O.bedY) + gap), cy = -Math.floor(n / cols) * (Math.max(O.bedX, O.bedY) + gap);
        pg.position.set(cx - bw / 2, cy - bd / 2, 0); g.add(pg); g.add(bedOutline(cx, cy, bw, bd));
        const lb = label(jb.name, O.bedY * 0.13, css('--ink')); lb.position.set(cx - bw / 2 + lb.scale.x / 2 + 6, cy + bd / 2 + O.bedY * 0.1, 0); g.add(lb);
      });
      MV.set(g); MV.fit([0, -0.35, 1]);
      $('pwCap').textContent = `${js.length} Druckbetten gesamt`;
      $('pwDl').innerHTML = '';
    }
  }
  function showInfo() {
    const head = $('infoHead'), body = $('infoBody'), cv = $('part3d');
    if (!R || R.error) { head.innerHTML = ''; body.innerHTML = ''; cv.hidden = true; return; }
    if (!sel) {
      cv.hidden = true;
      head.innerHTML = `<h3>Teil antippen</h3>`;
      body.innerHTML = `<p class="msg" style="margin:0">Klick in der Box auf eine Platte oder Leiste. Hier erscheint dann das Teil einzeln in 3D mit Maßen. Unten siehst du immer die Druckansicht.</p><p class="msg" style="margin:0">Ziehen dreht, Mausrad oder zwei Finger zoomen, Rechtsklick verschiebt.</p>`;
      showPrint(); return;
    }
    const ox = R.AX.gapLow, oy = R.AY.gapLow;
    let title, rows, key, w, d;
    if (sel.kind === 'P') {
      const p = R.pieces[sel.idx]; key = 'P:' + R.types.indexOf(p.type); w = p.w; d = p.d;
      title = `<span class="tag">${p.type.label}</span> Platte <span class="hint" style="font-weight:500">${cellsOf(p)}</span>`;
      rows = [['Maße', `${fmt(p.w)} × ${fmt(p.d)} × ${fmt(GF.H, 2)} mm`],
        ['Position', `${fmt(ox + p.x, 1)} / ${fmt(oy + p.y, 1)} mm ab links / vorne`], ['Gleiche Teile', `${p.type.pieces.length}×`],
        ['PLA', `${fmt(GF.volume(getMesh(key).pla) * 1.24, 0)} g`]];
    } else {
      const s = R.spacers.list[sel.idx], t = s.type; key = 'R:' + R.spacers.types.indexOf(t); w = t.w; d = t.d;
      title = `<span class="tag">${t.label}</span> Leiste`;
      rows = [['Maße', `${fmt(t.w, 2)} × ${fmt(t.d, 2)} × ${fmt(t.h, 2)} mm`], ['Form', O.spacerStyle === 'solid' || t.tiles.length === 1 ? 'voll' : `Leiter, ${fmt(O.rail, 2)} mm Schienen`],
        ['Position', `${fmt(ox + s.x0, 1)} / ${fmt(oy + s.y0, 1)} mm ab links / vorne`], ['Gleiche Teile', `${t.items.length}×`],
        ['PLA', `${fmt(GF.volume(getMesh(key).spacer) * 1.24, 1)} g`]];
    }
    head.innerHTML = `<h3>${title}</h3>`;
    body.innerHTML = `<dl>${rows.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('')}</dl>`;
    cv.hidden = false;
    if (has3D()) {
      if (!PV) PV = makeViewer(cv);
      const g = new THREE.Group(), pg = partGroup(key);
      g.add(pg);
      addDims(g, 0, 0, w, d, Math.max(w, d) * 0.06, `${fmt(w, 1)} mm`, `${fmt(d, 1)} mm`, css('--muted'));
      PV.set(g); PV.fit([-0.35, -1.1, 1.25]);
    }
    showPrint();
  }

  // ---------- export ----------
  const safe = (s) => s.replace(/[^A-Za-z0-9_.-]+/g, '_');
  function filesFor(key) {
    const [kind, i] = key.split(':'), out = [];
    if (kind === 'P') {
      const t = R.types[i], p = t.rep;
      out.push([`Platte_${t.label}_${p.ax.cells.length}x${p.ay.cells.length}_${safe(fmt(p.w))}x${safe(fmt(p.d))}mm_${t.pieces.length}x.stl`, GF.stl(getMesh(key).pla, 'Platte ' + t.label)]);
    } else if (kind === 'R') {
      const t = R.spacers.types[i];
      out.push([`Leiste_${t.label}_${safe(fmt(t.w, 2))}x${safe(fmt(t.d, 2))}mm_${t.items.length}x.stl`, GF.stl(getMesh(key).spacer, 'Leiste ' + t.label)]);
    } else {
      const s = R.stacks[i], m = getMesh(key), base = `${s.label}_${s.items.map(it => it.p.type.label).join('')}${s.spacers.length ? (s.items.length ? '_mit_' : '') + s.spacers.length + 'Leisten' : ''}`;
      out.push([base + '_PLA.stl', GF.stl(m.pla, base + ' PLA')]);
      if (m.petg.f.length) out.push([base + '_PETG.stl', GF.stl(m.petg, base + ' PETG')]);
      // Bambu-Studio-Projekt: PLA-Teil auf Filament 1, PETG-Teil auf Filament 2
      out.push([base + '.3mf', GF.threeMF([{ name: base + ' PLA', mesh: m.pla, extruder: 1 }, { name: base + ' PETG Trennschicht', mesh: m.petg, extruder: 2 }], base)]);
    }
    return out;
  }
  function buildZip() {
    const files = [];
    R.stacks.forEach((s, i) => filesFor('S:' + i).forEach(([n, d]) => files.push(['druckbetten/' + n, d])));
    R.types.forEach((t, i) => filesFor('P:' + i).forEach(([n, d]) => files.push(['einzelteile/platten/' + n, d])));
    R.spacers.types.forEach((t, i) => filesFor('R:' + i).forEach(([n, d]) => files.push(['einzelteile/leisten/' + n, d])));
    files.push(['LIESMICH.txt', readme()]);
    return GF.zip(files);
  }
  function readme() {
    const L = [];
    L.push('Gridfinity Planer – Export', '');
    L.push(`Box innen: ${O.boxW} x ${O.boxD} mm, Spiel je Achse ${O.clearance} mm, Raster liegt: ${POSNAME.y[pos.y]} ${POSNAME.x[pos.x]}`);
    L.push(`Raster: ${R.AX.cells.length} x ${R.AY.cells.length} Zellen (${R.AX.cells.join('+')} / ${R.AY.cells.join('+')} mm)`);
    L.push(`Abstandshalter links/rechts: ${R.AX.mLow} / ${R.AX.mHigh} mm, vorne/hinten: ${R.AY.mLow} / ${R.AY.mHigh} mm (${O.spacers === 'separate' ? 'separate Leisten, ' + (O.spacerStyle === 'solid' ? 'voll' : 'Leiter') + ', Höhe ' + O.spacerH + ' mm' : 'in Platten integriert'})`);
    L.push(`Druckbett: ${O.bedX} x ${O.bedY} x ${O.bedZ} mm${O.stack ? ', Reserve Prime-Tower ' + O.towerReserve + ' mm' : ''}`, '');
    const ox = R.AX.gapLow, oy = R.AY.gapLow;
    L.push('Platten (Position = linke vordere Ecke, gemessen ab linker und vorderer Boxwand, mm):');
    R.pieces.forEach(p => L.push(`  ${p.type.label}: ${fmt(p.w)} x ${fmt(p.d)} bei x=${fmt(ox + p.x, 2)} y=${fmt(oy + p.y, 2)}`));
    if (R.spacers.list.length) { L.push('', 'Leisten:'); R.spacers.list.forEach(s => L.push(`  ${s.type.label} (${{ S: 'vorne', N: 'hinten', W: 'links', E: 'rechts' }[s.side]}): ${fmt(s.x1 - s.x0, 2)} x ${fmt(s.y1 - s.y0, 2)} bei x=${fmt(ox + s.x0, 2)} y=${fmt(oy + s.y0, 2)}`)); }
    L.push('', 'Druckbetten (Ordner druckbetten/, je Datei ein Druck; Leisten liegen schon neben den Platten):');
    R.stacks.forEach((s) => L.push(`  ${s.label}: ${s.items.map(it => it.p.type.label).join(' + ') || '-'}${s.items.length > 1 ? ' (unten -> oben)' : ''}${s.spacers.length ? ' + ' + s.spacers.length + ' Leisten daneben' : ''}`));
    if (O.stack) {
      L.push('', `Stapel: PETG-Trennschicht ${O.sepT} mm, Form: ${({ sheet: 'durchgehende Folie', wedge: 'Netz mit 45°-Keil', ring: 'Netz unter den Stegen', grow: `wächst aus der Stegspitze mit ${O.overhang}° Überhang` })[O.sepStyle]}.`);
      L.push('', 'Bambu Studio:', '  1. S*.3mf öffnen (Bambu-Studio-Projektformat, PLA-Teil = Filament 1, PETG-Teil = Filament 2).',
        '     Ausweichweg: S*_PLA.stl und S*_PETG.stl zusammen importieren und "als ein Objekt mit mehreren Teilen" laden.',
        '  2. Filament 1 = PLA, Filament 2 = PETG; prüfen, dass die Teile so zugeordnet sind (X2D: PLA linke Düse, PETG rechte Düse).',
        '  3. Stützen aus, Prime-Tower an, Schichthöhe 0,2 mm.', '  4. Nach dem Druck die Platten von oben abziehen, PETG-Reste abziehen.');
    }
    return L.join('\r\n');
  }
  async function offer(filename, bytes) {
    let dl = null;
    try { dl = window.claude && window.claude.use ? await window.claude.use('downloads') : null; } catch (e) { dl = null; }
    if (dl) {
      try { await dl.save({ filename, data: new Blob([bytes], { type: 'application/zip' }) }); return 'Gespeichert.'; }
      catch (e) { return e && e.code === 'declined' ? 'Download abgebrochen.' : 'Download nicht möglich (' + (e && e.code || 'Fehler') + ').'; }
    }
    const url = URL.createObjectURL(new Blob([bytes], { type: 'application/zip' }));
    const a = document.createElement('a'); a.href = url; a.download = filename; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
    return 'Download gestartet.';
  }
  $('dlAll').addEventListener('click', async () => {
    const b = $('dlAll'); b.disabled = true; $('dlMsg').textContent = 'Erzeuge Dateien …';
    await new Promise(r => setTimeout(r, 30));
    try {
      const z = buildZip();
      $('dlMsg').textContent = `${(z.length / 1048576).toFixed(1)} MB · ` + await offer(`gridfinity_${Math.round(O.boxW)}x${Math.round(O.boxD)}.zip`, z);
    } catch (e) { $('dlMsg').textContent = 'Fehler beim Erzeugen: ' + e.message; }
    b.disabled = false;
  });

  $('form').addEventListener('input', () => { clearTimeout(window.__t); window.__t = setTimeout(update, 200); });
  $('form').addEventListener('submit', (e) => e.preventDefault());
  const retheme = () => { if (R && !R.error) { buildBox(); showInfo(); } };
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', retheme);
  new MutationObserver(retheme).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });

  // ---------- hover help ----------
  const TIPS = {
    boxW: 'Innenmaß der Box von links nach rechts. Am Boden messen, dort ist die Box meist am engsten.',
    boxD: 'Innenmaß der Box von vorne nach hinten.',
    clearance: 'Luft, die insgesamt pro Richtung abgezogen wird, damit alles ohne Klemmen in die Box passt. Je Seite ist es die Hälfte.',
    cornerR: 'Rundung der Box-Innenecken. Die Leisten in den Ecken werden passend abgerundet.',
    spacersSeg: 'Separate Leisten: eigene dünne Teile am Rand, die Platten bleiben gleich groß und lassen sich gut stapeln. Integriert: der Rand wird fest an die Randplatten angedruckt.',
    posGrid: 'Wähle, an welcher Wand oder Ecke das Raster anliegt. Der Rest wird auf der Gegenseite mit Leisten aufgefüllt.',
    minSpacer: 'Ist der Rest schmaler als dieser Wert, wird keine Leiste gedruckt und es bleibt einfach ein Spalt.',
    half: 'Passt am Rand noch eine halbe Zelle (21 mm), wird eine halbe Reihe statt einer breiten Leiste eingesetzt.',
    styleSeg: 'Leiter: zwei dünne Schienen mit Querstreben, sehr wenig Material. Voll: massiver Streifen.',
    spacerH: 'Höhe der Leisten. Sie müssen nicht so hoch wie die Platten sein (4,65 mm), weil sie nur seitlich anliegen.',
    rail: 'Breite der beiden Längsschienen einer Leiter-Leiste. 1,2 mm entsprechen drei Bahnen mit 0,4-mm-Düse.',
    ribPitch: 'Abstand der Querstreben zwischen den Schienen. Größer spart Material, kleiner macht die Leiste steifer.',
    bedX: 'Nutzbare Breite des Druckbetts. X2D mit beiden Düsen: 235,5 mm.',
    bedY: 'Nutzbare Tiefe des Druckbetts. X2D: 256 mm.',
    bedZ: 'Maximale Druckhöhe. Begrenzt, wie viele Platten in einen Stapel passen.',
    stack: 'Mehrere Platten in einem Druck übereinander, getrennt durch eine dünne PETG-Schicht.',
    sepT: 'Dicke der PETG-Trennschicht zwischen zwei Platten. 0,4 mm sind zwei Schichten bei 0,2 mm Schichthöhe.',
    sepSeg: 'Aus Stegspitze: PETG startet oben auf den Stegen und wächst ohne Stützen schräg nach außen bis unter die nächste Platte. Netz: flaches Gitter unter den Stegen. Netz + Keil: zusätzlich Keile auf der Schräge. Folie: ganze Fläche.',
    overhang: 'Wie flach das PETG nach außen wachsen darf, gemessen von der Senkrechten. 45° druckt sicher ohne Stützen. Größer = niedrigerer Stapel, aber riskanter.',
    maxStack: 'Höchstens so viele Platten pro Druckjob. Weniger heißt kürzere Jobs und weniger Risiko bei einem Fehldruck.',
    towerReserve: 'Platz, der auf dem Bett für den Prime-Tower frei bleibt. Er wird beim Filamentwechsel PLA/PETG gebraucht.',
    vTop: 'Box von oben ansehen.',
    vIso: 'Box schräg von vorne ansehen.',
    dlAll: 'Alle Platten, Leisten und Stapel als STL/3MF in einem ZIP, mit Anleitung.'
  };
  for (const [id, t] of Object.entries(TIPS)) {
    const el = $(id); if (!el) continue;
    const host = el.closest('label.f, label.chk') || el; host.dataset.tip = t;
  }
  (() => {
    const tip = $('ftip'); let timer = null, cur = null;
    const place = (el) => {
      const r = el.getBoundingClientRect(), tw = tip.offsetWidth, th = tip.offsetHeight;
      let x = Math.min(Math.max(8, r.left), window.innerWidth - tw - 8), y = r.bottom + 6;
      if (y + th > window.innerHeight - 8) y = r.top - th - 6;
      tip.style.left = x + 'px'; tip.style.top = y + 'px';
    };
    const show = (el) => { cur = el; tip.textContent = el.dataset.tip; tip.classList.add('on'); place(el); };
    const hide = () => { clearTimeout(timer); cur = null; tip.classList.remove('on'); };
    document.addEventListener('pointerover', (e) => {
      if (e.pointerType === 'touch') return;
      const el = e.target.closest('[data-tip]'); if (el === cur) return;
      clearTimeout(timer); if (!el) { hide(); return; }
      timer = setTimeout(() => show(el), 350);
    });
    document.addEventListener('focusin', (e) => { const el = e.target.closest('[data-tip]'); if (el) show(el); });
    document.addEventListener('focusout', hide);
    window.addEventListener('scroll', hide, { passive: true });
  })();
  load(); drawPos();
  // Einsatzort aus dem Intro übernehmen
  function apply(opts, use, W, D) {
    for (const [k, v] of Object.entries(opts)) if ($(k)) $(k).value = v;
    $('boxTitle').textContent = use.area;
    $('boxHint').textContent = use.hint;
    $('useSub').textContent = `${use.name} · ${fmt(W)} × ${fmt(D)} mm`;
    $('stack').checked = true;
  }
  document.documentElement.dataset.theme = 'dark';
  const intro = createIntro({
    onDone: ({ use, W, D, opts }) => {
      apply(opts, use, W, D); sel = null;
      $('app').hidden = false; window.scrollTo(0, 0);
      update();
      if (BV) { BV.dimKey = ''; requestAnimationFrame(() => { BV.fit(); BV.dimKey = O.boxW + 'x' + O.boxD; }); }
    },
  });
  $('toIntro').addEventListener('click', () => { $('app').hidden = true; intro.show(); });
  TIPS.toIntro = 'Zurück zur Auswahl Schreibtisch, Schublade oder Box.';
  $('toIntro').dataset.tip = TIPS.toIntro;
  window.__gf = { buildZip, select, get R() { return R; } };
})();
