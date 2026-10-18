const SKIP_FLAGS = 0x4 | 0x2 | 0x40 | 0x80 | 0x100 | 0x200;
const SKIP_NAMES = /^(tools\/|maps\/.*\/tools|effects\/|sky|dev\/dev_blendmeasure)/i;

function srgb(v) {
  const c = Math.max(0, Math.min(1, v));
  return c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;
}

export function parseBsp(buf) {
  const dv = new DataView(buf);
  const ident = String.fromCharCode(dv.getUint8(0), dv.getUint8(1), dv.getUint8(2), dv.getUint8(3));
  if (ident === 'rBSP') throw new Error('That is an Apex or Titanfall map, those are not supported.');
  if (ident !== 'VBSP') {
    const v = dv.getInt32(0, true);
    if (v === 29 || v === 30) throw new Error('That is a Quake or Half-Life 1 map. Only Source maps (.bsp from CS:GO, CS:S, HL2, TF2, Gmod) work.');
    throw new Error("That isn't a Source engine map.");
  }
  const version = dv.getInt32(4, true);
  const lump = (i) => {
    const o = 8 + i * 16;
    const ofs = dv.getInt32(o, true);
    const len = dv.getInt32(o + 4, true);
    if (len >= 4 && dv.getUint32(ofs, true) === 0x414d5a4c) throw new Error('This map has compressed data inside. Open it in a BSP tool and save it uncompressed first.');
    return { ofs, len };
  };
  const vl = lump(3);
  const verts = new Float32Array(buf.slice(vl.ofs, vl.ofs + vl.len));
  const el = lump(12);
  const edges = new Uint16Array(buf.slice(el.ofs, el.ofs + el.len));
  const sl = lump(13);
  const surf = new Int32Array(buf.slice(sl.ofs, sl.ofs + sl.len));
  const til = lump(6);
  const tdl = lump(2);
  const strData = lump(43);
  const strTab = lump(44);
  const td = new TextDecoder();
  const names = [];
  const colors = [];
  const ntd = Math.floor(tdl.len / 32);
  for (let i = 0; i < ntd; i++) {
    const o = tdl.ofs + i * 32;
    colors.push([srgb(dv.getFloat32(o, true)), srgb(dv.getFloat32(o + 4, true)), srgb(dv.getFloat32(o + 8, true))]);
    const sid = dv.getInt32(o + 12, true);
    let name = '';
    if (sid >= 0 && strTab.ofs + sid * 4 + 4 <= strTab.ofs + strTab.len) {
      const so = strData.ofs + dv.getInt32(strTab.ofs + sid * 4, true);
      let e = so;
      while (e < strData.ofs + strData.len && dv.getUint8(e) !== 0) e++;
      name = td.decode(new Uint8Array(buf, so, e - so));
    }
    names.push(name);
  }
  const texinfo = [];
  const nti = Math.floor(til.len / 72);
  for (let i = 0; i < nti; i++) {
    const o = til.ofs + i * 72;
    texinfo.push({ flags: dv.getInt32(o + 64, true), td: dv.getInt32(o + 68, true) });
  }
  const dil = lump(26);
  const dvl = lump(33);
  const fl = lump(7);
  const nf = Math.floor(fl.len / 56);
  const S = 1;
  const P = (i) => [verts[i * 3] * S, -verts[i * 3 + 1] * S, verts[i * 3 + 2] * S];
  const tris = [];
  let skipped = 0;
  for (let f = 0; f < nf; f++) {
    const o = fl.ofs + f * 56;
    const firstedge = dv.getInt32(o + 4, true);
    const numedges = dv.getInt16(o + 8, true);
    const tex = dv.getInt16(o + 10, true);
    const disp = dv.getInt16(o + 12, true);
    const ti = texinfo[tex];
    if (!ti) continue;
    const name = names[ti.td] || '';
    if (ti.flags & SKIP_FLAGS || SKIP_NAMES.test(name)) {
      skipped++;
      continue;
    }
    const col = colors[ti.td] || [0.7, 0.7, 0.7];
    const poly = [];
    for (let k = 0; k < numedges; k++) {
      const se = surf[firstedge + k];
      const vi = se >= 0 ? edges[se * 2] : edges[-se * 2 + 1];
      poly.push(vi);
    }
    if (poly.length < 3) continue;
    if (disp >= 0 && dil.len && poly.length === 4) {
      dispTris(dv, dil, dvl, disp, poly.map(P), col, tris);
      continue;
    }
    const p0 = P(poly[0]);
    for (let k = 1; k + 1 < poly.length; k++) tris.push({ a: p0, b: P(poly[k]), c: P(poly[k + 1]), base: col });
  }
  return { tris, version, skipped };
}

function dispTris(dv, dil, dvl, idx, corners, col, out) {
  const o = dil.ofs + idx * 176;
  const start = [dv.getFloat32(o, true), -dv.getFloat32(o + 4, true), dv.getFloat32(o + 8, true)];
  const vstart = dv.getInt32(o + 12, true);
  const power = dv.getInt32(o + 20, true);
  let best = 0;
  let bd = Infinity;
  corners.forEach((c, i) => {
    const d = (c[0] - start[0]) ** 2 + (c[1] - start[1]) ** 2 + (c[2] - start[2]) ** 2;
    if (d < bd) {
      bd = d;
      best = i;
    }
  });
  const c = [0, 1, 2, 3].map((k) => corners[(best + k) % 4]);
  const n = (1 << power) + 1;
  const grid = [];
  const lerp = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
  for (let y = 0; y < n; y++) {
    const t = y / (n - 1);
    const left = lerp(c[0], c[1], t);
    const right = lerp(c[3], c[2], t);
    for (let x = 0; x < n; x++) {
      const base = lerp(left, right, x / (n - 1));
      const vo = dvl.ofs + (vstart + y * n + x) * 20;
      if (vo + 20 > dvl.ofs + dvl.len) {
        grid.push(base);
        continue;
      }
      const vx = dv.getFloat32(vo, true);
      const vy = -dv.getFloat32(vo + 4, true);
      const vz = dv.getFloat32(vo + 8, true);
      const dist = dv.getFloat32(vo + 12, true);
      grid.push([base[0] + vx * dist, base[1] + vy * dist, base[2] + vz * dist]);
    }
  }
  for (let y = 0; y < n - 1; y++)
    for (let x = 0; x < n - 1; x++) {
      const a = grid[y * n + x];
      const b = grid[y * n + x + 1];
      const d = grid[(y + 1) * n + x];
      const e = grid[(y + 1) * n + x + 1];
      out.push({ a, b, c: e, base: col }, { a, b: e, c: d, base: col });
    }
}
