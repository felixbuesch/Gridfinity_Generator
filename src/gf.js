// Gridfinity geometry + layout core. No dependencies; runs in Node and in the browser (ES module).
const GF = (() => {
  const PITCH = 42, R = 4, H = 4.4, MAX_DIM = 2000;
  // baseplate pocket profile, bottom -> top: [z, inset]
  // Oben flach abgeschnitten (statt Stegspitze bei 4,65): Stege haben überall 0,5 mm breite Oberkante,
  // keine höheren Eck-Inseln -> PLA und kopfüber gedrucktes PETG liegen auf dem ganzen Kamm aufeinander.
  const TOP = 0.25;
  const PROFILE = [[0, 2.85], [0.7, 2.15], [2.5, 2.15], [H, TOP]];
  const T_BOT = 2.85, CHAMFER_Z = 2.5, CHAMFER_T = 2.15;
  const ARC = 8; // segments per rounded corner
  // Eckrundung der Wand (Schublade/Box): alle Teile bleiben innerhalb der Wandrundung minus Spiel
  const MIN_ROUND = 0.2;   // mm: kleinere Rundungen werden nicht geschnitten
  const ARC_SAG = 0.02;    // mm: größte Abweichung der Sehnen vom Kreisbogen
  // Verbindungen zwischen Grundplatten: Schwalbenschwanz an der Unterseite, mittig je Zelle an jeder Stoßkante.
  // Der Rand einer Zelle ist unten 2,85 mm und von 0,7 bis 2,5 mm Höhe 2,15 mm massiv, darüber wird er schmaler.
  // Die Tasche bleibt deshalb unter 2,5 mm Höhe und 1,35 mm tief: dahinter bleiben 0,8 mm Wand, oben bleibt alles unberührt.
  const CONN = {
    depth: 1.2,    // mm: so weit ragt ein Zapfen über die Stoßkante (Brücke: je Seite)
    neck: 6,       // mm: Breite an der Stoßkante
    flank: 45,     // Grad: Hinterschnitt der Flanken; Kopf = neck + 2 · depth · tan(flank)
    height: 2.3,   // mm: Höhe von Zapfen und Brücke ab Unterseite
    pocketH: 2.5,  // mm: Höhe der Tasche (0,2 mm Luft über dem Zapfen = eine Schicht)
    fit: 0.15,     // mm: Spiel je Flanke und an der Zapfenspitze (Standard)
    blockN: 10,    // Brücken je Reihe auf dem Druckbett
    blockGap: 2,   // mm: Abstand der Brücken auf dem Druckbett
    spare: 2,      // Brücken zusätzlich als Reserve
  };
  // Drucker: nutzbares Druckbett (mm) und Zahl der Düsen. Weitere Angaben (Preis, Geschwindigkeit ...) können
  // später je Eintrag ergänzt werden; gerechnet wird überall nur mit bedX/bedY/bedZ aus den Einstellungen.
  const PRINTERS = [
    { id: 'x2d', name: 'Bambu Lab X2D (zwei Düsen)', bedX: 235, bedY: 256, bedZ: 256, nozzles: 2 },
    { id: 'a1mini', name: 'Bambu Lab A1 mini', bedX: 180, bedY: 180, bedZ: 180, nozzles: 1 },
    { id: 'a1', name: 'Bambu Lab A1', bedX: 256, bedY: 256, bedZ: 256, nozzles: 1 },
    { id: 'p1s', name: 'Bambu Lab P1S / X1C', bedX: 256, bedY: 256, bedZ: 256, nozzles: 1 },
  ];
  const CUSTOM_PRINTER = { id: 'custom', name: 'Eigener Drucker', nozzles: 1 };
  // gewählter Drucker mit den tatsächlich gerechneten Bettmaßen
  const printerOf = (o) => { const p = PRINTERS.find((q) => q.id === o.printer) || CUSTOM_PRINTER; return { ...p, bedX: o.bedX, bedY: o.bedY, bedZ: o.bedZ }; };
  // Bettmaße eines Profils in die Einstellungen übernehmen (eigener Drucker: Eingaben bleiben)
  const applyPrinter = (o) => { const p = PRINTERS.find((q) => q.id === o.printer); return p ? { ...o, bedX: p.bedX, bedY: p.bedY, bedZ: p.bedZ } : { ...o, printer: 'custom' }; };
  // Profil zu gegebenen Bettmaßen (für gespeicherte Einstellungen ohne Druckerangabe)
  const printerFor = (o) => (PRINTERS.find((p) => p.bedX === o.bedX && p.bedY === o.bedY && p.bedZ === o.bedZ) || CUSTOM_PRINTER).id;
  // Fläche, auf der ein Druckjob in der Datei liegt: bei zwei Materialien bleibt rechts der Streifen für den Prime-Tower frei
  const printArea = (o, flat) => [o.bedX - (twoMaterials(o) && !flat ? o.towerReserve || 0 : 0), o.bedY];
  // Trennung aus demselben Material: Luftspalt + Punkte als Sollbruchstellen (Herleitung: docs/PERFORATION.md)
  const PERF = {
    gap: 0.4,     // mm: Z-Abstand zwischen zwei Platten = 2 Schichten à 0,2 mm
    dot: 0.8,     // mm: Punktdurchmesser = 2 Bahnen einer 0,4-mm-Düse
    pitch: 6,     // mm: Punktabstand (42 mm ÷ 7)
    edge: 0.6,    // mm: Abstand der Punktreihen von den Kanten des Plattenfußes (unter den äußeren Bahnen)
    seg: 6,       // Ecken eines Punkts
    margin: 0.3,  // mm: so weit bleibt ein Punktrand von Wandrundungen und Verbindungstaschen weg
  };
  const MIN_POCKET = 150;  // mm²: bleibt vom Taschenboden einer beschnittenen Zelle weniger, wird sie massiv

  // ---------- mesh builder ----------
  function Mesh() { this.v = []; this.f = []; this.map = new Map(); }
  Mesh.prototype.vid = function (p) {
    const k = Math.round(p[0] * 1e4) + ',' + Math.round(p[1] * 1e4) + ',' + Math.round(p[2] * 1e4);
    let i = this.map.get(k);
    if (i === undefined) { i = this.v.length / 3; this.v.push(p[0], p[1], p[2]); this.map.set(k, i); }
    return i;
  };
  Mesh.prototype.tri = function (a, b, c) {
    const i = this.vid(a), j = this.vid(b), k = this.vid(c);
    if (i !== j && j !== k && i !== k) this.f.push(i, j, k);
  };
  Mesh.prototype.quad = function (a, b, c, d) { this.tri(a, b, c); this.tri(a, c, d); };
  Mesh.prototype.fan = function (pts) { // planar polygon, ccw seen from the side the normal points to
    let cx = 0, cy = 0, cz = 0;
    for (const p of pts) { cx += p[0]; cy += p[1]; cz += p[2]; }
    const c = [cx / pts.length, cy / pts.length, cz / pts.length];
    for (let i = 0; i < pts.length; i++) this.tri(c, pts[i], pts[(i + 1) % pts.length]);
  };

  const z3 = (p, z) => [p[0], p[1], z];

  // rounded-rect ring of a pocket tile at inset t: array of 4 corner arcs (SW,SE,NE,NW), ccw
  // ex: optional extra inset per side [S,E,N,W]
  function ring(tile, t, z, ex) {
    const { x0, y0, x1, y1 } = tile, r = R - t, [eS, eE, eN, eW] = ex || [0, 0, 0, 0];
    const cs = [[x0 + t + eW + r, y0 + t + eS + r, 180], [x1 - t - eE - r, y0 + t + eS + r, 270], [x1 - t - eE - r, y1 - t - eN - r, 0], [x0 + t + eW + r, y1 - t - eN - r, 90]];
    const arcs = cs.map(([cx, cy, a0]) => {
      const arc = [];
      for (let i = 0; i <= ARC; i++) {
        const a = (a0 + 90 * i / ARC) * Math.PI / 180;
        arc.push([cx + r * Math.cos(a), cy + r * Math.sin(a), z]);
      }
      return arc;
    });
    if (!isClipped(tile)) return arcs;
    // beschnittene Zelle: Ring = Normalring ∩ (Wandrundung um t nach innen versetzt) -> geschlossene Punktfolge
    let P = flat(arcs).map((p) => ({ x: p[0], y: p[1] }));
    for (const c of tile.clips) P = clipPoly(P, c, t + ((ex && ex[4]) || 0));
    const loop = P.map((p) => [p.x, p.y, z]);
    loop.loop = true; loop.c = pocketCentre(tile);
    return loop;
  }
  const isClipped = (tile) => !!(tile.clips && tile.clips.length);

  // ---------- Wandrundung: Schnitt eines konvexen Vielecks mit einer gerundeten Ecke ----------
  // clip = {cx, cy, r, q}: Kreis (Mitte, Radius) der Wandrundung minus Spiel; q = Ecke 0 SW, 1 SE, 2 NE, 3 NW.
  // Entfernt wird, was im Eckquadranten außerhalb des Kreises liegt. Der Rest ist konvex.
  const clipSign = (q) => [q === 0 || q === 3 ? 1 : -1, q < 2 ? 1 : -1];
  // schneidet die Rundung in das Rechteck? (dann liegt dessen äußerste Ecke im entfernten Bereich)
  function clipCuts(c, x0, y0, x1, y1) {
    const [sx, sy] = clipSign(c.q), px = sx > 0 ? x0 : x1, py = sy > 0 ? y0 : y1;
    return sx * (px - c.cx) < -1e-9 && sy * (py - c.cy) < -1e-9 && Math.hypot(px - c.cx, py - c.cy) > c.r + 1e-9;
  }
  // pts: [{x, y, b}] gegen den Uhrzeigersinn, b = Kante zum nächsten Punkt ist Außenkante. shrink: Kreis um so viel kleiner
  function clipPoly(pts, c, shrink = 0) {
    const r = c.r - shrink;
    if (!(r > 0)) return pts;
    const [sx, sy] = clipSign(c.q);
    const gone = pts.map((p) => sx * (p.x - c.cx) < -1e-9 && sy * (p.y - c.cy) < -1e-9 && (p.x - c.cx) ** 2 + (p.y - c.cy) ** 2 > r * r + 1e-9);
    if (!gone.includes(true)) return pts;
    if (!gone.includes(false)) return [];
    const cross = (a, b, last) => { // Schnittpunkt der Strecke mit dem Kreis
      const dx = b.x - a.x, dy = b.y - a.y, fx = a.x - c.cx, fy = a.y - c.cy;
      const A = dx * dx + dy * dy, B = 2 * (fx * dx + fy * dy), C = fx * fx + fy * fy - r * r, q = Math.sqrt(Math.max(0, B * B - 4 * A * C));
      const t = Math.min(1, Math.max(0, (-B + (last ? q : -q)) / (2 * A)));
      return { x: a.x + t * dx, y: a.y + t * dy };
    };
    const n = pts.length, k0 = gone.indexOf(false), res = [];
    let exit = null;
    for (let i = 0; i < n; i++) {
      const ia = (k0 + i) % n, ib = (ia + 1) % n, a = pts[ia], b = pts[ib];
      if (!gone[ia]) res.push(a);
      if (!gone[ia] && gone[ib]) { exit = cross(a, b, true); res.push({ ...exit, b: true, arc: true }); }
      else if (gone[ia] && !gone[ib]) {
        const entry = cross(a, b, false), N = Math.max(ARC, Math.ceil((Math.PI / 2) / Math.sqrt(8 * ARC_SAG / r))), step = Math.PI / 2 / N, tol = 0.02 / r;
        const a0 = Math.atan2(exit.y - c.cy, exit.x - c.cx); let a1 = Math.atan2(entry.y - c.cy, entry.x - c.cx);
        while (a1 < a0) a1 += 2 * Math.PI;
        for (let k = Math.ceil((a0 + tol) / step); k * step < a1 - tol; k++) res.push({ x: c.cx + r * Math.cos(k * step), y: c.cy + r * Math.sin(k * step), b: true, arc: true });
        res.push({ ...entry, b: a.b });
      }
    }
    // doppelte Punkte (Schnitt genau auf einer Ecke) entfernen: der spätere Punkt trägt die richtige Kante
    return res.filter((p, i) => { const q = res[(i + 1) % res.length]; return Math.hypot(p.x - q.x, p.y - q.y) > 1e-6; });
  }
  // Umriss einer beschnittenen Kachel (sonst null)
  function outline(t) {
    if (!isClipped(t)) return null;
    let P = [{ x: t.x0, y: t.y0, b: t.boundary[0] }, { x: t.x1, y: t.y0, b: t.boundary[1] }, { x: t.x1, y: t.y1, b: t.boundary[2] }, { x: t.x0, y: t.y1, b: t.boundary[3] }];
    for (const c of t.clips) P = clipPoly(P, c);
    return P;
  }
  // Taschenboden (Einzug T_BOT) einer beschnittenen Zelle als Vieleck
  function pocketFloor(tile) {
    const r = R - T_BOT, { x0, y0, x1, y1 } = tile, t = T_BOT, P0 = [];
    for (const [cx, cy, a0] of [[x0 + t + r, y0 + t + r, 180], [x1 - t - r, y0 + t + r, 270], [x1 - t - r, y1 - t - r, 0], [x0 + t + r, y1 - t - r, 90]])
      for (let i = 0; i <= ARC; i++) { const a = (a0 + 90 * i / ARC) * Math.PI / 180; P0.push({ x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) }); }
    let P = P0;
    for (const c of tile.clips) P = clipPoly(P, c, t);
    return P;
  }
  function pocketCentre(tile) {
    const P = pocketFloor(tile); let x = 0, y = 0;
    for (const p of P) { x += p.x; y += p.y; }
    return [x / P.length, y / P.length];
  }
  const polyArea = (P) => P.reduce((a, p, i) => { const q = P[(i + 1) % P.length]; return a + (p.x * q.y - q.x * p.y) / 2; }, 0);
  // Fläche zwischen zwei konvexen, gleich umlaufenden Punktfolgen P und Q, die beide um c herum liegen
  // (dürfen verschieden viele Punkte haben). Normale = Umlaufrichtung × (Q − P); flip dreht sie um.
  function zipLoops(m, P, Q, c, flip) {
    const ang = (p) => Math.atan2(p[1] - c[1], p[0] - c[0]);
    const start = (L) => { let k = 0, best = Infinity; L.forEach((p, i) => { const a = ang(p); if (a < best) { best = a; k = i; } }); return L.slice(k).concat(L.slice(0, k)); };
    P = start(P); Q = start(Q);
    const nP = P.length, nQ = Q.length, next = (L, i, n) => (i < n ? ang(L[(i + 1) % n]) + (i + 1 === n ? 2 * Math.PI : 0) : Infinity);
    let i = 0, j = 0;
    while (i < nP || j < nQ) {
      let a, b, d;
      if (next(P, i, nP) <= next(Q, j, nQ)) { a = P[i % nP]; b = P[(i + 1) % nP]; d = Q[j % nQ]; i++; }
      else { a = Q[j % nQ]; b = P[i % nP]; d = Q[(j + 1) % nQ]; j++; }
      flip ? m.tri(a, d, b) : m.tri(a, b, d);
    }
  }
  // Außenkante der Platte: oben genauso breit wie ein Steg zwischen zwei Zellen (2 × TOP = 0,5 mm),
  // sonst wäre der Rand nur 0,25 mm breit und der Slicer lässt ihn weg (Lücke zwischen PLA und PETG am Rand)
  // 5. Wert: Zuschlag entlang einer Wandrundung (ist immer Außenkante)
  const topEx = (tile) => [...(tile.boundary || [false, false, false, false]).map((b) => (b ? TOP : 0)), isClipped(tile) ? TOP : 0];
  const flat = (rg) => [].concat(...rg);
  const corners = (tile) => [[tile.x0, tile.y0], [tile.x1, tile.y0], [tile.x1, tile.y1], [tile.x0, tile.y1]];

  // surface between two rings (A below B). faceOut: normal away from tile centre
  function loft(m, A, B, faceOut) {
    if (A.loop) return zipLoops(m, A, B, A.c, !faceOut);
    const a = flat(A), b = flat(B), n = a.length;
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      if (faceOut) m.quad(a[i], a[j], b[j], b[i]); else m.quad(a[i], b[i], b[j], a[j]);
    }
  }
  // flat face between tile rectangle and a ring, at z
  // F: Verbindungen je Seite (nur Unterseite): Die Kante bekommt die Punkte von Zapfenwurzel bzw. Tasche
  function rectAnnulus(m, tile, rg, z, up, F) {
    if (rg.loop) return zipLoops(m, outline(tile).map((p) => [p.x, p.y, z]), rg, rg.c, !up);
    const C = corners(tile).map(p => [p[0], p[1], z]);
    for (let c = 0; c < 4; c++) {
      const arc = rg[c];
      for (let i = 0; i < arc.length - 1; i++) up ? m.tri(C[c], arc[i + 1], arc[i]) : m.tri(C[c], arc[i], arc[i + 1]);
      const n = (c + 1) % 4, p = arc[arc.length - 1], q = rg[n][0];
      const degenerate = Math.abs(p[0] - C[c][0]) < 1e-9 && Math.abs(p[1] - C[c][1]) < 1e-9 ||
        (Math.abs((q[0] - p[0]) * (C[n][1] - C[c][1]) - (q[1] - p[1]) * (C[n][0] - C[c][0])) < 1e-9 &&
          Math.abs((p[0] - C[c][0]) * (C[n][1] - C[c][1]) - (p[1] - C[c][1]) * (C[n][0] - C[c][0])) < 1e-9);
      const f = F && F[c];
      if (f) {
        const n1 = z3(f.n1, z), n2 = z3(f.n2, z), h1 = z3(f.h1, z), h2 = z3(f.h2, z);
        const T = f.kind === 2
          ? [[C[c], n1, h1], [C[c], h1, p], [h1, h2, q], [h1, q, p], [h2, C[n], q], [h2, n2, C[n]]] // Tasche: Kerbe ausgespart
          : [[C[c], n1, p], [n1, q, p], [n1, n2, q], [n2, C[n], q]];                                  // Zapfen: nur Punkte an der Wurzel
        for (const [a, b, d] of T) up ? m.tri(a, b, d) : m.tri(a, d, b);
      } else if (!degenerate) up ? m.quad(C[c], C[n], q, p) : m.quad(C[c], p, q, C[n]);
    }
  }
  // flat face between two rings (outer O, inner I) at same z
  function ringAnnulus(m, O, I, up) {
    const o = flat(O), i_ = flat(I), n = o.length;
    for (let k = 0; k < n; k++) {
      const j = (k + 1) % n;
      if (up) m.quad(o[k], o[j], i_[j], i_[k]); else m.quad(o[k], i_[k], i_[j], o[j]);
    }
  }

  // ---------- tile perimeter (for solid tiles & boundary walls) ----------
  // knife points on a side (corner+R ... corner-R) when a pocket tile's knife level touches that side
  function sideKnife(a, b) {
    const dx = b[0] - a[0], dy = b[1] - a[1], L = Math.hypot(dx, dy), ux = dx / L, uy = dy / L;
    return [[a[0] + ux * R, a[1] + uy * R], [b[0] - ux * R, b[1] - uy * R]];
  }
  // segments of a tile perimeter, ccw. each: {pts:[2d...], boundary, arc}
  // knife: per side bool (extra points at this level)
  function perimeter(tile, knife) {
    const C = corners(tile), segs = [];
    const rd = tile.rounds || {}; // {cornerIndex: radius}
    const centre = (k, r) => { const cc = C[k]; return [cc[0] + (k === 0 || k === 3 ? r : -r), cc[1] + (k === 0 || k === 1 ? r : -r)]; };
    for (let s = 0; s < 4; s++) {
      const e = (s + 1) % 4;
      let a = C[s], b = C[e];
      const dx = Math.sign(b[0] - a[0]), dy = Math.sign(b[1] - a[1]);
      if (rd[s]) a = [a[0] + dx * rd[s], a[1] + dy * rd[s]];
      if (rd[e]) b = [b[0] - dx * rd[e], b[1] - dy * rd[e]];
      const pts = knife[s] ? [a, ...sideKnife(C[s], C[e]), b] : [a, b];
      segs.push({ pts, boundary: tile.boundary[s], arc: false });
      if (rd[e]) {
        const r = rd[e], cen = centre(e, r), a0 = [180, 270, 0, 90][e], arc = [];
        for (let i = 0; i <= ARC; i++) {
          const an = (a0 + 90 * i / ARC) * Math.PI / 180;
          arc.push([cen[0] + r * Math.cos(an), cen[1] + r * Math.sin(an)]);
        }
        segs.push({ pts: arc, boundary: true, arc: true });
      }
    }
    return segs;
  }
  // Umriss einer massiven Kachel auf Höhe z
  function tilePoly(tile, knife, z) {
    const O = outline(tile);
    return O ? O.map((p) => [p.x, p.y, z]) : polyFromSegs(perimeter(tile, knife), z);
  }
  function polyFromSegs(segs, z) {
    const out = [];
    for (const s of segs) for (let i = 0; i < s.pts.length - 1; i++) out.push(z3(s.pts[i], z));
    return out;
  }
  // vertical boundary walls between levels zb (knifeB) and zt (knifeT)
  // open: je Seite eine Öffnung unten in der Wand (Zapfenwurzel oder Taschenöffnung)
  function walls(m, tile, zb, zt, kb, kt, open) {
    const O = outline(tile);
    if (O) {
      O.forEach((p, i) => { if (!p.b) return; const q = O[(i + 1) % O.length]; m.quad([p.x, p.y, zb], [q.x, q.y, zb], [q.x, q.y, zt], [p.x, p.y, zt]); });
      return;
    }
    const sb = perimeter(tile, kb), st = perimeter(tile, kt);
    for (let i = 0; i < sb.length; i++) {
      if (!sb[i].boundary) continue;
      const B = sb[i].pts, T = st[i].pts;
      if (open && open[i]) {
        const f = open[i], zh = zb + f.h, a = B[0], b = B[B.length - 1];
        m.quad(z3(a, zb), z3(f.n1, zb), z3(f.n1, zh), z3(a, zt));
        m.quad(z3(f.n1, zh), z3(f.n2, zh), z3(b, zt), z3(a, zt));
        m.quad(z3(f.n2, zb), z3(b, zb), z3(b, zt), z3(f.n2, zh));
        continue;
      }
      if (sb[i].arc) {
        for (let k = 0; k < B.length - 1; k++) m.quad(z3(B[k], zb), z3(B[k + 1], zb), z3(T[k + 1], zt), z3(T[k], zt));
      } else {
        const poly = B.map(p => z3(p, zb)).concat(T.slice().reverse().map(p => z3(p, zt)));
        m.fan(poly);
      }
    }
  }
  // knife flags per side for a level: pocket tiles -> all sides; solid -> sides whose neighbour is pocket
  function knifeFlags(tile, isKnifeLevel) {
    // mit flacher Stegoberkante (TOP > 0) enden die Taschenringe nie auf der Zellkante -> keine Zusatzpunkte
    if (!isKnifeLevel || TOP > 1e-9) return [false, false, false, false];
    if (tile.pocket) return [true, true, true, true];
    return tile.nbPocket.slice();
  }

  // ---------- Verbindungen ----------
  const connGeo = (fit) => {
    const a = CONN.flank * Math.PI / 180, f = fit ?? CONN.fit;
    return { tan: Math.tan(a), wn: CONN.neck / 2 - f / Math.cos(a), D: CONN.depth + f };
  };
  // Verbindungen einer Zelle je Seite: null oder {kind 1 Zapfen / 2 Tasche, h, n1, n2 (an der Kante), h1, h2 (Kopf)}
  function tileFeat(t) {
    if (!t.pocket || isClipped(t) || !t.feat || !t.feat.some(Boolean)) return null;
    const C = corners(t), g = connGeo(t.fit);
    return t.feat.map((kind, s) => {
      if (!kind) return null;
      const a = C[s], b = C[(s + 1) % 4], L = Math.hypot(b[0] - a[0], b[1] - a[1]), ux = (b[0] - a[0]) / L, uy = (b[1] - a[1]) / L;
      const P = (u, v) => [a[0] + u * ux - v * uy, a[1] + u * uy + v * ux]; // u längs der Kante, v nach innen
      const uc = L / 2;
      if (kind === 2) { const hn = CONN.neck / 2, e = g.D * g.tan; return { kind, h: CONN.pocketH, n1: P(uc - hn, 0), n2: P(uc + hn, 0), h1: P(uc - hn - e, g.D), h2: P(uc + hn + e, g.D) }; }
      const e = CONN.depth * g.tan;
      return { kind, h: CONN.height, n1: P(uc - g.wn, 0), n2: P(uc + g.wn, 0), h1: P(uc - g.wn - e, -CONN.depth), h2: P(uc + g.wn + e, -CONN.depth) };
    });
  }
  // Tasche: von unten offen, Decke auf pocketH (kurze Brücke beim Druck), Wände senkrecht
  function addSocket(m, f, z0) {
    const zh = z0 + f.h, P = [f.n1, f.h1, f.h2, f.n2];
    for (let i = 0; i < 3; i++) m.quad(z3(P[i], z0), z3(P[i + 1], z0), z3(P[i + 1], zh), z3(P[i], zh));
    m.quad(z3(f.n1, zh), z3(f.h1, zh), z3(f.h2, zh), z3(f.n2, zh));
  }
  // Zapfen. mode: 'full' liegt auf dem Druckbett; 'bottom' = Unterseite steigt unter 45° aus der Plattenwand
  // (Platte höher im Stapel), 'top' = Oberseite fällt unter 45° (Platte wird kopfüber gedruckt) -> druckt ohne Stützen
  function addTab(m, f, z0, mode) {
    const zr = z0 + f.h, zb = mode === 'bottom' ? z0 + CONN.depth : z0, zt = mode === 'top' ? zr - CONN.depth : zr;
    const r1b = z3(f.n1, z0), r2b = z3(f.n2, z0), r1t = z3(f.n1, zr), r2t = z3(f.n2, zr);
    const t1b = z3(f.h1, zb), t2b = z3(f.h2, zb), t1t = z3(f.h1, zt), t2t = z3(f.h2, zt);
    m.quad(r1t, t1t, t2t, r2t); m.quad(r2b, t2b, t1b, r1b);
    m.quad(r1b, t1b, t1t, r1t); m.quad(t1b, t2b, t2t, t1t); m.quad(t2b, r2b, r2t, t2t);
  }
  // Brücke (Doppel-Schwalbenschwanz) um (cx, cy), Hals längs x, liegt flach auf dem Bett
  function addBridge(m, cx, cy, fit) {
    const g = connGeo(fit), d = CONN.depth, wh = g.wn + d * g.tan, h = CONN.height;
    const O = [[-wh, -d], [wh, -d], [g.wn, 0], [wh, d], [-wh, d], [-g.wn, 0]].map(([x, y]) => [cx + x, cy + y]);
    const q = (i, z) => z3(O[i], z);
    m.quad(q(0, h), q(1, h), q(2, h), q(5, h)); m.quad(q(5, h), q(2, h), q(3, h), q(4, h));
    m.quad(q(5, 0), q(2, 0), q(1, 0), q(0, 0)); m.quad(q(4, 0), q(3, 0), q(2, 0), q(5, 0));
    for (let i = 0; i < 6; i++) { const j = (i + 1) % 6; m.quad(q(i, 0), q(j, 0), q(j, h), q(i, h)); }
  }
  const bridgeSize = (fit) => { const g = connGeo(fit); return [2 * (g.wn + CONN.depth * g.tan), 2 * CONN.depth]; };
  function bridgeMesh(fit) { const m = new Mesh(), [w, d] = bridgeSize(fit); addBridge(m, w / 2, d / 2, fit); return m; }
  // Zapfen ragen über die Platte hinaus: so viel bleibt ringsum auf dem Druckbett frei
  const connPad = (o) => (o.connect === 'tabs' ? CONN.depth : 0);

  // ---------- bodies ----------
  function addPlate(m, tiles, z0, hs, tabMode) {
    const HS = hs || H;
    for (const t of tiles) {
      const kb = knifeFlags(t, false), kt = knifeFlags(t, true);
      if (t.pocket) {
        const rings = PROFILE.map(([z, ins], k) => ring(t, ins, z0 + z, k === PROFILE.length - 1 ? topEx(t) : null));
        for (let i = 0; i < rings.length - 1; i++) loft(m, rings[i], rings[i + 1], false);
        const F = tileFeat(t);
        rectAnnulus(m, t, rings[0], z0, false, F);
        rectAnnulus(m, t, rings[rings.length - 1], z0 + H, true);
        if (F) {
          for (const f of F) if (f) f.kind === 2 ? addSocket(m, f, z0) : addTab(m, f, z0, tabMode || 'full');
          walls(m, t, z0, z0 + H, kb, kt, F);
          continue;
        }
      } else {
        m.fan(tilePoly(t, kt, z0 + HS));
        m.fan(tilePoly(t, kb, z0).reverse());
      }
      walls(m, t, z0, z0 + (t.pocket ? H : HS), kb, kt);
    }
  }
  // separator (PETG) placed on a plate whose base is at z0; thickness s; wedge fills the upper chamfer
  function addSeparator(m, tiles, z0, s, wedgeDepth) {
    const wedge = wedgeDepth > 0.05, wd = Math.min(wedgeDepth, H - CHAMFER_Z);
    const Z0 = z0 + H, Z1 = Z0 + s;
    for (const t of tiles) {
      const kb = knifeFlags(t, wedge), kt = knifeFlags(t, false);
      if (t.pocket) {
        if (wedge) {
          // grows out of the 45deg chamfer of the plate below: starts as a line on the chamfer,
          // inner face rises at 45deg to the rib edge (inset T_BOT) of the next plate -> no overhang
          const ts = T_BOT / 2, zc = Z0 - (ts - TOP);
          const rs = ring(t, ts, zc, topEx(t).map((e) => e * (1 - (ts - TOP) / (H - CHAMFER_Z)))), rIn = ring(t, T_BOT, Z0), inHi = ring(t, T_BOT, Z1), r0 = ring(t, TOP, Z0, topEx(t));
          loft(m, rs, r0, true);     // lies on the PLA chamfer
          loft(m, rs, rIn, false);   // 45deg inner flank
          loft(m, rIn, inHi, false); // vertical inner edge of the sheet
          rectAnnulus(m, t, r0, Z0, false);
          rectAnnulus(m, t, inHi, Z1, true);
        } else {
          const lo = ring(t, T_BOT, Z0), hi = ring(t, T_BOT, Z1);
          loft(m, lo, hi, false);
          rectAnnulus(m, t, lo, Z0, false);
          rectAnnulus(m, t, hi, Z1, true);
        }
      } else {
        m.fan(tilePoly(t, kt, Z1));
        m.fan(tilePoly(t, kb, Z0).reverse());
      }
      walls(m, t, Z0, Z1, kb, kt);
    }
  }

  // PETG that starts on the top edges of the plate below and grows outward at the allowed overhang angle
  // until it reaches the full foot of the next plate (inset T_BOT), then a flat base of thickness s
  const growHeight = (o) => (T_BOT - TOP) / Math.tan(Math.max(20, Math.min(70, o.overhang || 45)) * Math.PI / 180);
  // Wendeplatte: jede zweite Platte ist selbst die PETG-Trennung (kopfüber), Platten liegen direkt aufeinander
  // Wendeplatte: Leisten so hoch wie eine Platte und im Turm ebenfalls abwechselnd PLA/PETG ohne Zwischenlage
  const flipMode = (o) => o.sepStyle === 'flip' && o.stack;
  // Perforation: ein Material, Platten abwechselnd kopfüber mit Luftspalt, dazwischen nur Punkte
  const perfMode = (o) => o.sepStyle === 'perf' && o.stack;
  const altFlip = (o) => o.sepStyle === 'flip' || o.sepStyle === 'perf';
  const perfOpt = (o) => ({ gap: o.perfGap || PERF.gap, dot: o.perfDot || PERF.dot, pitch: o.perfPitch || PERF.pitch });
  // zweites Material (PETG) im Spiel? Nur dann braucht es Platz für den Prime-Tower
  const twoMaterials = (o) => !!o.stack && o.sepStyle !== 'perf';
  const spacerHeight = (o) => (flipMode(o) ? H : o.spacerH || H);
  const spacerGap = (o) => (flipMode(o) ? 0 : perfMode(o) ? perfOpt(o).gap : o.sepT);
  const sepGap = (o) => o.sepStyle === 'flip' ? 0 : o.sepStyle === 'perf' ? perfOpt(o).gap : o.sepStyle === 'grow' ? growHeight(o) + o.sepT : o.sepT;
  function addGrowSeparator(m, tiles, Z0, gh, s) {
    const Za = Z0 + gh, Z1 = Za + s;
    for (const t of tiles) {
      const kb = knifeFlags(t, true), kt = knifeFlags(t, false);
      if (t.pocket) {
        const r0 = ring(t, TOP, Z0, topEx(t)), ra = ring(t, T_BOT, Za), r1 = ring(t, T_BOT, Z1);
        loft(m, r0, ra, false);   // overhang flank, grows outward from the flat rib top
        loft(m, ra, r1, false);   // vertical edge of the base layer
        rectAnnulus(m, t, r0, Z0, false);
        rectAnnulus(m, t, r1, Z1, true);
      } else {
        m.fan(tilePoly(t, kt, Z1));
        m.fan(tilePoly(t, kb, Z0).reverse());
      }
      walls(m, t, Z0, Z1, kb, kt);
    }
  }
  // ---------- layout ----------
  // axis: {cells:[w...], mLow, mHigh}
  function axisLayout(inner, clearance, minSpacer, half, align) {
    const U = inner - clearance;
    const n = Math.max(0, Math.floor((U + 1e-9) / PITCH));
    const cells = Array(n).fill(PITCH);
    let rem = U - n * PITCH;
    if (half && rem >= PITCH / 2 - 1e-9) { align === 'end' ? cells.unshift(PITCH / 2) : cells.push(PITCH / 2); rem -= PITCH / 2; }
    let mLow = align === 'center' ? rem / 2 : align === 'end' ? rem : 0, mHigh = align === 'center' ? rem / 2 : align === 'end' ? 0 : rem;
    const gapLow = mLow < minSpacer ? mLow : 0, gapHigh = mHigh < minSpacer ? mHigh : 0;
    if (mLow < minSpacer) mLow = 0;
    if (mHigh < minSpacer) mHigh = 0;
    rem = Math.max(0, rem);
    return { inner, U, cells, mLow: round2(mLow), mHigh: round2(mHigh), gapLow: round2(gapLow + clearance / 2), gapHigh: round2(gapHigh + clearance / 2) };
  }
  const round2 = (x) => Math.round(x * 100) / 100;

  // split an axis into groups each <= L, minimal count, as even as possible
  function splitAxis(ax, L) {
    const n = ax.cells.length;
    if (n === 0) return null;
    const width = (i, j) => { // cells i..j-1
      let w = 0; for (let k = i; k < j; k++) w += ax.cells[k];
      if (i === 0) w += ax.mLow; if (j === n) w += ax.mHigh; return w;
    };
    for (let k = 1; k <= n; k++) {
      // dp[g][j] = min sum of squares splitting first j cells into g groups
      const INF = 1e18, dp = [], par = [];
      for (let g = 0; g <= k; g++) { dp.push(Array(n + 1).fill(INF)); par.push(Array(n + 1).fill(-1)); }
      dp[0][0] = 0;
      for (let g = 1; g <= k; g++) for (let j = 1; j <= n; j++) for (let i = g - 1; i < j; i++) {
        if (dp[g - 1][i] >= INF) continue;
        const w = width(i, j); if (w > L + 1e-9) continue;
        const v = dp[g - 1][i] + w * w;
        if (v < dp[g][j]) { dp[g][j] = v; par[g][j] = i; }
      }
      if (dp[k][n] < INF) {
        const cuts = []; let j = n;
        for (let g = k; g >= 1; g--) { const i = par[g][j]; cuts.unshift([i, j]); j = i; }
        return cuts.map(([i, j]) => ({
          cells: ax.cells.slice(i, j), mLow: i === 0 ? ax.mLow : 0, mHigh: j === n ? ax.mHigh : 0,
          offset: (i === 0 ? 0 : ax.mLow + ax.cells.slice(0, i).reduce((a, b) => a + b, 0)),
          width: width(i, j), first: i, last: j
        }));
      }
    }
    return null; // a single cell plus margin does not fit
  }

  function axisKey(a) { return a.mLow + '|' + a.cells.join(',') + '|' + a.mHigh; }

  // build tiles of a piece (local coords, origin at its min corner)
  function pieceTiles(p, clips, fit) {
    const cols = [], rows = [];
    const mk = (ax, out) => {
      let x = 0;
      if (ax.mLow > 0) { out.push({ a: x, b: x + ax.mLow, cell: false }); x += ax.mLow; }
      for (const w of ax.cells) { out.push({ a: x, b: x + w, cell: true }); x += w; }
      if (ax.mHigh > 0) { out.push({ a: x, b: x + ax.mHigh, cell: false }); x += ax.mHigh; }
    };
    mk(p.ax, cols); mk(p.ay, rows);
    const tiles = [], grid = [];
    for (let j = 0; j < rows.length; j++) {
      grid.push([]);
      for (let i = 0; i < cols.length; i++) {
        const t = { x0: cols[i].a, x1: cols[i].b, y0: rows[j].a, y1: rows[j].b, pocket: cols[i].cell && rows[j].cell, i, j, rounds: {}, clips: [] };
        grid[j].push(t); tiles.push(t);
      }
    }
    for (const t of tiles) {
      const nb = [grid[t.j - 1] && grid[t.j - 1][t.i], grid[t.j][t.i + 1], grid[t.j + 1] && grid[t.j + 1][t.i], grid[t.j][t.i - 1]]; // S,E,N,W
      t.boundary = nb.map(n => !n);
      t.nbPocket = nb.map(n => !!(n && n.pocket));
      if (t.pocket && p.feat) { // Verbindungen an Stoßkanten (S, E, N, W)
        const F = p.feat, li = cols.length - 1, lj = rows.length - 1;
        t.feat = [t.j === 0 ? F[0][t.i] || 0 : 0, t.i === li ? F[1][t.j] || 0 : 0, t.j === lj ? F[2][t.i] || 0 : 0, t.i === 0 ? F[3][t.j] || 0 : 0];
        t.fit = fit;
      }
    }
    return clipTiles(tiles, clips);
  }
  // Wandrundungen auf Kacheln verteilen: ganz weggeschnittene Kacheln entfallen,
  // Zellen mit zu wenig Taschenboden werden massiv
  function clipTiles(tiles, clips) {
    if (!Array.isArray(clips) || !clips.length) return tiles;
    return tiles.filter((t) => {
      t.clips = clips.filter((c) => clipCuts(c, t.x0, t.y0, t.x1, t.y1));
      if (!t.clips.length) return true;
      if (outline(t).length < 3) return false;
      if (t.pocket) { const F = pocketFloor(t); if (F.length < 3 || polyArea(F) < MIN_POCKET) t.pocket = false; }
      return true;
    });
  }
  // die vier Wandrundungen im Koordinatensystem des Rasters (Ursprung = vordere linke Ecke von Platten + Leisten).
  // Wand: Innenmaß mit Eckradius r. Teile halten ringsum das halbe Spiel g Abstand, in der Ecke also
  // einen Kreis mit Radius r − g um denselben Mittelpunkt (Wandecke + r in beiden Richtungen).
  function wallClips(AX, AY, W, D, o) {
    const g = (o.clearance || 0) / 2, r = Math.min(o.cornerR || 0, o.boxW / 2, o.boxD / 2), rho = r - g;
    if (!(rho > MIN_ROUND)) return [];
    const xl = -AX.gapLow + r, xh = W + AX.gapHigh - r, yl = -AY.gapLow + r, yh = D + AY.gapHigh - r;
    return [{ cx: xl, cy: yl, r: rho, q: 0 }, { cx: xh, cy: yl, r: rho, q: 1 }, { cx: xh, cy: yh, r: rho, q: 2 }, { cx: xl, cy: yh, r: rho, q: 3 }];
  }
  // Rundungen, die ein Teil (Rechteck) treffen, in dessen eigenen Koordinaten + Kennung für gleiche Teile
  const localClips = (clips, x0, y0, x1, y1) => clips.filter((c) => clipCuts(c, x0, y0, x1, y1)).map((c) => ({ ...c, cx: c.cx - x0, cy: c.cy - y0 }));
  const clipKey = (cl) => cl.map((c) => c.q + ':' + c.cx.toFixed(3) + ':' + c.cy.toFixed(3) + ':' + c.r.toFixed(3)).join(';');
  const moveClips = (cl, dx, dy) => (cl || []).map((c) => ({ ...c, cx: c.cx + dx, cy: c.cy + dy }));
  const moveTile = (t, dx, dy) => ({ ...t, x0: t.x0 + dx, x1: t.x1 + dx, y0: t.y0 + dy, y1: t.y1 + dy, clips: moveClips(t.clips, dx, dy) });

  // Innenmaße, bei denen das Raster ohne Rest aufgeht (keine Leisten nötig): nächstkleineres und nächstgrößeres
  function fitSizes(v, clearance, half) {
    const step = half ? PITCH / 2 : PITCH, c = clearance || 0;
    const k = Math.floor((v - c) / step + 1e-9), r1 = (x) => Math.round(x * 10) / 10;
    if (k * step < PITCH) return { lo: null, hi: r1(PITCH + c), exact: false, cells: 0 }; // noch keine ganze Zelle
    const lo = k * step + c, exact = Math.abs(v - lo) < 0.05;
    return { lo: r1(lo), hi: r1(lo + step), exact, cells: (k * step) / PITCH };
  }

  // ---------- stapelgerechte Aufteilung ----------
  // alle Zerlegungen von n Zellen in Gruppen (Größen absteigend), jede <= maxPart, höchstens maxParts Gruppen
  // Alle Zerlegungen von n Zellen in höchstens maxParts Teile <= maxPart (große Teile zuerst).
  // Bei sehr vielen Zellen explodiert das: dann nur ausgewogene Zerlegungen (Teile nahe n/k) je Teilezahl k.
  function partitions(n, maxPart, maxParts) {
    const run = (lo, k, cap) => {
      const out = [];
      const rec = (left, max, acc) => {
        if (out.length >= cap) return;
        if (left === 0) { if (!k || acc.length === k) out.push(acc.slice()); return; }
        if (acc.length >= (k || maxParts)) return;
        if (k && left > (k - acc.length) * max) return;
        for (let s = Math.min(max, left); s >= lo; s--) { acc.push(s); rec(left - s, s, acc); acc.pop(); }
      };
      rec(n, maxPart, []);
      return out;
    };
    const all = run(1, 0, 3000);
    if (all.length < 3000) return all;
    const out = [];
    for (let k = Math.ceil(n / maxPart); k <= maxParts; k++) out.push(...run(Math.max(1, Math.floor(n / k) - 2), k, 150));
    return out;
  }
  // Achse ohne Rand in aufeinanderfolgende Gruppen der angegebenen Größen schneiden
  function cutAxis(ax, sizes) {
    let i = 0;
    return sizes.map((k) => {
      const cells = ax.cells.slice(i, i + k), offset = ax.cells.slice(0, i).reduce((a, b) => a + b, 0);
      const g = { cells, mLow: 0, mHigh: 0, offset, width: cells.reduce((a, b) => a + b, 0), first: i, last: i + k };
      i += k; return g;
    });
  }
  // Anzahl gleicher Einsätze (mit Rahmen), die zusammen gedruckt werden
  const nCopies = (o) => Math.max(1, Math.min(20, Math.round(o.copies || 1)));
  function copiesOf(arr, n) {
    if (n <= 1) return arr.map((a) => ({ ...a, copy: 0 }));
    const out = [];
    for (let c = 0; c < n; c++) for (const a of arr) out.push({ ...a, copy: c });
    return out;
  }
  function makePieces(sx, sy, ox, oy, sep) {
    const pieces = [];
    sy.forEach((gy, jy) => sx.forEach((gx, ix) => {
      pieces.push({
        ax: gx, ay: gy, ix, iy: jy, x: ox + gx.offset, y: oy + gy.offset, w: gx.width, d: gy.width,
        outer: sep ? [false, false, false, false] : [jy === 0, ix === sx.length - 1, jy === sy.length - 1, ix === 0],
        feat: [[], [], [], []],
        key: axisKey(gx) + '#' + axisKey(gy)
      });
    }));
    return pieces;
  }

  // Verbindungen festlegen: je Stoßseite und Zelle Zapfen (1) oder Tasche (2).
  // 'tabs': Zapfen rechts und hinten, Taschen links und vorne. 'bridges': überall Taschen.
  // Nur wo die eigene und die gegenüberliegende Zelle nicht von einer Wandrundung beschnitten sind.
  function setConn(P0, nx, clips, o) {
    const cm = o.connect === 'tabs' ? [2, 1, 1, 2] : o.connect === 'bridges' ? [2, 2, 2, 2] : null;
    if (!cm) return;
    const cut = (x0, y0, x1, y1) => clips.some((c) => clipCuts(c, x0, y0, x1, y1));
    const spans = (ax) => { const out = []; let x = 0; if (ax.mLow > 0) { out.push(null); x += ax.mLow; } for (const w of ax.cells) { out.push([x, x + w]); x += w; } if (ax.mHigh > 0) out.push(null); return out; };
    for (const p of P0) {
      const cols = spans(p.ax), rows = spans(p.ay);
      const nb = [P0[(p.iy - 1) * nx + p.ix], p.ix + 1 < nx ? P0[p.iy * nx + p.ix + 1] : null, P0[(p.iy + 1) * nx + p.ix], p.ix > 0 ? P0[p.iy * nx + p.ix - 1] : null];
      for (let s = 0; s < 4; s++) {
        const q = nb[s]; if (!q) continue;
        const horiz = s === 0 || s === 2, low = s === 0 || s === 3, along = horiz ? cols : rows, own = horiz ? rows : cols;
        const mine = own[low ? 0 : own.length - 1], qc = horiz ? q.ay.cells : q.ax.cells, theirs = low ? qc[qc.length - 1] : qc[0];
        if (!mine) continue;
        p.feat[s] = along.map((sp) => {
          if (!sp) return 0;
          let a, b; // eigene Zelle und Nachbarzelle in Raster-Koordinaten
          if (horiz) { const y = low ? p.y : p.y + p.d; a = [p.x + sp[0], p.y + mine[0], p.x + sp[1], p.y + mine[1]]; b = low ? [a[0], y - theirs, a[2], y] : [a[0], y, a[2], y + theirs]; }
          else { const x = low ? p.x : p.x + p.w; a = [p.x + mine[0], p.y + sp[0], p.x + mine[1], p.y + sp[1]]; b = low ? [x - theirs, a[1], x, a[3]] : [x, a[1], x + theirs, a[3]]; }
          return cut(...a) || cut(...b) ? 0 : cm[s];
        });
      }
    }
  }

  function compute(o) {
    const AX = axisLayout(o.boxW, o.clearance, o.minSpacer, o.half, o.alignX || o.align);
    const AY = axisLayout(o.boxD, o.clearance, o.minSpacer, o.half, o.alignY || o.align);
    if (!(o.boxW > 0 && o.boxD > 0)) return { error: 'Bitte Breite und Tiefe eingeben.' };
    if (o.boxW > MAX_DIM || o.boxD > MAX_DIM) return { error: `Höchstens ${MAX_DIM} mm je Richtung. Für größere Flächen bitte in mehrere Bereiche aufteilen.` };
    if (!AX.cells.length || !AY.cells.length) return { error: 'Das Innenmaß ist zu klein für eine Gridfinity-Zelle (mindestens 42 mm plus Spiel je Richtung).' };
    if (o.bedZ < H) return { error: `Die Druckhöhe Z ist kleiner als eine Platte (${H} mm). Druckbettmaße prüfen.` };
    const sep = o.spacers === 'separate';
    const gX = sep ? { ...AX, mLow: 0, mHigh: 0 } : AX, gY = sep ? { ...AY, mLow: 0, mHigh: 0 } : AY;
    const ox = sep ? AX.mLow : 0, oy = sep ? AY.mLow : 0;
    // Passt alles nebeneinander auf ein Druckbett, wird nicht gestapelt: ein Material, kein Prime-Tower
    // Zapfen ragen über die Platten hinaus: Bett ringsum um den Überstand kleiner rechnen
    const BX = o.bedX - 2 * connPad(o), BY = o.bedY - 2 * connPad(o);
    if (sep) {
      // mehrere Aufteilungen probieren: die erste, bei der auch die Leisten noch mit aufs Bett passen
      for (const flat of flatSplit(gX, gY, BX, BY, nCopies(o), 8)) {
        const r = finish(AX, AY, flat, ox, oy, sep, { ...o, stack: false }, BX, BY, flat.place);
        if (r.stacks.length === 1) return { ...r, flat: true };
      }
    }
    const bx = BX - (twoMaterials(o) ? o.towerReserve : 0), by = BY;
    let best = null;
    if (o.stack && sep) best = stackSplit(gX, gY, bx, by, o);
    if (!best) for (const [lx, ly] of [[bx, by], [by, bx]]) {
      const sx = splitAxis(gX, lx), sy = splitAxis(gY, ly);
      if (!sx || !sy) continue;
      const cnt = sx.length * sy.length;
      if (!best || cnt < best.cnt) best = { sx, sy, cnt };
    }
    if (!best) return { error: 'Eine einzelne Zelle mit Abstandshalter passt nicht aufs Druckbett. Druckbettmaße prüfen.' };
    return finish(AX, AY, best, ox, oy, sep, o, bx, by, null);
  }

  // Platten, Typen, Druckjobs und Leisten aus einer gewählten Aufteilung
  function finish(AX, AY, best, ox, oy, sep, o, bx, by, flatPlace) {
    const totalW0 = AX.cells.reduce((a, b) => a + b, 0) + AX.mLow + AX.mHigh, totalD0 = AY.cells.reduce((a, b) => a + b, 0) + AY.mLow + AY.mHigh;
    const clips = wallClips(AX, AY, totalW0, totalD0, o);
    const P0 = makePieces(best.sx, best.sy, ox, oy, sep).map((p) => ({ ...p, clips: localClips(clips, p.x, p.y, p.x + p.w, p.y + p.d) }));
    setConn(P0, best.sx.length, clips, o);
    const pieces = copiesOf(P0, nCopies(o));
    // identical piece types
    const types = new Map();
    for (const p of pieces) {
      const k = p.key + '#' + p.outer.join('') + '#' + clipKey(p.clips) + '#' + p.feat.map((a) => a.join('')).join('|');
      if (!types.has(k)) types.set(k, { label: String.fromCharCode(65 + types.size), pieces: [], rep: p });
      types.get(k).pieces.push(p);
      p.type = types.get(k);
    }
    for (const t of types.values()) t.tiles = pieceTiles(t.rep, t.rep.clips, o.connFit);
    // Brücken: eine je Taschenpaar, als Reihen aufs Druckbett
    const bridges = { count: 0, list: [], types: [] };
    if (o.connect === 'bridges') {
      const fit = o.connFit ?? CONN.fit, [bw, bd] = bridgeSize(fit);
      for (const p of pieces) for (const a of p.feat) for (const k of a) if (k === 2) bridges.count += 0.5;
      bridges.count = Math.round(bridges.count);
      for (let left = bridges.count ? bridges.count + CONN.spare : 0; left > 0; left -= CONN.blockN) {
        const n = Math.min(CONN.blockN, left), w = n * bw + (n - 1) * CONN.blockGap;
        let t = bridges.types.find((q) => q.n === n);
        if (!t) { t = { bridge: true, label: 'B' + (bridges.types.length + 1), n, w, d: bd, h: CONN.height, fit, bw, items: [], tiles: [] }; bridges.types.push(t); }
        const b = { x0: 0, y0: 0, x1: w, y1: bd, type: t, bridge: true }; t.items.push(b); bridges.list.push(b);
      }
      bridges.total = bridges.count + CONN.spare; bridges.size = [bw, bd, CONN.height];
    }
    const stacks = flatPlace
      ? [{ label: 'J1', flat: true, bedRot: Math.abs(flatPlace.W - bx) > 1e-6, bed: { w: flatPlace.W, d: flatPlace.D }, foot: { w: flatPlace.fw, d: flatPlace.fd },
          items: flatPlace.items.map((q) => ({ p: pieces[q.i], rot: q.rot, flip: 0, lv: 0, dx: q.x, dy: q.y })) }]
      : o.stack ? buildStacks(pieces, o) : pieces.map((p, i) => ({ items: [{ p, dx: 0, dy: 0 }], label: 'J' + (i + 1) }));
    // spacers: try full-length strips first, split them shorter until they fit next to the plates
    let spacers = { list: [], types: [] }, jobs = packSpacers(stacks.slice(), spacers, bx, by, o, bridges);
    if (sep) {
      const L0 = Math.max(bx, by), best = { n: Infinity };
      for (const f of [1, 0.75, 0.6, 0.5, 0.4, 0.34, 0.25]) {
        const sp = buildSpacers(AX, AY, totalW0, totalD0, L0 * f, o, clips), jb = packSpacers(stacks.map(st => ({ ...st })), sp, bx, by, o, bridges);
        const extra = jb.length - stacks.length;
        if (extra < best.n) { best.n = extra; best.sp = sp; best.jb = jb; }
        if (extra === 0) break;
      }
      spacers = best.sp; jobs = best.jb;
    }
    return { AX, AY, pieces, types: [...types.values()], stacks: jobs, spacers, bridges, totalW: AX.cells.reduce((a, b) => a + b, 0) + AX.mLow + AX.mHigh, totalD: AY.cells.reduce((a, b) => a + b, 0) + AY.mLow + AY.mHigh };
  }

  // Zerlegungsvorschläge einer Achse in Gruppen <= L
  function axisCands(ax, L) {
    const n = ax.cells.length, total = ax.cells.reduce((a, b) => a + b, 0), minParts = Math.max(1, Math.ceil(total / L - 1e-9));
    const maxPart = Math.max(1, Math.floor(L / (PITCH / 2) + 1e-9));
    return partitions(n, maxPart, Math.min(n, minParts + 2)).map((sz) => cutAxis(ax, sz)).filter((gs) => gs.every((g) => g.width <= L + 1e-9));
  }
  // Rechtecke in Reihen aufs Bett legen (Drehung erlaubt), Abstand g; null wenn es nicht passt
  function shelfPack(rects, W, D, g) {
    const order = rects.map((r, i) => ({ ...r, i })).sort((a, b) => Math.min(b.w, b.d) - Math.min(a.w, a.d) || b.w * b.d - a.w * a.d);
    const shelves = [], out = [];
    let yTop = 0, fw = 0;
    for (const r of order) {
      let placed = null;
      for (const rot of [0, 1]) {
        const w = rot ? r.d : r.w, d = rot ? r.w : r.d;
        const sh = shelves.find((q) => q.x + w <= W + 1e-6 && d <= q.h + 1e-6);
        if (sh) { placed = { i: r.i, rot, x: sh.x, y: sh.y }; sh.x += w + g; fw = Math.max(fw, sh.x - g); break; }
      }
      if (!placed) for (const rot of [0, 1]) {
        const w = rot ? r.d : r.w, d = rot ? r.w : r.d;
        if (w <= W + 1e-6 && yTop + d <= D + 1e-6) {
          shelves.push({ y: yTop, h: d, x: w + g }); placed = { i: r.i, rot, x: 0, y: yTop };
          yTop += d + g; fw = Math.max(fw, w); break;
        }
      }
      if (!placed) return null;
      out.push(placed);
    }
    return { items: out.sort((a, b) => a.i - b.i), fw, fd: yTop - g };
  }
  // Wenigste Platten, die zusammen flach auf ein Bett passen (ohne Stapeln)
  function flatSplit(gX, gY, BX, BY, nc = 1, max = 1) {
    const L = Math.max(BX, BY), combos = [], found = [];
    for (const sx of axisCands(gX, L)) for (const sy of axisCands(gY, L)) combos.push({ sx, sy, n: sx.length * sy.length });
    combos.sort((a, b) => a.n - b.n);
    for (const c of combos) {
      if (c.n * nc > 24) break;
      let area = 0; const rects = [];
      for (let k = 0; k < nc; k++) for (const gy of c.sy) for (const gx of c.sx) { rects.push({ w: gx.width, d: gy.width }); area += gx.width * gy.width; }
      if (area > BX * BY) continue;
      for (const [W, D] of [[BX, BY], [BY, BX]]) {
        const pk = shelfPack(rects, W, D, 3);
        if (pk) { found.push({ sx: c.sx, sy: c.sy, cnt: c.n, place: { ...pk, W, D } }); if (found.length >= max) return max === 1 ? found[0] : found; }
      }
    }
    return max === 1 ? found[0] || null : found;
  }

  // Aufteilung so wählen, dass die Platten aufeinander passen: erst möglichst wenige Stapel (Druckjobs),
  // dann möglichst wenige Platten, dann möglichst gleichmäßig. Jede Platte darf einzeln gedreht aufs Bett.
  function stackSplit(gX, gY, bx, by, o) {
    const L = Math.max(bx, by), fits = (w, d) => (w <= bx + 1e-9 && d <= by + 1e-9) || (w <= by + 1e-9 && d <= bx + 1e-9);
    const cand = (ax) => {
      const n = ax.cells.length, total = ax.cells.reduce((a, b) => a + b, 0), minParts = Math.max(1, Math.ceil(total / L - 1e-9));
      const maxPart = Math.max(1, Math.floor(L / (PITCH / 2) + 1e-9));
      return partitions(n, maxPart, Math.min(n, minParts + 2)).map((sz) => cutAxis(ax, sz)).filter((gs) => gs.every((g) => g.width <= L + 1e-9));
    };
    const cx = cand(gX), cy = cand(gY), combos = [];
    for (const sx of cx) for (const sy of cy) combos.push({ sx, sy, n: sx.length * sy.length });
    combos.sort((a, b) => a.n - b.n);
    let best = null;
    for (const c of combos) {
      if (best && best.stacks === 1 && c.n > best.n) break; // ein Stapel gefunden, mehr Platten bringen nichts
      if (best && c.n > best.n + 12) break;
      if (!c.sx.every((gx) => c.sy.every((gy) => fits(gx.width, gy.width)))) continue;
      const st = buildStacks(copiesOf(makePieces(c.sx, c.sy, 0, 0, true), nCopies(o)), o).length;
      const even = c.sx.reduce((a, g) => a + g.width * g.width, 0) + c.sy.reduce((a, g) => a + g.width * g.width, 0);
      if (!best || st < best.stacks || (st === best.stacks && (c.n < best.n || (c.n === best.n && even < best.even)))) best = { sx: c.sx, sy: c.sy, n: c.n, cnt: c.n, stacks: st, even };
    }
    return best;
  }
  // separate spacer strips around the grid. S/N strips span the full width, W/E strips sit between them
  // ladder frame: two thin rails along the length + cross ribs. local coords, length along x if horiz
  function spacerTiles(w, h, horiz, clips, o) {
    const L = horiz ? w : h, M = horiz ? h : w;
    const rail = Math.max(0.8, o.rail || 1.6), pitch = Math.max(8, o.ribPitch || 30);
    // Enden, in die eine Wandrundung schneidet, werden massiv (sonst blieben offene Leiter-Enden stehen):
    // der entfernte Bereich reicht längs der Leiste höchstens bis zum Kreismittelpunkt
    let eA = 0, eB = 0;
    for (const c of clips || []) {
      const ca = horiz ? c.cx : c.cy, low = horiz ? (c.q === 0 || c.q === 3) : c.q < 2;
      if (low) eA = Math.max(eA, Math.min(L, ca)); else eB = Math.max(eB, Math.min(L, L - ca));
    }
    const S = L - eA - eB, rs = eA > 0 ? 0 : 1, re = eB > 0 ? 0 : 1;
    const ng = Math.max(1, Math.ceil((S - rail) / pitch)), nrib = ng - 1 + rs + re, gapL = (S - nrib * rail) / ng;
    const ladder = o.spacerStyle !== 'solid' && M - 2 * rail >= 1.5 && gapL >= 1;
    const across = ladder ? [[0, rail, true], [rail, M - rail, false], [M - rail, M, true]] : [[0, M, true]];
    let along;
    if (ladder && !eA && !eB) {
      const nr = Math.max(2, Math.ceil((L - rail) / pitch) + 1), gap = (L - nr * rail) / (nr - 1);
      along = [];
      for (let k = 0; k < nr; k++) {
        const a = k * (rail + gap);
        along.push([a, a + rail, true]);
        if (k < nr - 1) along.push([a + rail, a + rail + gap, false]);
      }
    } else if (ladder) {
      along = []; let x = eA;
      if (eA > 0) along.push([0, eA, true]);
      for (let k = 0; k < ng; k++) {
        if (k > 0 || rs) { along.push([x, x + rail, true]); x += rail; }
        const e = k === ng - 1 ? L - eB - (re ? rail : 0) : x + gapL;
        along.push([x, e, false]); x = e;
      }
      along.push([x, L, true]);
    } else along = [[0, L, true]];
    // grid[j][i]: j across, i along
    const grid = across.map(([c0, c1, railRow]) => along.map(([a0, a1, rib]) => (railRow || rib) ? (horiz ? { x0: a0, x1: a1, y0: c0, y1: c1 } : { x0: c0, x1: c1, y0: a0, y1: a1 }) : null));
    const tiles = [];
    const at = (j, i) => (grid[j] && grid[j][i]) || null;
    for (let j = 0; j < grid.length; j++) for (let i = 0; i < grid[j].length; i++) {
      const t = grid[j][i]; if (!t) continue;
      // neighbours S,E,N,W in world terms
      const nb = horiz ? [at(j - 1, i), at(j, i + 1), at(j + 1, i), at(j, i - 1)] : [at(j, i - 1), at(j + 1, i), at(j, i + 1), at(j - 1, i)];
      t.pocket = false; t.boundary = nb.map(n => !n); t.nbPocket = [false, false, false, false]; t.rounds = {}; t.clips = [];
      tiles.push(t);
    }
    return clipTiles(tiles, clips);
  }
  // separate spacer strips around the grid. S/N strips span the full width, W/E strips sit between them
  function buildSpacers(AX, AY, W, D, maxLen, o, clips = []) {
    const list = [], L = maxLen - 2;
    const strip = (x0, y0, x1, y1, horiz, roundA, roundB, side) => {
      const len = horiz ? x1 - x0 : y1 - y0, n = Math.max(1, Math.ceil(len / L - 1e-9)), seg = len / n;
      for (let k = 0; k < n; k++) {
        const t = horiz ? { x0: x0 + k * seg, x1: x0 + (k + 1) * seg, y0, y1 } : { x0, x1, y0: y0 + k * seg, y1: y0 + (k + 1) * seg };
        list.push({ ...t, side, horiz, clips: localClips(clips, t.x0, t.y0, t.x1, t.y1) });
      }
    };
    const s = AY.mLow, n = AY.mHigh, w = AX.mLow, e = AX.mHigh;
    // corner indices: 0 SW, 1 SE, 2 NE, 3 NW
    if (s > 0) strip(0, 0, W, s, true, [0], [1], 'S');
    if (n > 0) strip(0, D - n, W, D, true, [3], [2], 'N');
    const ya = s > 0 ? s : 0, yb = n > 0 ? D - n : D;
    if (w > 0) strip(0, ya, w, yb, false, s > 0 ? null : [0], n > 0 ? null : [3], 'W');
    if (e > 0) strip(W - e, ya, W, yb, false, s > 0 ? null : [1], n > 0 ? null : [2], 'E');
    const types = new Map(), all = copiesOf(list, nCopies(o));
    list.length = 0; list.push(...all);
    for (const sp of list) {
      const w2 = sp.x1 - sp.x0, h2 = sp.y1 - sp.y0;
      const key = w2.toFixed(2) + 'x' + h2.toFixed(2) + (sp.horiz ? 'h' : 'v') + clipKey(sp.clips);
      if (!types.has(key)) types.set(key, { label: 'R' + (types.size + 1), items: [], w: w2, d: h2, h: spacerHeight(o), tiles: spacerTiles(w2, h2, sp.horiz, sp.clips, o) });
      types.get(key).items.push(sp); sp.type = types.get(key);
    }
    return { list, types: [...types.values()] };
  }
  function spacerMesh(type) {
    const m = new Mesh();
    if (type.bridge) { for (let i = 0; i < type.n; i++) addBridge(m, type.bw / 2 + i * (type.bw + CONN.blockGap), type.d / 2, type.fit); return m; }
    addPlate(m, type.tiles, 0, type.h); return m;
  }
  // can piece B sit on piece A? returns {dx,dy} offset or null
  function axisFit(b, a) {
    let off;
    if (b.mLow === a.mLow) off = 0; else if (b.mLow === 0) off = a.mLow; else return null;
    if (b.cells.length > a.cells.length) return null;
    for (let i = 0; i < b.cells.length; i++) if (b.cells[i] !== a.cells[i]) return null;
    if (b.mHigh > 0 && !(b.cells.length === a.cells.length && b.mHigh === a.mHigh)) return null;
    return off;
  }
  // Lage der Zellfolge b auf der Zellfolge a (zusammenhängend, gleiche Breiten): Versatz in mm, sonst null
  function seqFit(b, a) {
    for (let i = 0; i + b.length <= a.length; i++) {
      let ok = true;
      for (let k = 0; k < b.length && ok; k++) ok = a[i + k] === b[k];
      if (ok) return a.slice(0, i).reduce((s, x) => s + x, 0);
    }
    return null;
  }
  // Platte p auf die oberste Platte top legen. Die Zellen müssen exakt über Zellen liegen, dann wächst das
  // PETG aus den Stegspitzen darunter und es braucht keine Stützen. Drehung um 90° ist erlaubt.
  // xs/ys = Zellfolgen der liegenden Platte im Koordinatensystem der untersten Platte
  // flip: Platte kopfüber (180° um die x-Achse), dadurch kehrt sich ihre Zellfolge in y um.
  // Kopfüber liegen ihre Stegspitzen unten auf den Stegspitzen darunter, oben ist ihr flaches Bodengitter.
  function placeOn(p, top, flip = 0) {
    for (const rot of [0, 1]) {
      const xs = rot ? p.ay.cells.slice().reverse() : p.ax.cells, ys0 = rot ? p.ax.cells : p.ay.cells;
      const ys = flip ? ys0.slice().reverse() : ys0;
      const fx = seqFit(xs, top.xs), fy = seqFit(ys, top.ys);
      if (fx !== null && fy !== null) return { p, rot, flip, xs, ys, dx: top.dx + fx, dy: top.dy + fy };
    }
    return null;
  }
  function buildStacks(pieces, o) {
    const per = H + sepGap(o);
    const maxN = Math.max(1, Math.min(o.maxStack, Math.floor((o.bedZ - H) / per) + 1));
    const margins = pieces.some((p) => p.ax.mLow || p.ax.mHigh || p.ay.mLow || p.ay.mHigh);
    const sorted = pieces.slice().sort((p, q) => q.w * q.d - p.w * p.d || Math.max(q.w, q.d) - Math.max(p.w, p.d));
    const stacks = [];
    for (const p of sorted) {
      let best = null;
      for (const s of stacks) {
        if (s.items.length >= maxN) continue;
        const top = s.items[s.items.length - 1];
        let it;
        if (margins) { // integrierte Ränder: nur ungedreht und bündig (alte Regel); gewendet spiegeln sich die Ränder in y
          const flip = altFlip(o) ? s.items.length % 2 : 0;
          const ay = flip ? { cells: p.ay.cells.slice().reverse(), mLow: p.ay.mHigh, mHigh: p.ay.mLow } : p.ay;
          const fx = axisFit(p.ax, top.pax), fy = axisFit(ay, top.pay);
          it = fx === null || fy === null ? null : { p, rot: 0, flip, pax: p.ax, pay: ay, dx: top.dx + fx, dy: top.dy + fy };
        } else it = placeOn(p, top, altFlip(o) ? s.items.length % 2 : 0);
        if (!it) continue;
        // gleiche Platte oben bevorzugen, sonst die engste passende
        const score = (top.p.key === p.key ? 0 : 1e9) + top.p.w * top.p.d;
        if (!best || score < best.score) best = { s, it, score };
      }
      if (best) best.s.items.push(best.it);
      else stacks.push({ items: [{ p, rot: 0, flip: 0, xs: p.ax.cells, ys: p.ay.cells, pax: p.ax, pay: p.ay, dx: 0, dy: 0 }] });
    }
    stacks.forEach((s, i) => s.label = 'S' + (i + 1));
    return stacks;
  }

  // put spacer strips into the free area of the plate beds; leftovers get their own bed(s)
  function packSpacers(stacks, spacers, BX, BY, o, bridges) {
    const g = 3;
    stacks.forEach(st => {
      st.spacers = []; st.bridges = [];
      let w, d, bx, by;
      if (st.flat) { w = st.foot.w; d = st.foot.d; bx = st.bed.w; by = st.bed.d; }
      else {
        const p = st.items[0].p; w = p.w; d = p.d;
        st.bedRot = !(w <= BX + 1e-6 && d <= BY + 1e-6);
        [bx, by] = st.bedRot ? [BY, BX] : [BX, BY];
        st.bed = { w: bx, d: by };
      }
      st.regions = [{ x: w + g, y: 0, W: bx - w - g, H: by, lanes: [] }, { x: 0, y: d + g, W: w, H: by - d - g, lanes: [] }].filter(r => r.W > 0.5 && r.H > 0.5);
    });
    const fit = (st, tw) => {
      const sp = tw[0], sw = sp.x1 - sp.x0, sd = sp.y1 - sp.y0, L = Math.max(sw, sd), T = Math.min(sw, sd);
      for (const r of st.regions) {
        const alongY = r.H >= r.W, RL = alongY ? r.H : r.W, RS = alongY ? r.W : r.H;
        if (L > RL + 1e-6 || T > RS + 1e-6) continue;
        let lane = r.lanes.find(ln => T <= ln.t + 1e-6 && ln.used + L <= RL + 1e-6);
        if (!lane) {
          const usedS = r.lanes.reduce((a, ln) => a + ln.t + g, 0);
          if (usedS + T > RS + 1e-6) continue;
          lane = { off: usedS, t: T, used: 0 }; r.lanes.push(lane);
        }
        const a = lane.used; lane.used += L + g;
        // strip long axis along the region's long axis
        const x = alongY ? r.x + lane.off : r.x + a, y = alongY ? r.y + a : r.y + lane.off;
        tw.forEach((q, level) => {
          const longX = (q.x1 - q.x0) >= (q.y1 - q.y0), rot = longX !== !alongY;
          st[tw.key || 'spacers'].push({ sp: q, x, y, rot, level });
        });
        return true;
      }
      return false;
    };
    // towers: equal strips stacked on top of each other (PETG layer between) when stack printing is on
    const towers = [], perT = spacerHeight(o) + spacerGap(o);
    const maxT = o.stack ? Math.max(1, Math.min(o.maxStack, Math.floor((o.bedZ - spacerHeight(o)) / perT) + 1)) : 1;
    const groups = new Map();
    for (const sp of spacers.list) {
      const L = Math.max(sp.x1 - sp.x0, sp.y1 - sp.y0), T = Math.min(sp.x1 - sp.x0, sp.y1 - sp.y0);
      const k = L.toFixed(2) + 'x' + T.toFixed(2);
      if (!groups.has(k)) groups.set(k, []); groups.get(k).push(sp);
    }
    for (const arr of groups.values()) for (let i = 0; i < arr.length; i += maxT) towers.push(arr.slice(i, i + maxT));
    const order = towers.sort((a, b) => Math.max(b[0].x1 - b[0].x0, b[0].y1 - b[0].y0) - Math.max(a[0].x1 - a[0].x0, a[0].y1 - a[0].y0));
    // Brücken-Reihen: flach, nie gestapelt, nach den Leisten
    for (const b of (bridges ? bridges.list : [])) { const tw = [b]; tw.key = 'bridges'; order.push(tw); }
    const left = [];
    for (const tw of order) { if (!stacks.some(st => fit(st, tw))) left.push(tw); }
    while (left.length) { // own beds for what did not fit
      const st = { items: [], spacers: [], bridges: [], bed: { w: BX, d: BY }, regions: [{ x: 0, y: 0, W: BX, H: BY, lanes: [] }], label: 'L' };
      const rest = left.filter(tw => !fit(st, tw));
      if (rest.length === left.length) break; // cannot place (should not happen)
      stacks.push(st); left.splice(0, left.length, ...rest);
    }
    let n = 0; stacks.forEach(st => { if (!st.items.length) st.label = 'L' + (++n); });
    for (const st of stacks) for (const e of st.spacers.concat(st.bridges)) e.sp.job = st;
    return stacks;
  }
  // append mesh src into dst, rotated 90deg (ccw) if rot, then moved to (tx,ty). src occupies [0,w]x[0,d]
  function merge(dst, src, tx, ty, rot, d, tz) {
    const zz = tz || 0, V = src.v, F = src.f, P = (i) => { const x = V[3 * i], y = V[3 * i + 1], z = V[3 * i + 2] + zz; return rot ? [tx + d - y, ty + x, z] : [tx + x, ty + y, z]; };
    for (let k = 0; k < F.length; k += 3) dst.tri(P(F[k]), P(F[k + 1]), P(F[k + 2]));
  }
  function plateMesh(type) { const m = new Mesh(); addPlate(m, type.tiles, 0); return m; }
  // Kacheln einer Platte um 90° gegen den Uhrzeigersinn drehen; Ergebnis liegt in [0,d] x [0,w]
  function rotTiles(tiles, d) {
    const rs = (a) => [a[3], a[0], a[1], a[2]]; // Seiten S,E,N,W
    return tiles.map((t) => {
      return { ...t, x0: d - t.y1, x1: d - t.y0, y0: t.x0, y1: t.x1, boundary: rs(t.boundary), nbPocket: rs(t.nbPocket), rounds: {}, feat: t.feat && rs(t.feat),
        clips: (t.clips || []).map((c) => ({ ...c, cx: d - c.cy, cy: c.cx, q: (c.q + 1) % 4 })) };
    });
  }
  // Kacheln einer Platte kopfüber (180° um x): y spiegelt sich, vorne und hinten tauschen
  function flipTiles(tiles, d) {
    const sw = (a) => a && [a[2], a[1], a[0], a[3]];
    return tiles.map((t) => ({ ...t, y0: d - t.y1, y1: d - t.y0, boundary: sw(t.boundary), nbPocket: sw(t.nbPocket), feat: sw(t.feat),
      clips: (t.clips || []).map((c) => ({ ...c, cy: d - c.cy, q: [3, 2, 1, 0][c.q] })) }));
  }
  // Kacheln einer Platte so, wie sie im Stapel liegt (gedreht, gewendet, verschoben)
  function itemTiles(it) {
    let T = it.rot ? rotTiles(it.p.type.tiles, it.p.d) : it.p.type.tiles;
    if (it.flip) T = flipTiles(T, it.rot ? it.p.w : it.p.d);
    return T.map((t) => moveTile(t, it.dx, it.dy));
  }
  // liegt ein Punkt (mit Rand m) im Material der Kacheln: im Umriss, nicht in einer Wandrundung, nicht über einer Verbindungstasche
  function solidAt(tiles, x, y, m) {
    for (const t of tiles) {
      if (x < t.x0 - 1e-9 || x > t.x1 + 1e-9 || y < t.y0 - 1e-9 || y > t.y1 + 1e-9) continue;
      let ok = true;
      for (const c of t.clips || []) { const [sx, sy] = clipSign(c.q); if (sx * (x - c.cx) < 0 && sy * (y - c.cy) < 0 && Math.hypot(x - c.cx, y - c.cy) > c.r - m) ok = false; }
      const F = ok && tileFeat(t);
      if (F) {
        const C = corners(t), g = connGeo(t.fit);
        F.forEach((f, s) => {
          if (!f || f.kind !== 2) return;
          const a = C[s], b = C[(s + 1) % 4], L = Math.hypot(b[0] - a[0], b[1] - a[1]), ux = (b[0] - a[0]) / L, uy = (b[1] - a[1]) / L;
          const u = (x - a[0]) * ux + (y - a[1]) * uy, v = -(x - a[0]) * uy + (y - a[1]) * ux;
          if (v < g.D + m && Math.abs(u - L / 2) < CONN.neck / 2 + g.D * g.tan + m) ok = false;
        });
      }
      if (ok) return true;
    }
    return false;
  }
  // Punktraster unter einer Platte. kind 'top': Stegoberkanten liegen aufeinander (obere Platte kopfüber),
  // 'foot': Plattenfüße liegen aufeinander. Massive Kacheln (Leisten, Ränder) bekommen ein gleichmäßiges Raster.
  // lo: Kacheln der Platte darunter. Ragt sie über eine Außenkante der oberen Platte hinaus, liegt dort unten ein
  // innerer Steg (±0,25 mm um die Kante) statt eines Außenrands: der Punkt rückt dann auf die halbe Randbreite.
  function perfPoints(tiles, kind, P, lo) {
    const under = (x, y) => !!lo && lo.some((t) => x > t.x0 && x < t.x1 && y > t.y0 && y < t.y1);
    const pts = new Map(), add = (x, y) => pts.set(Math.round(x * 1e3) + ',' + Math.round(y * 1e3), [x, y]);
    for (const t of tiles) {
      const w = t.x1 - t.x0, d = t.y1 - t.y0;
      if (!t.pocket) {
        const nx = Math.max(1, Math.round(w / P.pitch)), ny = Math.max(1, Math.round(d / P.pitch));
        for (let i = 0; i < nx; i++) for (let j = 0; j < ny; j++) add(t.x0 + (i + 0.5) * w / nx, t.y0 + (j + 0.5) * d / ny);
        continue;
      }
      const C = corners(t), B = t.boundary, e = T_BOT - PERF.edge;
      for (let s = 0; s < 4; s++) {
        const a = C[s], b = C[(s + 1) % 4], L = Math.hypot(b[0] - a[0], b[1] - a[1]), ux = (b[0] - a[0]) / L, uy = (b[1] - a[1]) / L;
        // Reihen: [Abstand von der Kante, Anfang, Ende längs der Kante]
        const out = B[s] && under((a[0] + b[0]) / 2 + uy, (a[1] + b[1]) / 2 - ux); // 1 mm außerhalb der Kante
        const rows = kind === 'top'
          ? [[B[s] ? (out ? TOP / 2 : TOP) : 0, B[(s + 3) % 4] ? TOP : 0, B[(s + 1) % 4] ? TOP : 0]] // Mitte der Stegoberkante
          : [[e, e, e], ...(B[s] ? [[PERF.edge, PERF.edge, PERF.edge]] : [])];          // an der Taschenkante, am Außenrand
        for (const [v, u0, u1] of rows) {
          const n = Math.max(1, Math.round((L - u0 - u1) / P.pitch));
          for (let k = 0; k <= n; k++) { const u = u0 + k * (L - u0 - u1) / n; add(a[0] + u * ux - v * uy, a[1] + u * uy + v * ux); }
        }
      }
    }
    return [...pts.values()];
  }
  // alle Punkte eines Druckjobs: [x, y, z unten, z oben]
  function perfList(stack, o) {
    if (!perfMode(o)) return [];
    const P = perfOpt(o), m = P.dot / 2 + PERF.margin, per = H + P.gap, out = [];
    let lo = null;
    stack.items.forEach((it, k) => {
      const up = itemTiles(it), lvk = it.lv ?? k;
      if (lvk > 0 && lo) for (const [x, y] of perfPoints(up, it.flip ? 'top' : 'foot', P, lo)) if (solidAt(up, x, y, m) && solidAt(lo, x, y, m)) out.push([x, y, (lvk - 1) * per + H, lvk * per]);
      lo = up;
    });
    const sh = spacerHeight(o), perS = sh + P.gap, placed = (e) => (e.rot ? rotTiles(e.sp.type.tiles, e.sp.type.d) : e.sp.type.tiles).map((t) => moveTile(t, e.x, e.y));
    for (const e of (stack.spacers || [])) {
      const lv = e.level || 0; if (!lv) continue;
      const below = stack.spacers.find((q) => q.x === e.x && q.y === e.y && (q.level || 0) === lv - 1); if (!below) continue;
      const up = placed(e), lw = placed(below);
      for (const [x, y] of perfPoints(up, 'foot', P)) if (solidAt(up, x, y, m) && solidAt(lw, x, y, m)) out.push([x, y, (lv - 1) * perS + sh, lv * perS]);
    }
    return out;
  }
  function addDot(m, x, y, r, z0, z1) {
    const n = PERF.seg, p = (i, z) => [x + r * Math.cos(2 * Math.PI * i / n), y + r * Math.sin(2 * Math.PI * i / n), z];
    for (let i = 0; i < n; i++) m.quad(p(i, z0), p(i + 1, z0), p(i + 1, z1), p(i, z1));
    for (let i = 1; i < n - 1; i++) { m.tri(p(0, z1), p(i, z1), p(i + 1, z1)); m.tri(p(0, z0), p(i + 1, z0), p(i, z0)); }
  }
  const dotVolume = (r, h) => PERF.seg / 2 * r * r * Math.sin(2 * Math.PI / PERF.seg) * h / 1000; // cm³
  // zwei Netze hintereinanderhängen, ohne Punkte zu verschmelzen (getrennte Körper bleiben getrennt)
  function concat(a, b) {
    const m = new Mesh(), n = a.v.length / 3;
    m.v = a.v.concat(b.v); m.f = a.f.concat(b.f.map((i) => i + n));
    return m;
  }

  function stackMeshes(stack, o) {
    const pla = new Mesh(), petg = new Mesh(), perf = new Mesh(), gap = sepGap(o), per = H + gap, pm = perfMode(o);
    stack.items.forEach((it, k) => {
      const base = it.rot ? rotTiles(it.p.type.tiles, it.p.d) : it.p.type.tiles;
      const lvk = it.lv ?? k;
      if (it.flip) { // PETG-Wendeplatte: Platte bauen und kopfüber an ihren Platz legen (180° um x, echte Drehung)
        const tmp = new Mesh(); addPlate(tmp, base, 0, undefined, 'top');
        const dd = it.rot ? it.p.w : it.p.d, z0 = lvk * per, V = tmp.v, F = tmp.f;
        const P = (i) => [V[3 * i] + it.dx, dd - V[3 * i + 1] + it.dy, z0 + H - V[3 * i + 2]];
        const dst = pm ? pla : petg; // Perforation: auch die gewendete Platte ist PLA
        for (let q = 0; q < F.length; q += 3) dst.tri(P(F[q]), P(F[q + 1]), P(F[q + 2]));
        return;
      }
      const tiles = base.map((t) => moveTile(t, it.dx, it.dy));
      addPlate(pla, tiles, lvk * per, undefined, lvk > 0 ? 'bottom' : 'full');
      if (lvk > 0 && !altFlip(o)) {
        if (o.sepStyle === 'sheet') { // one continuous PETG foil over the whole footprint of the upper plate
          const sheet = tiles.map(t => ({ ...t, pocket: false, nbPocket: [false, false, false, false] }));
          addPlate(petg, sheet, (k - 1) * per + H, o.sepT);
        } else if (o.sepStyle === 'grow') addGrowSeparator(petg, tiles, (k - 1) * per + H, growHeight(o), o.sepT);
        else addSeparator(petg, tiles, (k - 1) * per, o.sepT, o.sepStyle === 'wedge' ? 1 : 0);
      }
    });
    const sh = spacerHeight(o), perS = sh + spacerGap(o), flip = flipMode(o);
    let hs = 0;
    for (const e of (stack.spacers || [])) {
      const t = e.sp.type; if (!t._mesh || t._meshH !== t.h) { t._mesh = spacerMesh(t); t._meshH = t.h; }
      const lv = e.level || 0;
      // Wendeplatte: Leisten auf ungeraden Ebenen sind aus PETG (gleiche Höhen wie die PETG-Platten)
      merge(flip && lv % 2 ? petg : pla, t._mesh, e.x, e.y, e.rot, t.d, lv * perS);
      if (lv > 0 && !flip && !pm) { // PETG sheet with the strip's footprint below it
        if (!t._sep || t._sepT !== o.sepT) { t._sep = new Mesh(); addPlate(t._sep, t.tiles, 0, o.sepT); t._sepT = o.sepT; }
        merge(petg, t._sep, e.x, e.y, e.rot, t.d, lv * perS - o.sepT);
      }
      hs = Math.max(hs, lv * perS + sh);
    }
    for (const e of (stack.bridges || [])) {
      const t = e.sp.type; if (!t._mesh) t._mesh = spacerMesh(t);
      merge(pla, t._mesh, e.x, e.y, e.rot, t.d, 0); hs = Math.max(hs, t.h);
    }
    const nl = stack.items.reduce((a, it, k) => Math.max(a, (it.lv ?? k) + 1), 0);
    const hp = nl ? nl * H + (nl - 1) * gap : 0;
    if (pm) { const r = perfOpt(o).dot / 2; for (const [x, y, z0, z1] of perfList(stack, o)) addDot(perf, x, y, r, z0, z1); }
    return { pla, petg, perf, height: Math.max(hp, hs) };
  }

  function volume(m) { // cm^3
    let v = 0; const V = m.v, F = m.f;
    for (let i = 0; i < F.length; i += 3) {
      const a = F[i] * 3, b = F[i + 1] * 3, c = F[i + 2] * 3;
      v += V[a] * (V[b + 1] * V[c + 2] - V[b + 2] * V[c + 1]) - V[a + 1] * (V[b] * V[c + 2] - V[b + 2] * V[c]) + V[a + 2] * (V[b] * V[c + 1] - V[b + 1] * V[c]);
    }
    return v / 6 / 1000;
  }

  // ---------- file writers ----------
  function stl(m, name) {
    const n = m.f.length / 3, buf = new ArrayBuffer(84 + 50 * n), dv = new DataView(buf);
    const hdr = ('binary STL ' + (name || '')).slice(0, 79);
    for (let i = 0; i < hdr.length; i++) dv.setUint8(i, hdr.charCodeAt(i) & 127);
    dv.setUint32(80, n, true);
    const V = m.v, F = m.f;
    for (let t = 0; t < n; t++) {
      const o = 84 + 50 * t, a = F[3 * t] * 3, b = F[3 * t + 1] * 3, c = F[3 * t + 2] * 3;
      const ux = V[b] - V[a], uy = V[b + 1] - V[a + 1], uz = V[b + 2] - V[a + 2], vx = V[c] - V[a], vy = V[c + 1] - V[a + 1], vz = V[c + 2] - V[a + 2];
      let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx; const l = Math.hypot(nx, ny, nz) || 1;
      dv.setFloat32(o, nx / l, true); dv.setFloat32(o + 4, ny / l, true); dv.setFloat32(o + 8, nz / l, true);
      [a, b, c].forEach((p, k) => { dv.setFloat32(o + 12 + 12 * k, V[p], true); dv.setFloat32(o + 16 + 12 * k, V[p + 1], true); dv.setFloat32(o + 20 + 12 * k, V[p + 2], true); });
    }
    return new Uint8Array(buf);
  }

  // 3MF in the Bambu Studio project layout: one object whose parts carry their own extruder
  // (PLA plates = filament 1, PETG separators = filament 2).
  //   3D/3dmodel.model            build item + assembly object (components with p:path)
  //   3D/Objects/object_1.model   the part meshes
  //   Metadata/model_settings.config  per-part extruder, plate assignment
  // Vertices are stored relative to the object's footprint centre; the build item transform puts the
  // object back where the layout placed it on the bed (opts.bed = [w, d] centres it instead).
  // Material und Höhe eines Druckjobs ohne das ganze Netz zu bauen (schnell, für die Anzeige).
  // Rechnet dieselben Teile wie stackMeshes, aber über zwischengespeicherte Volumen je Teiletyp.
  // Für den Export: liegt ein Druckjob intern quer (Bett gedreht), wird das Netz um 90° gedreht,
  // damit die Datei in X höchstens Bett-X und in Y höchstens Bett-Y breit ist
  function toBed(m, stack) {
    if (!stack.bedRot || !m.f.length) return m;
    const W = stack.bed.w, out = new Mesh(), V = m.v, F = m.f;
    const P = (i) => [V[3 * i + 1], W - V[3 * i], V[3 * i + 2]];
    for (let q = 0; q < F.length; q += 3) out.tri(P(F[q]), P(F[q + 1]), P(F[q + 2]));
    return out;
  }
  function stackInfo(stack, o) {
    const vol = (obj, key, mk) => { obj._vol = obj._vol || {}; if (!(key in obj._vol)) obj._vol[key] = volume(mk()); return obj._vol[key]; };
    const gap = sepGap(o), per = H + gap, flip = flipMode(o);
    let pla = 0, petg = 0;
    stack.items.forEach((it, k) => {
      const t = it.p.type, lvk = it.lv ?? k, tm = it.flip ? 'top' : lvk > 0 ? 'bottom' : 'full';
      const pv = vol(t, 'plate:' + tm, () => { const m = new Mesh(); addPlate(m, t.tiles, 0, undefined, tm); return m; });
      if (it.flip && !perfMode(o)) { petg += pv; return; }
      pla += pv;
      if (lvk > 0 && !altFlip(o)) {
        petg += vol(t, 'sep:' + o.sepStyle + ':' + o.sepT + ':' + o.overhang, () => {
          const m = new Mesh();
          if (o.sepStyle === 'sheet') addPlate(m, t.tiles.map(q => ({ ...q, pocket: false, nbPocket: [false, false, false, false] })), 0, o.sepT);
          else if (o.sepStyle === 'grow') addGrowSeparator(m, t.tiles, H, growHeight(o), o.sepT);
          else addSeparator(m, t.tiles, 0, o.sepT, o.sepStyle === 'wedge' ? 1 : 0);
          return m;
        });
      }
    });
    const sh = spacerHeight(o), perS = sh + spacerGap(o);
    let hs = 0;
    for (const e of (stack.spacers || [])) {
      const t = e.sp.type, lv = e.level || 0, sv = vol(t, 'sp:' + t.h, () => spacerMesh(t));
      if (flip && lv % 2) petg += sv; else pla += sv;
      if (lv > 0 && !flip && !perfMode(o)) petg += vol(t, 'spsep:' + o.sepT, () => { const m = new Mesh(); addPlate(m, t.tiles, 0, o.sepT); return m; });
      hs = Math.max(hs, lv * perS + sh);
    }
    for (const e of (stack.bridges || [])) { const t = e.sp.type; pla += vol(t, 'bridge', () => spacerMesh(t)); hs = Math.max(hs, t.h); }
    const nl = stack.items.reduce((a, it, k) => Math.max(a, (it.lv ?? k) + 1), 0);
    const dots = perfList(stack, o), perf = dots.length ? dots.reduce((a, q) => a + dotVolume(perfOpt(o).dot / 2, q[3] - q[2]), 0) : 0;
    return { pla, petg, perf, dots: dots.length, height: Math.max(nl ? nl * H + (nl - 1) * gap : 0, hs) };
  }

  function threeMF(parts, objName, opts) {
    opts = opts || {};
    const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    const num = (x) => String(+x.toFixed(5));
    const uuid = (a, b) => ('00000000' + a.toString(16)).slice(-8) + '-' + ('0000' + b.toString(16)).slice(-4) + '-4000-8000-' + '0'.repeat(12);
    parts = parts.filter(p => p.mesh.f.length);
    let x0 = Infinity, y0 = Infinity, z0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const p of parts) for (let k = 0; k < p.mesh.v.length; k += 3) {
      const V = p.mesh.v;
      x0 = Math.min(x0, V[k]); x1 = Math.max(x1, V[k]); y0 = Math.min(y0, V[k + 1]); y1 = Math.max(y1, V[k + 1]); z0 = Math.min(z0, V[k + 2]);
    }
    const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
    const tx = opts.bed ? opts.bed[0] / 2 : cx, ty = opts.bed ? opts.bed[1] / 2 : cy;
    const oid = parts.length + 1, OBJ = '/3D/Objects/object_1.model', ident = '1 0 0 0 1 0 0 0 1 0 0 0';
    let objs = '', comps = '', cfgParts = '';
    parts.forEach((p, i) => {
      const id = i + 1, V = p.mesh.v, F = p.mesh.f, vs = [], ts = [];
      for (let k = 0; k < V.length; k += 3) vs.push(`<vertex x="${num(V[k] - cx)}" y="${num(V[k + 1] - cy)}" z="${num(V[k + 2] - z0)}"/>`);
      for (let k = 0; k < F.length; k += 3) ts.push(`<triangle v1="${F[k]}" v2="${F[k + 1]}" v3="${F[k + 2]}"/>`);
      objs += `  <object id="${id}" p:UUID="${uuid(id, 1)}" type="model">\n   <mesh>\n    <vertices>\n${vs.join('\n')}\n    </vertices>\n    <triangles>\n${ts.join('\n')}\n    </triangles>\n   </mesh>\n  </object>\n`;
      comps += `    <component p:path="${OBJ}" objectid="${id}" p:UUID="${uuid(oid, 0x10 + id)}" transform="${ident}"/>\n`;
      cfgParts += `    <part id="${id}" subtype="normal_part">\n      <metadata key="name" value="${esc(p.name)}"/>\n      <metadata key="matrix" value="1 0 0 0 0 1 0 0 0 0 1 0 0 0 0 1"/>\n      <metadata key="source_file" value="${esc(objName)}.3mf"/>\n      <metadata key="source_object_id" value="0"/>\n      <metadata key="source_volume_id" value="${i}"/>\n      <metadata key="extruder" value="${p.extruder}"/>\n    </part>\n`;
    });
    const NS = 'xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02" xmlns:BambuStudio="http://schemas.bambulab.com/package/2021" xmlns:p="http://schemas.microsoft.com/3dmanufacturing/production/2015/06" requiredextensions="p"';
    const itemT = `1 0 0 0 1 0 0 0 1 ${num(tx)} ${num(ty)} ${num(z0)}`;
    // opts.meta: zusätzliche Angaben (z. B. Drucker), als normale 3MF-Metadaten
    const meta = Object.entries(opts.meta || {}).map(([k, v]) => ` <metadata name="${esc(k)}">${esc(v)}</metadata>\n`).join('');
    const model = `<?xml version="1.0" encoding="UTF-8"?>
<model unit="millimeter" xml:lang="en-US" ${NS}>
 <metadata name="Application">BambuStudio-02.00.00.00</metadata>
 <metadata name="BambuStudio:3mfVersion">1</metadata>
 <metadata name="Title">${esc(objName)}</metadata>
 <metadata name="Designer">Gridfinity Planer</metadata>
${meta} <resources>
  <object id="${oid}" p:UUID="${uuid(oid, 0)}" type="model">
   <components>
${comps}   </components>
  </object>
 </resources>
 <build p:UUID="${uuid(0, 0xb)}">
  <item objectid="${oid}" p:UUID="${uuid(oid, 0xb)}" transform="${itemT}"/>
 </build>
</model>
`;
    const objModel = `<?xml version="1.0" encoding="UTF-8"?>
<model unit="millimeter" xml:lang="en-US" ${NS}>
 <metadata name="BambuStudio:3mfVersion">1</metadata>
 <resources>
${objs} </resources>
 <build/>
</model>
`;
    const cfg = `<?xml version="1.0" encoding="UTF-8"?>
<config>
  <object id="${oid}">
    <metadata key="name" value="${esc(objName)}"/>
    <metadata key="extruder" value="1"/>
${cfgParts}  </object>
  <plate>
    <metadata key="plater_id" value="1"/>
    <metadata key="plater_name" value=""/>
    <metadata key="locked" value="false"/>
    <model_instance>
      <metadata key="object_id" value="${oid}"/>
      <metadata key="instance_id" value="0"/>
      <metadata key="identify_id" value="${oid * 100}"/>
    </model_instance>
  </plate>
  <assemble>
   <assemble_item object_id="${oid}" instance_id="0" transform="${itemT}" offset="0 0 0" />
  </assemble>
</config>
`;
    const ct = `<?xml version="1.0" encoding="UTF-8"?>\n<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">\n <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>\n <Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/>\n <Default Extension="config" ContentType="text/xml"/>\n</Types>\n`;
    const rel = (target) => `<?xml version="1.0" encoding="UTF-8"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">\n <Relationship Target="${target}" Id="rel-1" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/>\n</Relationships>\n`;
    return zip([
      ['[Content_Types].xml', ct], ['_rels/.rels', rel('/3D/3dmodel.model')],
      ['3D/3dmodel.model', model], ['3D/_rels/3dmodel.model.rels', rel(OBJ)], [OBJ.slice(1), objModel],
      ['Metadata/model_settings.config', cfg],
    ]);
  }

  // ---------- minimal ZIP (store) ----------
  const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
  function crc32(u8) { let c = 0xFFFFFFFF; for (let i = 0; i < u8.length; i++) c = CRC[(c ^ u8[i]) & 255] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; }
  function zip(entries) {
    const enc = new TextEncoder(), files = [], chunks = []; let off = 0;
    for (const [name, data] of entries) {
      const nb = enc.encode(name), d = typeof data === 'string' ? enc.encode(data) : data, crc = crc32(d);
      const h = new DataView(new ArrayBuffer(30));
      h.setUint32(0, 0x04034b50, true); h.setUint16(4, 20, true); h.setUint16(6, 0x0800, true); h.setUint16(8, 0, true);
      h.setUint16(10, 0, true); h.setUint16(12, 0x21, true); h.setUint32(14, crc, true); h.setUint32(18, d.length, true); h.setUint32(22, d.length, true);
      h.setUint16(26, nb.length, true); h.setUint16(28, 0, true);
      chunks.push(new Uint8Array(h.buffer), nb, d);
      files.push({ nb, crc, size: d.length, off }); off += 30 + nb.length + d.length;
    }
    let cdSize = 0;
    for (const f of files) {
      const h = new DataView(new ArrayBuffer(46));
      h.setUint32(0, 0x02014b50, true); h.setUint16(4, 20, true); h.setUint16(6, 20, true); h.setUint16(8, 0x0800, true); h.setUint16(10, 0, true);
      h.setUint16(12, 0, true); h.setUint16(14, 0x21, true); h.setUint32(16, f.crc, true); h.setUint32(20, f.size, true); h.setUint32(24, f.size, true);
      h.setUint16(28, f.nb.length, true); h.setUint32(42, f.off, true);
      chunks.push(new Uint8Array(h.buffer), f.nb); cdSize += 46 + f.nb.length;
    }
    const e = new DataView(new ArrayBuffer(22));
    e.setUint32(0, 0x06054b50, true); e.setUint16(8, files.length, true); e.setUint16(10, files.length, true);
    e.setUint32(12, cdSize, true); e.setUint32(16, off, true);
    chunks.push(new Uint8Array(e.buffer));
    let total = 0; for (const c of chunks) total += c.length;
    const out = new Uint8Array(total); let p = 0; for (const c of chunks) { out.set(c, p); p += c.length; }
    return out;
  }

  return { PITCH, H, MAX_DIM, stackInfo, toBed, nCopies, PRINTERS, printerOf, applyPrinter, printerFor, printArea, PERF, perfMode, perfOpt, perfList, concat, twoMaterials, itemTiles, CONN, bridgeMesh, bridgeSize, connPad, wallClips, clipPoly, outline, fitSizes, flipMode, spacerHeight, compute, spacerMesh, plateMesh, stackMeshes, volume, stl, threeMF, zip, Mesh, addPlate, addSeparator, pieceTiles };
})();

export default GF;
export const { PITCH, H, compute, spacerMesh, plateMesh, stackMeshes, volume, stl, threeMF, zip, Mesh, addPlate, addSeparator, pieceTiles } = GF;
