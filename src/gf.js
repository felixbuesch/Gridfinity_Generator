// Gridfinity geometry + layout core. No dependencies; runs in Node and in the browser (ES module).
const GF = (() => {
  const PITCH = 42, R = 4, H = 4.65;
  // baseplate pocket profile, bottom -> top: [z, inset]
  const PROFILE = [[0, 2.85], [0.7, 2.15], [2.5, 2.15], [4.65, 0]];
  const T_BOT = 2.85, CHAMFER_Z = 2.5, CHAMFER_T = 2.15;
  const ARC = 8; // segments per rounded corner

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
  function ring(tile, t, z) {
    const { x0, y0, x1, y1 } = tile, r = R - t;
    const cs = [[x0 + t + r, y0 + t + r, 180], [x1 - t - r, y0 + t + r, 270], [x1 - t - r, y1 - t - r, 0], [x0 + t + r, y1 - t - r, 90]];
    return cs.map(([cx, cy, a0]) => {
      const arc = [];
      for (let i = 0; i <= ARC; i++) {
        const a = (a0 + 90 * i / ARC) * Math.PI / 180;
        arc.push([cx + r * Math.cos(a), cy + r * Math.sin(a), z]);
      }
      return arc;
    });
  }
  const flat = (rg) => [].concat(...rg);
  const corners = (tile) => [[tile.x0, tile.y0], [tile.x1, tile.y0], [tile.x1, tile.y1], [tile.x0, tile.y1]];

  // surface between two rings (A below B). faceOut: normal away from tile centre
  function loft(m, A, B, faceOut) {
    const a = flat(A), b = flat(B), n = a.length;
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      if (faceOut) m.quad(a[i], a[j], b[j], b[i]); else m.quad(a[i], b[i], b[j], a[j]);
    }
  }
  // flat face between tile rectangle and a ring, at z
  function rectAnnulus(m, tile, rg, z, up) {
    const C = corners(tile).map(p => [p[0], p[1], z]);
    for (let c = 0; c < 4; c++) {
      const arc = rg[c];
      for (let i = 0; i < arc.length - 1; i++) up ? m.tri(C[c], arc[i + 1], arc[i]) : m.tri(C[c], arc[i], arc[i + 1]);
      const n = (c + 1) % 4, p = arc[arc.length - 1], q = rg[n][0];
      const degenerate = Math.abs(p[0] - C[c][0]) < 1e-9 && Math.abs(p[1] - C[c][1]) < 1e-9 ||
        (Math.abs((q[0] - p[0]) * (C[n][1] - C[c][1]) - (q[1] - p[1]) * (C[n][0] - C[c][0])) < 1e-9 &&
          Math.abs((p[0] - C[c][0]) * (C[n][1] - C[c][1]) - (p[1] - C[c][1]) * (C[n][0] - C[c][0])) < 1e-9);
      if (!degenerate) up ? m.quad(C[c], C[n], q, p) : m.quad(C[c], p, q, C[n]);
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
  function polyFromSegs(segs, z) {
    const out = [];
    for (const s of segs) for (let i = 0; i < s.pts.length - 1; i++) out.push(z3(s.pts[i], z));
    return out;
  }
  // vertical boundary walls between levels zb (knifeB) and zt (knifeT)
  function walls(m, tile, zb, zt, kb, kt) {
    const sb = perimeter(tile, kb), st = perimeter(tile, kt);
    for (let i = 0; i < sb.length; i++) {
      if (!sb[i].boundary) continue;
      const B = sb[i].pts, T = st[i].pts;
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
    if (!isKnifeLevel) return [false, false, false, false];
    if (tile.pocket) return [true, true, true, true];
    return tile.nbPocket.slice();
  }

  // ---------- bodies ----------
  function addPlate(m, tiles, z0, hs) {
    const HS = hs || H;
    for (const t of tiles) {
      const kb = knifeFlags(t, false), kt = knifeFlags(t, true);
      if (t.pocket) {
        const rings = PROFILE.map(([z, ins]) => ring(t, ins, z0 + z));
        for (let i = 0; i < rings.length - 1; i++) loft(m, rings[i], rings[i + 1], false);
        rectAnnulus(m, t, rings[0], z0, false);
        rectAnnulus(m, t, rings[rings.length - 1], z0 + H, true);
      } else {
        const segsT = perimeter(t, kt), segsB = perimeter(t, kb);
        m.fan(polyFromSegs(segsT, z0 + (t.pocket ? H : HS)));
        m.fan(polyFromSegs(segsB, z0).reverse());
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
          const ts = T_BOT / 2, zc = Z0 - ts;
          const rs = ring(t, ts, zc), rIn = ring(t, T_BOT, Z0), inHi = ring(t, T_BOT, Z1), r0 = ring(t, 0, Z0);
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
        m.fan(polyFromSegs(perimeter(t, kt), Z1));
        m.fan(polyFromSegs(perimeter(t, kb), Z0).reverse());
      }
      walls(m, t, Z0, Z1, kb, kt);
    }
  }

  // PETG that starts on the top edges of the plate below and grows outward at the allowed overhang angle
  // until it reaches the full foot of the next plate (inset T_BOT), then a flat base of thickness s
  const growHeight = (o) => T_BOT / Math.tan(Math.max(20, Math.min(70, o.overhang || 45)) * Math.PI / 180);
  // Wendeplatte: jede zweite Platte ist selbst die PETG-Trennung (kopfüber), Platten liegen direkt aufeinander
  // Wendeplatte: Leisten so hoch wie eine Platte und im Turm ebenfalls abwechselnd PLA/PETG ohne Zwischenlage
  const flipMode = (o) => o.sepStyle === 'flip' && o.stack;
  const spacerHeight = (o) => (flipMode(o) ? H : o.spacerH || H);
  const spacerGap = (o) => (flipMode(o) ? 0 : o.sepT);
  const sepGap = (o) => o.sepStyle === 'flip' ? 0 : o.sepStyle === 'grow' ? growHeight(o) + o.sepT : o.sepT;
  function addGrowSeparator(m, tiles, Z0, gh, s) {
    const Za = Z0 + gh, Z1 = Za + s;
    for (const t of tiles) {
      const kb = knifeFlags(t, true), kt = knifeFlags(t, false);
      if (t.pocket) {
        const r0 = ring(t, 0, Z0), ra = ring(t, T_BOT, Za), r1 = ring(t, T_BOT, Z1);
        loft(m, r0, ra, false);   // overhang flank, grows outward from the knife edge
        loft(m, ra, r1, false);   // vertical edge of the base layer
        rectAnnulus(m, t, r0, Z0, false);
        rectAnnulus(m, t, r1, Z1, true);
      } else {
        m.fan(polyFromSegs(perimeter(t, kt), Z1));
        m.fan(polyFromSegs(perimeter(t, kb), Z0).reverse());
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
  function pieceTiles(p, cornerR) {
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
        const t = { x0: cols[i].a, x1: cols[i].b, y0: rows[j].a, y1: rows[j].b, pocket: cols[i].cell && rows[j].cell, i, j, rounds: {} };
        grid[j].push(t); tiles.push(t);
      }
    }
    for (const t of tiles) {
      const nb = [grid[t.j - 1] && grid[t.j - 1][t.i], grid[t.j][t.i + 1], grid[t.j + 1] && grid[t.j + 1][t.i], grid[t.j][t.i - 1]]; // S,E,N,W
      t.boundary = nb.map(n => !n);
      t.nbPocket = nb.map(n => !!(n && n.pocket));
      if (!t.pocket && cornerR > 0) {
        const outer = p.outer; // which outer edges of the whole layout this piece touches: [S,E,N,W]
        const lim = Math.min(t.x1 - t.x0, t.y1 - t.y0) - 0.01;
        const r = Math.min(cornerR, lim);
        const cand = [[0, 3, 0], [0, 1, 1], [2, 1, 2], [2, 3, 3]]; // [sideA, sideB, corner]
        for (const [sa, sb, c] of cand) {
          if (t.boundary[sa] && t.boundary[sb] && outer[sa] && outer[sb] && r > 0.2) {
            const isCornerTile = (c === 0 && t.i === 0 && t.j === 0) || (c === 1 && t.i === cols.length - 1 && t.j === 0) ||
              (c === 2 && t.i === cols.length - 1 && t.j === rows.length - 1) || (c === 3 && t.i === 0 && t.j === rows.length - 1);
            if (isCornerTile) t.rounds[c] = r;
          }
        }
      }
    }
    return tiles;
  }

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
  function partitions(n, maxPart, maxParts) {
    const out = [];
    const rec = (left, max, acc) => {
      if (left === 0) { out.push(acc.slice()); return; }
      if (acc.length >= maxParts) return;
      for (let k = Math.min(max, left); k >= 1; k--) { acc.push(k); rec(left - k, k, acc); acc.pop(); }
    };
    rec(n, maxPart, []);
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
        key: axisKey(gx) + '#' + axisKey(gy)
      });
    }));
    return pieces;
  }

  function compute(o) {
    const AX = axisLayout(o.boxW, o.clearance, o.minSpacer, o.half, o.alignX || o.align);
    const AY = axisLayout(o.boxD, o.clearance, o.minSpacer, o.half, o.alignY || o.align);
    if (!AX.cells.length || !AY.cells.length) return { error: 'Die Box ist zu klein für eine Gridfinity-Einheit (mind. 42 mm plus Spiel je Richtung).' };
    const sep = o.spacers === 'separate';
    const gX = sep ? { ...AX, mLow: 0, mHigh: 0 } : AX, gY = sep ? { ...AY, mLow: 0, mHigh: 0 } : AY;
    const ox = sep ? AX.mLow : 0, oy = sep ? AY.mLow : 0;
    // Passt alles nebeneinander auf ein Druckbett, wird nicht gestapelt: ein Material, kein Prime-Tower
    if (sep) {
      const flat = flatSplit(gX, gY, o.bedX, o.bedY, nCopies(o));
      if (flat) {
        const r = finish(AX, AY, flat, ox, oy, sep, { ...o, stack: false }, o.bedX, o.bedY, flat.place);
        if (r.stacks.length === 1) return { ...r, flat: true };
      }
    }
    const bx = o.bedX - (o.stack ? o.towerReserve : 0), by = o.bedY;
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
    const pieces = copiesOf(makePieces(best.sx, best.sy, ox, oy, sep), nCopies(o));
    // identical piece types
    const types = new Map();
    for (const p of pieces) {
      const k = p.key + '#' + p.outer.join('');
      if (!types.has(k)) types.set(k, { label: String.fromCharCode(65 + types.size), pieces: [], rep: p });
      types.get(k).pieces.push(p);
      p.type = types.get(k);
    }
    for (const t of types.values()) t.tiles = pieceTiles(t.rep, o.cornerR);
    const stacks = flatPlace
      ? [{ label: 'J1', flat: true, bed: { w: flatPlace.W, d: flatPlace.D }, foot: { w: flatPlace.fw, d: flatPlace.fd },
          items: flatPlace.items.map((q) => ({ p: pieces[q.i], rot: q.rot, flip: 0, lv: 0, dx: q.x, dy: q.y })) }]
      : o.stack ? buildStacks(pieces, o) : pieces.map((p, i) => ({ items: [{ p, dx: 0, dy: 0 }], label: 'J' + (i + 1) }));
    const totalW0 = AX.cells.reduce((a, b) => a + b, 0) + AX.mLow + AX.mHigh, totalD0 = AY.cells.reduce((a, b) => a + b, 0) + AY.mLow + AY.mHigh;
    // spacers: try full-length strips first, split them shorter until they fit next to the plates
    let spacers = { list: [], types: [] }, jobs = packSpacers(stacks.slice(), spacers, bx, by, o);
    if (sep) {
      const L0 = Math.max(bx, by), best = { n: Infinity };
      for (const f of [1, 0.75, 0.6, 0.5, 0.4, 0.34, 0.25]) {
        const sp = buildSpacers(AX, AY, totalW0, totalD0, L0 * f, o), jb = packSpacers(stacks.map(st => ({ ...st })), sp, bx, by, o);
        const extra = jb.length - stacks.length;
        if (extra < best.n) { best.n = extra; best.sp = sp; best.jb = jb; }
        if (extra === 0) break;
      }
      spacers = best.sp; jobs = best.jb;
    }
    return { AX, AY, pieces, types: [...types.values()], stacks: jobs, spacers, totalW: AX.cells.reduce((a, b) => a + b, 0) + AX.mLow + AX.mHigh, totalD: AY.cells.reduce((a, b) => a + b, 0) + AY.mLow + AY.mHigh };
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
  function flatSplit(gX, gY, BX, BY, nc = 1) {
    const L = Math.max(BX, BY), combos = [];
    for (const sx of axisCands(gX, L)) for (const sy of axisCands(gY, L)) combos.push({ sx, sy, n: sx.length * sy.length });
    combos.sort((a, b) => a.n - b.n);
    for (const c of combos) {
      if (c.n * nc > 24) break;
      let area = 0; const rects = [];
      for (let k = 0; k < nc; k++) for (const gy of c.sy) for (const gx of c.sx) { rects.push({ w: gx.width, d: gy.width }); area += gx.width * gy.width; }
      if (area > BX * BY) continue;
      for (const [W, D] of [[BX, BY], [BY, BX]]) {
        const pk = shelfPack(rects, W, D, 3);
        if (pk) return { sx: c.sx, sy: c.sy, cnt: c.n, place: { ...pk, W, D } };
      }
    }
    return null;
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
  function spacerTiles(w, h, horiz, rounds, o) {
    const L = horiz ? w : h, M = horiz ? h : w;
    const rail = Math.max(0.8, o.rail || 1.6), pitch = Math.max(8, o.ribPitch || 30);
    const ladder = o.spacerStyle !== 'solid' && M - 2 * rail >= 1.5;
    const across = ladder ? [[0, rail, true], [rail, M - rail, false], [M - rail, M, true]] : [[0, M, true]];
    let along;
    if (ladder) {
      const nr = Math.max(2, Math.ceil((L - rail) / pitch) + 1), gap = (L - nr * rail) / (nr - 1);
      along = [];
      for (let k = 0; k < nr; k++) {
        const a = k * (rail + gap);
        along.push([a, a + rail, true]);
        if (k < nr - 1) along.push([a + rail, a + rail + gap, false]);
      }
    } else along = [[0, L, true]];
    // grid[j][i]: j across, i along
    const grid = across.map(([c0, c1, railRow]) => along.map(([a0, a1, rib]) => (railRow || rib) ? (horiz ? { x0: a0, x1: a1, y0: c0, y1: c1 } : { x0: c0, x1: c1, y0: a0, y1: a1 }) : null));
    const tiles = [];
    const at = (j, i) => (grid[j] && grid[j][i]) || null;
    for (let j = 0; j < grid.length; j++) for (let i = 0; i < grid[j].length; i++) {
      const t = grid[j][i]; if (!t) continue;
      // neighbours S,E,N,W in world terms
      const nb = horiz ? [at(j - 1, i), at(j, i + 1), at(j + 1, i), at(j, i - 1)] : [at(j, i - 1), at(j + 1, i), at(j, i + 1), at(j - 1, i)];
      t.pocket = false; t.boundary = nb.map(n => !n); t.nbPocket = [false, false, false, false]; t.rounds = {};
      tiles.push(t);
    }
    // rounded strip corners -> the tile sitting in that corner
    for (const c of Object.keys(rounds)) {
      const cx = (c == 1 || c == 2) ? w : 0, cy = (c == 2 || c == 3) ? h : 0;
      const t = tiles.find(t => Math.abs((cx ? t.x1 : t.x0) - cx) < 1e-6 && Math.abs((cy ? t.y1 : t.y0) - cy) < 1e-6);
      if (!t) continue;
      const r = Math.min(rounds[c], t.x1 - t.x0 - 0.01, t.y1 - t.y0 - 0.01);
      if (r > 0.2 && t.boundary[c == 0 || c == 1 ? 0 : 2] && t.boundary[c == 0 || c == 3 ? 3 : 1]) t.rounds[c] = r;
    }
    return tiles;
  }
  // separate spacer strips around the grid. S/N strips span the full width, W/E strips sit between them
  function buildSpacers(AX, AY, W, D, maxLen, o) {
    const cornerR = o.cornerR, list = [], L = maxLen - 2;
    const strip = (x0, y0, x1, y1, horiz, roundA, roundB, side) => {
      const len = horiz ? x1 - x0 : y1 - y0, n = Math.max(1, Math.ceil(len / L - 1e-9)), seg = len / n;
      for (let k = 0; k < n; k++) {
        const t = horiz ? { x0: x0 + k * seg, x1: x0 + (k + 1) * seg, y0, y1 } : { x0, x1, y0: y0 + k * seg, y1: y0 + (k + 1) * seg };
        const rounds = {};
        if (cornerR > 0.2) {
          if (k === 0 && roundA) for (const c of roundA) rounds[c] = cornerR;
          if (k === n - 1 && roundB) for (const c of roundB) rounds[c] = cornerR;
        }
        list.push({ ...t, side, horiz, rounds });
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
      const key = w2.toFixed(2) + 'x' + h2.toFixed(2) + JSON.stringify(sp.rounds);
      if (!types.has(key)) types.set(key, { label: 'R' + (types.size + 1), items: [], w: w2, d: h2, h: spacerHeight(o), tiles: spacerTiles(w2, h2, sp.horiz, sp.rounds, o) });
      types.get(key).items.push(sp); sp.type = types.get(key);
    }
    return { list, types: [...types.values()] };
  }
  function spacerMesh(type) { const m = new Mesh(); addPlate(m, type.tiles, 0, type.h); return m; }
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
          const flip = o.sepStyle === 'flip' ? s.items.length % 2 : 0;
          const ay = flip ? { cells: p.ay.cells.slice().reverse(), mLow: p.ay.mHigh, mHigh: p.ay.mLow } : p.ay;
          const fx = axisFit(p.ax, top.pax), fy = axisFit(ay, top.pay);
          it = fx === null || fy === null ? null : { p, rot: 0, flip, pax: p.ax, pay: ay, dx: top.dx + fx, dy: top.dy + fy };
        } else it = placeOn(p, top, o.sepStyle === 'flip' ? s.items.length % 2 : 0);
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
  function packSpacers(stacks, spacers, BX, BY, o) {
    const g = 3;
    stacks.forEach(st => {
      st.spacers = [];
      let w, d, bx, by;
      if (st.flat) { w = st.foot.w; d = st.foot.d; bx = st.bed.w; by = st.bed.d; }
      else {
        const p = st.items[0].p; w = p.w; d = p.d;
        [bx, by] = (w <= BX + 1e-6 && d <= BY + 1e-6) ? [BX, BY] : [BY, BX];
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
          st.spacers.push({ sp: q, x, y, rot, level });
        });
        return true;
      }
      return false;
    };
    // towers: equal strips stacked on top of each other (PETG layer between) when stack printing is on
    const towers = [], perT = spacerHeight(o) + spacerGap(o);
    const maxT = o.stack ? Math.max(1, Math.min(o.maxStack, Math.floor(((o.bedZ || 250) - spacerHeight(o)) / perT) + 1)) : 1;
    const groups = new Map();
    for (const sp of spacers.list) {
      const L = Math.max(sp.x1 - sp.x0, sp.y1 - sp.y0), T = Math.min(sp.x1 - sp.x0, sp.y1 - sp.y0);
      const k = L.toFixed(2) + 'x' + T.toFixed(2);
      if (!groups.has(k)) groups.set(k, []); groups.get(k).push(sp);
    }
    for (const arr of groups.values()) for (let i = 0; i < arr.length; i += maxT) towers.push(arr.slice(i, i + maxT));
    const order = towers.sort((a, b) => Math.max(b[0].x1 - b[0].x0, b[0].y1 - b[0].y0) - Math.max(a[0].x1 - a[0].x0, a[0].y1 - a[0].y0));
    const left = [];
    for (const tw of order) { if (!stacks.some(st => fit(st, tw))) left.push(tw); }
    while (left.length) { // own beds for what did not fit
      const st = { items: [], spacers: [], bed: { w: BX, d: BY }, regions: [{ x: 0, y: 0, W: BX, H: BY, lanes: [] }], label: 'L' };
      const rest = left.filter(tw => !fit(st, tw));
      if (rest.length === left.length) break; // cannot place (should not happen)
      stacks.push(st); left.splice(0, left.length, ...rest);
    }
    let n = 0; stacks.forEach(st => { if (!st.items.length) st.label = 'L' + (++n); });
    for (const st of stacks) for (const e of st.spacers) e.sp.job = st;
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
      const r = { ...t, x0: d - t.y1, x1: d - t.y0, y0: t.x0, y1: t.x1, boundary: rs(t.boundary), nbPocket: rs(t.nbPocket), rounds: {} };
      for (const c of Object.keys(t.rounds || {})) r.rounds[(+c + 1) % 4] = t.rounds[c];
      return r;
    });
  }
  function stackMeshes(stack, o) {
    const pla = new Mesh(), petg = new Mesh(), gap = sepGap(o), per = H + gap;
    stack.items.forEach((it, k) => {
      const base = it.rot ? rotTiles(it.p.type.tiles, it.p.d) : it.p.type.tiles;
      const lvk = it.lv ?? k;
      if (it.flip) { // PETG-Wendeplatte: Platte bauen und kopfüber an ihren Platz legen (180° um x, echte Drehung)
        const tmp = new Mesh(); addPlate(tmp, base, 0);
        const dd = it.rot ? it.p.w : it.p.d, z0 = lvk * per, V = tmp.v, F = tmp.f;
        const P = (i) => [V[3 * i] + it.dx, dd - V[3 * i + 1] + it.dy, z0 + H - V[3 * i + 2]];
        for (let q = 0; q < F.length; q += 3) petg.tri(P(F[q]), P(F[q + 1]), P(F[q + 2]));
        return;
      }
      const tiles = base.map(t => ({ ...t, x0: t.x0 + it.dx, x1: t.x1 + it.dx, y0: t.y0 + it.dy, y1: t.y1 + it.dy }));
      addPlate(pla, tiles, lvk * per);
      if (lvk > 0 && o.sepStyle !== 'flip') {
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
      if (lv > 0 && !flip) { // PETG sheet with the strip's footprint below it
        if (!t._sep || t._sepT !== o.sepT) { t._sep = new Mesh(); addPlate(t._sep, t.tiles, 0, o.sepT); t._sepT = o.sepT; }
        merge(petg, t._sep, e.x, e.y, e.rot, t.d, lv * perS - o.sepT);
      }
      hs = Math.max(hs, lv * perS + sh);
    }
    const nl = stack.items.reduce((a, it, k) => Math.max(a, (it.lv ?? k) + 1), 0);
    const hp = nl ? nl * H + (nl - 1) * gap : 0;
    return { pla, petg, height: Math.max(hp, hs) };
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
    const model = `<?xml version="1.0" encoding="UTF-8"?>
<model unit="millimeter" xml:lang="en-US" ${NS}>
 <metadata name="Application">BambuStudio-02.00.00.00</metadata>
 <metadata name="BambuStudio:3mfVersion">1</metadata>
 <metadata name="Title">${esc(objName)}</metadata>
 <metadata name="Designer">Gridfinity Planer</metadata>
 <resources>
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

  return { PITCH, H, nCopies, fitSizes, flipMode, spacerHeight, compute, spacerMesh, plateMesh, stackMeshes, volume, stl, threeMF, zip, Mesh, addPlate, addSeparator, pieceTiles };
})();

export default GF;
export const { PITCH, H, compute, spacerMesh, plateMesh, stackMeshes, volume, stl, threeMF, zip, Mesh, addPlate, addSeparator, pieceTiles } = GF;
