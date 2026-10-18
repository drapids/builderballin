export const WILD = 0xffff;

export class Grid {
  constructor(nx, ny, nz, size = [100, 100, 100]) {
    this.nx = nx;
    this.ny = ny;
    this.nz = nz;
    this.size = size;
    this.cells = new Uint16Array(nx * ny * nz);
    this.extra = [];
  }
  idx(x, y, z) {
    return x + this.nx * (y + this.ny * z);
  }
  get(x, y, z) {
    if (x < 0 || y < 0 || z < 0 || x >= this.nx || y >= this.ny || z >= this.nz) return 0;
    return this.cells[x + this.nx * (y + this.ny * z)];
  }
  set(x, y, z, v) {
    if (x < 0 || y < 0 || z < 0 || x >= this.nx || y >= this.ny || z >= this.nz) return;
    this.cells[x + this.nx * (y + this.ny * z)] = v;
  }
}

export function fillInside(g) {
  const { nx, ny, nz, cells } = g;
  const out = new Uint8Array(nx * ny * nz);
  const stack = [];
  const push = (x, y, z) => {
    const i = x + nx * (y + ny * z);
    if (out[i] || cells[i]) return;
    out[i] = 1;
    stack.push(i);
  };
  for (let x = 0; x < nx; x++)
    for (let y = 0; y < ny; y++) {
      push(x, y, 0);
      push(x, y, nz - 1);
    }
  for (let x = 0; x < nx; x++)
    for (let z = 0; z < nz; z++) {
      push(x, 0, z);
      push(x, ny - 1, z);
    }
  for (let y = 0; y < ny; y++)
    for (let z = 0; z < nz; z++) {
      push(0, y, z);
      push(nx - 1, y, z);
    }
  while (stack.length) {
    const i = stack.pop();
    const x = i % nx;
    const y = ((i - x) / nx) % ny;
    const z = (i - x - nx * y) / (nx * ny);
    if (x > 0) push(x - 1, y, z);
    if (x < nx - 1) push(x + 1, y, z);
    if (y > 0) push(x, y - 1, z);
    if (y < ny - 1) push(x, y + 1, z);
    if (z > 0) push(x, y, z - 1);
    if (z < nz - 1) push(x, y, z + 1);
  }
  let n = 0;
  for (let i = 0; i < cells.length; i++)
    if (!cells[i] && !out[i]) {
      cells[i] = WILD;
      n++;
    }
  return n;
}

export function meshGrid(g) {
  const { nx, ny, nz, cells } = g;
  const nxy = nx * ny;
  const need = new Uint8Array(cells.length);
  const empty = (x, y, z) => x < 0 || y < 0 || z < 0 || x >= nx || y >= ny || z >= nz || cells[x + nx * (y + ny * z)] === 0;
  for (let z = 0; z < nz; z++)
    for (let y = 0; y < ny; y++)
      for (let x = 0; x < nx; x++) {
        const i = x + nx * y + nxy * z;
        const c = cells[i];
        if (!c) continue;
        if (c === WILD) continue;
        if (empty(x - 1, y, z) || empty(x + 1, y, z) || empty(x, y - 1, z) || empty(x, y + 1, z) || empty(x, y, z - 1) || empty(x, y, z + 1)) need[i] = 1;
        else cells[i] = WILD;
      }
  const boxes = [];
  const ok = (i, c) => {
    const v = cells[i];
    return v === WILD || (v === c && need[i] === 1);
  };
  for (let z = 0; z < nz; z++)
    for (let y = 0; y < ny; y++)
      for (let x = 0; x < nx; x++) {
        const i0 = x + nx * y + nxy * z;
        if (need[i0] !== 1) continue;
        const c = cells[i0];
        let x1 = x;
        while (x1 + 1 < nx && ok(x1 + 1 + nx * y + nxy * z, c)) x1++;
        let y1 = y;
        grow: while (y1 + 1 < ny) {
          for (let xx = x; xx <= x1; xx++) if (!ok(xx + nx * (y1 + 1) + nxy * z, c)) break grow;
          y1++;
        }
        let z1 = z;
        growz: while (z1 + 1 < nz) {
          for (let yy = y; yy <= y1; yy++) for (let xx = x; xx <= x1; xx++) if (!ok(xx + nx * yy + nxy * (z1 + 1), c)) break growz;
          z1++;
        }
        let real = 0;
        for (let zz = z; zz <= z1; zz++)
          for (let yy = y; yy <= y1; yy++)
            for (let xx = x; xx <= x1; xx++) {
              const k = xx + nx * yy + nxy * zz;
              if (need[k] === 1) {
                need[k] = 2;
                real++;
              }
            }
        if (real) boxes.push([x, y, z, x1 + 1, y1 + 1, z1 + 1, c - 1]);
      }
  return boxes;
}

export function mergeExtras(list) {
  let boxes = list.map((b) => b.slice());
  for (let axis = 0; axis < 3; axis++) {
    const a = axis;
    const o = [0, 1, 2].filter((k) => k !== a);
    const key = (b) => `${b[6]}|${b[o[0]]}|${b[o[0] + 3]}|${b[o[1]]}|${b[o[1] + 3]}`;
    const groups = new Map();
    for (const b of boxes) {
      const k = key(b);
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k).push(b);
    }
    const next = [];
    for (const g of groups.values()) {
      g.sort((p, q) => p[a] - q[a]);
      let cur = g[0];
      for (let i = 1; i < g.length; i++) {
        const b = g[i];
        if (Math.abs(b[a] - cur[a + 3]) < 1e-6) cur[a + 3] = Math.max(cur[a + 3], b[a + 3]);
        else {
          next.push(cur);
          cur = b;
        }
      }
      next.push(cur);
    }
    boxes = next;
  }
  return boxes;
}

export function gridToAsset(g, palette, { name, source, inside = true } = {}) {
  if (inside) fillInside(g);
  const raw = meshGrid(g).concat(mergeExtras(g.extra));
  const [sx, sy, sz] = g.size;
  const cx = g.nx / 2;
  const cy = g.ny / 2;
  const boxes = [];
  const used = new Map();
  const pal = [];
  for (const b of raw) {
    let ci = used.get(b[6]);
    if (ci === undefined) {
      ci = pal.length;
      pal.push(palette[b[6]] || '#9a9a96');
      used.set(b[6], ci);
    }
    const w = (b[3] - b[0]) * sx;
    const d = (b[4] - b[1]) * sy;
    const h = (b[5] - b[2]) * sz;
    boxes.push(r1(((b[0] + b[3]) / 2 - cx) * sx), r1(((b[1] + b[4]) / 2 - cy) * sy), r1(((b[2] + b[5]) / 2) * sz), r1(w), r1(d), r1(h), ci);
  }
  return { name: name || 'Import', source: source || 'voxels', palette: pal, boxes, size: [g.nx * sx, g.ny * sy, g.nz * sz] };
}

const r1 = (v) => Math.round(v * 10) / 10;

export function hex(r, g, b) {
  return '#' + [r, g, b].map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('');
}

export function parseHex(h) {
  const n = parseInt(h.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function quantize(colors, weights, k) {
  const pts = colors.map((c, i) => ({ c: parseHex(c), w: weights[i] || 1, i }));
  if (pts.length <= k) return colors.map((_, i) => i);
  let boxes = [pts];
  while (boxes.length < k) {
    let best = -1;
    let bestRange = -1;
    let bestAxis = 0;
    boxes.forEach((b, bi) => {
      if (b.length < 2) return;
      for (let a = 0; a < 3; a++) {
        let lo = 255;
        let hi = 0;
        for (const p of b) {
          lo = Math.min(lo, p.c[a]);
          hi = Math.max(hi, p.c[a]);
        }
        const range = (hi - lo) * Math.log2(1 + b.reduce((s, p) => s + p.w, 0));
        if (range > bestRange) {
          bestRange = range;
          best = bi;
          bestAxis = a;
        }
      }
    });
    if (best < 0 || bestRange <= 0) break;
    const b = boxes[best].sort((p, q) => p.c[bestAxis] - q.c[bestAxis]);
    const total = b.reduce((s, p) => s + p.w, 0);
    let acc = 0;
    let cut = 1;
    for (let i = 0; i < b.length - 1; i++) {
      acc += b[i].w;
      if (acc >= total / 2) {
        cut = i + 1;
        break;
      }
    }
    boxes.splice(best, 1, b.slice(0, cut), b.slice(cut));
  }
  const map = new Array(colors.length);
  const out = [];
  boxes.forEach((b) => {
    const tw = b.reduce((s, p) => s + p.w, 0) || 1;
    const avg = [0, 1, 2].map((a) => b.reduce((s, p) => s + p.c[a] * p.w, 0) / tw);
    const id = out.length;
    out.push(hex(...avg));
    for (const p of b) map[p.i] = id;
  });
  return { map, palette: out };
}

export function reduceGrid(g, palette, k) {
  if (!k || palette.length <= k) return palette;
  const counts = new Array(palette.length).fill(0);
  for (const v of g.cells) if (v && v !== WILD) counts[v - 1]++;
  for (const b of g.extra) counts[b[6]] += 1;
  const q = quantize(palette, counts, k);
  for (let i = 0; i < g.cells.length; i++) {
    const v = g.cells[i];
    if (v && v !== WILD) g.cells[i] = q.map[v - 1] + 1;
  }
  for (const b of g.extra) b[6] = q.map[b[6]];
  return q.palette;
}


export function assetParts(a) {
  const out = [];
  if (a.kind === 'mesh') return out;
  const b = a.boxes;
  for (let i = 0; i + 6 < b.length; i += 7) out.push({ kind: 'shape', shape: 'cube', pos: [b[i], b[i + 1], b[i + 2]], rot: [0, 0, 0], scale: [b[i + 3] / 100, b[i + 4] / 100, b[i + 5] / 100], color: a.palette[b[i + 6]] });
  return out;
}

export function assetCount(a) {
  if (a.kind === 'mesh') return (a.sections || []).length;
  return Math.floor((a.boxes || []).length / 7);
}
