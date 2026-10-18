import * as THREE from 'three';
import { GLTFLoader, OBJLoader, MTLLoader, STLLoader, PLYLoader, FBXLoader, ThreeMFLoader, unzipSync } from '../vendor/loaders.js';
import { Grid, gridToAsset, reduceGrid, hex, quantize } from './voxels.js';
import { parseMinecraft } from './minecraft.js';
import { parseBsp } from './bsp.js';

const ext = (name) => (name.match(/\.([a-z0-9]+)$/i) || [])[1]?.toLowerCase() || '';
const stem = (name) =>
  name
    .replace(/\.[^.]+$/, '')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim() || 'Import';

export const IMAGE_EXT = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp'];
export const MC_EXT = ['schem', 'schematic', 'litematic', 'nbt'];
export const MODEL_EXT = ['glb', 'gltf', 'obj', 'stl', 'ply', 'fbx', '3mf'];
export const MAP_EXT = ['bsp'];
export const ACCEPT = [...IMAGE_EXT, ...MC_EXT, 'vox', ...MODEL_EXT, ...MAP_EXT, 'zip'].map((e) => '.' + e).join(',') + ',.mtl,.bin';
const SOURCE_UNIT = 1.905;
const LEVELISH = /\b(map|level|arena|de_|cs_|dust|mirage|inferno|nuke|office|train|overpass|ancient|vertigo|city|town|village|island|terrain|world|course|stage)\b/i;

export function kindOf(files) {
  const main = pickMain(files);
  if (!main) return null;
  const e = ext(main.name);
  if (IMAGE_EXT.includes(e)) return 'image';
  if (MC_EXT.includes(e)) return 'minecraft';
  if (e === 'vox') return 'vox';
  if (MAP_EXT.includes(e)) return 'bsp';
  if (MODEL_EXT.includes(e)) return 'model';
  return null;
}

export function pickMain(files) {
  const order = [...MAP_EXT, ...MC_EXT, 'vox', ...MODEL_EXT, ...IMAGE_EXT];
  let best = null;
  let rank = 1e9;
  for (const f of files) {
    const r = order.indexOf(ext(f.name));
    if (r >= 0 && r < rank) {
      rank = r;
      best = f;
    }
  }
  return best;
}

export const DEFAULTS = {
  image: { mode: 'wall', res: 48, pixel: 400, depth: 400, height: 6000, levels: 12, colors: 16, alpha: 128 },
  minecraft: { block: 500, colors: 64, fluids: false, solid: true },
  vox: { block: 300, colors: 64, solid: true },
  model: { build: 'mesh', quality: 70, twoSided: true, res: 48, size: 8000, colors: 24, solid: true, up: 'y', level: false },
  bsp: { build: 'mesh', quality: 100, twoSided: true, res: 128, scale: 8, colors: 32, solid: false }
};

async function unpack(files) {
  const out = [];
  for (const f of files) {
    if (ext(f.name) !== 'zip') {
      out.push(f);
      continue;
    }
    const entries = unzipSync(new Uint8Array(await f.arrayBuffer()));
    for (const [path, data] of Object.entries(entries)) {
      if (!data.length || /__MACOSX|\/\./.test(path)) continue;
      out.push(new File([data], path.split('/').pop()));
    }
  }
  return out;
}

export async function loadSource(input) {
  const files = await unpack(input);
  const kind = kindOf(files);
  const main = pickMain(files);
  if (!kind) throw new Error("I can't read that file type. Try a PNG, a Minecraft schematic, a .vox, a Source .bsp map or a 3D model.");
  const zipName = input.length === 1 && ext(input[0].name) === 'zip' ? stem(input[0].name) : null;
  const name = zipName && /^scene$/i.test(stem(main.name)) ? zipName : stem(main.name);
  if (kind === 'image') return { kind, name, img: await readImage(main) };
  if (kind === 'minecraft') return { kind, name, buf: await main.arrayBuffer() };
  if (kind === 'vox') return { kind, name, vox: parseVox(await main.arrayBuffer()) };
  if (kind === 'bsp') {
    const bsp = parseBsp(await main.arrayBuffer());
    let longest = 0;
    const lo = [Infinity, Infinity, Infinity];
    const hi = [-Infinity, -Infinity, -Infinity];
    for (const t of bsp.tris)
      for (const p of [t.a, t.b, t.c])
        for (let k = 0; k < 3; k++) {
          lo[k] = Math.min(lo[k], p[k]);
          hi[k] = Math.max(hi[k], p[k]);
        }
    for (let k = 0; k < 3; k++) longest = Math.max(longest, hi[k] - lo[k]);
    return { kind, name, bsp, longest };
  }
  const model = await loadModel(files, main);
  return { kind, name, model, levelish: LEVELISH.test(name) || modelSpan(model) > 4000 };
}

function modelSpan(obj) {
  const b = new THREE.Box3().setFromObject(obj);
  const s = b.getSize(new THREE.Vector3());
  return Math.max(s.x, s.y, s.z);
}

export function sourceUnits() {
  return SOURCE_UNIT;
}

export function buildAsset(src, opt) {
  if (src.kind === 'image') return imageAsset(src, opt);
  if (src.kind === 'minecraft') return minecraftAsset(src, opt);
  if (src.kind === 'vox') return voxAsset(src, opt);
  if (src.kind === 'bsp') {
    const size = src.longest * SOURCE_UNIT * opt.scale;
    if (opt.build === 'mesh') return meshFromTris(src.bsp.tris, { quality: opt.quality, colors: opt.colors, size, twoSided: opt.twoSided }, { name: src.name, source: 'level', flip: false });
    return voxelizeTris(src.bsp.tris, { res: opt.res, colors: opt.colors, solid: opt.solid, size }, { name: src.name, source: 'level' });
  }
  return modelAsset(src, opt);
}

async function readImage(file) {
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.decoding = 'async';
    img.src = url;
    await img.decode();
    return img;
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }
}

function sampleImage(img, res) {
  const s = Math.min(1, res / Math.max(img.naturalWidth, img.naturalHeight));
  const w = Math.max(1, Math.round(img.naturalWidth * s));
  const h = Math.max(1, Math.round(img.naturalHeight * s));
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d', { willReadFrequently: true });
  g.imageSmoothingEnabled = s < 1;
  g.imageSmoothingQuality = 'high';
  g.drawImage(img, 0, 0, w, h);
  return { w, h, data: g.getImageData(0, 0, w, h).data };
}

function imageAsset(src, o) {
  const { w, h, data } = sampleImage(src.img, o.res);
  const pal = [];
  const index = new Map();
  const pix = new Int32Array(w * h).fill(-1);
  const lum = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) {
    const a = data[i * 4 + 3];
    if (a < o.alpha) continue;
    const r = data[i * 4];
    const gg = data[i * 4 + 1];
    const b = data[i * 4 + 2];
    lum[i] = (0.2126 * r + 0.7152 * gg + 0.0722 * b) / 255;
    const key = (r << 16) | (gg << 8) | b;
    let ci = index.get(key);
    if (ci === undefined) {
      ci = pal.length;
      pal.push(hex(r, gg, b));
      index.set(key, ci);
    }
    pix[i] = ci;
  }
  let g;
  if (o.mode === 'wall') {
    g = new Grid(1, w, h, [o.depth, o.pixel, o.pixel]);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (pix[y * w + x] >= 0) g.set(0, x, h - 1 - y, pix[y * w + x] + 1);
  } else if (o.mode === 'floor') {
    g = new Grid(h, w, 1, [o.pixel, o.pixel, o.depth]);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (pix[y * w + x] >= 0) g.set(h - 1 - y, x, 0, pix[y * w + x] + 1);
  } else {
    const L = Math.max(1, o.levels);
    g = new Grid(h, w, L + 1, [o.pixel, o.pixel, o.height / L]);
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        if (pix[i] < 0) continue;
        const top = Math.round(lum[i] * L);
        for (let z = 0; z <= top; z++) g.set(h - 1 - y, x, z, pix[i] + 1);
      }
  }
  const palette = reduceGrid(g, pal, o.colors);
  return gridToAsset(g, palette, { name: src.name, source: 'image', inside: o.mode === 'height' });
}

function minecraftAsset(src, o) {
  const b = parseMinecraft(src.buf, { fluids: o.fluids });
  const { grid, palette } = b.grid(o.block);
  const pal = reduceGrid(grid, palette, o.colors);
  const a = gridToAsset(grid, pal, { name: src.name, source: 'minecraft', inside: o.solid });
  a.blocks = b.blocks.length;
  return a;
}

function parseVox(buf) {
  const dv = new DataView(buf);
  const tag = (p) => String.fromCharCode(dv.getUint8(p), dv.getUint8(p + 1), dv.getUint8(p + 2), dv.getUint8(p + 3));
  if (tag(0) !== 'VOX ') throw new Error("That isn't a MagicaVoxel file.");
  const models = [];
  let palette = null;
  const nodes = {};
  let p = 8;
  const readStr = (q) => {
    const n = dv.getInt32(q, true);
    return [new TextDecoder().decode(new Uint8Array(buf, q + 4, n)), q + 4 + n];
  };
  const readDict = (q) => {
    const n = dv.getInt32(q, true);
    q += 4;
    const d = {};
    for (let i = 0; i < n; i++) {
      let k, v;
      [k, q] = readStr(q);
      [v, q] = readStr(q);
      d[k] = v;
    }
    return [d, q];
  };
  let size = null;
  while (p + 12 <= buf.byteLength) {
    const id = tag(p);
    const n = dv.getInt32(p + 4, true);
    const c = p + 12;
    if (id === 'MAIN') {
      p = c;
      continue;
    }
    if (id === 'SIZE') size = [dv.getInt32(c, true), dv.getInt32(c + 4, true), dv.getInt32(c + 8, true)];
    else if (id === 'XYZI') {
      const count = dv.getInt32(c, true);
      const v = new Uint8Array(buf, c + 4, count * 4).slice();
      models.push({ size, v });
    } else if (id === 'RGBA') {
      palette = [];
      for (let i = 0; i < 256; i++) palette.push(hex(dv.getUint8(c + i * 4), dv.getUint8(c + i * 4 + 1), dv.getUint8(c + i * 4 + 2)));
    } else if (id === 'nTRN') {
      let q = c;
      const nid = dv.getInt32(q, true);
      q += 4;
      [, q] = readDict(q);
      const child = dv.getInt32(q, true);
      q += 16;
      const frames = dv.getInt32(q - 4, true);
      let t = [0, 0, 0];
      if (frames > 0) {
        const [fd] = readDict(q);
        if (fd._t) t = fd._t.split(' ').map(Number);
      }
      nodes[nid] = { type: 'trn', child, t };
    } else if (id === 'nGRP') {
      let q = c;
      const nid = dv.getInt32(q, true);
      q += 4;
      [, q] = readDict(q);
      const k = dv.getInt32(q, true);
      q += 4;
      const kids = [];
      for (let i = 0; i < k; i++) kids.push(dv.getInt32(q + i * 4, true));
      nodes[nid] = { type: 'grp', kids };
    } else if (id === 'nSHP') {
      let q = c;
      const nid = dv.getInt32(q, true);
      q += 4;
      [, q] = readDict(q);
      const k = dv.getInt32(q, true);
      q += 4;
      const ms = [];
      for (let i = 0; i < k; i++) {
        ms.push(dv.getInt32(q, true));
        q += 4;
        [, q] = readDict(q);
      }
      nodes[nid] = { type: 'shp', models: ms };
    }
    p = c + n;
  }
  if (!models.length) throw new Error('That .vox file has no voxels.');
  if (!palette) palette = Array.from({ length: 256 }, (_, i) => hex(255 - i, 255 - i, 255 - i));
  const placed = [];
  const walk = (id, t) => {
    const nd = nodes[id];
    if (!nd) return;
    if (nd.type === 'trn') walk(nd.child, [t[0] + nd.t[0], t[1] + nd.t[1], t[2] + nd.t[2]]);
    else if (nd.type === 'grp') nd.kids.forEach((k) => walk(k, t));
    else nd.models.forEach((m) => placed.push({ m, t }));
  };
  if (nodes[0]) walk(0, [0, 0, 0]);
  if (!placed.length) placed.push({ m: 0, t: [0, 0, 0] });
  return { models, palette, placed };
}

function voxAsset(src, o) {
  const { models, palette, placed } = src.vox;
  const pts = [];
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (const { m, t } of placed) {
    const md = models[m];
    if (!md) continue;
    const off = [t[0] - Math.floor(md.size[0] / 2), t[1] - Math.floor(md.size[1] / 2), t[2] - Math.floor(md.size[2] / 2)];
    for (let i = 0; i < md.v.length; i += 4) {
      const x = md.v[i] + off[0];
      const y = md.v[i + 1] + off[1];
      const z = md.v[i + 2] + off[2];
      pts.push(x, y, z, md.v[i + 3]);
      if (x < min[0]) min[0] = x;
      if (y < min[1]) min[1] = y;
      if (z < min[2]) min[2] = z;
      if (x > max[0]) max[0] = x;
      if (y > max[1]) max[1] = y;
      if (z > max[2]) max[2] = z;
    }
  }
  const g = new Grid(max[1] - min[1] + 1, max[0] - min[0] + 1, max[2] - min[2] + 1, [o.block, o.block, o.block]);
  for (let i = 0; i < pts.length; i += 4) g.set(pts[i + 1] - min[1], pts[i] - min[0], pts[i + 2] - min[2], pts[i + 3]);
  const pal = reduceGrid(g, palette.slice(0, 256), o.colors);
  return gridToAsset(g, pal, { name: src.name, source: 'vox', inside: o.solid });
}

async function loadModel(files, main) {
  const urls = new Map();
  for (const f of files) urls.set(f.name.toLowerCase(), URL.createObjectURL(f));
  const manager = new THREE.LoadingManager();
  manager.setURLModifier((url) => {
    if (url.startsWith('blob:') || url.startsWith('data:')) return url;
    const base = decodeURIComponent(url.split(/[\\/]/).pop().split('?')[0]).toLowerCase();
    return urls.get(base) || url;
  });
  const e = ext(main.name);
  const mainUrl = urls.get(main.name.toLowerCase());
  try {
    let obj;
    if (e === 'glb' || e === 'gltf') obj = (await new GLTFLoader(manager).loadAsync(mainUrl)).scene;
    else if (e === 'obj') {
      const loader = new OBJLoader(manager);
      const mtl = files.find((f) => ext(f.name) === 'mtl');
      if (mtl) {
        const mats = new MTLLoader(manager).parse(await mtl.text(), '');
        mats.preload();
        loader.setMaterials(mats);
      }
      obj = loader.parse(await main.text());
    } else if (e === 'stl') obj = new THREE.Mesh(new STLLoader(manager).parse(await main.arrayBuffer()), new THREE.MeshStandardMaterial({ color: '#b9b2f2', vertexColors: false }));
    else if (e === 'ply') {
      const geo = new PLYLoader(manager).parse(await main.arrayBuffer());
      obj = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: '#ffffff', vertexColors: !!geo.attributes.color }));
    } else if (e === 'fbx') obj = new FBXLoader(manager).parse(await main.arrayBuffer(), '');
    else if (e === '3mf') obj = new ThreeMFLoader(manager).parse(await main.arrayBuffer());
    await waitTextures(obj);
    return obj;
  } finally {
    setTimeout(() => urls.forEach((u) => URL.revokeObjectURL(u)), 30000);
  }
}

async function waitTextures(obj) {
  const imgs = [];
  obj.traverse((c) => {
    if (!c.isMesh) return;
    for (const m of [].concat(c.material || [])) if (m && m.map && m.map.image && m.map.image.decode) imgs.push(m.map.image);
  });
  const deadline = Date.now() + 5000;
  await Promise.all(imgs.map((im) => (im.complete ? Promise.resolve() : im.decode().catch(() => {}))));
  while (Date.now() < deadline) {
    let ready = true;
    obj.traverse((c) => {
      if (!c.isMesh) return;
      for (const m of [].concat(c.material || [])) if (m && m.map && !m.map.image) ready = false;
    });
    if (ready) break;
    await new Promise((r) => setTimeout(r, 100));
  }
}

const texCache = new WeakMap();
function texData(tex) {
  if (texCache.has(tex)) return texCache.get(tex);
  let out = null;
  const im = tex.image;
  if (im && (im.width || im.naturalWidth)) {
    const w0 = im.naturalWidth || im.width;
    const h0 = im.naturalHeight || im.height;
    const s = Math.min(1, 512 / Math.max(w0, h0));
    const w = Math.max(1, Math.round(w0 * s));
    const h = Math.max(1, Math.round(h0 * s));
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    const g = c.getContext('2d', { willReadFrequently: true });
    try {
      g.drawImage(im, 0, 0, w, h);
      out = { w, h, d: g.getImageData(0, 0, w, h).data, flip: tex.flipY };
    } catch {
      out = null;
    }
  }
  texCache.set(tex, out);
  return out;
}

const tmpC = new THREE.Color();
const tmpO = { r: 0, g: 0, b: 0 };
function toSrgb(r, g, b) {
  tmpC.setRGB(r, g, b, THREE.LinearSRGBColorSpace);
  tmpC.getRGB(tmpO, THREE.SRGBColorSpace);
  return [tmpO.r, tmpO.g, tmpO.b];
}

function collectTris(root, up) {
  root.updateMatrixWorld(true);
  const tris = [];
  const v = new THREE.Vector3();
  const mapPos = (p) => (up === 'z' ? [p.x, -p.y, p.z] : [p.x, p.z, p.y]);
  root.traverse((mesh) => {
    if (!mesh.isMesh || !mesh.geometry || !mesh.geometry.attributes.position) return;
    const geo = mesh.geometry;
    const pos = geo.attributes.position;
    const uv = geo.attributes.uv;
    const col = geo.attributes.color;
    const mats = [].concat(mesh.material || []);
    const index = geo.index;
    const groups = geo.groups.length ? geo.groups : [{ start: 0, count: index ? index.count : pos.count, materialIndex: 0 }];
    const world = [];
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i).applyMatrix4(mesh.matrixWorld);
      world.push(mapPos(v));
    }
    for (const gr of groups) {
      const m = mats[gr.materialIndex] || mats[0] || {};
      if (m.visible === false || (m.opacity !== undefined && m.opacity < 0.05)) continue;
      const base = toSrgb(...(m.color ? [m.color.r, m.color.g, m.color.b] : [1, 1, 1]));
      const td = m.map ? texData(m.map) : null;
      const useCol = col && (m.vertexColors || !m.map);
      for (let k = gr.start; k + 2 < gr.start + gr.count; k += 3) {
        const ia = index ? index.getX(k) : k;
        const ib = index ? index.getX(k + 1) : k + 1;
        const ic = index ? index.getX(k + 2) : k + 2;
        tris.push({ a: world[ia], b: world[ib], c: world[ic], ia, ib, ic, uv, col: useCol ? col : null, td, base });
      }
    }
  });
  return tris;
}

export function voxelizeTris(tris, o, meta) {
  if (!tris.length) throw new Error('No surfaces found in that file.');
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (const t of tris)
    for (const p of [t.a, t.b, t.c])
      for (let k = 0; k < 3; k++) {
        if (p[k] < min[k]) min[k] = p[k];
        if (p[k] > max[k]) max[k] = p[k];
      }
  const ext3 = max.map((m, k) => Math.max(1e-6, m - min[k]));
  const longest = Math.max(...ext3);
  const vs = longest / o.res;
  const dims = ext3.map((e) => Math.max(1, Math.ceil(e / vs - 1e-6)));
  const n = dims[0] * dims[1] * dims[2];
  if (n > 3.4e7) throw new Error('That is too many voxels. Lower the detail.');
  const sums = new Map();
  const ua = new THREE.Vector2();
  const ub = new THREE.Vector2();
  const uc = new THREE.Vector2();
  const len = (p, q) => Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);
  for (const t of tris) {
    const A = t.a.map((q, k) => (q - min[k]) / vs);
    const B = t.b.map((q, k) => (q - min[k]) / vs);
    const C = t.c.map((q, k) => (q - min[k]) / vs);
    const steps = Math.min(600, Math.ceil(Math.max(len(A, B), len(B, C), len(C, A)) * 2) + 1);
    if (t.uv && t.td) {
      ua.fromBufferAttribute(t.uv, t.ia);
      ub.fromBufferAttribute(t.uv, t.ib);
      uc.fromBufferAttribute(t.uv, t.ic);
    }
    let ca, cb, cc;
    if (t.col) {
      ca = toSrgb(t.col.getX(t.ia), t.col.getY(t.ia), t.col.getZ(t.ia));
      cb = toSrgb(t.col.getX(t.ib), t.col.getY(t.ib), t.col.getZ(t.ib));
      cc = toSrgb(t.col.getX(t.ic), t.col.getY(t.ic), t.col.getZ(t.ic));
    }
    const base = t.base || [0.7, 0.7, 0.7];
    for (let i = 0; i <= steps; i++)
      for (let j = 0; j <= steps - i; j++) {
        const wa = i / steps;
        const wb = j / steps;
        const wc = 1 - wa - wb;
        const x = Math.min(dims[0] - 1, Math.floor(A[0] * wa + B[0] * wb + C[0] * wc));
        const y = Math.min(dims[1] - 1, Math.floor(A[1] * wa + B[1] * wb + C[1] * wc));
        const z = Math.min(dims[2] - 1, Math.floor(A[2] * wa + B[2] * wb + C[2] * wc));
        let r = base[0];
        let g = base[1];
        let b = base[2];
        if (t.td && t.uv) {
          let u = ua.x * wa + ub.x * wb + uc.x * wc;
          let vv = ua.y * wa + ub.y * wb + uc.y * wc;
          u -= Math.floor(u);
          vv -= Math.floor(vv);
          const px = Math.min(t.td.w - 1, Math.floor(u * t.td.w));
          const py = Math.min(t.td.h - 1, Math.floor((t.td.flip ? 1 - vv : vv) * t.td.h));
          const q = (py * t.td.w + px) * 4;
          if (t.td.d[q + 3] < 40) continue;
          r *= t.td.d[q] / 255;
          g *= t.td.d[q + 1] / 255;
          b *= t.td.d[q + 2] / 255;
        } else if (ca) {
          r = ca[0] * wa + cb[0] * wb + cc[0] * wc;
          g = ca[1] * wa + cb[1] * wb + cc[1] * wc;
          b = ca[2] * wa + cb[2] * wb + cc[2] * wc;
        }
        const key = x + dims[0] * (y + dims[1] * z);
        const bucket = ((Math.min(255, r * 255) >> 4) << 8) | ((Math.min(255, g * 255) >> 4) << 4) | (Math.min(255, b * 255) >> 4);
        let acc = sums.get(key);
        if (!acc) {
          acc = [];
          sums.set(key, acc);
        }
        let slot = null;
        for (let q = 0; q < acc.length; q += 5) if (acc[q] === bucket) slot = q;
        if (slot === null) {
          if (acc.length < 20) {
            slot = acc.length;
            acc.push(bucket, 0, 0, 0, 0);
          } else {
            let lo = 0;
            for (let q = 5; q < acc.length; q += 5) if (acc[q + 1] < acc[lo + 1]) lo = q;
            slot = lo;
            acc[lo] = bucket;
            acc[lo + 1] = 0;
            acc[lo + 2] = acc[lo + 3] = acc[lo + 4] = 0;
          }
        }
        acc[slot + 1] += 1;
        acc[slot + 2] += r;
        acc[slot + 3] += g;
        acc[slot + 4] += b;
      }
  }
  const cell = vs * (o.size / longest);
  const grid = new Grid(dims[0], dims[1], dims[2], [cell, cell, cell]);
  const pal = [];
  const pIndex = new Map();
  for (const [i, acc] of sums) {
    let best = 0;
    for (let q = 5; q < acc.length; q += 5) if (acc[q + 1] > acc[best + 1]) best = q;
    const c = acc[best + 1];
    const r = Math.round((acc[best + 2] / c) * 255);
    const g = Math.round((acc[best + 3] / c) * 255);
    const b = Math.round((acc[best + 4] / c) * 255);
    const key = ((r >> 2) << 12) | ((g >> 2) << 6) | (b >> 2);
    let ci = pIndex.get(key);
    if (ci === undefined) {
      ci = pal.length;
      pal.push(hex(r, g, b));
      pIndex.set(key, ci);
    }
    grid.cells[i] = ci + 1;
  }
  const palette = reduceGrid(grid, pal, o.colors);
  return gridToAsset(grid, palette, { ...meta, inside: o.solid });
}

function modelAsset(src, o) {
  const tris = src.tris && src.trisUp === o.up ? src.tris : collectTris(src.model, o.up);
  src.tris = tris;
  src.trisUp = o.up;
  if (!tris.length) throw new Error('No mesh found in that model.');
  if (o.build === 'mesh') return meshFromTris(tris, o, { name: src.name, source: o.level ? 'level' : 'model', flip: true });
  return voxelizeTris(tris, o, { name: src.name, source: o.level ? 'level' : 'model' });
}

function triColor(t, ua, ub, uc) {
  const base = t.base || [0.7, 0.7, 0.7];
  if (t.td && t.uv) {
    ua.fromBufferAttribute(t.uv, t.ia);
    ub.fromBufferAttribute(t.uv, t.ib);
    uc.fromBufferAttribute(t.uv, t.ic);
    let r = 0;
    let g = 0;
    let b = 0;
    let n = 0;
    for (const [wa, wb] of [[1 / 3, 1 / 3], [0.6, 0.2], [0.2, 0.6], [0.2, 0.2]]) {
      const wc = 1 - wa - wb;
      let u = ua.x * wa + ub.x * wb + uc.x * wc;
      let v = ua.y * wa + ub.y * wb + uc.y * wc;
      u -= Math.floor(u);
      v -= Math.floor(v);
      const px = Math.min(t.td.w - 1, Math.floor(u * t.td.w));
      const py = Math.min(t.td.h - 1, Math.floor((t.td.flip ? 1 - v : v) * t.td.h));
      const q = (py * t.td.w + px) * 4;
      if (t.td.d[q + 3] < 40) continue;
      r += t.td.d[q] / 255;
      g += t.td.d[q + 1] / 255;
      b += t.td.d[q + 2] / 255;
      n++;
    }
    if (!n) return null;
    return [(base[0] * r) / n, (base[1] * g) / n, (base[2] * b) / n];
  }
  if (t.col) {
    const c = [t.ia, t.ib, t.ic].map((i) => toSrgb(t.col.getX(i), t.col.getY(i), t.col.getZ(i)));
    return [0, 1, 2].map((k) => (c[0][k] + c[1][k] + c[2][k]) / 3);
  }
  return base;
}

function b64(bytes) {
  let s = '';
  const CH = 0x8000;
  for (let i = 0; i < bytes.length; i += CH) s += String.fromCharCode.apply(null, bytes.subarray(i, i + CH));
  return btoa(s);
}

export function unb64(str) {
  const s = atob(str);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

export function meshFromTris(tris, o, meta) {
  if (!tris.length) throw new Error('No surfaces found in that file.');
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (const t of tris)
    for (const p of [t.a, t.b, t.c])
      for (let k = 0; k < 3; k++) {
        if (p[k] < min[k]) min[k] = p[k];
        if (p[k] > max[k]) max[k] = p[k];
      }
  const longest = Math.max(...max.map((m, k) => m - min[k]), 1e-6);
  const s = o.size / longest;
  const center = [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2, min[2]];
  const exact = o.quality >= 100;
  const cells = Math.round(48 * Math.pow(2, (o.quality / 100) * 6));
  const cell = longest / cells;
  const clusters = new Map();
  const cv = [];
  const vid = (p) => {
    if (exact) {
      const k = `${p[0]},${p[1]},${p[2]}`;
      let id = clusters.get(k);
      if (id === undefined) {
        id = cv.length / 4;
        clusters.set(k, id);
        cv.push(p[0], p[1], p[2], 1);
      }
      return id;
    }
    const k = Math.floor((p[0] - min[0]) / cell) + cells * 4 * (Math.floor((p[1] - min[1]) / cell) + cells * 4 * Math.floor((p[2] - min[2]) / cell));
    let id = clusters.get(k);
    if (id === undefined) {
      id = cv.length / 4;
      clusters.set(k, id);
      cv.push(0, 0, 0, 0);
    }
    cv[id * 4] += p[0];
    cv[id * 4 + 1] += p[1];
    cv[id * 4 + 2] += p[2];
    cv[id * 4 + 3] += 1;
    return id;
  };
  const ua = new THREE.Vector2();
  const ub = new THREE.Vector2();
  const uc = new THREE.Vector2();
  const faces = [];
  const colors = [];
  const weights = [];
  const colorIndex = new Map();
  for (const t of tris) {
    const ia = vid(t.a);
    const ib = vid(t.b);
    const ic = vid(t.c);
    if (ia === ib || ib === ic || ia === ic) continue;
    const c = triColor(t, ua, ub, uc);
    if (!c) continue;
    const key = hex(c[0] * 255, c[1] * 255, c[2] * 255);
    let ci = colorIndex.get(key);
    if (ci === undefined) {
      ci = colors.length;
      colors.push(key);
      weights.push(0);
      colorIndex.set(key, ci);
    }
    weights[ci] += 1;
    faces.push(ia, ib, ic, ci);
  }
  const pos = new Float64Array((cv.length / 4) * 3);
  for (let i = 0; i < cv.length / 4; i++) {
    const n = cv[i * 4 + 3] || 1;
    pos[i * 3] = (cv[i * 4] / n - center[0]) * s;
    pos[i * 3 + 1] = (cv[i * 4 + 1] / n - center[1]) * s;
    pos[i * 3 + 2] = (cv[i * 4 + 2] / n - center[2]) * s;
  }
  const q = quantizeColors(colors, weights, o.colors);
  const groups = new Map();
  const flip = !!meta.flip;
  for (let f = 0; f < faces.length; f += 4) {
    const pi = q.map[faces[f + 3]];
    if (!groups.has(pi)) groups.set(pi, []);
    const g = groups.get(pi);
    if (flip) g.push(faces[f], faces[f + 2], faces[f + 1]);
    else g.push(faces[f], faces[f + 1], faces[f + 2]);
  }
  const sections = [];
  let triCount = 0;
  for (const [pi, idx] of groups) {
    let i = 0;
    while (i < idx.length) {
      const remap = new Map();
      const verts = [];
      const norms = [];
      const out = [];
      for (; i < idx.length && verts.length / 3 < 64000; i += 3) {
        const a = idx[i];
        const b = idx[i + 1];
        const c = idx[i + 2];
        const ax = pos[a * 3], ay = pos[a * 3 + 1], az = pos[a * 3 + 2];
        const e1 = [pos[b * 3] - ax, pos[b * 3 + 1] - ay, pos[b * 3 + 2] - az];
        const e2 = [pos[c * 3] - ax, pos[c * 3 + 1] - ay, pos[c * 3 + 2] - az];
        const n = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
        const nl = Math.hypot(n[0], n[1], n[2]);
        if (nl < 1e-9) continue;
        n[0] /= nl;
        n[1] /= nl;
        n[2] /= nl;
        const ax2 = Math.abs(n[0]) > Math.abs(n[1]) ? (Math.abs(n[0]) > Math.abs(n[2]) ? 0 : 2) : Math.abs(n[1]) > Math.abs(n[2]) ? 1 : 2;
        const bucket = ax2 * 2 + (n[ax2] > 0 ? 1 : 0);
        for (const v of [a, b, c]) {
          const k = v * 6 + bucket;
          let ni = remap.get(k);
          if (ni === undefined) {
            ni = verts.length / 3;
            remap.set(k, ni);
            verts.push(pos[v * 3], pos[v * 3 + 1], pos[v * 3 + 2]);
            norms.push(0, 0, 0);
          }
          norms[ni * 3] += n[0];
          norms[ni * 3 + 1] += n[1];
          norms[ni * 3 + 2] += n[2];
          out.push(ni);
        }
      }
      if (!out.length) continue;
      const bmin = [Infinity, Infinity, Infinity];
      const bmax = [-Infinity, -Infinity, -Infinity];
      for (let v = 0; v < verts.length; v += 3)
        for (let k = 0; k < 3; k++) {
          bmin[k] = Math.min(bmin[k], verts[v + k]);
          bmax[k] = Math.max(bmax[k], verts[v + k]);
        }
      const qp = new Uint16Array(verts.length);
      for (let v = 0; v < verts.length; v += 3)
        for (let k = 0; k < 3; k++) qp[v + k] = Math.round(((verts[v + k] - bmin[k]) / Math.max(1e-6, bmax[k] - bmin[k])) * 65535);
      const qn = new Int8Array(norms.length);
      for (let v = 0; v < norms.length; v += 3) {
        const l = Math.hypot(norms[v], norms[v + 1], norms[v + 2]) || 1;
        for (let k = 0; k < 3; k++) qn[v + k] = Math.round((norms[v + k] / l) * 127);
      }
      triCount += out.length / 3;
      sections.push({ c: pi, b: [...bmin, ...bmax].map((v) => Math.round(v * 10) / 10), p: b64(new Uint8Array(qp.buffer)), n: b64(new Uint8Array(qn.buffer)), i: b64(new Uint8Array(new Uint16Array(out).buffer)), v: verts.length / 3, t: out.length / 3 });
    }
  }
  if (!sections.length) throw new Error('Nothing left after simplifying. Turn the quality up.');
  return { name: meta.name, source: meta.source, kind: 'mesh', palette: q.palette, sections, tris: triCount, twoSided: !!o.twoSided, size: [(max[0] - min[0]) * s, (max[1] - min[1]) * s, (max[2] - min[2]) * s], boxes: [] };
}

function quantizeColors(colors, weights, k) {
  if (colors.length <= k) return { map: colors.map((_, i) => i), palette: colors };
  return quantize(colors, weights, k);
}
