function bytes(str) {
  const s = atob(str);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

function b64(u8) {
  let s = '';
  for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
  return btoa(s);
}

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a) => {
  const l = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};

function readTris(a) {
  const tris = [];
  for (const sec of a.sections) {
    const qp = new Uint16Array(bytes(sec.p).buffer);
    const idx = new Uint16Array(bytes(sec.i).buffer);
    const b = sec.b;
    const sx = (b[3] - b[0]) / 65535;
    const sy = (b[4] - b[1]) / 65535;
    const sz = (b[5] - b[2]) / 65535;
    const P = (k) => [b[0] + qp[k * 3] * sx, b[1] + qp[k * 3 + 1] * sy, b[2] + qp[k * 3 + 2] * sz];
    for (let i = 0; i + 2 < idx.length; i += 3) {
      const p = [P(idx[i]), P(idx[i + 1]), P(idx[i + 2])];
      const c = cross(sub(p[1], p[0]), sub(p[2], p[0]));
      const area = Math.hypot(c[0], c[1], c[2]) / 2;
      if (area < 1e-6) continue;
      tris.push({ p, n: norm(c), area });
    }
  }
  return tris;
}

function regions(tris, snap, tol) {
  const parent = tris.map((_, i) => i);
  const find = (i) => {
    while (parent[i] !== i) i = parent[i] = parent[parent[i]];
    return i;
  };
  const key = (p) => `${Math.round(p[0] / snap)},${Math.round(p[1] / snap)},${Math.round(p[2] / snap)}`;
  const edges = new Map();
  tris.forEach((t, i) => {
    const k = t.p.map(key);
    for (let e = 0; e < 3; e++) {
      const a = k[e];
      const b = k[(e + 1) % 3];
      const ek = a < b ? a + '|' + b : b + '|' + a;
      const list = edges.get(ek);
      if (list) list.push(i);
      else edges.set(ek, [i]);
    }
  });
  for (const list of edges.values()) {
    for (let x = 0; x < list.length; x++)
      for (let y = x + 1; y < list.length; y++) {
        const A = tris[list[x]];
        const B = tris[list[y]];
        const d = dot(A.n, B.n);
        if (Math.abs(d) < 0.9995) continue;
        if (Math.abs(dot(A.n, sub(B.p[0], A.p[0]))) > tol) continue;
        const ra = find(list[x]);
        const rb = find(list[y]);
        if (ra !== rb) parent[ra] = rb;
      }
  }
  const groups = new Map();
  tris.forEach((t, i) => {
    const r = find(i);
    if (groups.has(r)) groups.get(r).push(t);
    else groups.set(r, [t]);
  });
  return [...groups.values()];
}

function fitRegion(group, cell, maxCells, out) {
  let n = [0, 0, 0];
  let area = 0;
  for (const t of group) {
    const s = dot(t.n, group[0].n) < 0 ? -1 : 1;
    n = [n[0] + t.n[0] * t.area * s, n[1] + t.n[1] * t.area * s, n[2] + t.n[2] * t.area * s];
    area += t.area;
  }
  n = norm(n);
  const seed = Math.abs(n[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0];
  const u0 = norm(cross(seed, n));
  const v0 = cross(n, u0);
  const flat = group.map((t) => t.p.map((p) => [dot(p, u0), dot(p, v0)]));
  let d = 0;
  for (const t of group) d += dot(t.p[0], n);
  d /= group.length;
  const dirs = [];
  for (const f of flat)
    for (let e = 0; e < 3; e++) {
      const a = f[e];
      const b = f[(e + 1) % 3];
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (len > 1e-6) dirs.push([Math.atan2(b[1] - a[1], b[0] - a[0]), len]);
    }
  dirs.sort((p, q) => q[1] - p[1]);
  const angles = [0];
  for (const [ang] of dirs.slice(0, 64)) {
    const m = ((ang % (Math.PI / 2)) + Math.PI / 2) % (Math.PI / 2);
    if (!angles.some((x) => Math.abs(x - m) < 1e-3)) angles.push(m);
  }
  let best = null;
  for (const ang of angles) {
    const c = Math.cos(ang);
    const s = Math.sin(ang);
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const f of flat)
      for (const [px, py] of f) {
        const x = px * c + py * s;
        const y = -px * s + py * c;
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    const ar = (x1 - x0) * (y1 - y0);
    if (!best || ar < best.ar) best = { ar, ang, c, s, x0, y0, x1, y1 };
  }
  const { c, s } = best;
  const u = [u0[0] * c + v0[0] * s, u0[1] * c + v0[1] * s, u0[2] * c + v0[2] * s];
  const v = cross(n, u);
  const emit = (x0, y0, x1, y1) => out.push({ u, v, n, d, x0, y0, x1, y1 });
  const W = best.x1 - best.x0;
  const H = best.y1 - best.y0;
  if (area >= best.ar * 0.97 || (W <= cell * 0.5 && H <= cell * 0.5)) {
    emit(best.x0, best.y0, best.x1, best.y1);
    return;
  }
  const rows = Math.max(1, Math.min(maxCells, Math.ceil(H / cell - 1e-9)));
  const sy = H / rows;
  const local = flat.map((f) => f.map(([px, py]) => [px * c + py * s - best.x0, -px * s + py * c - best.y0]));
  const join = Math.max(cell * 0.05, W * 1e-4);
  let prev = [];
  for (let gy = 0; gy < rows; gy++) {
    const ya = gy * sy;
    const yb = ya + sy;
    const spans = [];
    for (const t of local) {
      const ys = [t[0][1], t[1][1], t[2][1]];
      if (Math.max(...ys) < ya || Math.min(...ys) > yb) continue;
      let lo = Infinity;
      let hi = -Infinity;
      for (let e = 0; e < 3; e++) {
        const a = t[e];
        const b = t[(e + 1) % 3];
        if (a[1] >= ya && a[1] <= yb) {
          lo = Math.min(lo, a[0]);
          hi = Math.max(hi, a[0]);
        }
        for (const yy of [ya, yb]) {
          if ((a[1] - yy) * (b[1] - yy) < 0) {
            const x = a[0] + ((yy - a[1]) / (b[1] - a[1])) * (b[0] - a[0]);
            lo = Math.min(lo, x);
            hi = Math.max(hi, x);
          }
        }
      }
      if (hi >= lo) spans.push([lo, hi]);
    }
    spans.sort((p, q) => p[0] - q[0]);
    const merged = [];
    for (const sp of spans) {
      const last = merged[merged.length - 1];
      if (last && sp[0] <= last[1] + join) last[1] = Math.max(last[1], sp[1]);
      else merged.push(sp.slice());
    }
    const next = [];
    for (const m of merged) {
      const same = prev.find((p) => !p.used && Math.abs(p.x0 - m[0]) <= join && Math.abs(p.x1 - m[1]) <= join);
      if (same) {
        same.used = true;
        same.y1 = yb;
        next.push({ ...same, used: false });
        same.carried = true;
      } else next.push({ x0: m[0], x1: m[1], y0: ya, y1: yb, used: false });
    }
    for (const p of prev) if (!p.carried) emit(best.x0 + p.x0, best.y0 + p.y0, best.x0 + p.x1, best.y0 + p.y1);
    prev = next;
  }
  for (const p of prev) emit(best.x0 + p.x0, best.y0 + p.y0, best.x0 + p.x1, best.y0 + p.y1);
}

function quatFromAxes(u, v, n) {
  const m00 = u[0], m10 = u[1], m20 = u[2];
  const m01 = v[0], m11 = v[1], m21 = v[2];
  const m02 = n[0], m12 = n[1], m22 = n[2];
  const tr = m00 + m11 + m22;
  let x, y, z, w;
  if (tr > 0) {
    const s = Math.sqrt(tr + 1) * 2;
    w = s / 4;
    x = (m21 - m12) / s;
    y = (m02 - m20) / s;
    z = (m10 - m01) / s;
  } else if (m00 > m11 && m00 > m22) {
    const s = Math.sqrt(1 + m00 - m11 - m22) * 2;
    w = (m21 - m12) / s;
    x = s / 4;
    y = (m01 + m10) / s;
    z = (m02 + m20) / s;
  } else if (m11 > m22) {
    const s = Math.sqrt(1 + m11 - m00 - m22) * 2;
    w = (m02 - m20) / s;
    x = (m01 + m10) / s;
    y = s / 4;
    z = (m12 + m21) / s;
  } else {
    const s = Math.sqrt(1 + m22 - m00 - m11) * 2;
    w = (m10 - m01) / s;
    x = (m02 + m20) / s;
    y = (m12 + m21) / s;
    z = s / 4;
  }
  return [x, y, z, w];
}

export function collidersFromMesh(a, budget = 16000) {
  const tris = readTris(a);
  if (!tris.length) return null;
  const size = a.size || [1, 1, 1];
  const diag = Math.hypot(size[0], size[1], size[2]) || 1;
  const groups = regions(tris, diag / 50000, diag / 4000);
  if (groups.length > budget) return null;
  let cell = diag / 700;
  let rects = null;
  for (let tries = 0; tries < 8; tries++) {
    rects = [];
    for (const g of groups) fitRegion(g, cell, 96, rects);
    if (rects.length <= budget) break;
    cell *= 1.6;
  }
  if (!rects || rects.length > budget * 1.5) return null;
  const thick = Math.min(Math.max(diag / 3000, 8), 30);
  const data = new Float32Array(rects.length * 10);
  rects.forEach((r, i) => {
    const cx = (r.x0 + r.x1) / 2;
    const cy = (r.y0 + r.y1) / 2;
    const c = [0, 1, 2].map((k) => r.u[k] * cx + r.v[k] * cy + r.n[k] * r.d);
    const q = quatFromAxes(r.u, r.v, r.n);
    data.set([c[0], c[1], c[2], q[0], q[1], q[2], q[3], Math.max(r.x1 - r.x0, thick) / 100, Math.max(r.y1 - r.y0, thick) / 100, thick / 100], i * 10);
  });
  return { n: rects.length, d: b64(new Uint8Array(data.buffer)), cell, thick };
}

export function colliderChunks(c, per = 400) {
  if (!c || !c.n) return [];
  const all = bytes(c.d);
  const out = [];
  for (let i = 0; i < c.n; i += per) {
    const k = Math.min(per, c.n - i);
    out.push(b64(all.subarray(i * 40, (i + k) * 40)));
  }
  return out;
}
