import * as THREE from 'three';
import { OrbitControls } from '../vendor/OrbitControls.js';
import { TransformControls } from '../vendor/TransformControls.js';
import { PIECES, PIECE, CATS, GLAZES, ZONE_COLORS, localParts, defaultParams, GEMS, GEM, MARBLE_R, M, marblePoints, MODE_INFO, pickGem, speedRange, DOMINUS } from './pieces.js';
import { makeSky, makeEnvironment, gemMaterial, MARBLE_GEO, woodMaterial, finishRings, playerFigure, arrowMesh, MOON_DIR } from './look.js';
import { blankMap, newObject, uid, flatten, exportMap, importMap, validate, blankAnim, MOVE_DEFAULT, SPIN_DEFAULT, SWING_DEFAULT, BLINK_DEFAULT, DIFFICULTIES, GEM_NAMES, axisVector } from './mapfile.js';
import { axesFromRot, toThree, fromThree, scaleToThree, scaleFromThree, quatFromRot, rotFromQuat, quatFromAxes, add } from './ue.js';
import { evalAnim } from './anim.js';
import { MESHES } from './meshes.js';
import { animate, fadeIn, SPRINGS, Spring, springCurve } from './spring.js';
import { TEMPLATES } from './templates.js';
import { loadSource, buildAsset, DEFAULTS, ACCEPT, unb64, blocksFromMesh } from './importers.js';
import { openSearch } from './search.js';
import { createHome, createGame } from './home.js';
import { assetCount } from './voxels.js';

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const html = (s) => {
  const t = document.createElement('template');
  t.innerHTML = s.trim();
  return t.content.firstElementChild;
};
const ICON = {
  x: '<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg>',
  chev: '<svg viewBox="0 0 24 24"><path d="M6 9l6 6 6-6"/></svg>',
  eye: '<svg viewBox="0 0 24 24"><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></svg>',
  eyeOff: '<svg viewBox="0 0 24 24"><path d="M3 3l18 18M10.6 5.1A10 10 0 0112 5c6.4 0 10 7 10 7a17 17 0 01-3.2 4.2M6.6 6.6C3.8 8.4 2 12 2 12s3.6 7 10 7a9.6 9.6 0 004.4-1"/></svg>',
  play: '<path d="M7 4.5v15l12-7.5z"/>',
  pause: '<path d="M6.5 4.5h4v15h-4zM13.5 4.5h4v15h-4z"/>'
};

const desk = window.bbDesktop || null;
const STORE_KEY = 'builderballin:map';
const LIB_KEY = 'builderballin:imports';
const PREFS_KEY = 'builderballin:prefs';

const state = {
  map: null,
  selected: new Set(),
  tool: 'select',
  brush: null,
  cat: 'marbles',
  grid: 1000,
  angle: 15,
  snap: true,
  placeZ: 0,
  playing: false,
  time: 0,
  fire: false,
  hiddenIds: new Set(),
  clipboard: null,
  history: [],
  future: [],
  importRef: null,
  filePath: null,
  openSecs: JSON.parse(localStorage.getItem('builderballin:secs') || '{}')
};

const canvas = $('#view');
const stage = $('#stage');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;

const scene = new THREE.Scene();
const sky = makeSky();
scene.add(sky);
scene.environment = makeEnvironment(renderer);
scene.fog = new THREE.Fog('#c9c2f2', 260000, 2200000);

const camera = new THREE.PerspectiveCamera(50, 1, 100, 1.2e7);
camera.position.set(60000, 45000, 60000);

const controls = new OrbitControls(camera, canvas);
controls.enableDamping = true;
controls.dampingFactor = 0.12;
controls.mouseButtons = { LEFT: null, MIDDLE: THREE.MOUSE.PAN, RIGHT: THREE.MOUSE.ROTATE };
controls.screenSpacePanning = true;
controls.maxPolarAngle = Math.PI * 0.495;
controls.minDistance = 1500;
controls.maxDistance = 1800000;
controls.zoomToCursor = true;

scene.add(new THREE.HemisphereLight('#e4defe', '#3a3466', 1.15));
const sun = new THREE.DirectionalLight('#ffe6cc', 2.4);
sun.castShadow = true;
sun.shadow.mapSize.set(4096, 4096);
sun.shadow.bias = -0.0003;
sun.shadow.normalBias = 40;
const sc = sun.shadow.camera;
sc.near = 1000;
sc.far = 900000;
scene.add(sun, sun.target);
const SUN_DIR = new THREE.Vector3(-MOON_DIR.x, 0.75, -MOON_DIR.z).normalize();
let shadowSpan = 0;
function fitShadow(dist) {
  const span = Math.min(300000, Math.max(15000, dist * 0.9));
  if (Math.abs(span - shadowSpan) / span < 0.15) return;
  shadowSpan = span;
  sc.left = -span;
  sc.right = span;
  sc.top = span;
  sc.bottom = -span;
  sc.updateProjectionMatrix();
}

const grid = new THREE.Group();
scene.add(grid);
function buildGrid() {
  grid.clear();
  const minorSize = state.grid * 160;
  const minor = new THREE.GridHelper(minorSize, 160, '#fffbff', '#fffbff');
  minor.material.transparent = true;
  minor.material.opacity = 0.09;
  minor.material.depthWrite = false;
  minor.userData.follow = state.grid;
  const majorStep = state.grid * 10;
  const major = new THREE.GridHelper(majorStep * 120, 120, '#ffffff', '#ffffff');
  major.material.transparent = true;
  major.material.opacity = 0.16;
  major.material.depthWrite = false;
  major.userData.follow = majorStep;
  const size = 2e6;
  const axisX = new THREE.Mesh(new THREE.BoxGeometry(size, 1, 60), new THREE.MeshBasicMaterial({ color: '#ff8165', transparent: true, opacity: 0.45, depthWrite: false }));
  const axisY = new THREE.Mesh(new THREE.BoxGeometry(60, 1, size), new THREE.MeshBasicMaterial({ color: '#7fe100', transparent: true, opacity: 0.45, depthWrite: false }));
  grid.add(minor, major, axisX, axisY);
}
function followGrid(camDist) {
  const pxPer = stage.clientHeight / (2 * Math.tan((camera.fov * Math.PI) / 360) * Math.max(1, camDist));
  for (const g of grid.children) {
    const f = g.userData.follow;
    if (!f) continue;
    const px = f * pxPer;
    const base = g.userData.base ?? (g.userData.base = g.material.opacity);
    const k = Math.min(1, Math.max(0, (px - 7) / 18));
    g.material.opacity = base * k;
    g.visible = k > 0.01;
    g.position.x = Math.round(controls.target.x / f) * f;
    g.position.z = Math.round(controls.target.z / f) * f;
  }
}

const world = new THREE.Group();
scene.add(world);
const roots = new Map();

const GEO = {
  cube: new THREE.BoxGeometry(100, 100, 100),
  cylinder: new THREE.CylinderGeometry(50, 50, 100, 40),
  sphere: new THREE.SphereGeometry(50, 40, 24),
  cone: new THREE.ConeGeometry(50, 100, 40)
};
const EDGE = Object.fromEntries(Object.entries(GEO).map(([k, g]) => [k, new THREE.EdgesGeometry(g, 30)]));

const matCache = new Map();
function solidMat(color, { ice = false, ghost = false, faded = false } = {}) {
  const key = `${color}|${ice}|${ghost}|${faded}`;
  if (matCache.has(key)) return matCache.get(key);
  const m = new THREE.MeshStandardMaterial({ color, roughness: ice ? 0.12 : 0.7, metalness: ice ? 0.2 : 0, envMapIntensity: 0.7 });
  if (ice) m.emissive = new THREE.Color('#bfefff').multiplyScalar(0.18);
  if (ghost || faded) {
    m.transparent = true;
    m.opacity = ghost ? 0.5 : 0.28;
    m.depthWrite = !ghost;
  }
  matCache.set(key, m);
  return m;
}
const edgeCache = new Map();
function edgeMat(color) {
  if (edgeCache.has(color)) return edgeCache.get(color);
  const c = new THREE.Color(color);
  const hsl = {};
  c.getHSL(hsl);
  const e = new THREE.Color().setHSL(hsl.h, Math.min(1, hsl.s * 0.9 + 0.1), hsl.l > 0.6 ? 0.42 : Math.max(0.08, hsl.l * 0.55));
  const m = new THREE.LineBasicMaterial({ color: e, transparent: true, opacity: 0.55 });
  edgeCache.set(color, m);
  return m;
}
const SEL_EDGE = new THREE.LineBasicMaterial({ color: '#5fc8ff', transparent: true, opacity: 1, depthTest: false });
const SEL_RING = new THREE.MeshBasicMaterial({ color: '#5fc8ff', transparent: true, opacity: 0.9, depthTest: false, side: THREE.DoubleSide });
let thumbMode = false;
const MODELS = {
  g_tracks: [{ mk: 'tracks1_3a1', wood: true }],
  g_track_round: [{ mk: 'greentrackrounded', color: '#5f9a3a' }],
  g_large_green: [{ mk: 'largegreenexpg', color: '#6aa84f' }],
  g_halftunnel: [{ mk: 'halftunnel3', color: '#aaa69e' }],
  g_halftunnel_m: [{ mk: 'halftunnel3mirror', color: '#aaa69e' }],
  g_window_tunnel: [{ mk: 'windowhalftunnel2b1', color: '#aaa69e' }],
  g_block: [{ mk: 'Block1a1', color: '#b9a58a' }],
  g_lowceiling: [{ mk: 'SM_staple3', color: '#e8e2d0' }],
  g_bowl: [{ mk: 'scene', color: '#f1efe8' }],
  g_spinplate: [{ mk: 'Decorative_plate', s: 3.4, color: '#d9d2c3' }, { mk: 'Rounded_square_steel_tube_PL', color: '#8d939b' }],
  g_plate: [{ mk: 'Decorative_plate', color: '#d9d2c3' }],
  g_tube: [{ mk: 'Rounded_square_steel_tube_PL', color: '#8d939b' }],
  g_pillar: [{ mk: 'p1a2eg2', color: '#efeae2' }],
  g_hookpoint: [{ mk: 'hookpointexp', s: 8, color: '#c9b27a' }],
  g_pipe: [{ mk: 'SM_pipe1b2', color: '#8f96a0' }],
  g_torus: [{ mk: 'SM_Torus', color: '#5fc8ff' }],
  g_marker: [{ mk: 'marker', color: '#ff8165' }]
};
const meshGeo = new Map();
function gameGeometry(mk) {
  if (meshGeo.has(mk)) return meshGeo.get(mk);
  const m = MESHES[mk];
  if (!m) return null;
  const bin = (b64) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)).buffer;
  const q = new Uint16Array(bin(m.p));
  const ix = new Uint16Array(bin(m.i));
  const n = q.length / 3;
  const pos = new Float32Array(n * 3);
  const uv = new Float32Array(n * 2);
  for (let i = 0; i < n; i++) {
    const x = m.b[0] + (q[i * 3] / 65535) * (m.b[3] - m.b[0]);
    const y = m.b[1] + (q[i * 3 + 1] / 65535) * (m.b[4] - m.b[1]);
    const z = m.b[2] + (q[i * 3 + 2] / 65535) * (m.b[5] - m.b[2]);
    pos[i * 3] = x;
    pos[i * 3 + 1] = z;
    pos[i * 3 + 2] = y;
    uv[i * 2] = x / 3000;
    uv[i * 2 + 1] = y / 3000;
  }
  const idx = new Uint16Array(ix.length);
  for (let t = 0; t < ix.length; t += 3) {
    idx[t] = ix[t];
    idx[t + 1] = ix[t + 2];
    idx[t + 2] = ix[t + 1];
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.setIndex(new THREE.BufferAttribute(idx, 1));
  g.computeVertexNormals();
  g.computeBoundingBox();
  g.computeBoundingSphere();
  const e = new THREE.EdgesGeometry(g, 40);
  const out = { g, e };
  meshGeo.set(mk, out);
  return out;
}
const gameMats = new Map();
function gameMat(color, ghost, faded) {
  const key = `${color}|${ghost}|${faded}`;
  if (gameMats.has(key)) return gameMats.get(key);
  const m = new THREE.MeshStandardMaterial({ color, roughness: 0.62, metalness: 0.05, side: THREE.DoubleSide, envMapIntensity: 0.7 });
  if (ghost || faded) {
    m.transparent = true;
    m.opacity = ghost ? 0.5 : 0.3;
    m.depthWrite = !ghost;
  }
  gameMats.set(key, m);
  return m;
}
const SEL_SHELL = new THREE.MeshBasicMaterial({ color: '#5fc8ff', side: THREE.BackSide, transparent: true, opacity: 0.85, depthWrite: false });
const fixedScale = (piece) => ['marker', 'decor', 'marble', 'marbles', 'spawner', 'dominus'].includes(piece.kind);

let hatchTex = null;
function hatch() {
  if (hatchTex) return hatchTex;
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const x = c.getContext('2d');
  x.fillStyle = '#d9d4f6';
  x.fillRect(0, 0, 64, 64);
  x.strokeStyle = '#6c63c9';
  x.lineWidth = 6;
  for (let i = -64; i < 128; i += 22) {
    x.beginPath();
    x.moveTo(i, 64);
    x.lineTo(i + 64, 0);
    x.stroke();
  }
  hatchTex = new THREE.CanvasTexture(c);
  hatchTex.wrapS = hatchTex.wrapT = THREE.RepeatWrapping;
  hatchTex.repeat.set(3, 3);
  hatchTex.colorSpace = THREE.SRGBColorSpace;
  return hatchTex;
}

function labelSprite(text, color) {
  const c = document.createElement('canvas');
  const x = c.getContext('2d');
  const font = '700 44px "Schibsted Grotesk", sans-serif';
  x.font = font;
  const w = Math.ceil(x.measureText(text).width) + 44;
  c.width = w;
  c.height = 72;
  x.font = font;
  x.fillStyle = color;
  x.beginPath();
  x.roundRect(0, 0, w, 72, 20);
  x.fill();
  x.fillStyle = '#ffffff';
  x.textBaseline = 'middle';
  x.fillText(text, 22, 38);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true, sizeAttenuation: false }));
  s.userData.aspect = w / 72;
  s.scale.set(s.userData.aspect * 0.028, 0.028, 1);
  s.renderOrder = 5;
  return s;
}

function textTexture(text, color) {
  const c = document.createElement('canvas');
  const x = c.getContext('2d');
  const font = '800 120px "Schibsted Grotesk", sans-serif';
  x.font = font;
  const w = Math.max(10, Math.ceil(x.measureText(text || ' ').width) + 20);
  c.width = w;
  c.height = 160;
  x.font = font;
  x.fillStyle = color;
  x.textBaseline = 'middle';
  x.fillText(text, 10, 84);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return { tex: t, aspect: w / 160 };
}

function partMesh(shape, color, opts, edges = true, mat = null, size = null) {
  const g = new THREE.Group();
  const material = mat === 'wood' && size ? woodMaterial(size[0] / 3000, size[1] / 3000, color, opts) : solidMat(color, opts);
  const m = new THREE.Mesh(GEO[shape] || GEO.cube, material);
  m.castShadow = !opts.ghost && !opts.faded;
  m.receiveShadow = true;
  g.add(m);
  if (edges) {
    const e = new THREE.LineSegments(EDGE[shape] || EDGE.cube, edgeMat(color));
    e.userData.edge = true;
    g.add(e);
  }
  return g;
}

let library = readLib();
function readLib() {
  try {
    const l = JSON.parse(localStorage.getItem(LIB_KEY) || '[]');
    return Array.isArray(l) ? l.filter((x) => x && x.ref && x.asset) : [];
  } catch {
    return [];
  }
}
function saveLib(ref, asset) {
  let lib = [{ ref, asset }, ...library.filter((x) => x.ref !== ref)].slice(0, 16);
  library = lib;
  while (lib.length) {
    try {
      localStorage.setItem(LIB_KEY, JSON.stringify(lib));
      return;
    } catch {
      lib = lib.slice(0, -1);
    }
  }
}
function assetFor(ref) {
  if (!ref) return null;
  return (state.map && state.map.assets && state.map.assets[ref]) || library.find((x) => x.ref === ref)?.asset || null;
}
const instMats = new Map();
function instMat({ ghost = false, faded = false, ice = false } = {}) {
  const key = `${ghost}|${faded}|${ice}`;
  if (instMats.has(key)) return instMats.get(key);
  const m = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: ice ? 0.15 : 0.75, metalness: ice ? 0.2 : 0, envMapIntensity: 0.7 });
  if (ghost || faded) {
    m.transparent = true;
    m.opacity = ghost ? 0.5 : 0.28;
    m.depthWrite = !ghost;
  }
  instMats.set(key, m);
  return m;
}
const IMPORT_EDGE = new THREE.LineBasicMaterial({ color: '#b9b2f2', transparent: true, opacity: 0.28 });
const meshMats = new Map();
const sectionGeo = new WeakMap();
function sectionGeometry(sec) {
  if (sectionGeo.has(sec)) return sectionGeo.get(sec);
  const qp = new Uint16Array(unb64(sec.p).buffer);
  const qn = new Int8Array(unb64(sec.n).buffer);
  const idx = new Uint16Array(unb64(sec.i).buffer);
  const b = sec.b;
  const n = qp.length / 3;
  const pos = new Float32Array(n * 3);
  const nor = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const x = b[0] + (qp[i * 3] / 65535) * (b[3] - b[0]);
    const y = b[1] + (qp[i * 3 + 1] / 65535) * (b[4] - b[1]);
    const z = b[2] + (qp[i * 3 + 2] / 65535) * (b[5] - b[2]);
    pos[i * 3] = x;
    pos[i * 3 + 1] = z;
    pos[i * 3 + 2] = y;
    nor[i * 3] = qn[i * 3] / 127;
    nor[i * 3 + 1] = qn[i * 3 + 2] / 127;
    nor[i * 3 + 2] = qn[i * 3 + 1] / 127;
  }
  const tri = new Uint32Array(idx.length);
  for (let i = 0; i < idx.length; i += 3) {
    tri[i] = idx[i];
    tri[i + 1] = idx[i + 2];
    tri[i + 2] = idx[i + 1];
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  g.setIndex(new THREE.BufferAttribute(tri, 1));
  g.computeBoundingSphere();
  g.computeBoundingBox();
  sectionGeo.set(sec, g);
  return g;
}
function meshMat(color, two, { ghost = false, faded = false } = {}) {
  const key = `${color}|${two}|${ghost}|${faded}`;
  if (meshMats.has(key)) return meshMats.get(key);
  const m = new THREE.MeshStandardMaterial({ color, roughness: 0.82, envMapIntensity: 0.6, side: two ? THREE.DoubleSide : THREE.FrontSide });
  if (ghost || faded) {
    m.transparent = true;
    m.opacity = ghost ? 0.5 : 0.28;
    m.depthWrite = !ghost;
  }
  meshMats.set(key, m);
  return m;
}
function assetMesh(a, opts = {}) {
  if (a.kind === 'mesh') {
    const g = new THREE.Group();
    for (const sec of a.sections) {
      const m = new THREE.Mesh(sectionGeometry(sec), meshMat(a.palette[sec.c] || '#9a9a96', a.twoSided, opts));
      m.castShadow = !opts.ghost && !opts.faded;
      m.receiveShadow = true;
      g.add(m);
    }
    const sz = a.size || [100, 100, 100];
    const e = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(sz[0], sz[2], sz[1])), IMPORT_EDGE);
    e.position.copy(toThree([0, 0, sz[2] / 2]));
    e.userData.edge = true;
    g.add(e);
    return g;
  }
  const g = new THREE.Group();
  const n = assetCount(a);
  if (!n) return g;
  const mesh = new THREE.InstancedMesh(GEO.cube, instMat(opts), n);
  const m4 = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const c = new THREE.Color();
  const b = a.boxes;
  for (let i = 0; i < n; i++) {
    const k = i * 7;
    m4.compose(toThree([b[k], b[k + 1], b[k + 2]]), q, scaleToThree([b[k + 3] / 100, b[k + 4] / 100, b[k + 5] / 100]));
    mesh.setMatrixAt(i, m4);
    mesh.setColorAt(i, c.set(a.palette[b[k + 6]] || '#9a9a96'));
  }
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  mesh.computeBoundingSphere();
  mesh.castShadow = !opts.ghost && !opts.faded;
  mesh.receiveShadow = true;
  g.add(mesh);
  const sz = a.size || [100, 100, 100];
  const e = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(sz[0], sz[2], sz[1])), IMPORT_EDGE);
  e.position.copy(toThree([0, 0, sz[2] / 2]));
  e.userData.edge = true;
  g.add(e);
  return g;
}

function setLocal(o3, pos, rot, scale) {
  o3.position.copy(toThree(pos));
  o3.quaternion.copy(quatFromRot(rot));
  o3.scale.copy(scaleToThree(scale));
}

function buildVisual(obj, ghost = false) {
  const piece = PIECE[obj.piece];
  const root = new THREE.Group();
  root.userData.id = obj.id;
  const faded = !ghost && obj.look && !obj.look.visible;
  const opts = { ice: obj.look?.ice, ghost, faded };
  if (piece.kind === 'zone') {
    const color = ZONE_COLORS[piece.zone];
    const box = new THREE.Mesh(GEO.cube, new THREE.MeshBasicMaterial({ color, transparent: true, opacity: ghost ? 0.25 : piece.zone === 'kill' ? 0.05 : 0.12, depthWrite: false }));
    box.userData.zoneBox = true;
    const edges = new THREE.LineSegments(EDGE.cube, new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.9 }));
    edges.userData.edge = true;
    root.add(box, edges);
    if (piece.rings) {
      box.material.opacity = ghost ? 0.08 : 0.04;
      const rings = finishRings(ghost);
      rings.userData.ringsHolder = true;
      root.add(rings);
    }
    if (piece.pad) {
      const pad = partMesh(piece.zone === 'bounce' ? 'cylinder' : 'cube', color, { ghost });
      pad.userData.pad = true;
      root.add(pad);
    }
    if (piece.zone === 'boost' || piece.zone === 'wind') {
      const arrow = new THREE.Mesh(new THREE.ConeGeometry(500, 1300, 3), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.9 }));
      arrow.rotation.z = -Math.PI / 2;
      arrow.userData.arrow = true;
      root.add(arrow);
    }
    if (!ghost) {
      const lbl = labelSprite(piece.name + (piece.zone === 'checkpoint' ? ` ${obj.p.order ?? ''}` : ''), color);
      lbl.userData.label = true;
      root.add(lbl);
    }
  } else if (piece.kind === 'marker') {
    const color = obj.color || piece.color;
    if (piece.marker === 'spawn') {
      const prm = { ...defaultParams(piece), ...obj.p };
      const ball = new THREE.Mesh(MARBLE_GEO, gemMaterial(pickGem(prm.color, 0, obj.id), { ghost, simple: thumbMode }));
      ball.position.y = MARBLE_R;
      ball.castShadow = !ghost;
      const who = playerFigure();
      who.position.y = MARBLE_R * 2;
      who.scale.setScalar(1.6);
      const arr = arrowMesh(Math.max(2500, 1500 + speedRange(prm, 'speedMin', 'speedMax', 'speed')[1] * 0.5), '#5fc8ff', 260);
      arr.position.y = MARBLE_R;
      arr.position.x = MARBLE_R * 1.05;
      const beam = new THREE.Mesh(new THREE.CylinderGeometry(40, 40, 12000, 8), new THREE.MeshBasicMaterial({ color: '#5fc8ff', transparent: true, opacity: 0.25, depthWrite: false }));
      beam.position.y = MARBLE_R * 2 + 6000;
      root.add(ball, who, arr, beam);
      if (!ghost) {
        const lbl = labelSprite('Start', '#2a7cff');
        lbl.position.y = MARBLE_R * 2 + 900;
        lbl.userData.label = true;
        root.add(lbl);
      }
    } else {
      const ball = new THREE.Mesh(GEO.sphere, solidMat(color, { ghost }));
      ball.scale.setScalar(14);
      ball.position.y = 700;
      const arrow = arrowMesh(2400, color, 300);
      arrow.position.y = 700;
      root.add(ball, arrow);
    }
  } else if (piece.kind === 'marble' || piece.kind === 'marbles') {
    const prm = { ...defaultParams(piece), ...obj.p };
    const pts = marblePoints(obj);
    for (const m of pts) {
      const ball = new THREE.Mesh(MARBLE_GEO, gemMaterial(m.gem, { ghost, simple: thumbMode }));
      ball.position.copy(toThree(m.pos));
      ball.rotation.set(m.i * 1.7, m.i * 2.3, 0);
      ball.castShadow = !ghost;
      ball.receiveShadow = true;
      ball.userData.marble = true;
      const shell = new THREE.Mesh(MARBLE_GEO, SEL_SHELL);
      shell.scale.setScalar(1.07);
      shell.visible = false;
      shell.userData.selShell = true;
      ball.add(shell);
      root.add(ball);
      if (prm.mode === 'drift' && !thumbMode) {
        const halo = new THREE.Mesh(new THREE.TorusGeometry(MARBLE_R * 1.18, 30, 6, 48), new THREE.MeshBasicMaterial({ color: '#dddaff', transparent: true, opacity: 0.35, depthWrite: false }));
        halo.position.copy(ball.position);
        halo.rotation.x = Math.PI / 2;
        root.add(halo);
      }
    }
    const pushHi = speedRange(obj.p || {})[1];
    if (pushHi > 0) {
      for (const m of piece.kind === 'marble' ? pts : pts.slice(0, 1)) {
        const arr = arrowMesh(1500 + pushHi * 0.35, '#5fc8ff', 220);
        arr.position.copy(toThree(m.pos));
        arr.position.x += MARBLE_R * 1.05;
        root.add(arr);
      }
    }
    if (piece.kind === 'marbles' && pts.length > 1 && !thumbMode) {
      const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts.map((m) => toThree(m.pos))), new THREE.LineDashedMaterial({ color: '#dddaff', dashSize: 600, gapSize: 500, transparent: true, opacity: ghost ? 0.3 : 0.55 }));
      line.computeLineDistances();
      root.add(line);
    }
  } else if (piece.kind === 'dominus') {
    const sz = Math.max(0.05, obj.p?.size || 1);
    const d = finishRings(ghost);
    d.scale.setScalar((DOMINUS.reach * sz) / 48);
    root.add(d);
    const core = new THREE.Mesh(new THREE.OctahedronGeometry(DOMINUS.reach * sz * 0.22, 0), new THREE.MeshStandardMaterial({ color: '#ffd23a', emissive: '#ffb000', emissiveIntensity: 0.6, metalness: 0.4, roughness: 0.25, transparent: ghost, opacity: ghost ? 0.5 : 1 }));
    core.userData.spin = 0.8;
    root.add(core);
    if (!ghost && !thumbMode) {
      const lbl = labelSprite('Dominus', '#2a7cff');
      lbl.position.y = DOMINUS.reach * sz * 1.25;
      lbl.userData.label = true;
      root.add(lbl);
    }
  } else if (piece.kind === 'spawner') {
    const prm = { ...defaultParams(piece), ...obj.p };
    const boxMat = new THREE.MeshStandardMaterial({ color: '#9dffca', transparent: true, opacity: ghost ? 0.25 : 0.35, roughness: 0.3, emissive: '#2a7c66', emissiveIntensity: 0.4, depthWrite: false });
    const box = new THREE.Mesh(GEO.cube, boxMat);
    box.scale.setScalar(20);
    const edges = new THREE.LineSegments(EDGE.cube, new THREE.LineBasicMaterial({ color: '#9dffca' }));
    edges.scale.setScalar(20);
    edges.userData.edge = true;
    root.add(box, edges);
    const throwHi = speedRange(prm, 'speedMin', 'speedMax', 'speed', 0.35)[1];
    const arr = arrowMesh(Math.max(3000, throwHi * 0.45), '#9dffca', 320);
    arr.position.x = 1000;
    root.add(arr);
    const half = (prm.angle * Math.PI) / 360;
    const fan = new THREE.Mesh(new THREE.CircleGeometry(Math.max(3000, throwHi * 0.45), 32, -half, half * 2), new THREE.MeshBasicMaterial({ color: '#9dffca', transparent: true, opacity: 0.14, side: THREE.DoubleSide, depthWrite: false }));
    fan.rotation.x = -Math.PI / 2;
    root.add(fan);
    if (prm.spread > 0) {
      const sq = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.PlaneGeometry(prm.spread, prm.spread)), new THREE.LineDashedMaterial({ color: '#9dffca', dashSize: 500, gapSize: 400, transparent: true, opacity: 0.7 }));
      sq.rotation.x = -Math.PI / 2;
      sq.computeLineDistances();
      root.add(sq);
    }
    const sample = new THREE.Mesh(MARBLE_GEO, gemMaterial(pickGem(prm.color, 0, obj.id), { ghost: true, simple: thumbMode }));
    sample.position.set(0, -MARBLE_R * 1.6, 0);
    root.add(sample);
    if (!ghost && !thumbMode) {
      const lbl = labelSprite('Spawner', '#1e8a6c');
      lbl.position.y = 1800;
      lbl.userData.label = true;
      root.add(lbl);
    }
  } else if (piece.kind === 'game' && MODELS[piece.id] && MODELS[piece.id].every((p) => MESHES[p.mk])) {
    for (const part of MODELS[piece.id]) {
      const gg = gameGeometry(part.mk);
      const mat = part.wood ? woodMaterial(1, 1, null, { ghost, faded }) : gameMat(part.color, ghost, faded);
      if (part.wood) mat.side = THREE.DoubleSide;
      const m = new THREE.Mesh(gg.g, mat);
      m.scale.setScalar(part.s || 1);
      m.castShadow = !ghost;
      m.receiveShadow = true;
      root.add(m);
      if (!thumbMode) {
        const e = new THREE.LineSegments(gg.e, edgeMat(part.color || '#a8703f'));
        e.userData.edge = true;
        e.scale.setScalar(part.s || 1);
        root.add(e);
      }
    }
  } else if (piece.kind === 'game') {
    const geo = piece.round ? GEO.cylinder : GEO.cube;
    const size = piece.box.e.map((v) => (v * 2) / 100);
    const mat = piece.wood ? woodMaterial(size[0] / 30, size[1] / 30, null, { ghost, faded }) : new THREE.MeshStandardMaterial({ map: hatch(), roughness: 0.8, transparent: ghost || faded, opacity: ghost ? 0.5 : faded ? 0.3 : 1 });
    const m = new THREE.Mesh(geo, mat);
    m.scale.copy(scaleToThree(size));
    m.position.copy(toThree(piece.box.o));
    m.castShadow = !ghost;
    m.receiveShadow = true;
    const e = new THREE.LineSegments(piece.round ? EDGE.cylinder : EDGE.cube, edgeMat('#6c63c9'));
    e.userData.edge = true;
    e.scale.copy(m.scale);
    e.position.copy(m.position);
    root.add(m, e);
  } else if (piece.kind === 'import') {
    const a = assetFor(obj.p && obj.p.ref);
    if (a) root.add(assetMesh(a, opts));
    else {
      const pm = partMesh('cube', '#ff5a4a', { ghost: true });
      pm.scale.setScalar(20);
      root.add(pm);
    }
  } else if (piece.kind === 'decor') {
    const prm = { ...defaultParams(piece), ...obj.p };
    if (piece.decor === 'text') {
      const { tex, aspect } = textTexture(prm.text, obj.color);
      const plane = new THREE.Mesh(new THREE.PlaneGeometry(prm.height * aspect, prm.height), new THREE.MeshBasicMaterial({ map: tex, transparent: true, side: THREE.DoubleSide, opacity: ghost ? 0.5 : 1 }));
      plane.rotation.y = Math.PI / 2;
      root.add(plane);
      const hit = new THREE.Mesh(new THREE.BoxGeometry(10, prm.height, prm.height * aspect), new THREE.MeshBasicMaterial({ visible: false }));
      root.add(hit);
    } else {
      const bulb = new THREE.Mesh(GEO.sphere, new THREE.MeshBasicMaterial({ color: obj.color }));
      bulb.scale.setScalar(12);
      const halo = new THREE.Mesh(GEO.sphere, new THREE.MeshBasicMaterial({ color: obj.color, transparent: true, opacity: 0.12, depthWrite: false }));
      halo.scale.setScalar(Math.min(60, prm.radius / 1200));
      root.add(bulb, halo);
    }
  } else {
    for (const lp of localParts(obj)) {
      const wood = lp.mat === 'wood' || obj.look?.wood;
      const sz = wood ? [lp.scale[0] * 100 * Math.abs(obj.scale[0]), lp.scale[1] * 100 * Math.abs(obj.scale[1])] : null;
      const pm = partMesh(lp.shape, obj.color, opts, !wood, wood ? 'wood' : null, sz);
      setLocal(pm, lp.pos, lp.rot, lp.scale);
      root.add(pm);
    }
  }
  return root;
}

function applyBase(obj, root) {
  const piece = PIECE[obj.piece];
  root.position.copy(toThree(obj.pos));
  root.quaternion.copy(quatFromRot(obj.rot));
  if (fixedScale(piece)) root.scale.set(1, 1, 1);
  else root.scale.copy(scaleToThree(obj.scale));
  fixZoneChildren(obj, root);
  root.visible = !state.hiddenIds.has(obj.id);
}

function fixZoneChildren(obj, root) {
  const piece = PIECE[obj.piece];
  if (piece.kind !== 'zone') return;
  const s = obj.scale;
  for (const c of root.children) {
    if (c.userData.pad) {
      c.position.copy(toThree([0, 0, -50 + 10 / Math.max(0.01, Math.abs(s[2]))]));
      c.scale.copy(scaleToThree([0.95, 0.95, 0.2 / Math.max(0.01, Math.abs(s[2]))]));
    }
    if (c.userData.label) {
      c.position.set(0, 50 + 60 / Math.max(0.01, Math.abs(s[2])), 0);
      c.scale.set((c.userData.aspect * 0.028) / Math.abs(s[0] || 1), 0.028 / Math.abs(s[2] || 1), 1);
    }
    if (c.userData.ringsHolder) {
      const k = Math.min(Math.abs(s[1]), Math.abs(s[2])) || 1;
      c.scale.set(k / (Math.abs(s[0]) || 1), k / (Math.abs(s[2]) || 1), k / (Math.abs(s[1]) || 1));
    }
    if (c.userData.arrow) {
      c.scale.set(1 / Math.abs(s[1] || 1), 1 / Math.abs(s[0] || 1), 1 / Math.abs(s[2] || 1));
      c.position.set(0, -50 + 30 / Math.max(0.01, Math.abs(s[2])), 0);
    }
  }
}

function rebuildObject(obj) {
  const old = roots.get(obj.id);
  if (old) world.remove(old);
  const root = buildVisual(obj);
  applyBase(obj, root);
  const sp = [];
  root.traverse((c) => c.userData.spin && sp.push(c));
  if (sp.length) root.userData.spinners = sp;
  world.add(root);
  roots.set(obj.id, root);
  if (state.selected.has(obj.id)) paintSelected(root, true);
  return root;
}

function rebuildAll() {
  world.clear();
  roots.clear();
  for (const o of state.map.objects) rebuildObject(o);
}

function paintSelected(root, on) {
  root.traverse((c) => {
    if (c.userData.selShell) c.visible = on;
    if (c.userData.edge) {
      if (on) {
        if (!c.userData.baseMat) c.userData.baseMat = c.material;
        c.material = SEL_EDGE;
        c.renderOrder = 4;
      } else if (c.userData.baseMat) {
        c.material = c.userData.baseMat;
        c.renderOrder = 0;
      }
    }
  });
}

const obj = (id) => state.map.objects.find((o) => o.id === id);
const selectedObjs = () => state.map.objects.filter((o) => state.selected.has(o.id));

const pivot = new THREE.Object3D();
scene.add(pivot);
const gizmo = new TransformControls(camera, canvas);
gizmo.setSize(0.85);
scene.add(gizmo.getHelper());
let dragStart = null;

gizmo.addEventListener('dragging-changed', (e) => {
  controls.enabled = !e.value;
  if (e.value) {
    stopPreview(true);
    pivot.updateMatrixWorld();
    dragStart = { pivot: pivot.matrixWorld.clone(), items: selectedObjs().map((o) => ({ o, m: roots.get(o.id).matrix.clone() })) };
  } else if (dragStart) {
    for (const { o } of dragStart.items) {
      const r = roots.get(o.id);
      o.pos = fromThree(r.position).map(round2);
      o.rot = rotFromQuat(r.quaternion);
      const piece = PIECE[o.piece];
      if (!fixedScale(piece)) o.scale = scaleFromThree(r.scale).map((v) => Math.round(v * 1000) / 1000);
      applyBase(o, r);
    }
    dragStart = null;
    commit('Transform');
    refreshPivot();
    renderInspector();
  }
});

gizmo.addEventListener('objectChange', () => {
  if (!dragStart) return;
  pivot.updateMatrixWorld();
  const delta = pivot.matrixWorld.clone().multiply(dragStart.pivot.clone().invert());
  for (const { o, m } of dragStart.items) {
    const r = roots.get(o.id);
    const nm = delta.clone().multiply(m);
    nm.decompose(r.position, r.quaternion, r.scale);
    const piece = PIECE[o.piece];
    if (fixedScale(piece)) r.scale.set(1, 1, 1);
    fixZoneChildren({ ...o, scale: scaleFromThree(r.scale) }, r);
  }
  drawMotionPath();
  liveInspectorTransform();
});

const round2 = (v) => Math.round(v * 100) / 100;

function refreshPivot() {
  const sel = selectedObjs();
  if (!sel.length || state.tool === 'select') {
    gizmo.detach();
    return;
  }
  const c = new THREE.Vector3();
  for (const o of sel) c.add(toThree(o.pos));
  c.divideScalar(sel.length);
  pivot.position.copy(c);
  pivot.quaternion.copy(sel.length === 1 ? quatFromRot(sel[0].rot) : new THREE.Quaternion());
  pivot.scale.set(1, 1, 1);
  pivot.updateMatrixWorld();
  gizmo.attach(pivot);
  gizmo.setMode(state.tool);
  gizmo.setSpace(state.tool === 'scale' || sel.length === 1 ? 'local' : 'world');
  applySnaps();
}

function applySnaps() {
  gizmo.setTranslationSnap(state.snap ? state.grid : null);
  gizmo.setRotationSnap(state.snap && state.angle ? THREE.MathUtils.degToRad(state.angle) : null);
  gizmo.setScaleSnap(state.snap ? 0.05 : null);
}

function select(ids, { add = false, toggle = false } = {}) {
  const next = add || toggle ? new Set(state.selected) : new Set();
  for (const id of ids) {
    if (toggle && next.has(id)) next.delete(id);
    else next.add(id);
  }
  for (const id of state.selected) if (!next.has(id) && roots.get(id)) paintSelected(roots.get(id), false);
  for (const id of next) if (roots.get(id)) paintSelected(roots.get(id), true);
  state.selected = next;
  refreshPivot();
  drawMotionPath();
  renderInspector();
}

function expandGroups(ids, alt) {
  if (alt) return ids;
  const out = new Set(ids);
  for (const id of ids) {
    const o = obj(id);
    if (o && o.group) for (const m of state.map.objects) if (m.group === o.group) out.add(m.id);
  }
  return [...out];
}

let motionLine = null;
function drawMotionPath() {
  if (motionLine) {
    scene.remove(motionLine);
    motionLine.traverse((c) => c.geometry && c.geometry.dispose());
    motionLine = null;
  }
  const sel = selectedObjs();
  if (sel.length !== 1 || !sel[0].anim || !sel[0].anim.move) return;
  const o = sel[0];
  const pts = [[0, 0, 0], ...o.anim.move.points];
  if (o.anim.move.mode === 'loop') pts.push([0, 0, 0]);
  const base = o.pos;
  const v = pts.map((p) => toThree(add(base, p)));
  const g = new THREE.Group();
  const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(v), new THREE.LineDashedMaterial({ color: '#5fc8ff', dashSize: 900, gapSize: 700, depthTest: false, transparent: true }));
  line.computeLineDistances();
  line.renderOrder = 6;
  g.add(line);
  v.forEach((p, i) => {
    const d = new THREE.Mesh(new THREE.SphereGeometry(i ? 420 : 280, 16, 10), new THREE.MeshBasicMaterial({ color: i ? '#5fc8ff' : '#ffffff', depthTest: false }));
    d.position.copy(p);
    d.renderOrder = 7;
    g.add(d);
  });
  motionLine = g;
  scene.add(g);
}

function snapshot() {
  return JSON.stringify(state.map, (k, v) => (k === 'assets' ? undefined : v));
}

function commit(label) {
  state.freshBoot = false;
  state.history.push(state.lastSnap);
  if (state.history.length > 120) state.history.shift();
  state.future = [];
  state.lastSnap = snapshot();
  scheduleSave();
  updateUndo();
  updateStats();
}

function undo() {
  if (!state.history.length) return;
  state.future.push(state.lastSnap);
  state.lastSnap = state.history.pop();
  restore(state.lastSnap);
  toast('Undone');
}

function redo() {
  if (!state.future.length) return;
  state.history.push(state.lastSnap);
  state.lastSnap = state.future.pop();
  restore(state.lastSnap);
  toast('Redone');
}

function restore(snap) {
  const assets = state.map.assets || {};
  state.map = JSON.parse(snap);
  state.map.assets = assets;
  const keep = [...state.selected].filter((id) => obj(id));
  rebuildAll();
  state.selected = new Set();
  select(keep);
  $('#mapName').value = state.map.meta.name;
  scheduleSave();
  updateUndo();
  updateStats();
}

function updateUndo() {
  $('#undoBtn').disabled = !state.history.length;
  $('#redoBtn').disabled = !state.future.length;
}

let saveTimer = null;
function scheduleSave() {
  $('#savedText').textContent = 'Saving';
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(state.map));
      $('#savedText').textContent = state.filePath ? 'Autosaved' : 'Saved';
    } catch {
      $('#savedText').textContent = desk ? 'Too big to autosave, Ctrl+S' : 'Too big to autosave, export it';
    }
  }, 500);
}

function savePrefs() {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify({ grid: state.grid, angle: state.angle, snap: state.snap, cat: state.cat }));
  } catch {}
}

function loadMap(map, { intro = false } = {}) {
  stopPreview(true);
  state.map = map;
  state.selected = new Set();
  state.hiddenIds = new Set();
  rebuildAll();
  state.history = [];
  state.future = [];
  state.lastSnap = snapshot();
  $('#mapName').value = map.meta.name;
  select([]);
  updateUndo();
  updateStats();
  scheduleSave();
  if (intro) playIntro();
  else frameAll();
  if (map.oldScale) {
    delete map.oldScale;
    setTimeout(() => toast('This map was made before marbles were real size, so everything in it is small next to them.'), 900);
  }
}

const raycaster = new THREE.Raycaster();
const ndc = new THREE.Vector2();
function setRay(e) {
  const r = canvas.getBoundingClientRect();
  ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
  raycaster.setFromCamera(ndc, camera);
}

function pickables(solidOnly) {
  const out = [];
  for (const [id, root] of roots) {
    if (!root.visible) continue;
    const piece = PIECE[obj(id)?.piece];
    if (!piece) continue;
    if (solidOnly && ['zone', 'marker', 'decor', 'marble', 'marbles', 'spawner', 'dominus'].includes(piece.kind)) continue;
    root.traverse((c) => {
      if (c.isMesh && !c.userData.label && !c.userData.selShell) out.push(c);
    });
  }
  return out;
}

function hitObject(e) {
  setRay(e);
  const hits = raycaster.intersectObjects(pickables(false), false);
  const sorted = hits.sort((a, b) => {
    const za = a.object.userData.zoneBox ? 1 : 0;
    const zb = b.object.userData.zoneBox ? 1 : 0;
    return za - zb || a.distance - b.distance;
  });
  for (const h of sorted) {
    let o = h.object;
    while (o && !o.userData.id) o = o.parent;
    if (o) return o.userData.id;
  }
  return null;
}

let ghost = null;
let ghostBox = null;
const ghostSpring = { x: new Spring(0, SPRINGS.snappy), y: new Spring(0, SPRINGS.snappy), z: new Spring(0, SPRINGS.snappy) };
let ghostTarget = null;

function setBrush(id) {
  state.brush = id;
  if (ghost) {
    scene.remove(ghost);
    ghost = null;
  }
  $$('.piece').forEach((p) => p.classList.toggle('on', p.dataset.id === id && (id !== 'import' || p.dataset.ref === state.importRef)));
  const bar = $('#placing');
  if (!id) {
    bar.hidden = true;
    canvas.style.cursor = '';
    updateTrayNote();
    return;
  }
  const temp = newObject(id, [0, 0, 0]);
  if (id === 'import') temp.p.ref = state.importRef;
  ghost = buildVisual(temp, true);
  applyBase(temp, ghost);
  ghost.position.set(0, 0, 0);
  ghost.updateMatrixWorld(true);
  ghostBox = new THREE.Box3().setFromObject(ghost);
  ghost.visible = false;
  scene.add(ghost);
  ghostTarget = null;
  $('#placingName').textContent = `Placing ${id === 'import' ? assetFor(state.importRef)?.name || 'import' : PIECE[id].name}`;
  bar.hidden = false;
  fadeIn(bar, { y: 10, spring: SPRINGS.bouncy });
  updatePlaceHeight();
  canvas.style.cursor = 'crosshair';
  gizmo.detach();
  updateTrayNote();
}

function updatePlaceHeight() {
  $('#placingHeight').textContent = `Height ${fmtLen(state.placeZ)}`;
}

function fmtLen(cm) {
  return Math.abs(cm) >= 100000 ? `${round2(cm / 100000)} km` : `${round2(cm / 100)} m`;
}

const snapV = (v) => (state.snap ? Math.round(v / state.grid) * state.grid : Math.round(v));

function placementTarget(e) {
  setRay(e);
  const hits = raycaster.intersectObjects(pickables(true), false);
  const p = new THREE.Vector3();
  const b = ghostBox;
  if (hits.length) {
    const h = hits[0];
    const n = h.face.normal.clone().transformDirection(h.object.matrixWorld);
    const ax = Math.abs(n.x) > Math.abs(n.y) ? (Math.abs(n.x) > Math.abs(n.z) ? 'x' : 'z') : Math.abs(n.y) > Math.abs(n.z) ? 'y' : 'z';
    p.copy(h.point);
    const sign = Math.sign(n[ax]);
    p[ax] = h.point[ax] - (sign > 0 ? b.min[ax] : b.max[ax]);
    for (const k of ['x', 'y', 'z']) if (k !== ax) p[k] = k === 'y' ? (state.snap ? Math.round(p.y / state.grid) * state.grid : p.y) : snapV(p[k]);
    return p;
  }
  const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -state.placeZ);
  if (!raycaster.ray.intersectPlane(plane, p)) return null;
  p.x = snapV(p.x);
  p.z = snapV(p.z);
  p.y = state.placeZ - b.min.y;
  return p;
}

let painting = null;

function placeAt(p) {
  const pos = fromThree(p).map(round2);
  const id = state.brush;
  const piece = PIECE[id];
  if (piece.marker === 'spawn') {
    const existing = state.map.objects.find((o) => o.piece === 'spawn');
    if (existing) {
      existing.pos = pos;
      applyBase(existing, roots.get(existing.id));
      bounceIn(roots.get(existing.id));
      toast('Spawn moved');
      return existing;
    }
  }
  const o = newObject(id, pos);
  if (id === 'import') {
    o.p.ref = state.importRef;
    const a = assetFor(state.importRef);
    if (!a) return null;
    state.map.assets = state.map.assets || {};
    if (!state.map.assets[state.importRef]) state.map.assets[state.importRef] = a;
    o.name = a.name;
  }
  if (id === 'checkpoint') o.p.order = state.map.objects.filter((x) => x.piece === 'checkpoint').length + 1;
  state.map.objects.push(o);
  const r = rebuildObject(o);
  bounceIn(r);
  if (id === 'teleport') {
    const ex = newObject('exit', [pos[0] + 12000, pos[1], pos[2] - o.scale[2] * 50]);
    ex.p.link = o.id;
    o.p.exit = ex.id;
    state.map.objects.push(ex);
    bounceIn(rebuildObject(ex), 120);
  }
  return o;
}

const appear = [];
function bounceIn(root, delay = 0, drop = 0) {
  if (!root) return;
  const target = root.scale.clone();
  const baseY = root.position.y;
  const s = new Spring(0.0001, SPRINGS.bouncy);
  s.target = 1;
  const y = new Spring(drop, SPRINGS.gentle);
  y.target = 0;
  root.scale.copy(target).multiplyScalar(0.0001);
  appear.push({ root, target, baseY, s, y, wait: delay / 1000 });
}

function stepAppear(dt) {
  for (let i = appear.length - 1; i >= 0; i--) {
    const a = appear[i];
    if (a.wait > 0) {
      a.wait -= dt;
      continue;
    }
    const s = a.s.step(dt);
    const y = a.y.step(dt);
    a.root.scale.copy(a.target).multiplyScalar(Math.max(0.0001, s));
    a.root.position.y = a.baseY + y;
    if (a.s.done && a.y.done) {
      a.root.scale.copy(a.target);
      a.root.position.y = a.baseY;
      appear.splice(i, 1);
    }
  }
}

let down = null;
canvas.addEventListener('pointerdown', (e) => {
  canvas.focus();
  if (e.button !== 0) return;
  if (gizmo.dragging || gizmo.axis) return;
  if (state.brush) {
    const p = placementTarget(e);
    if (!p) return;
    stopPreview(true);
    const o = placeAt(p);
    painting = { keys: new Set([cellKey(p)]), placed: [o.id], lastP: p.clone() };
    canvas.setPointerCapture(e.pointerId);
    return;
  }
  down = { x: e.clientX, y: e.clientY, shift: e.shiftKey, alt: e.altKey, ctrl: e.ctrlKey || e.metaKey, marquee: false };
  canvas.setPointerCapture(e.pointerId);
});

const cellKey = (p) => `${Math.round(p.x)}|${Math.round(p.y)}|${Math.round(p.z)}`;

canvas.addEventListener('pointermove', (e) => {
  if (state.brush) {
    const p = placementTarget(e);
    if (p && ghost) {
      if (!ghost.visible) {
        ghost.visible = true;
        ghostSpring.x.set(p.x);
        ghostSpring.y.set(p.y);
        ghostSpring.z.set(p.z);
      }
      ghostTarget = p;
      ghostSpring.x.target = p.x;
      ghostSpring.y.target = p.y;
      ghostSpring.z.target = p.z;
      const pk = PIECE[state.brush];
      const roomy = !['marble', 'marbles', 'spawner'].includes(pk.kind) || !painting || !painting.lastP || painting.lastP.distanceTo(p) >= (pk.kind === 'marble' ? MARBLE_R * 2.6 : 20000);
      if (painting && roomy && !painting.keys.has(cellKey(p))) {
        painting.keys.add(cellKey(p));
        painting.lastP = p.clone();
        const o = placeAt(p);
        painting.placed.push(o.id);
      }
    } else if (ghost) ghost.visible = false;
    return;
  }
  if (down) {
    const dx = e.clientX - down.x, dy = e.clientY - down.y;
    if (!down.marquee && Math.hypot(dx, dy) > 5) down.marquee = true;
    if (down.marquee) {
      const r = stage.getBoundingClientRect();
      const m = $('#marquee');
      m.hidden = false;
      const x0 = Math.min(down.x, e.clientX) - r.left, y0 = Math.min(down.y, e.clientY) - r.top;
      Object.assign(m.style, { left: x0 + 'px', top: y0 + 'px', width: Math.abs(dx) + 'px', height: Math.abs(dy) + 'px' });
    }
  }
});

canvas.addEventListener('pointerup', (e) => {
  if (painting) {
    const n = painting.placed.length;
    painting = null;
    commit('Place');
    if (n > 1) toast(`Painted ${n} pieces`);
    updateStats();
    renderInspector();
    return;
  }
  if (!down) return;
  const d = down;
  down = null;
  if (d.marquee) {
    $('#marquee').hidden = true;
    const r = canvas.getBoundingClientRect();
    const x0 = Math.min(d.x, e.clientX), x1 = Math.max(d.x, e.clientX), y0 = Math.min(d.y, e.clientY), y1 = Math.max(d.y, e.clientY);
    const ids = [];
    for (const o of state.map.objects) {
      if (state.hiddenIds.has(o.id)) continue;
      const v = toThree(o.pos).project(camera);
      const sx = r.left + ((v.x + 1) / 2) * r.width, sy = r.top + ((1 - v.y) / 2) * r.height;
      if (v.z < 1 && sx >= x0 && sx <= x1 && sy >= y0 && sy <= y1) ids.push(o.id);
    }
    select(expandGroups(ids, d.alt), { add: d.shift });
    return;
  }
  const id = hitObject(e);
  if (id) select(expandGroups([id], d.alt), { toggle: d.shift || d.ctrl });
  else if (!d.shift) select([]);
});

canvas.addEventListener('dblclick', (e) => {
  const id = hitObject(e);
  if (id) frameObjects([obj(id)]);
});

canvas.addEventListener(
  'wheel',
  (e) => {
    if (state.brush && e.altKey) {
      e.preventDefault();
      e.stopImmediatePropagation();
      state.placeZ += (e.deltaY < 0 ? 1 : -1) * state.grid;
      updatePlaceHeight();
      canvas.dispatchEvent(new PointerEvent('pointermove', { clientX: e.clientX, clientY: e.clientY }));
    }
  },
  { capture: true, passive: false }
);

canvas.addEventListener('contextmenu', (e) => e.preventDefault());

const camFly = { active: false, pos: [new Spring(0, SPRINGS.soft), new Spring(0, SPRINGS.soft), new Spring(0, SPRINGS.soft)], tgt: [new Spring(0, SPRINGS.soft), new Spring(0, SPRINGS.soft), new Spring(0, SPRINGS.soft)] };
function flyTo(pos, target, spring = SPRINGS.soft) {
  ['x', 'y', 'z'].forEach((k, i) => {
    Object.assign(camFly.pos[i], { k: spring.stiffness, c: spring.damping });
    Object.assign(camFly.tgt[i], { k: spring.stiffness, c: spring.damping });
    if (!camFly.active) {
      camFly.pos[i].set(camera.position[k]);
      camFly.tgt[i].set(controls.target[k]);
    }
    camFly.pos[i].target = pos[k];
    camFly.tgt[i].target = target[k];
  });
  camFly.active = true;
}
controls.addEventListener('start', () => (camFly.active = false));

function boundsOf(list) {
  const box = new THREE.Box3();
  for (const o of list) {
    const r = roots.get(o.id);
    if (r) box.expandByObject(r);
  }
  return box;
}

function frameObjects(list, dir) {
  if (!list.length) return;
  const box = boundsOf(list);
  if (box.isEmpty()) return;
  const c = box.getCenter(new THREE.Vector3());
  const size = box.getSize(new THREE.Vector3()).length();
  const dist = Math.max(12000, size * 0.9) / Math.tan((camera.fov * Math.PI) / 360) / 1.6;
  const d = dir || camera.position.clone().sub(controls.target).normalize();
  flyTo(c.clone().add(d.multiplyScalar(dist)), c);
}

function frameAll() {
  const list = state.map.objects.filter((o) => o.piece !== 'kill');
  if (list.length) frameObjects(list);
  else if (state.map.objects.length) frameObjects(state.map.objects);
  else flyTo(new THREE.Vector3(60000, 45000, 60000), new THREE.Vector3(0, 0, 0));
}

function setView(v) {
  $$('.viewbar [data-view]').forEach((b) => b.classList.toggle('on', b.dataset.view === v && v !== 'frame'));
  const list = state.selected.size ? selectedObjs() : state.map.objects;
  if (v === 'frame') return frameAll();
  const dir = v === 'top' ? new THREE.Vector3(0.001, 1, 0.001).normalize() : v === 'side' ? new THREE.Vector3(0, 0.12, 1).normalize() : new THREE.Vector3(1, 0.85, 1.05).normalize();
  if (list.length) frameObjects(list, dir);
  else flyTo(dir.multiplyScalar(80000), new THREE.Vector3());
}

function resize() {
  const r = stage.getBoundingClientRect();
  renderer.setSize(r.width, r.height, false);
  camera.aspect = r.width / Math.max(1, r.height);
  camera.updateProjectionMatrix();
}
new ResizeObserver(resize).observe(stage);

let resolvedAnims = null;
function resolveAll() {
  const build = flatten({ ...state.map, objects: state.map.objects.filter((o) => o.anim) });
  const out = new Map();
  for (const z of build.zones) if (z.anim) out.set(z.id, z.anim);
  for (const p of [...build.parts, ...build.marbles, ...build.spawners]) {
    const id = p.id.split(':')[0];
    if (p.anim && !out.has(id)) out.set(id, p.anim);
  }
  for (const o of state.map.objects) {
    if (o.anim && !out.has(o.id) && PIECE[o.piece].kind === 'marker') continue;
  }
  return out;
}

function applyTime() {
  if (!resolvedAnims) resolvedAnims = resolveAll();
  for (const o of state.map.objects) {
    const a = resolvedAnims.get(o.id);
    if (!a) continue;
    const r = roots.get(o.id);
    if (!r) continue;
    const t = a.start === 'trigger' && !state.fire ? 0 : state.time;
    const res = evalAnim(a, t, o.pos, axesFromRot(o.rot));
    r.position.copy(toThree(res.pos));
    r.quaternion.copy(quatFromAxes(res.axes));
    r.visible = res.visible && !state.hiddenIds.has(o.id);
  }
}

function setTime(t) {
  state.time = t;
  $('#scrub').value = t;
  $('#scrub').style.setProperty('--fill', (t / +$('#scrub').max) * 100 + '%');
  $('#timeText').textContent = `${t.toFixed(1)} s`;
  applyTime();
}

function togglePreview() {
  if (state.playing) stopPreview(false);
  else {
    resolvedAnims = resolveAll();
    const spawners = state.map.objects.some((o) => PIECE[o.piece].kind === 'spawner');
    if (!resolvedAnims.size && !spawners) {
      toast('Nothing moves yet. Add a marble spawner, or give something motion in the inspector.');
      return;
    }
    clearSim();
    state.playing = true;
    gizmo.detach();
    $('#playIcon').innerHTML = ICON.pause;
  }
}

function stopPreview(reset) {
  const was = state.playing || state.time !== 0;
  state.playing = false;
  $('#playIcon').innerHTML = ICON.play;
  if (reset) clearSim();
  if (reset && was) {
    setTime(0);
    for (const o of state.map.objects) {
      const r = roots.get(o.id);
      if (r) applyBase(o, r);
    }
    resolvedAnims = null;
    refreshPivot();
  }
}

const sim = { list: [], timers: new Map(), group: new THREE.Group(), frame: 0, count: 0, solids: null };
scene.add(sim.group);
const GRAVITY = 980;
const simRay = new THREE.Raycaster();
const DOWN = new THREE.Vector3(0, -1, 0);
const UP3 = new THREE.Vector3(0, 1, 0);

function clearSim() {
  for (const m of sim.list) sim.group.remove(m.mesh);
  sim.list = [];
  sim.timers.clear();
  sim.solids = null;
}

function removeSim(m) {
  sim.group.remove(m.mesh);
  const i = sim.list.indexOf(m);
  if (i >= 0) sim.list.splice(i, 1);
}

function stepSim(dt) {
  sim.frame++;
  if (!sim.solids || sim.frame % 45 === 0) sim.solids = pickables(true);
  for (const o of state.map.objects) {
    if (PIECE[o.piece].kind !== 'spawner') continue;
    const prm = { ...defaultParams(PIECE.spawner), ...o.p };
    if ((prm.channel || '').trim() && !state.fire) continue;
    const r = roots.get(o.id);
    if (!r || !r.visible) continue;
    let t = (sim.timers.get(o.id) ?? 0) - dt;
    let guard = 0;
    while (t <= 0 && guard++ < 8) {
      t += Math.max(0.1, prm.interval);
      const mine = sim.list.filter((m) => m.owner === o.id);
      if (mine.length >= prm.max) removeSim(mine[0]);
      const fwd = new THREE.Vector3(1, 0, 0).applyQuaternion(r.quaternion);
      const side = new THREE.Vector3(0, 0, 1).applyQuaternion(r.quaternion);
      const pos = r.position.clone().addScaledVector(fwd, (Math.random() - 0.5) * prm.spread).addScaledVector(side, (Math.random() - 0.5) * prm.spread);
      const dir = fwd.clone().applyAxisAngle(UP3, (Math.random() - 0.5) * prm.angle * (Math.PI / 180));
      const [sLo, sHi] = speedRange(o.p, 'speedMin', 'speedMax', 'speed', 0.35);
      const lo = o.p.speedMin === undefined && o.p.speed === undefined ? prm.speedMin : sLo;
      const hi = o.p.speedMax === undefined && o.p.speed === undefined ? prm.speedMax : sHi;
      const vel = dir.multiplyScalar(lo + Math.random() * (hi - lo));
      const gem = pickGem(prm.color, ++sim.count, `${o.id}:${sim.frame}`);
      const mesh = new THREE.Mesh(MARBLE_GEO, gemMaterial(gem));
      mesh.castShadow = true;
      mesh.position.copy(pos);
      sim.group.add(mesh);
      sim.list.push({ mesh, vel, owner: o.id, mode: prm.mode, age: 0, ground: false });
    }
    sim.timers.set(o.id, t);
  }
  const kill = state.map.rules.killHeight ?? -60000;
  for (let i = sim.list.length - 1; i >= 0; i--) {
    const m = sim.list[i];
    m.age += dt;
    if (m.mode === 'roll') m.vel.y -= GRAVITY * dt;
    else if (m.mode === 'float') m.vel.multiplyScalar(Math.pow(0.25, dt));
    m.mesh.position.addScaledVector(m.vel, dt);
    m.mesh.rotation.z -= (m.vel.x * dt) / MARBLE_R;
    m.mesh.rotation.x += (m.vel.z * dt) / MARBLE_R;
    if (m.mode === 'roll' && (m.ground || (sim.frame + i) % 3 === 0)) {
      simRay.set(m.mesh.position.clone().addScaledVector(UP3, MARBLE_R), DOWN);
      simRay.far = MARBLE_R * 3.2;
      const h = simRay.intersectObjects(sim.solids, false)[0];
      m.ground = false;
      if (h && h.face) {
        const n = h.face.normal.clone().transformDirection(h.object.matrixWorld);
        if (n.y < 0) n.negate();
        const gap = m.mesh.position.y - h.point.y;
        if (gap < MARBLE_R) {
          m.mesh.position.y = h.point.y + MARBLE_R;
          const vn = m.vel.dot(n);
          if (vn < 0) m.vel.addScaledVector(n, -vn * 1.2);
          m.vel.multiplyScalar(Math.pow(0.92, dt));
          m.ground = true;
        } else if (gap < MARBLE_R * 1.6) m.ground = true;
      }
    }
    if (toThree([0, 0, kill]).y > m.mesh.position.y || m.age > 90) removeSim(m);
  }
}

let last = performance.now();
function loop(now) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  if (camFly.active) {
    ['x', 'y', 'z'].forEach((k, i) => {
      camera.position[k] = camFly.pos[i].step(dt);
      controls.target[k] = camFly.tgt[i].step(dt);
    });
    if (camFly.pos.every((s) => s.done) && camFly.tgt.every((s) => s.done)) camFly.active = false;
  }
  controls.update();
  if (ghost && ghost.visible) {
    ghost.position.set(ghostSpring.x.step(dt), ghostSpring.y.step(dt), ghostSpring.z.step(dt));
  }
  stepAppear(dt);
  if (state.playing) {
    let t = state.time + dt;
    if (t > +$('#scrub').max) {
      t = 0;
      clearSim();
    }
    setTime(t);
    stepSim(dt);
  }
  const target = controls.target;
  const camDist = camera.position.distanceTo(target);
  fitShadow(camDist);
  sun.position.copy(target).addScaledVector(SUN_DIR, 400000);
  sun.target.position.copy(target);
  sky.position.copy(camera.position);
  sky.material.uniforms.uTime.value = now / 1000;
  followGrid(camDist);
  for (const r of roots.values()) {
    if (!r.userData.spinners) continue;
    for (const c of r.userData.spinners) c.rotation.x += c.userData.spin * dt;
  }
  renderer.render(scene, camera);
  requestAnimationFrame(loop);
}

function toast(text, bad = false) {
  const t = html(`<div class="toast ${bad ? 'bad' : ''}">${esc(text)}</div>`);
  $('#toasts').appendChild(t);
  animate(t, { opacity: [0, 1], transform: ['translateY(-10px) scale(0.96)', 'none'] }, { spring: SPRINGS.bouncy });
  setTimeout(() => {
    const a = t.animate({ opacity: [1, 0], transform: ['none', 'translateY(-6px)'] }, { duration: 220, easing: 'ease-in', fill: 'forwards' });
    a.onfinish = () => t.remove();
  }, 2200);
}

function modal({ title, body, foot, wide = false, onMount, onClose }) {
  const root = $('#modalRoot');
  const bd = html(`<div class="backdrop"><div class="modal ${wide ? 'wide' : ''}" role="dialog" aria-modal="true" aria-label="${esc(title)}"><div class="modal-head"><h2>${esc(title)}</h2></div><div class="modal-body"></div><div class="modal-foot"></div></div></div>`);
  const m = $('.modal', bd);
  if (typeof body === 'string') $('.modal-body', bd).innerHTML = body;
  else $('.modal-body', bd).appendChild(body);
  if (foot) $('.modal-foot', bd).innerHTML = foot;
  else $('.modal-foot', bd).remove();
  root.appendChild(bd);
  animate(bd, { opacity: [0, 1] }, { spring: SPRINGS.gentle });
  animate(m, { opacity: [0, 1], transform: ['translateY(14px) scale(0.97)', 'none'] }, { spring: SPRINGS.bouncy });
  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    document.removeEventListener('keydown', onKey, true);
    if (onClose) onClose();
    const a = bd.animate({ opacity: [1, 0] }, { duration: 160, easing: 'ease-in', fill: 'forwards' });
    m.animate({ transform: ['none', 'translateY(8px) scale(0.98)'] }, { duration: 160, easing: 'ease-in', fill: 'forwards' });
    a.onfinish = () => bd.remove();
  };
  const onKey = (e) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      close();
    }
  };
  document.addEventListener('keydown', onKey, true);
  bd.addEventListener('pointerdown', (e) => {
    if (e.target === bd) close();
  });
  $$('[data-close]', bd).forEach((b) => b.addEventListener('click', close));
  if (onMount) onMount(m, close);
  const first = $('input, select, textarea, button.primary', m);
  if (first) setTimeout(() => first.focus(), 30);
  return { el: m, close };
}

function buildTray() {
  $('#cats').innerHTML = CATS.map(([id, name]) => `<button role="tab" data-cat="${id}" class="${id === state.cat ? 'on' : ''}">${name}</button>`).join('');
  $$('#cats button').forEach((b) =>
    b.addEventListener('click', () => {
      state.cat = b.dataset.cat;
      $('#pieceSearch').value = '';
      $$('#cats button').forEach((x) => x.classList.toggle('on', x === b));
      renderPieces(true);
      savePrefs();
    })
  );
  $('#pieceSearch').addEventListener('input', () => renderPieces(true));
  renderPieces(false);
}

const thumbs = new Map();
function renderPieces(anim) {
  const q = $('#pieceSearch').value.trim().toLowerCase();
  if (state.cat === 'import' && !q) return renderImportTray(anim);
  const list = PIECES.filter((p) => !p.hidden && (q ? p.name.toLowerCase().includes(q) || (p.desc || '').toLowerCase().includes(q) : p.cat === state.cat));
  const box = $('#pieces');
  box.innerHTML = list.length
    ? list.map((p) => `<button class="piece ${state.brush === p.id ? 'on' : ''}" data-id="${p.id}" title="${esc(p.desc || p.name)}">${thumbs.get(p.id) ? `<img alt="" src="${thumbs.get(p.id)}">` : '<div class="thumb-wait"></div>'}<span>${esc(p.name)}</span>${p.kind === 'smart' ? '<i class="tag">Smart</i>' : ''}</button>`).join('')
    : `<p class="hint" style="grid-column: 1 / -1; padding: 8px 2px">Nothing called "${esc(q)}".</p>`;
  $$('.piece', box).forEach((b, i) => {
    b.addEventListener('click', () => setBrush(state.brush === b.dataset.id ? null : b.dataset.id));
    b.addEventListener('mouseenter', () => updateTrayNote(PIECE[b.dataset.id]));
    b.addEventListener('mouseleave', () => updateTrayNote());
    if (anim) animate(b, { opacity: [0, 1], transform: ['translateY(10px) scale(0.96)', 'none'] }, { spring: SPRINGS.bouncy, delay: i * 22 });
  });
}

function renderImportTray(anim) {
  const box = $('#pieces');
  const inMap = Object.entries(state.map?.assets || {}).map(([ref, asset]) => ({ ref, asset }));
  const seen = new Set(inMap.map((x) => x.ref));
  const list = [...inMap, ...library.filter((x) => !seen.has(x.ref))];
  box.innerHTML = `<button class="import-drop" id="importPick"><svg viewBox="0 0 24 24"><path d="M12 16V4M7 9l5-5 5 5"/><path d="M4 15v4a1 1 0 001 1h14a1 1 0 001-1v-4"/></svg><b>Bring in a file</b><span>PNG, Minecraft build, .vox, a 3D model or a Source .bsp map. You can also just drop it on the map.</span></button><button class="import-find" id="importFind"><svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="6.5"/><path d="M16 16l4.5 4.5"/></svg>Find models online</button>${list
    .map(({ ref, asset }) => `<button class="piece ${state.brush === 'import' && state.importRef === ref ? 'on' : ''}" data-id="import" data-ref="${esc(ref)}" title="${esc(asset.name)}">${asset.thumb ? `<img alt="" src="${asset.thumb}">` : '<div class="thumb-wait"></div>'}<span>${esc(asset.name)}</span><i class="tag">${asset.kind === 'mesh' ? 'Mesh' : assetCount(asset)}</i></button>`)
    .join('')}${list.length ? '' : '<p class="hint import-empty">Nothing imported yet. Pixel art, a Minecraft house, a model off Sketchfab, all of it turns into blocks that show up in game.</p>'}`;
  $('#importPick', box).addEventListener('click', () => $('#importInput').click());
  $('#importFind', box).addEventListener('click', () => searchModal());
  $$('.piece', box).forEach((b, i) => {
    b.addEventListener('click', () => {
      if (state.brush === 'import' && state.importRef === b.dataset.ref) return setBrush(null);
      state.importRef = b.dataset.ref;
      setBrush('import');
    });
    b.addEventListener('mouseenter', () => {
      const a = assetFor(b.dataset.ref);
      if (a) $('#trayNote').textContent = `${a.name}. ${a.kind === 'mesh' ? `${a.tris.toLocaleString()} triangles` : `${assetCount(a)} blocks`}, ${a.size.map((v) => Math.round(v / M)).join(' × ')} m.`;
    });
    b.addEventListener('mouseleave', () => updateTrayNote());
    if (anim) animate(b, { opacity: [0, 1], transform: ['translateY(10px) scale(0.96)', 'none'] }, { spring: SPRINGS.bouncy, delay: i * 22 });
  });
}

function showImports() {
  state.cat = 'import';
  $('#pieceSearch').value = '';
  $$('#cats button').forEach((x) => x.classList.toggle('on', x.dataset.cat === 'import'));
  renderPieces(true);
  savePrefs();
}

function importStats(a) {
  if (a.kind === 'mesh') {
    const dimsM = a.size.map((v) => (v / M >= 100 ? Math.round(v / M) : round2(v / M))).join(' × ');
    return { n: a.sections.length, text: `${a.tris.toLocaleString()} triangles in ${a.sections.length} part${a.sections.length === 1 ? '' : 's'}, ${a.palette.length} colours, ${dimsM} m`, heavy: a.tris * (a.twoSided ? 2 : 1) > 200000 };
  }
  const n = assetCount(a);
  const dims = a.size.map((v) => (v / M >= 100 ? Math.round(v / M) : round2(v / M))).join(' × ');
  return { n, text: `${n.toLocaleString()} blocks in game, ${a.palette.length} colours, ${dims} m`, heavy: n > (a.source === 'level' ? 9000 : 3000) };
}

async function importModal(files, nameHint) {
  let src;
  const t = setTimeout(() => toast('Reading the file'), 400);
  try {
    src = await loadSource(files);
  } catch (e) {
    clearTimeout(t);
    toast(e.message || "Couldn't read that file.", true);
    return;
  }
  clearTimeout(t);
  if (nameHint && /^(scene|model|untitled|[0-9a-f]{20,})$/i.test(src.name)) src.name = nameHint;
  const opt = { ...DEFAULTS[src.kind] };
  if (src.kind === 'model' && src.levelish) Object.assign(opt, { level: true, res: 128, size: 60000, solid: false, quality: 85 });
  const body = html(`<div class="imp"><div class="imp-view"><canvas></canvas><div class="imp-busy" hidden>Working on it</div></div><div class="imp-side"><div class="imp-opts"></div><p class="imp-stat"></p></div></div>`);
  let asset = null;
  let busy = false;
  let again = false;
  let preview = null;
  const opts = $('.imp-opts', body);
  const stat = $('.imp-stat', body);
  const rebuild = () => {
    if (busy) {
      again = true;
      return;
    }
    busy = true;
    $('.imp-busy', body).hidden = false;
    setTimeout(() => {
      try {
        asset = buildAsset(src, opt);
        const st = importStats(asset);
        stat.textContent = st.text + (st.heavy ? (asset.kind === 'mesh' ? '. That is a lot of triangles, it could lag in game. Turn the quality down if it does.' : '. That is a lot of parts, the game takes longer to load it. Lower the detail or colours if it lags.') : '.');
        stat.classList.toggle('warn', st.heavy);
        if (preview) preview.show(asset);
      } catch (e) {
        asset = null;
        stat.textContent = e.message || 'That did not work.';
        stat.classList.add('warn');
        if (preview) preview.show(null);
      }
      $('.imp-busy', body).hidden = true;
      busy = false;
      if (again) {
        again = false;
        rebuild();
      }
    }, 30);
  };
  let timer = null;
  const later = () => {
    clearTimeout(timer);
    timer = setTimeout(rebuild, 140);
  };
  const metres = (label, key, min, max, step) => sliderRow({ label, value: opt[key] / M, min, max, step, unit: 'm', onInput: (v) => {
    opt[key] = v * M;
    later();
  }, onCommit: () => {} });
  const count = (label, key, min, max, step = 1) => sliderRow({ label, value: opt[key], min, max, step, onInput: (v) => {
    opt[key] = Math.round(v);
    later();
  }, onCommit: () => {} });
  const tick = (label, key) => checkRow(label, opt[key], (v) => {
    opt[key] = v;
    later();
  });
  const fill = () => {
    opts.innerHTML = '';
    if (src.kind === 'image') {
      opts.appendChild(row('Make it', chipsEl([['wall', 'Standing'], ['floor', 'Flat'], ['height', 'Terrain']], opt.mode, (v) => {
        opt.mode = v;
        fill();
        later();
      })));
      opts.appendChild(count('Detail', 'res', 8, 160));
      opts.appendChild(metres('Pixel size', 'pixel', 0.5, 20, 0.5));
      if (opt.mode === 'height') opts.appendChild(metres('Tallest', 'height', 5, 400, 1));
      else opts.appendChild(metres('Thickness', 'depth', 0.5, 20, 0.5));
      opts.appendChild(count('Colours', 'colors', 2, 64));
      opts.appendChild(html(`<p class="hint">${opt.mode === 'height' ? 'Brighter pixels go higher. Good for hills out of a grayscale image.' : 'Clear pixels are skipped, so a PNG with a see-through background comes out as just the shape.'}</p>`));
    } else if (src.kind === 'minecraft') {
      opts.appendChild(metres('Block size', 'block', 1, 30, 0.5));
      opts.appendChild(count('Colours', 'colors', 2, 64));
      opts.appendChild(tick('Fill the inside', 'solid'));
      opts.appendChild(tick('Keep water and lava', 'fluids'));
      opts.appendChild(html(`<p class="hint">A Minecraft block is 1 m, but marbles here are ${round2((MARBLE_R * 2) / M)} m across, so 5 m blocks feel about right. Torches, flowers, doors and signs are left out.</p>`));
    } else if (src.kind === 'vox') {
      opts.appendChild(metres('Voxel size', 'block', 0.5, 30, 0.5));
      opts.appendChild(count('Colours', 'colors', 2, 64));
      opts.appendChild(tick('Fill the inside', 'solid'));
    } else {
      const isMap = src.kind === 'bsp';
      if (!isMap)
        opts.appendChild(checkRow('This is a whole map', opt.level, (v) => {
          Object.assign(opt, v ? { level: true, res: 128, size: 60000, solid: false, quality: 85 } : { level: false, res: 48, size: 8000, solid: true, quality: 70 });
          fill();
          later();
        }));
      opts.appendChild(row('Build as', chipsEl([['mesh', 'Real shape'], ['blocks', 'Blocks']], opt.build, (v) => {
        opt.build = v;
        fill();
        later();
      })));
      if (opt.build === 'mesh') {
        const q = sliderRow({ label: 'Quality', value: opt.quality, min: 0, max: 100, step: 1, unit: '%', onInput: (v) => {
          opt.quality = Math.round(v);
          later();
        }, onCommit: () => {} });
        opts.appendChild(q);
      } else opts.appendChild(count('Detail', 'res', isMap ? 32 : 8, isMap || opt.level ? 256 : 128, isMap ? 8 : 1));
      if (isMap)
        opts.appendChild(row('Scale', chipsEl([['1', '1x'], ['4', '4x'], ['8', 'Marble size'], ['14', '14x']], String(opt.scale), (v) => {
          opt.scale = +v;
          later();
        })));
      else opts.appendChild(metres('Size', 'size', 10, opt.level ? 3000 : 1000, 5));
      opts.appendChild(count('Colours', 'colors', 2, 64));
      if (!isMap)
        opts.appendChild(row('Up is', chipsEl([['y', 'Y'], ['z', 'Z']], opt.up, (v) => {
          opt.up = v;
          later();
        })));
      if (opt.build === 'mesh') opts.appendChild(tick('Show both sides', 'twoSided'));
      else opts.appendChild(tick(isMap || opt.level ? 'Fill closed rooms' : 'Fill the inside', 'solid'));
      const tip = opt.build === 'mesh'
        ? `The actual shape goes into the game, triangles and all, with real collision. Quality 100% keeps every triangle, lower merges them so big maps load faster.${isMap ? ' Props are left out.' : ''}`
        : 'Turned into coloured blocks. Lighter on the game and looks like voxel art.';
      const scaleTip = isMap ? ` At 1x the halls are thinner than a marble, Marble size makes it ${Math.round((src.longest * 1.905 * 8) / M)} m across.` : opt.level ? ' Size is the longest side, 600 m makes halls wide enough for marbles.' : '';
      opts.appendChild(html(`<p class="hint">${tip}${scaleTip}</p>`));
    }
  };
  fill();
  modal({
    title: `Import ${src.name}`,
    body,
    wide: true,
    foot: '<button class="btn ghost" data-close>Cancel</button><button class="btn primary" id="impGo">Add to map</button>',
    onMount: (el, close) => {
      preview = importPreview($('canvas', el));
      rebuild();
      $('#impGo', el).addEventListener('click', () => {
        if (!asset) return;
        const ref = uid();
        asset.thumb = preview.thumb();
        if (asset.kind === 'mesh') {
          try {
            const fb = buildAsset(src, { ...opt, build: 'blocks', res: src.kind === 'bsp' || opt.level ? 96 : 40, colors: Math.min(16, opt.colors), solid: src.kind !== 'bsp' && !opt.level });
            asset.fallback = { palette: fb.palette, boxes: fb.boxes };
          } catch {}
        }
        state.map.assets = state.map.assets || {};
        state.map.assets[ref] = asset;
        saveLib(ref, asset);
        scheduleSave();
        close();
        state.importRef = ref;
        showImports();
        setBrush('import');
        toast(`${asset.name} is ready. Click to place it`);
      });
    }
  });
}

function importPreview(cv) {
  const r = new THREE.WebGLRenderer({ canvas: cv, antialias: true, preserveDrawingBuffer: true });
  r.setPixelRatio(Math.min(devicePixelRatio, 2));
  r.outputColorSpace = THREE.SRGBColorSpace;
  r.toneMapping = THREE.ACESFilmicToneMapping;
  const sc2 = new THREE.Scene();
  sc2.background = new THREE.Color('#1f1c38');
  sc2.environment = makeEnvironment(r);
  sc2.add(new THREE.HemisphereLight('#f1edff', '#4a4380', 1.4));
  const dl = new THREE.DirectionalLight('#ffe6cc', 2.2);
  dl.position.set(2, 4, 3);
  sc2.add(dl);
  const cam = new THREE.PerspectiveCamera(35, 1, 10, 1e7);
  const ctl = new OrbitControls(cam, cv);
  ctl.enableDamping = true;
  ctl.autoRotate = true;
  ctl.autoRotateSpeed = 1.2;
  let holder = null;
  let framed = false;
  const size = () => {
    const w = cv.clientWidth || 400;
    const h = cv.clientHeight || 300;
    r.setSize(w, h, false);
    cam.aspect = w / h;
    cam.updateProjectionMatrix();
  };
  const show = (a) => {
    if (holder) sc2.remove(holder);
    holder = null;
    if (!a) return;
    holder = assetMesh(a);
    holder.children.forEach((c) => c.userData.edge && (c.visible = false));
    sc2.add(holder);
    const box = new THREE.Box3().setFromObject(holder);
    const c = box.getCenter(new THREE.Vector3());
    const rad = Math.max(1, box.getSize(new THREE.Vector3()).length() / 2);
    const dir = framed ? cam.position.clone().sub(ctl.target) : new THREE.Vector3(1, 0.75, 1.15);
    framed = true;
    ctl.target.copy(c);
    cam.position.copy(c).add(dir.normalize().multiplyScalar((rad / Math.sin((35 * Math.PI) / 360)) * 1.12));
    cam.near = rad / 100;
    cam.far = rad * 100;
    cam.updateProjectionMatrix();
  };
  const frame = () => {
    if (!cv.isConnected) {
      ctl.dispose();
      r.dispose();
      return;
    }
    size();
    ctl.update();
    r.render(sc2, cam);
    requestAnimationFrame(frame);
  };
  size();
  requestAnimationFrame(frame);
  const thumb = () => {
    const t = document.createElement('canvas');
    t.width = 200;
    t.height = 150;
    const g = t.getContext('2d');
    r.render(sc2, cam);
    const w = cv.width;
    const h = cv.height;
    const s = Math.min(w / 4, h / 3);
    g.drawImage(cv, (w - s * 4) / 2, (h - s * 3) / 2, s * 4, s * 3, 0, 0, 200, 150);
    return t.toDataURL('image/jpeg', 0.82);
  };
  return { show, thumb };
}

function updateTrayNote(hover) {
  const p = hover || (state.brush && PIECE[state.brush]);
  const note = $('#trayNote');
  if (p && p.kind === 'import') {
    const a = assetFor(state.importRef);
    note.textContent = a ? `${a.name}. Click to place, it scales like any other piece.` : 'Imported build.';
  } else if (p) note.textContent = p.kind === 'game' ? `${p.name}. ${p.desc ? p.desc + '. ' : ''}${MODELS[p.id] ? 'Shape and size come straight from the game files.' : `The real one spawns in game. The box here is its size${p.approx ? ', roughly' : ''}.`}` : `${p.name}. ${p.desc || ''}`;
  else note.textContent = 'Floors hurt in Hyperballin, marbles don\'t. Pick a piece, click to place it, drag to paint. Right-drag orbits, middle-drag pans.';
}

function makeThumbs() {
  const tr = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
  tr.setSize(200, 150);
  tr.setPixelRatio(1);
  tr.outputColorSpace = THREE.SRGBColorSpace;
  tr.toneMapping = THREE.ACESFilmicToneMapping;
  const ts = new THREE.Scene();
  ts.environment = makeEnvironment(tr);
  ts.add(new THREE.HemisphereLight('#f1edff', '#4a4380', 1.6));
  const tl = new THREE.DirectionalLight('#ffe6cc', 2.2);
  tl.position.set(2, 4, 3);
  ts.add(tl);
  const tc = new THREE.PerspectiveCamera(35, 4 / 3, 1, 100000);
  const queue = PIECES.filter((p) => !p.hidden).map((p) => p.id);
  const next = () => {
    const batch = queue.splice(0, 4);
    for (const id of batch) {
      const o = newObject(id, [0, 0, 0]);
      if (id === 'marble_line') Object.assign(o.p, { count: 4, color: 'cycle' });
      if (id === 'marble_cloud') Object.assign(o.p, { count: 10, sizeX: 16000, sizeY: 12000, color: 'cycle' });
      if (PIECE[id].kind === 'marbles' && o.p.color === 'random') o.p.color = 'cycle';
      thumbMode = true;
      const v = buildVisual(o);
      thumbMode = false;
      applyBase(o, v);
      v.position.set(0, 0, 0);
      v.traverse((c) => {
        if (c.userData.label) c.visible = false;
      });
      ts.add(v);
      v.updateMatrixWorld(true);
      const box = new THREE.Box3().setFromObject(v);
      const c = box.getCenter(new THREE.Vector3());
      const r = box.getSize(new THREE.Vector3()).length() / 2;
      const dir = new THREE.Vector3(1, 0.8, 1.15).normalize();
      tc.position.copy(c).add(dir.multiplyScalar(r / Math.sin((35 * Math.PI) / 360) * 0.95));
      tc.lookAt(c);
      tr.render(ts, tc);
      thumbs.set(id, tr.domElement.toDataURL('image/png'));
      ts.remove(v);
      const btn = $(`.piece[data-id="${id}"]`);
      if (btn) {
        const wait = $('.thumb-wait', btn);
        if (wait) {
          const img = html(`<img alt="" src="${thumbs.get(id)}">`);
          wait.replaceWith(img);
          animate(img, { opacity: [0, 1] }, { spring: SPRINGS.gentle });
        }
      }
    }
    if (queue.length) setTimeout(next, 16);
    else tr.dispose();
  };
  setTimeout(next, 300);
}

function sec(id, title, inner, { open = true } = {}) {
  const isOpen = state.openSecs[id] ?? open;
  const s = html(`<section class="sec ${isOpen ? '' : 'closed'}" data-sec="${id}"><button class="sec-head" aria-expanded="${isOpen}">${esc(title)}${ICON.chev}</button><div class="sec-body" ${isOpen ? '' : 'style="height:0"'}><div class="sec-inner"></div></div></section>`);
  const body = $('.sec-inner', s);
  if (typeof inner === 'string') body.innerHTML = inner;
  else if (Array.isArray(inner)) inner.forEach((n) => n && body.appendChild(n));
  else if (inner) body.appendChild(inner);
  $('.sec-head', s).addEventListener('click', () => {
    const wrap = $('.sec-body', s);
    const opening = s.classList.contains('closed');
    const h = $('.sec-inner', s).offsetHeight;
    s.classList.toggle('closed', !opening);
    $('.sec-head', s).setAttribute('aria-expanded', opening);
    state.openSecs[id] = opening;
    localStorage.setItem('builderballin:secs', JSON.stringify(state.openSecs));
    const a = animate(wrap, { height: opening ? ['0px', h + 'px'] : [h + 'px', '0px'] }, { spring: opening ? SPRINGS.gentle : SPRINGS.snappy, fill: 'none' });
    wrap.style.height = opening ? '' : '0px';
    if (a && opening) a.onfinish = () => (wrap.style.height = '');
  });
  return s;
}

function numInput({ value, step = 1, axis, unit, min, max, onInput, onCommit, decimals = 2 }) {
  const n = html(`<div class="num">${axis ? `<span class="axis ${axis.toLowerCase()}">${axis}</span>` : '<span class="axis">↔</span>'}<input type="text" inputmode="decimal" value="${fmt(value, decimals)}">${unit ? `<span class="unit">${unit}</span>` : ''}</div>`);
  const input = $('input', n);
  const clamp = (v) => Math.min(max ?? Infinity, Math.max(min ?? -Infinity, v));
  const apply = (v, done) => {
    v = clamp(v);
    input.value = fmt(v, decimals);
    onInput && onInput(v);
    if (done) onCommit && onCommit(v);
  };
  input.addEventListener('change', () => {
    const v = parseExpr(input.value);
    if (Number.isFinite(v)) apply(v, true);
  });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') input.blur();
    if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      e.preventDefault();
      const v = (parseExpr(input.value) || 0) + (e.key === 'ArrowUp' ? 1 : -1) * step * (e.shiftKey ? 10 : 1);
      apply(v, true);
    }
  });
  const handle = $('.axis', n);
  handle.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    handle.setPointerCapture(e.pointerId);
    const start = parseExpr(input.value) || 0;
    const x0 = e.clientX;
    let moved = false;
    const move = (ev) => {
      moved = true;
      const k = ev.shiftKey ? 10 : ev.altKey ? 0.1 : 1;
      apply(Math.round((start + ((ev.clientX - x0) / 2) * step * k) / (step * (ev.altKey ? 0.1 : 1))) * step * (ev.altKey ? 0.1 : 1), false);
    };
    const up = () => {
      handle.removeEventListener('pointermove', move);
      handle.removeEventListener('pointerup', up);
      if (moved) onCommit && onCommit(parseExpr(input.value));
    };
    handle.addEventListener('pointermove', move);
    handle.addEventListener('pointerup', up);
  });
  return n;
}

function fmt(v, d = 2) {
  if (!Number.isFinite(+v)) return '0';
  const r = Math.round(v * 10 ** d) / 10 ** d;
  return String(Object.is(r, -0) ? 0 : r);
}

function parseExpr(s) {
  s = String(s).replace(/,/g, '.').trim();
  if (/^[-+*/(). \d]+$/.test(s)) {
    try {
      const v = Function(`"use strict";return (${s})`)();
      return Number.isFinite(v) ? v : NaN;
    } catch {
      return NaN;
    }
  }
  return parseFloat(s);
}

function row(label, control) {
  const r = html(`<div class="row"><span class="lbl">${esc(label)}</span><div></div></div>`);
  r.lastElementChild.replaceWith(control);
  return r;
}

function vecRow(label, values, { step, unit, axes = ['X', 'Y', 'Z'], onInput, onCommit, decimals }) {
  const v = html('<div class="vec"></div>');
  values.forEach((val, i) => v.appendChild(numInput({ value: val, step, axis: axes[i], decimals, onInput: (x) => onInput(i, x), onCommit: (x) => onCommit(i, x) })));
  const r = row(label, v);
  if (unit) r.firstElementChild.innerHTML = `${esc(label)} <span style="color:var(--ink-3)">${esc(unit)}</span>`;
  return r;
}

function sliderRow({ label, value, min, max, step, onInput, onCommit, unit }) {
  const r = html(`<div class="slider-row"><label>${esc(label)}</label><input type="range" min="${min}" max="${max}" step="${step}" value="${value}"><div></div></div>`);
  const range = $('input', r);
  const setFill = () => range.style.setProperty('--fill', ((range.value - min) / (max - min)) * 100 + '%');
  setFill();
  const num = numInput({ value, step, unit, onInput: (v) => {
    range.value = v;
    setFill();
    onInput(v);
  }, onCommit });
  r.lastElementChild.replaceWith(num);
  range.addEventListener('input', () => {
    setFill();
    $('input', num).value = fmt(+range.value);
    onInput(+range.value);
  });
  range.addEventListener('change', () => onCommit(+range.value));
  return r;
}

function checkRow(label, checked, onChange) {
  const c = html(`<label class="check"><input type="checkbox" ${checked ? 'checked' : ''}><span class="toggle"></span>${esc(label)}</label>`);
  $('input', c).addEventListener('change', (e) => onChange(e.target.checked));
  return c;
}

function selectEl(options, value, onChange) {
  const s = html(`<select class="select">${options.map(([v, l]) => `<option value="${esc(v)}" ${String(v) === String(value) ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select>`);
  s.addEventListener('change', () => onChange(s.value));
  return s;
}

function chipsEl(options, value, onChange) {
  const c = html(`<div class="chips">${options.map(([v, l]) => `<button class="chip ${v === value ? 'on' : ''}" data-v="${esc(v)}">${esc(l)}</button>`).join('')}</div>`);
  $$('.chip', c).forEach((b) =>
    b.addEventListener('click', () => {
      $$('.chip', c).forEach((x) => x.classList.toggle('on', x === b));
      onChange(b.dataset.v);
    })
  );
  return c;
}

function forSel(fn) {
  for (const o of selectedObjs()) fn(o);
}

function refreshVisuals(rebuild) {
  for (const o of selectedObjs()) {
    if (rebuild) rebuildObject(o);
    else applyBase(o, roots.get(o.id));
  }
  refreshPivot();
  drawMotionPath();
  resolvedAnims = null;
}

function liveInspectorTransform() {
  const sel = selectedObjs();
  if (sel.length !== 1) return;
  const r = roots.get(sel[0].id);
  const vals = [...fromThree(r.position), ...rotFromQuat(r.quaternion)];
  const inputs = $$('[data-sec="transform"] .num input');
  vals.forEach((v, i) => inputs[i] && (inputs[i].value = fmt(v)));
}

function renderInspector() {
  const ins = $('#inspector');
  const scroll = ins.scrollTop;
  ins.innerHTML = '';
  const sel = selectedObjs();
  if (!sel.length) renderMapPanel(ins);
  else renderSelPanel(ins, sel);
  ins.scrollTop = scroll;
}

function renderMapPanel(ins) {
  const m = state.map;
  ins.appendChild(html(`<div class="insp-head"><div class="insp-kind">Map</div><h2 class="insp-title-static">${esc(m.meta.name)}</h2></div>`));
  const issues = validate(m);
  const iss = html('<div class="issues"></div>');
  if (!issues.length) iss.appendChild(html(`<div class="issue good"><span class="dot"></span><span>${desk ? 'Ready to play. Press Play in game.' : 'Ready to play. Export it and drop it into Hyperboi.'}</span><span></span></div>`));
  for (const i of issues) {
    const el = html(`<div class="issue ${i.level}"><span class="dot"></span><span>${esc(i.text)}</span><span></span></div>`);
    if (i.fix) {
      const b = html(`<button class="btn line small">Place one</button>`);
      b.addEventListener('click', () => {
        state.cat = i.cat || 'play';
        $$('#cats button').forEach((x) => x.classList.toggle('on', x.dataset.cat === state.cat));
        renderPieces(true);
        setBrush(i.fix);
      });
      el.lastElementChild.replaceWith(b);
    } else if (i.id) {
      const b = html(`<button class="btn line small">Show</button>`);
      b.addEventListener('click', () => {
        select([i.id]);
        frameObjects([obj(i.id)]);
      });
      el.lastElementChild.replaceWith(b);
    }
    iss.appendChild(el);
  }
  ins.appendChild(sec('check', 'Checklist', iss));
  const b = flatten(m);
  const moving = m.objects.filter((o) => o.anim && (o.anim.move || o.anim.spin || o.anim.swing || o.anim.blink)).length;
  ins.appendChild(sec('stats', 'Numbers', html(`<div class="stats"><div class="stat-box"><b>${b.marbles.length}</b><span>Marbles</span></div><div class="stat-box"><b>${b.spawners.length}</b><span>Spawners</span></div><div class="stat-box"><b>${b.parts.length}</b><span>Game parts</span></div><div class="stat-box"><b>${moving}</b><span>Moving</span></div><div class="stat-box"><b>${b.zones.length}</b><span>Zones</span></div><div class="stat-box"><b>${b.checkpoints}</b><span>Checkpoints</span></div></div>`)));
  const wrap = html('<div></div>');
  const search = html('<input class="field" placeholder="Filter pieces" style="margin-bottom:6px">');
  const list = html('<div class="outline"></div>');
  const fill = () => {
    const q = search.value.trim().toLowerCase();
    list.innerHTML = '';
    const items = m.objects.filter((o) => !q || (o.name || PIECE[o.piece].name).toLowerCase().includes(q) || (o.group || '').toLowerCase().includes(q));
    if (!items.length) list.appendChild(html(`<p class="hint">${m.objects.length ? 'No matches.' : 'Empty so far. Place something from the left.'}</p>`));
    for (const o of items.slice(0, 400)) {
      const hidden = state.hiddenIds.has(o.id);
      const pk = PIECE[o.piece];
      const swc = pk.kind === 'zone' ? ZONE_COLORS[pk.zone] : pk.params?.some((x) => x.type === 'gem') ? (GEM[o.p.color] || GEM.coral).surface : o.color;
      const r = html(`<div class="out-row ${hidden ? 'hidden-obj' : ''}" role="button" tabindex="0"><span class="sw ${pk.params?.some((x) => x.type === 'gem') ? 'round' : ''}" style="background:${swc}"></span><span class="nm">${esc(o.name || PIECE[o.piece].name)}</span><span class="gr">${esc(o.group)}</span><button class="eye" title="${hidden ? 'Show in editor' : 'Hide in editor'}">${hidden ? ICON.eyeOff : ICON.eye}</button></div>`);
      r.addEventListener('click', (e) => {
        if (e.target.closest('.eye')) return;
        select([o.id], { toggle: e.shiftKey });
      });
      r.addEventListener('dblclick', () => frameObjects([o]));
      $('.eye', r).addEventListener('click', () => {
        if (hidden) state.hiddenIds.delete(o.id);
        else state.hiddenIds.add(o.id);
        applyBase(o, roots.get(o.id));
        fill();
      });
      list.appendChild(r);
    }
  };
  search.addEventListener('input', fill);
  fill();
  wrap.append(search, list);
  ins.appendChild(sec('outline', 'Everything in the map', wrap));
  ins.appendChild(sec('tips', 'Quick tips', '<p class="hint">Click a piece on the left, then click to place it. Hold and drag to paint a row. Right-drag to orbit, middle-drag to pan. Select something to edit it here, or drag a box around several.</p>', { open: false }));
}

function renderSelPanel(ins, sel) {
  const one = sel.length === 1 ? sel[0] : null;
  const piece = one ? PIECE[one.piece] : null;
  if (one) {
    const head = html(`<div class="insp-head"><div class="insp-kind">${esc(piece.name)}${piece.kind === 'game' ? ', from the game' : ''}</div><input class="insp-title" value="${esc(one.name || piece.name)}" aria-label="Name"></div>`);
    const t = $('input', head);
    t.addEventListener('change', () => {
      one.name = t.value.trim() === piece.name ? '' : t.value.trim();
      commit('Rename');
    });
    ins.appendChild(head);
  } else {
    const kinds = new Set(sel.map((o) => PIECE[o.piece].name));
    ins.appendChild(html(`<div class="insp-head"><div class="insp-kind">${kinds.size === 1 ? [...kinds][0] : 'Mixed pieces'}</div><h2 class="insp-title-static">${sel.length} selected</h2></div>`));
  }

  const tf = [];
  if (one) {
    tf.push(vecRow('Position', one.pos.map((v) => v / M), { step: state.snap ? state.grid / 4 / M : 1, unit: 'm', decimals: 2, onInput: (i, v) => {
      one.pos[i] = v * M;
      refreshVisuals(false);
    }, onCommit: () => commit('Move') }));
    tf.push(vecRow('Rotation', one.rot, { step: state.angle || 1, unit: '°', axes: ['P', 'Y', 'R'], onInput: (i, v) => {
      one.rot[i] = v;
      refreshVisuals(false);
    }, onCommit: () => commit('Rotate') }));
    if (fixedScale(piece)) {
      if (piece.kind === 'marble' || piece.kind === 'marbles') tf.push(html(`<p class="hint">Marbles are always ${round2((MARBLE_R * 2) / M)} m across, same as in the game. Only the colour changes.</p>`));
    } else if (piece.kind === 'smart' || piece.kind === 'game' || piece.kind === 'import') {
      tf.push(vecRow('Scale', one.scale, { step: 0.05, onInput: (i, v) => {
        one.scale[i] = v;
        refreshVisuals(false);
        if (piece.kind === 'game' && typeof updateRealSizeRef === 'function') updateRealSizeRef();
      }, onCommit: () => commit('Scale') }));
      if (piece.kind === 'game') {
        const real = html('<p class="hint"></p>');
        const updateRealSize = () => (real.textContent = `Real size in game: ${piece.box.e.map((e, i) => round2((e * 2 * Math.abs(one.scale[i])) / M)).join(' × ')} m${piece.approx ? ' (roughly)' : ''}.`);
        updateRealSize();
        tf.push(real);
        var updateRealSizeRef = updateRealSize;
      }
      if (piece.kind === 'import') {
        const a = assetFor(one.p.ref);
        if (a) tf.push(html(`<p class="hint">${a.kind === 'mesh' ? `${a.tris.toLocaleString()} triangles in ${a.sections.length} part${a.sections.length === 1 ? '' : 's'}` : `${assetCount(a).toLocaleString()} blocks`} in game. ${a.size.map((v, i) => Math.round((v * Math.abs(one.scale[i])) / M)).join(' × ')} m at this scale.</p>`));
      }
    } else {
      tf.push(vecRow('Size', one.scale.map((s) => (s * 100) / M), { step: state.snap ? state.grid / 4 / M : 1, unit: 'm', axes: ['L', 'W', 'H'], onInput: (i, v) => {
        one.scale[i] = (v * M) / 100;
        refreshVisuals(false);
      }, onCommit: () => commit('Resize') }));
    }
  } else {
    const nudge = html('<div class="vec"></div>');
    ['X', 'Y', 'Z'].forEach((a, i) => {
      let last = 0;
      nudge.appendChild(numInput({ value: 0, axis: a, step: state.grid / M, unit: 'm', onInput: (v) => {
        const d = (v - last) * M;
        last = v;
        forSel((o) => (o.pos[i] += d));
        refreshVisuals(false);
      }, onCommit: () => commit('Move') }));
    });
    tf.push(row('Shift by', nudge));
    tf.push(html('<p class="hint">Drag the letters to slide everything together, or switch to Move and use the arrows in the scene.</p>'));
  }
  ins.appendChild(sec('transform', 'Placement', tf));

  if (one && (piece.params || []).length) {
    const opts = [];
    for (const prm of piece.params) {
      const val = one.p[prm.key] ?? prm.def;
      if (prm.type === 'bool') opts.push(checkRow(prm.label, val, (v) => {
        one.p[prm.key] = v;
        commit('Option');
      }));
      else if (prm.type === 'gem') {
        const gw = html(`<div class="gems-pick">${[['random', 'Random'], ['cycle', 'Rainbow'], ...GEMS.map((g) => [g.id, g.name])].map(([id, name]) => `<button class="gem-chip ${val === id ? 'on' : ''}" data-g="${id}" title="${esc(name)}${id === 'random' ? ', with the same odds the game uses' : ''}"><i class="gem-dot ${id}" style="${GEM[id] ? `--c:${GEM[id].surface};--d:${GEM[id].deep}` : ''}"></i><span>${esc(name)}</span></button>`).join('')}</div>`);
        $$('.gem-chip', gw).forEach((b) =>
          b.addEventListener('click', () => {
            one.p[prm.key] = b.dataset.g;
            $$('.gem-chip', gw).forEach((x) => x.classList.toggle('on', x === b));
            rebuildObject(one);
            commit('Colour');
          })
        );
        opts.push(row(prm.label, gw));
      } else if (prm.type === 'choice') {
        const hint = html(`<p class="hint">${esc(prm.key === 'mode' ? MODE_INFO[val] || '' : '')}</p>`);
        opts.push(row(prm.label, chipsEl(prm.options, val, (v) => {
          one.p[prm.key] = v;
          if (prm.key === 'mode') hint.textContent = MODE_INFO[v] || '';
          rebuildObject(one);
          commit('Option');
          updateStats();
        })));
        if (prm.key === 'mode') opts.push(hint);
      } else if (prm.type === 'text') {
        const f = html(`<input class="field" value="${esc(val)}">`);
        f.addEventListener('input', () => {
          one.p[prm.key] = f.value;
          if (piece.kind === 'decor') rebuildObject(one);
        });
        f.addEventListener('change', () => {
          one.p[prm.key] = f.value;
          rebuildObject(one);
          commit('Option');
          if (piece.zone === 'trigger') renderInspector();
        });
        opts.push(row(prm.label, f));
      } else
        opts.push(sliderRow({ label: prm.label, value: (prm.pairMin || prm.pairMax ? one.p[prm.key] ?? legacyVal(one, prm) : val) / (prm.div || 1), min: prm.min / (prm.div || 1), max: prm.max / (prm.div || 1), step: prm.step / (prm.div || 1), unit: prm.unit || '', onInput: (v) => {
          one.p[prm.key] = v * (prm.div || 1);
          if (prm.pairMax && (one.p[prm.pairMax] ?? legacyVal(one, PIECE[one.piece].params.find((x) => x.key === prm.pairMax))) < one.p[prm.key]) one.p[prm.pairMax] = one.p[prm.key];
          if (prm.pairMin && (one.p[prm.pairMin] ?? legacyVal(one, PIECE[one.piece].params.find((x) => x.key === prm.pairMin))) > one.p[prm.key]) one.p[prm.pairMin] = one.p[prm.key];
          rebuildObject(one);
          refreshPivot();
        }, onCommit: () => {
          commit('Option');
          updateStats();
          if (prm.pairMin || prm.pairMax) renderInspector();
        } }));
    }
    if (piece.zone === 'teleport') {
      const b = html('<button class="btn line small">Select the exit</button>');
      b.addEventListener('click', () => obj(one.p.exit) && select([one.p.exit]));
      opts.push(b);
    }
    if (piece.marker === 'exit') {
      const b = html('<button class="btn line small">Select its teleporter</button>');
      b.addEventListener('click', () => obj(one.p.link) && select([one.p.link]));
      opts.push(b);
    }
    if (prm0hint(piece)) opts.push(html(`<p class="hint">${esc(prm0hint(piece))}</p>`));
    ins.appendChild(sec('opts', piece.kind === 'smart' ? 'Shape' : piece.kind === 'spawner' || piece.kind.startsWith('marble') ? 'Marbles' : 'Settings', opts));
  } else if (one && piece.marker === 'exit') {
    const b = html('<button class="btn line small">Select its teleporter</button>');
    b.addEventListener('click', () => obj(one.p.link) && select([one.p.link]));
    ins.appendChild(sec('opts', 'Settings', b));
  }

  const showLook = sel.some((o) => ['solid', 'smart', 'game', 'decor'].includes(PIECE[o.piece].kind) || o.piece === 'exit');
  if (showLook) {
    const look = [];
    const first = sel[0];
    if (sel.some((o) => PIECE[o.piece].kind !== 'game')) {
      const sw = html(`<div class="swatches">${GLAZES.map(([n, c]) => `<button class="swatch ${first.color === c ? 'on' : ''}" title="${n}" style="background:${c}" data-c="${c}"></button>`).join('')}<label class="swatch custom" title="Any colour"><input type="color" value="${first.color && first.color.length === 7 ? first.color : '#1c3faa'}"></label></div>`);
      const setColor = (c, done) => {
        forSel((o) => (o.color = c));
        refreshVisuals(true);
        $$('.swatch', sw).forEach((s) => s.classList.toggle('on', s.dataset.c === c));
        if (done) commit('Colour');
      };
      $$('.swatch[data-c]', sw).forEach((s) => s.addEventListener('click', () => setColor(s.dataset.c, true)));
      const ci = $('input[type=color]', sw);
      ci.addEventListener('input', () => setColor(ci.value, false));
      ci.addEventListener('change', () => setColor(ci.value, true));
      look.push(row('Colour', sw));
    }
    if (sel.some((o) => ['solid', 'smart'].includes(PIECE[o.piece].kind) && !PIECE[o.piece].mat)) {
      look.push(checkRow('Wooden, like the game\'s tracks', !!first.look.wood, (v) => {
        forSel((o) => (o.look.wood = v));
        refreshVisuals(true);
        commit('Wood');
      }));
    }
    if (sel.some((o) => ['solid', 'smart', 'game'].includes(PIECE[o.piece].kind))) {
      look.push(checkRow('Ice (slippery)', first.look.ice, (v) => {
        forSel((o) => (o.look.ice = v));
        refreshVisuals(true);
        commit('Ice');
      }));
      look.push(checkRow('Visible in game', first.look.visible, (v) => {
        forSel((o) => (o.look.visible = v));
        refreshVisuals(true);
        commit('Visibility');
      }));
      look.push(checkRow('Solid (you can stand on it)', first.look.collide, (v) => {
        forSel((o) => (o.look.collide = v));
        commit('Collision');
      }));
    }
    ins.appendChild(sec('look', 'Look', look));
  }

  ins.appendChild(sec('motion', 'Motion', motionPanel(sel)));

  const grp = [];
  const groups = [...new Set(state.map.objects.map((o) => o.group).filter(Boolean))];
  const gIn = html(`<input class="field" list="groupList" placeholder="No group" value="${esc(sel.every((o) => o.group === sel[0].group) ? sel[0].group : '')}">`);
  const dl = html(`<datalist id="groupList">${groups.map((g) => `<option value="${esc(g)}">`).join('')}</datalist>`);
  gIn.addEventListener('change', () => {
    forSel((o) => (o.group = gIn.value.trim()));
    commit('Group');
    resolvedAnims = null;
  });
  grp.push(row('Group', gIn), dl, html('<p class="hint">Pieces in a group get selected together. Hold Alt when clicking to grab just one. Motion can turn around the group\'s middle.</p>'));
  ins.appendChild(sec('group', 'Group', grp, { open: false }));

  const acts = html(`<div class="actions">
    <button class="btn line small" data-a="dup">Duplicate</button>
    <button class="btn line small" data-a="array">Make copies…</button>
    <button class="btn line small" data-a="mirrorX">Mirror front to back</button>
    <button class="btn line small" data-a="mirrorY">Mirror side to side</button>
    <button class="btn line small" data-a="floor">Sit on the grid</button>
    <button class="btn line small" data-a="frame">Zoom to it</button>
    <button class="btn danger small" data-a="del" style="grid-column: 1 / -1">Delete</button>
  </div>`);
  $$('[data-a]', acts).forEach((b) => b.addEventListener('click', () => action(b.dataset.a)));
  ins.appendChild(sec('actions', 'Actions', acts));
}

function motionPanel(sel) {
  const first = sel[0];
  const a = first.anim || null;
  const box = html('<div style="display:grid;gap:8px"></div>');
  const ensure = () => forSel((o) => (o.anim = o.anim || blankAnim()));
  const set = (fn, rebuildUI = false) => {
    ensure();
    forSel(fn);
    resolvedAnims = null;
    drawMotionPath();
    if (rebuildUI) renderInspector();
  };
  const done = () => commit('Motion');
  const kinds = [
    ['move', 'Move along a path', MOVE_DEFAULT],
    ['spin', 'Spin', SPIN_DEFAULT],
    ['swing', 'Swing back and forth', SWING_DEFAULT],
    ['blink', 'Appear and disappear', BLINK_DEFAULT]
  ];
  const axisOpts = [['world-up', 'Straight up'], ['object-up', 'Its own up'], ['object-forward', 'Its own forward'], ['object-side', 'Its own side'], ['world-forward', 'World X'], ['world-side', 'World Y']];
  const any = a && kinds.some(([k]) => a[k]);
  for (const [k, label] of kinds) {
    if (!a || !a[k]) continue;
    const card = html(`<div class="behavior"><div class="behavior-head"><span>${label}</span><button title="Remove" aria-label="Remove">${ICON.x}</button></div></div>`);
    $('.behavior-head button', card).addEventListener('click', () => {
      set((o) => o.anim && (o.anim[k] = null), true);
      done();
    });
    const v = a[k];
    if (k === 'move') {
      v.points.forEach((pt, pi) => {
        const pr = html(`<div class="point-row"><span class="idx">${pi + 1}</span><div class="vec"></div><button title="Remove point">${ICON.x}</button></div>`);
        pt.forEach((c, ci) =>
          $('.vec', pr).appendChild(numInput({ value: c / M, axis: 'XYZ'[ci], step: state.grid / 2 / M, onInput: (x) => set((o) => o.anim.move && o.anim.move.points[pi] && (o.anim.move.points[pi][ci] = x * M)), onCommit: done }))
        );
        $('button', pr).addEventListener('click', () => {
          if (v.points.length <= 1) return;
          set((o) => o.anim.move && o.anim.move.points.splice(pi, 1), true);
          done();
        });
        card.appendChild(pr);
      });
      const addPt = html('<button class="btn line small">Add a stop</button>');
      addPt.addEventListener('click', () => {
        set((o) => {
          if (!o.anim.move) return;
          const lastPt = o.anim.move.points[o.anim.move.points.length - 1] || [0, 0, 0];
          o.anim.move.points.push([lastPt[0] + 10000, lastPt[1], lastPt[2]]);
        }, true);
        done();
      });
      card.appendChild(addPt);
      card.appendChild(html('<p class="hint">Stops are offsets from where the piece sits, in metres.</p>'));
      card.appendChild(sliderRow({ label: 'Trip time', value: v.duration, min: 0.2, max: 120, step: 0.1, unit: 's', onInput: (x) => set((o) => o.anim.move && (o.anim.move.duration = x)), onCommit: done }));
      card.appendChild(row('Repeat', chipsEl([['pingpong', 'Back and forth'], ['loop', 'Loop'], ['once', 'Once']], v.mode, (x) => {
        set((o) => o.anim.move && (o.anim.move.mode = x));
        done();
      })));
      card.appendChild(row('Feel', chipsEl([['smooth', 'Smooth'], ['linear', 'Steady']], v.ease, (x) => {
        set((o) => o.anim.move && (o.anim.move.ease = x));
        done();
      })));
      card.appendChild(sliderRow({ label: 'Wait first', value: v.delay, min: 0, max: 20, step: 0.1, unit: 's', onInput: (x) => set((o) => o.anim.move && (o.anim.move.delay = x)), onCommit: done }));
    }
    if (k === 'spin') {
      card.appendChild(row('Around', selectEl(axisOpts, v.axis, (x) => {
        set((o) => o.anim.spin && (o.anim.spin.axis = x));
        done();
      })));
      card.appendChild(sliderRow({ label: 'Speed', value: v.speed, min: -720, max: 720, step: 5, unit: '°/s', onInput: (x) => set((o) => o.anim.spin && (o.anim.spin.speed = x)), onCommit: done }));
    }
    if (k === 'swing') {
      card.appendChild(row('Around', selectEl(axisOpts, v.axis, (x) => {
        set((o) => o.anim.swing && (o.anim.swing.axis = x));
        done();
      })));
      card.appendChild(sliderRow({ label: 'Angle', value: v.angle, min: 1, max: 180, step: 1, unit: '°', onInput: (x) => set((o) => o.anim.swing && (o.anim.swing.angle = x)), onCommit: done }));
      card.appendChild(sliderRow({ label: 'One swing', value: v.period, min: 0.2, max: 20, step: 0.1, unit: 's', onInput: (x) => set((o) => o.anim.swing && (o.anim.swing.period = x)), onCommit: done }));
    }
    if (k === 'blink') {
      card.appendChild(sliderRow({ label: 'Shown for', value: v.on, min: 0.1, max: 20, step: 0.1, unit: 's', onInput: (x) => set((o) => o.anim.blink && (o.anim.blink.on = x)), onCommit: done }));
      card.appendChild(sliderRow({ label: 'Gone for', value: v.off, min: 0, max: 20, step: 0.1, unit: 's', onInput: (x) => set((o) => o.anim.blink && (o.anim.blink.off = x)), onCommit: done }));
      card.appendChild(sliderRow({ label: 'Offset', value: v.offset, min: 0, max: 20, step: 0.1, unit: 's', onInput: (x) => set((o) => o.anim.blink && (o.anim.blink.offset = x)), onCommit: done }));
    }
    box.appendChild(card);
  }
  const addRow = html('<div class="chips"></div>');
  for (const [k, label, def] of kinds) {
    if (a && a[k]) continue;
    const b = html(`<button class="chip">+ ${label.split(' ')[0] === 'Appear' ? 'Blink' : label.split(' ')[0]}</button>`);
    b.addEventListener('click', () => {
      set((o) => (o.anim[k] = def()), true);
      done();
    });
    addRow.appendChild(b);
  }
  if (addRow.children.length) box.appendChild(addRow);
  if (any) {
    const channels = [...new Set(state.map.objects.filter((o) => o.piece === 'trigger').map((o) => o.p.channel || 'A'))];
    box.appendChild(row('Starts', chipsEl([['always', 'Right away'], ['trigger', 'On a trigger']], a.start, (x) => {
      set((o) => (o.anim.start = x), true);
      done();
    })));
    if (a.start === 'trigger') {
      const ch = html(`<input class="field" list="chanList" value="${esc(a.channel || 'A')}">`);
      ch.addEventListener('change', () => {
        set((o) => (o.anim.channel = ch.value.trim() || 'A'));
        done();
      });
      box.appendChild(row('Channel', ch));
      box.appendChild(html(`<datalist id="chanList">${channels.map((c) => `<option value="${esc(c)}">`).join('')}</datalist>`));
      box.appendChild(html(`<p class="hint">${channels.length ? `Triggers in this map send: ${channels.map(esc).join(', ')}.` : 'Place a Trigger zone from Gameplay and give it the same channel.'}</p>`));
    }
    if (a.spin || a.swing) box.appendChild(row('Turn around', chipsEl([['self', 'Its own middle'], ['group', 'Group middle']], a.pivot, (x) => {
      set((o) => (o.anim.pivot = x));
      done();
    })));
    const prev = html('<button class="btn line small">Preview motion</button>');
    prev.addEventListener('click', () => {
      setTime(0);
      togglePreview();
    });
    box.appendChild(prev);
  } else {
    box.prepend(html('<p class="hint">Make it move, spin, swing or blink. Works on anything, zones too.</p>'));
  }
  return box;
}

function legacyVal(one, prm) {
  const old = one.p.push ?? one.p.speed;
  if (old === undefined) return prm.def;
  return prm.key.endsWith('Min') && one.piece === 'spawner' ? old * 0.35 : old;
}

function prm0hint(piece) {
  if (piece.kind === 'spawner') return 'Works like the spawner in every stage: drops a marble every few moments and flings it forward. Give it motion to make it run ahead of you. Press play at the bottom to watch it.';
  if (piece.marker === 'spawn') return 'Like the game, a fresh marble appears under you here every time you start or respawn, already moving.';
  return '';
}

function action(a) {
  const sel = selectedObjs();
  if (!sel.length) return;
  if (a === 'del') {
    const ids = new Set(sel.map((o) => o.id));
    for (const o of sel) {
      if (o.piece === 'teleport' && o.p.exit) ids.add(o.p.exit);
      if (o.piece === 'exit' && o.p.link) {
        const tp = obj(o.p.link);
        if (tp) tp.p.exit = null;
      }
    }
    state.map.objects = state.map.objects.filter((o) => !ids.has(o.id));
    for (const id of ids) {
      const r = roots.get(id);
      if (r) {
        roots.delete(id);
        shrinkOut(r);
      }
    }
    state.selected = new Set();
    select([]);
    commit('Delete');
    toast(ids.size > 1 ? `Deleted ${ids.size} pieces` : 'Deleted');
  }
  if (a === 'dup') duplicate([state.grid, state.grid, 0]);
  if (a === 'array') arrayModal();
  if (a === 'mirrorX' || a === 'mirrorY') {
    const i = a === 'mirrorX' ? 0 : 1;
    const c = sel.reduce((s, o) => s + o.pos[i], 0) / sel.length;
    for (const o of sel) {
      o.pos[i] = 2 * c - o.pos[i];
      if (i === 1) {
        o.rot[1] = -o.rot[1];
        o.rot[2] = -o.rot[2];
      } else {
        o.rot[1] = 180 - o.rot[1];
        o.rot[2] = -o.rot[2];
      }
      if (o.anim && o.anim.move) o.anim.move.points.forEach((p) => (p[i] = -p[i]));
      if (o.p && typeof o.p.bank === 'number') o.p.bank = -o.p.bank;
    }
    refreshVisuals(true);
    commit('Mirror');
    renderInspector();
  }
  if (a === 'floor') {
    for (const o of sel) {
      const r = roots.get(o.id);
      r.updateMatrixWorld(true);
      const b = new THREE.Box3().setFromObject(r);
      o.pos[2] = round2(o.pos[2] - b.min.y);
      applyBase(o, r);
    }
    refreshPivot();
    commit('Drop');
    renderInspector();
  }
  if (a === 'frame') frameObjects(sel);
}

function shrinkOut(root) {
  const s0 = root.scale.clone();
  const sp = new Spring(1, SPRINGS.snappy);
  sp.target = 0;
  const tick = () => {
    const v = sp.step(1 / 60);
    root.scale.copy(s0).multiplyScalar(Math.max(0.0001, v));
    if (v > 0.02 && !sp.done) requestAnimationFrame(tick);
    else world.remove(root);
  };
  tick();
}

function cloneObjs(list, offset) {
  const idMap = new Map();
  const groupMap = new Map();
  const out = list.map((o) => {
    const c = JSON.parse(JSON.stringify(o));
    c.id = uid();
    idMap.set(o.id, c.id);
    c.pos = add(c.pos, offset);
    if (c.group) {
      if (!groupMap.has(c.group)) groupMap.set(c.group, uniqueGroup(c.group));
      c.group = groupMap.get(c.group);
    }
    return c;
  });
  for (const c of out) {
    if (c.piece === 'teleport' && c.p.exit) c.p.exit = idMap.get(c.p.exit) || null;
    if (c.piece === 'exit' && c.p.link) c.p.link = idMap.get(c.p.link) || null;
    if (c.piece === 'spawn') c.piece = null;
  }
  return out.filter((c) => c.piece);
}

function uniqueGroup(base) {
  const names = new Set(state.map.objects.map((o) => o.group));
  const stem = base.replace(/ \d+$/, '');
  let i = 2;
  while (names.has(`${stem} ${i}`)) i++;
  return `${stem} ${i}`;
}

function duplicate(offset) {
  const copies = cloneObjs(selectedObjs(), offset);
  if (!copies.length) return toast("There can only be one spawn, so it wasn't copied.", true);
  state.map.objects.push(...copies);
  copies.forEach((c, i) => bounceIn(rebuildObject(c), i * 18));
  select(copies.map((c) => c.id));
  commit('Duplicate');
}

function arrayModal() {
  const body = html(`<div style="display:grid;gap:12px">
    <p class="hint" style="margin-top:-6px">Each copy is shifted, turned and resized a bit more than the last one. Great for staircases, spirals and rows of obstacles.</p>
    <div class="form-row"><label>How many copies</label><input class="field" id="arCount" type="number" min="1" max="200" value="5"></div>
    <div class="form-row"><label>Shift each copy (metres)</label><div class="vec"><input class="field" id="arX" value="${(state.grid * 4) / M}"><input class="field" id="arY" value="0"><input class="field" id="arZ" value="0"></div></div>
    <div class="form-row"><label>Turn each copy (degrees around up)</label><input class="field" id="arYaw" value="0"></div>
    <div class="form-row"><label>Resize each copy (1 keeps the size)</label><input class="field" id="arScale" value="1"></div>
  </div>`);
  modal({
    title: 'Make copies',
    body,
    foot: '<button class="btn ghost" data-close>Cancel</button><button class="btn primary" id="arGo">Make them</button>',
    onMount: (m, close) => {
      $('#arGo', m).addEventListener('click', () => {
        const n = Math.min(200, Math.max(1, parseInt($('#arCount', m).value) || 1));
        const off = ['#arX', '#arY', '#arZ'].map((s) => (parseExpr($(s, m).value) || 0) * M);
        const yaw = parseExpr($('#arYaw', m).value) || 0;
        const sc = parseExpr($('#arScale', m).value) || 1;
        const src = selectedObjs();
        const c0 = src.reduce((s, o) => add(s, o.pos), [0, 0, 0]).map((v) => v / src.length);
        const made = [];
        for (let i = 1; i <= n; i++) {
          const copies = cloneObjs(src, [0, 0, 0]);
          const ang = (yaw * i * Math.PI) / 180;
          for (const c of copies) {
            const rel = [c.pos[0] - c0[0], c.pos[1] - c0[1], c.pos[2] - c0[2]];
            const rx = rel[0] * Math.cos(ang) - rel[1] * Math.sin(ang);
            const ry = rel[0] * Math.sin(ang) + rel[1] * Math.cos(ang);
            c.pos = [round2(c0[0] + rx + off[0] * i), round2(c0[1] + ry + off[1] * i), round2(c0[2] + rel[2] + off[2] * i)];
            c.rot[1] = round2(c.rot[1] + yaw * i);
            const f = Math.pow(sc, i);
            if (!fixedScale(PIECE[c.piece])) c.scale = c.scale.map((s) => round2(s * f * 1000) / 1000);
          }
          made.push(...copies);
        }
        state.map.objects.push(...made);
        made.forEach((c, i) => bounceIn(rebuildObject(c), Math.min(900, i * 30), 120));
        select(made.map((c) => c.id));
        commit('Array');
        close();
        toast(`Made ${made.length} copies`);
      });
    }
  });
}

function settingsModal() {
  const m = state.map;
  const g = m.meta.gems;
  const gemColors = { diamond: '#bdebff', emerald: '#3fd39a', gold: '#ffc83a', steel: '#a9b4c8', rock: '#8a7b6b' };
  const body = html(`<div style="display:grid;gap:12px">
    <div class="form-row"><label>Name</label><input class="field" id="sName" value="${esc(m.meta.name)}"></div>
    <div class="form-row"><label>Made by</label><input class="field" id="sAuthor" value="${esc(m.meta.author)}" placeholder="Your name"></div>
    <div class="form-row"><label>Description</label><textarea class="field" id="sDesc" placeholder="What makes this map fun">${esc(m.meta.description)}</textarea></div>
    <div class="form-row"><label>Difficulty</label><div id="sDiff"></div></div>
    <div class="form-row"><label>Gem times in seconds</label><div class="gems">${GEM_NAMES.map((n) => `<label class="gem-in"><span><i style="background:${gemColors[n]}"></i>${n[0].toUpperCase() + n.slice(1)}</span><input class="field" data-gem="${n}" value="${g[n] || ''}" placeholder="None"></label>`).join('')}</div><p class="hint">Beat a time to earn that gem. Leave blank to skip it.</p></div>
    <div class="form-row"><label>Rules</label><div style="display:grid;gap:8px" id="sRules"></div></div>
  </div>`);
  const rules = $('#sRules', body);
  const r = { ...m.rules };
  rules.appendChild(sliderRow({ label: 'Gravity', value: r.gravity, min: -1, max: 4, step: 0.05, onInput: (v) => (r.gravity = v), onCommit: () => {} }));
  rules.appendChild(sliderRow({ label: 'Run speed', value: r.speed, min: 0.25, max: 4, step: 0.05, onInput: (v) => (r.speed = v), onCommit: () => {} }));
  rules.appendChild(sliderRow({ label: 'Jump height', value: r.jump, min: 0.25, max: 5, step: 0.05, onInput: (v) => (r.jump = v), onCommit: () => {} }));
  rules.appendChild(sliderRow({ label: 'Fall limit', value: r.killHeight / M, min: -3000, max: 0, step: 10, unit: 'm', onInput: (v) => (r.killHeight = v * M), onCommit: () => {} }));
  rules.appendChild(sliderRow({ label: 'Time limit', value: r.timeLimit, min: 0, max: 900, step: 5, unit: 's', onInput: (v) => (r.timeLimit = v), onCommit: () => {} }));
  rules.appendChild(checkRow('Must touch every checkpoint before the finish counts', r.needCheckpoints, (v) => (r.needCheckpoints = v)));
  let diff = m.meta.difficulty;
  $('#sDiff', body).appendChild(chipsEl(DIFFICULTIES.map((d) => [d, d]), diff, (v) => (diff = v)));
  modal({
    title: 'Map settings',
    body,
    foot: '<button class="btn ghost" data-close>Cancel</button><button class="btn primary" id="sSave">Save settings</button>',
    onMount: (el, close) => {
      $('#sSave', el).addEventListener('click', () => {
        m.meta.name = $('#sName', el).value.trim() || 'Untitled map';
        m.meta.author = $('#sAuthor', el).value.trim();
        m.meta.description = $('#sDesc', el).value.trim();
        m.meta.difficulty = diff;
        $$('[data-gem]', el).forEach((i) => (m.meta.gems[i.dataset.gem] = parseFloat(i.value) || 0));
        m.rules = r;
        $('#mapName').value = m.meta.name;
        commit('Settings');
        renderInspector();
        close();
        toast('Settings saved');
      });
    }
  });
}

function slug(s) {
  return (s || 'map').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'map';
}

function exportModal() {
  const issues = validate(state.map);
  const bad = issues.filter((i) => i.level === 'bad');
  const body = html(`<div style="display:grid;gap:12px">
    ${bad.length ? `<div class="issues">${bad.map((i) => `<div class="issue bad"><span class="dot"></span><span>${esc(i.text)}</span><span></span></div>`).join('')}</div><p class="hint">You can still export it, but the game needs these to run the map properly.</p>` : '<div class="issue good"><span class="dot"></span><span>Looks good. Everything the game needs is there.</span><span></span></div>'}
    <div><b>To play it</b>
    <ol class="steps">
      <li>Download the map file below.</li>
      <li>Open Hyperboi, go to Maps and drop the file in.</li>
      <li>Press Play next to it, or pick it from Custom maps in the game's Options menu.</li>
    </ol></div>
  </div>`);
  modal({
    title: `Export "${state.map.meta.name}"`,
    body,
    foot: '<button class="btn ghost" id="exCopy">Copy as text</button><button class="btn primary" id="exGo">Download .hbmap</button>',
    onMount: (el, close) => {
      $('#exGo', el).addEventListener('click', () => {
        ensureFallbacks(state.map);
        const blob = new Blob([exportMap(state.map)], { type: 'application/json' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `${slug(state.map.meta.name)}.hbmap`;
        a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 2000);
        close();
        toast('Map downloaded');
      });
      $('#exCopy', el).addEventListener('click', async () => {
        try {
          await navigator.clipboard.writeText(exportMap(state.map));
          toast('Copied');
        } catch {
          toast("Couldn't copy. Use Download instead.", true);
        }
      });
    }
  });
}

function helpModal() {
  const keys = [
    ['Place the chosen piece', 'Click'],
    ['Paint a row', 'Click and drag'],
    ['Change placing height', 'Alt + scroll, [ ]'],
    ['Watch spawners and motion', 'Space'],
    ['Stop placing', 'Esc'],
    ['Orbit', 'Right drag'],
    ['Pan', 'Middle drag'],
    ['Zoom', 'Scroll'],
    ['Select several', 'Shift + click, drag a box'],
    ['Grab one from a group', 'Alt + click'],
    ['Select tool', 'V'],
    ['Move', 'W'],
    ['Rotate', 'E'],
    ['Scale', 'R'],
    ['Nudge', 'Arrows, Page Up / Down'],
    ['Duplicate', 'Ctrl + D'],
    ['Copy / paste', 'Ctrl + C / V'],
    ['Delete', 'Delete'],
    ['Group', 'Ctrl + G'],
    ['Undo / redo', 'Ctrl + Z / Ctrl + Shift + Z'],
    ['Zoom to selection', 'F'],
    [desk ? 'Save' : 'Export', 'Ctrl + S'],
    ...(desk ? [['Save as', 'Ctrl + Shift + S']] : []),
    ['Open a map', 'Ctrl + O'],
    ['Home', 'Ctrl + N'],
    ['Find models online', 'Ctrl + Shift + F'],
    ['Select everything', 'Ctrl + A'],
    ['Snap on or off', 'Hold Ctrl while dragging']
  ];
  modal({ title: 'Shortcuts', wide: true, body: `<div class="keys">${keys.map(([a, k]) => `<div class="key-row"><span>${a}</span><span>${k.split(/( \/ | \+ |, )/).map((p) => (/^( \/ | \+ |, )$/.test(p) ? p : `<kbd>${esc(p)}</kbd>`)).join('')}</span></div>`).join('')}</div>`, foot: '<button class="btn primary" data-close>Got it</button>' });
}

function openFile(file) {
  state.filePath = null;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      loadMap(importMap(reader.result), { intro: true });
      toast(`Opened ${state.map.meta.name}`);
    } catch (e) {
      toast(e.message || "Couldn't read that file.", true);
    }
  };
  reader.readAsText(file);
}

function setTool(t) {
  state.tool = t;
  const seg = $('#toolSeg');
  $$('button', seg).forEach((b) => b.classList.toggle('on', b.dataset.tool === t));
  const on = $(`button[data-tool="${t}"]`, seg);
  const thumb = $('.seg-thumb', seg);
  thumb.style.width = on.offsetWidth + 'px';
  thumb.style.transform = `translateX(${on.offsetLeft}px)`;
  if (t !== 'select' && state.brush) setBrush(null);
  refreshPivot();
}

function updateStats() {
  const n = state.map.objects.length;
  const parts = flatten(state.map).parts.length;
  $('#statText').textContent = `${n} piece${n === 1 ? '' : 's'}, ${parts} part${parts === 1 ? '' : 's'}`;
}

function nudge(d) {
  const sel = selectedObjs();
  if (!sel.length) return;
  for (const o of sel) {
    o.pos = add(o.pos, d);
    applyBase(o, roots.get(o.id));
  }
  refreshPivot();
  drawMotionPath();
  clearTimeout(nudge.t);
  nudge.t = setTimeout(() => {
    commit('Nudge');
    renderInspector();
  }, 350);
}

window.addEventListener('keydown', (e) => {
  if (e.target.closest('input, textarea, select, [contenteditable]')) return;
  if ($('#modalRoot').children.length) return;
  const k = e.key.toLowerCase();
  const mod = e.ctrlKey || e.metaKey;
  if (mod && k === 'z') {
    e.preventDefault();
    e.shiftKey ? redo() : undo();
  } else if (mod && k === 'y') {
    e.preventDefault();
    redo();
  } else if (mod && k === 'd') {
    e.preventDefault();
    if (state.selected.size) duplicate([state.grid, state.grid, 0]);
  } else if (mod && k === 'c') {
    if (state.selected.size) {
      state.clipboard = JSON.parse(JSON.stringify(selectedObjs()));
      toast(`Copied ${state.clipboard.length}`);
    }
  } else if (mod && k === 'v') {
    if (state.clipboard) {
      const copies = cloneObjs(state.clipboard, [state.grid * 2, state.grid * 2, 0]);
      state.map.objects.push(...copies);
      copies.forEach((c, i) => bounceIn(rebuildObject(c), i * 18));
      select(copies.map((c) => c.id));
      state.clipboard = JSON.parse(JSON.stringify(copies));
      commit('Paste');
    }
  } else if (mod && k === 'a') {
    e.preventDefault();
    select(state.map.objects.map((o) => o.id));
  } else if (mod && k === 's') {
    e.preventDefault();
    if (desk) saveDesk(e.shiftKey);
    else exportModal();
  } else if (mod && k === 'o') {
    e.preventDefault();
    openAny();
  } else if (mod && k === 'n') {
    e.preventDefault();
    home.open();
  } else if (mod && k === 'f' && e.shiftKey) {
    e.preventDefault();
    searchModal();
  } else if (mod && k === 'g') {
    e.preventDefault();
    if (!state.selected.size) return;
    if (e.shiftKey) {
      forSel((o) => (o.group = ''));
      toast('Ungrouped');
    } else {
      const name = uniqueGroup('Group 1');
      forSel((o) => (o.group = name));
      toast(`Grouped as ${name}`);
    }
    commit('Group');
    renderInspector();
  } else if (k === 'escape') {
    if (state.brush) setBrush(null);
    else select([]);
  } else if (k === 'delete' || k === 'backspace') {
    action('del');
  } else if (k === 'v') setTool('select');
  else if (k === 'w') setTool('translate');
  else if (k === 'e') setTool('rotate');
  else if (k === 'r') setTool('scale');
  else if (k === 'f') {
    if (state.selected.size) frameObjects(selectedObjs());
    else frameAll();
  } else if (k === ' ') {
    e.preventDefault();
    togglePreview();
  } else if (k === '[' || k === ']') {
    state.placeZ += (k === ']' ? 1 : -1) * state.grid;
    updatePlaceHeight();
  } else if (e.key.startsWith('Arrow') || e.key === 'PageUp' || e.key === 'PageDown') {
    if (!state.selected.size) return;
    e.preventDefault();
    const s = state.grid * (e.shiftKey ? 4 : 1);
    const fwd = new THREE.Vector3();
    camera.getWorldDirection(fwd);
    const f = Math.abs(fwd.x) > Math.abs(fwd.z) ? [Math.sign(fwd.x), 0] : [0, Math.sign(fwd.z)];
    const ueF = [f[0], f[1]];
    const ueR = [-ueF[1], ueF[0]];
    const d = e.key === 'ArrowUp' ? [ueF[0] * s, ueF[1] * s, 0] : e.key === 'ArrowDown' ? [-ueF[0] * s, -ueF[1] * s, 0] : e.key === 'ArrowLeft' ? [ueR[0] * s, ueR[1] * s, 0] : e.key === 'ArrowRight' ? [-ueR[0] * s, -ueR[1] * s, 0] : [0, 0, e.key === 'PageUp' ? s : -s];
    nudge(d);
  } else if (e.key === 'Control' && state.snap) {
    gizmo.setTranslationSnap(null);
    gizmo.setRotationSnap(null);
    gizmo.setScaleSnap(null);
  }
});
window.addEventListener('keyup', (e) => {
  if (e.key === 'Control') applySnaps();
});

function wire() {
  $('#undoBtn').addEventListener('click', undo);
  $('#redoBtn').addEventListener('click', redo);
  $$('#toolSeg button').forEach((b) => b.addEventListener('click', () => setTool(b.dataset.tool)));
  $('#mapName').addEventListener('change', () => {
    state.map.meta.name = $('#mapName').value.trim() || 'Untitled map';
    $('#mapName').value = state.map.meta.name;
    commit('Rename');
    if (!state.selected.size) renderInspector();
  });
  $('#settingsBtn').addEventListener('click', settingsModal);
  $('#exportBtn').addEventListener('click', exportModal);
  $('#homeBtn').addEventListener('click', () => home.open());
  $('#helpBtn').addEventListener('click', helpModal);
  $('#openBtn').addEventListener('click', () => openAny());
  if (desk) {
    document.body.classList.add('desktop');
    $('#playGameBtn').hidden = false;
    $('#playGameBtn').addEventListener('click', () => game.play());
    game.mount($('#gameSlot'));
    desk.on('openFile', (f) => {
      home.close();
      openPath(f);
    });
    desk.on('grab', (g) => {
      if (g.state === 'start') toast(`Downloading ${g.name}`);
      else if (g.state === 'failed') toast(`${g.name} didn't download`, true);
      else if (g.state === 'done') {
        const m = $('.find-modal');
        if (m) m.closest('.backdrop')?.remove();
        importModal(g.files.map((f) => new File([f.data], f.name)));
      }
    });
  } else {
    $('#exportBtn').classList.replace('line', 'primary');
  }
  $('#fileInput').addEventListener('change', (e) => {
    if (e.target.files[0]) openFile(e.target.files[0]);
    e.target.value = '';
  });
  $$('.viewbar [data-view]').forEach((b) => b.addEventListener('click', () => setView(b.dataset.view)));
  $('#playBtn').addEventListener('click', togglePreview);
  const ditherBtn = $('#ditherBtn');
  const setDither = (on) => {
    stage.classList.toggle('dither', on);
    ditherBtn.classList.toggle('on', on);
    try {
      localStorage.setItem('builderballin:dither', on ? '1' : '0');
    } catch {}
  };
  let ditherOn = true;
  try {
    ditherOn = localStorage.getItem('builderballin:dither') !== '0';
  } catch {}
  setDither(ditherOn);
  ditherBtn.addEventListener('click', () => setDither(!stage.classList.contains('dither')));
  $('#scrub').addEventListener('input', () => {
    if (!resolvedAnims) resolvedAnims = resolveAll();
    gizmo.detach();
    setTime(+$('#scrub').value);
  });
  $('#fireTriggers').addEventListener('change', (e) => {
    state.fire = e.target.checked;
    applyTime();
  });
  $('#gridSel').value = state.grid;
  $('#angleSel').value = state.angle;
  $('#snapChk').checked = state.snap;
  $('#gridSel').addEventListener('change', (e) => {
    state.grid = +e.target.value;
    buildGrid();
    applySnaps();
    savePrefs();
  });
  $('#angleSel').addEventListener('change', (e) => {
    state.angle = +e.target.value;
    applySnaps();
    savePrefs();
  });
  $('#snapChk').addEventListener('change', (e) => {
    state.snap = e.target.checked;
    applySnaps();
    savePrefs();
  });
  let dragDepth = 0;
  window.addEventListener('dragenter', (e) => {
    if (![...e.dataTransfer.types].includes('Files')) return;
    dragDepth++;
    const d = $('#drop');
    if (d.hidden) {
      d.hidden = false;
      fadeIn(d, { y: 0, scale: 0.98, spring: SPRINGS.gentle });
    }
  });
  window.addEventListener('dragleave', () => {
    dragDepth = Math.max(0, dragDepth - 1);
    if (!dragDepth) $('#drop').hidden = true;
  });
  window.addEventListener('dragover', (e) => e.preventDefault());
  window.addEventListener('drop', (e) => {
    e.preventDefault();
    dragDepth = 0;
    $('#drop').hidden = true;
    const files = [...e.dataTransfer.files];
    if (!files.length) return;
    if (files.length === 1 && /\.(hbmap|json)$/i.test(files[0].name)) openFile(files[0]);
    else importModal(files);
  });
  $('#importInput').accept = ACCEPT;
  $('#importInput').addEventListener('change', (e) => {
    const files = [...e.target.files];
    e.target.value = '';
    if (files.length) importModal(files);
  });
  $('#importBtn').addEventListener('click', () => $('#importInput').click());
}

function playIntro() {
  const list = state.map.objects;
  const order = list
    .map((o) => ({ o, d: Math.hypot(o.pos[0], o.pos[1]) + o.pos[2] * 0.3 }))
    .sort((a, b) => a.d - b.d)
    .map((x) => x.o);
  const step = Math.min(45, 1400 / Math.max(1, order.length));
  order.forEach((o, i) => bounceIn(roots.get(o.id), 250 + i * step, 500));
  const view = list.filter((o) => o.piece !== 'kill');
  const box = boundsOf(view.length ? view : list);
  if (box.isEmpty()) return frameAll();
  const c = box.getCenter(new THREE.Vector3());
  const size = box.getSize(new THREE.Vector3()).length();
  const dist = Math.max(12000, size * 0.9) / Math.tan((camera.fov * Math.PI) / 360) / 1.6;
  camera.position.copy(c).add(new THREE.Vector3(-0.6, 1.4, 1.2).normalize().multiplyScalar(dist * 1.9));
  controls.target.copy(c);
  camFly.active = false;
  flyTo(c.clone().add(new THREE.Vector3(1, 0.85, 1.05).normalize().multiplyScalar(dist)), c, { stiffness: 38, damping: 13 });
}

function enterUI() {
  $$('[data-enter]').forEach((el, i) => {
    const from = el.classList.contains('tray') ? 'translateX(-24px)' : el.classList.contains('inspector') ? 'translateX(24px)' : el.classList.contains('timeline') ? 'translateY(16px)' : el.classList.contains('bar') ? 'translateY(-12px)' : 'translateY(-6px)';
    animate(el, { opacity: [0, 1], transform: [from, 'none'] }, { spring: SPRINGS.gentle, delay: 80 + i * 70 });
  });
}

function mapThumb(map, w = 480, h = 300) {
  if (!mapThumb.r) {
    const r = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    r.setPixelRatio(1);
    r.outputColorSpace = THREE.SRGBColorSpace;
    r.toneMapping = THREE.ACESFilmicToneMapping;
    r.shadowMap.enabled = false;
    const sc2 = new THREE.Scene();
    sc2.background = new THREE.Color('#2a2650');
    sc2.fog = new THREE.Fog('#2a2650', 400000, 1400000);
    sc2.environment = makeEnvironment(r);
    sc2.add(new THREE.HemisphereLight('#e4defe', '#3a3466', 1.5));
    const dl = new THREE.DirectionalLight('#ffe6cc', 2.2);
    dl.position.set(-1, 2, 1.4);
    sc2.add(dl);
    mapThumb.r = r;
    mapThumb.scene = sc2;
    mapThumb.cam = new THREE.PerspectiveCamera(32, w / h, 100, 5e6);
  }
  const { r, scene: sc2, cam } = mapThumb;
  r.setSize(w, h, false);
  cam.aspect = w / h;
  const group = new THREE.Group();
  thumbMode = true;
  for (const o of map.objects) {
    if (o.piece === 'kill' || !PIECE[o.piece]) continue;
    const v = buildVisual(o);
    applyBase(o, v);
    v.traverse((c) => {
      if (c.userData.label || c.userData.zoneBox || c.userData.edge) c.visible = false;
    });
    group.add(v);
  }
  thumbMode = false;
  sc2.add(group);
  group.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(group);
  if (box.isEmpty()) box.set(new THREE.Vector3(-10000, -10000, -10000), new THREE.Vector3(10000, 10000, 10000));
  const c = box.getCenter(new THREE.Vector3());
  const rad = Math.max(8000, box.getSize(new THREE.Vector3()).length() / 2);
  cam.position.copy(c).add(new THREE.Vector3(-0.75, 0.62, 0.9).normalize().multiplyScalar((rad / Math.sin((cam.fov * Math.PI) / 360)) * 0.6));
  cam.near = rad / 200;
  cam.far = rad * 40;
  cam.updateProjectionMatrix();
  cam.lookAt(c);
  r.render(sc2, cam);
  const url = r.domElement.toDataURL('image/jpeg', 0.84);
  sc2.remove(group);
  return url;
}

function ensureFallbacks(map) {
  for (const a of Object.values(map.assets || {})) {
    if (a.kind !== 'mesh' || a.fallback) continue;
    try {
      a.fallback = blocksFromMesh(a, a.source === 'level' ? 96 : 40);
    } catch {}
  }
}

function countMap(map) {
  const fb = flatten(map);
  const rolling = fb.spawners.reduce((n, sp) => n + (sp.max || 0), 0);
  return { marbles: fb.marbles.length, rolling, total: fb.marbles.length + rolling, spawners: fb.spawners.length, parts: fb.parts.length };
}

function rememberPath() {
  try {
    if (state.filePath) localStorage.setItem('builderballin:path', state.filePath);
    else localStorage.removeItem('builderballin:path');
  } catch {}
}

function startTemplate(id) {
  const t = TEMPLATES.find((x) => x.id === id) || TEMPLATES[0];
  state.filePath = null;
  rememberPath();
  loadMap(t.make(), { intro: true });
  if (id !== 'blank') toast(`Started from ${t.name}`);
}

async function openPath(p) {
  try {
    const r = await desk.file.open(p);
    if (!r) return false;
    loadMap(importMap(r.text), { intro: true });
    state.filePath = r.path;
    rememberPath();
    toast(`Opened ${state.map.meta.name}`);
    return true;
  } catch (e) {
    toast(e.message || "Couldn't open that.", true);
    return false;
  }
}

function openAny() {
  if (desk) return openPath(null);
  return new Promise((resolve) => {
    const input = $('#fileInput');
    const once = () => {
      input.removeEventListener('change', once);
      resolve(!!input.files.length);
    };
    input.addEventListener('change', once);
    input.click();
  });
}

async function saveDesk(asNew = false) {
  try {
    ensureFallbacks(state.map);
    const p = await desk.file.save(exportMap(state.map), state.map.meta.name, asNew ? null : state.filePath);
    if (!p) return;
    state.filePath = p;
    rememberPath();
    toast('Saved');
    $('#savedText').textContent = 'Saved to file';
  } catch (e) {
    toast(e.message, true);
  }
}

function searchModal(q = '') {
  openSearch({ modal, html, esc, toast, desk, animate, SPRINGS, importFiles: (files, name) => importModal(files, name) }, q);
}

function savedName() {
  if (state.freshBoot) return '';
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (!raw) return '';
    const m = JSON.parse(raw);
    return m && m.meta && m.objects && m.objects.length ? m.meta.name : '';
  } catch {
    return '';
  }
}

const home = createHome({
  html,
  esc,
  toast,
  animate,
  SPRINGS,
  desk,
  TEMPLATES,
  countMap,
  mapThumb: (m, w, h) => mapThumb(m, w, h),
  startTemplate,
  openAny,
  openPath,
  pickImport: () => $('#importInput').click(),
  openSearch: () => searchModal(),
  openSetup: () => (game ? game.openSetup() : Promise.resolve(null)),
  savedName
});
const game = desk ? createGame({ html, esc, toast, modal, desk, validate, exportMap: (m) => (ensureFallbacks(m), exportMap(m)), state }) : null;

function boot() {
  try {
    const p = JSON.parse(localStorage.getItem(PREFS_KEY) || '{}');
    if (p.grid && p.grid >= 500) state.grid = p.grid;
    if (p.angle !== undefined) state.angle = p.angle;
    if (p.snap !== undefined) state.snap = p.snap;
    if (p.cat) state.cat = p.cat;
  } catch {}
  document.documentElement.style.setProperty('--spring', springCurve(SPRINGS.bouncy).easing);
  document.documentElement.style.setProperty('--spring-soft', springCurve(SPRINGS.gentle).easing);
  buildGrid();
  resize();
  wire();
  buildTray();
  updateTrayNote();
  makeThumbs();
  let map = null;
  try {
    const saved = localStorage.getItem(STORE_KEY);
    if (saved) map = importMap(saved);
  } catch {}
  if (map && map.objects.length && !map.objects.some((o) => ['marble', 'marbles', 'spawner'].includes(PIECE[o.piece].kind)) && map.oldScale) map = null;
  const fresh = !map;
  state.freshBoot = fresh;
  if (desk && map) {
    try {
      state.filePath = localStorage.getItem('builderballin:path') || null;
    } catch {}
  }
  if (!map) map = TEMPLATES.find((t) => t.id === 'run').make();
  enterUI();
  loadMap(map, { intro: !fresh });
  setTool('select');
  requestAnimationFrame(() => setTool('select'));
  requestAnimationFrame(loop);
  window.__bb = { state, flatten, exportMap, camera, controls, roots, scene, THREE, camFly, frameObjects, select, loadMap, TEMPLATES, setBrush, home, importModal, searchModal, mapThumb };
  const reveal = () => home.open({ first: true });
  if (window.__loaderDone) window.__loaderDone(reveal);
  else reveal();
}

boot();
