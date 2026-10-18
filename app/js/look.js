import * as THREE from 'three';
import { GEMS, GEM, MARBLE_R } from './pieces.js';

const SKY_VERT = `
varying vec3 vDir;
void main() {
  vDir = normalize(position);
  vec4 p = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * p;
  gl_Position.z = gl_Position.w;
}`;

const SKY_FRAG = `
varying vec3 vDir;
uniform vec3 uMoon;
uniform float uTime;
float hash(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
float noise(vec3 x) {
  vec3 i = floor(x); vec3 f = fract(x); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(hash(i), hash(i + vec3(1,0,0)), f.x), mix(hash(i + vec3(0,1,0)), hash(i + vec3(1,1,0)), f.x), f.y),
             mix(mix(hash(i + vec3(0,0,1)), hash(i + vec3(1,0,1)), f.x), mix(hash(i + vec3(0,1,1)), hash(i + vec3(1,1,1)), f.x), f.y), f.z);
}
float fbm(vec3 p) { float v = 0.0, a = 0.5; for (int i = 0; i < 5; i++) { v += a * noise(p); p *= 2.03; a *= 0.5; } return v; }
void main() {
  vec3 d = normalize(vDir);
  float h = d.y;
  vec3 horizon = vec3(0.93, 0.90, 1.0);
  vec3 dome = vec3(0.70, 0.66, 0.98);
  vec3 zenith = vec3(0.20, 0.18, 0.40);
  vec3 under = vec3(0.13, 0.12, 0.22);
  vec3 c = h > 0.0 ? mix(horizon, dome, smoothstep(0.0, 0.18, h)) : mix(horizon, under, smoothstep(0.0, 0.22, -h));
  c = h > 0.0 ? mix(c, zenith, smoothstep(0.25, 1.0, h)) : c;
  vec2 uv = d.xz / max(0.08, d.y + 0.25);
  float cl = fbm(vec3(uv * 0.9 + vec2(uTime * 0.004, 0.0), 1.7));
  float cl2 = fbm(vec3(uv * 2.6 - vec2(uTime * 0.007, 0.0), 4.1));
  float clouds = smoothstep(0.48, 0.78, cl * 0.75 + cl2 * 0.35) * smoothstep(-0.02, 0.2, h);
  float md = max(0.0, dot(d, normalize(uMoon)));
  vec3 glow = vec3(1.0, 0.82, 0.70) * (pow(md, 60.0) * 0.55 + pow(md, 8.0) * 0.12);
  c = mix(c, vec3(0.55, 0.53, 0.66) + glow * 1.4, clouds * 0.62);
  c += glow;
  float disk = smoothstep(0.99955, 0.99975, md);
  float crater = fbm(d * 220.0);
  c = mix(c, vec3(1.0, 0.95, 0.86) * (0.86 + crater * 0.2), disk);
  float st = step(0.9985, hash(floor(d * 900.0))) * smoothstep(0.35, 0.9, h) * (1.0 - clouds);
  c += st * 0.55;
  gl_FragColor = vec4(c, 1.0);
  #include <colorspace_fragment>
}`;

export const MOON_DIR = new THREE.Vector3(0.42, 0.34, -0.84).normalize();

export function makeSky() {
  const mat = new THREE.ShaderMaterial({ vertexShader: SKY_VERT, fragmentShader: SKY_FRAG, uniforms: { uMoon: { value: MOON_DIR }, uTime: { value: 0 } }, side: THREE.BackSide, depthWrite: false, fog: false });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(1, 48, 24), mat);
  mesh.scale.setScalar(5e6);
  mesh.frustumCulled = false;
  mesh.renderOrder = -10;
  mesh.userData.sky = true;
  return mesh;
}

export function makeEnvironment(renderer) {
  const s = new THREE.Scene();
  const sky = makeSky();
  sky.scale.setScalar(100);
  s.add(sky);
  const pm = new THREE.PMREMGenerator(renderer);
  const rt = pm.fromScene(s, 0.02, 0.1, 1000);
  pm.dispose();
  return rt.texture;
}

function ringPattern(w, h, seed) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const x = c.getContext('2d');
  let s = seed || 7;
  const r = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  x.fillStyle = 'rgb(150,150,150)';
  x.fillRect(0, 0, w, h);
  const tones = [235, 120, 200, 70, 250, 165, 40, 215];
  const rows = 7;
  for (let row = 0; row < rows; row++) {
    const cy = ((row + 0.5) / rows) * h;
    const edge = Math.abs(row - (rows - 1) / 2) / ((rows - 1) / 2);
    const n = Math.round(14 - edge * 6);
    const ry = (h / rows) * (0.52 + edge * 0.1);
    for (let k = -1; k <= n; k++) {
      const cx = ((k + 0.5 + (row % 2) * 0.5) / n) * w;
      const rx = (w / n) * (0.48 + edge * 0.22);
      const rings = 3 + Math.floor(r() * 4);
      for (let i = 0; i < rings; i++) {
        const f = 1 - i / rings;
        x.beginPath();
        x.ellipse(cx, cy, rx * f, ry * f, 0, 0, Math.PI * 2);
        x.fillStyle = `rgb(${tones[(i + row + k) & 7]},${tones[(i + row + k) & 7]},${tones[(i + row + k) & 7]})`;
        x.fill();
        x.lineWidth = Math.max(1.5, w / 380);
        x.strokeStyle = 'rgb(18,18,18)';
        x.stroke();
      }
      if (r() > 0.55) {
        x.beginPath();
        x.ellipse(cx, cy, rx * 0.12, ry * 0.18, 0, 0, Math.PI * 2);
        x.fillStyle = 'rgb(10,10,10)';
        x.fill();
      }
    }
  }
  return c;
}

function stonePattern(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const x = c.getContext('2d');
  x.fillStyle = 'rgb(236,232,223)';
  x.fillRect(0, 0, w, h);
  let s = 11;
  const r = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  for (let v = 0; v < 26; v++) {
    let px = r() * w, py = r() * h;
    x.beginPath();
    x.moveTo(px, py);
    for (let i = 0; i < 40; i++) {
      px += (r() - 0.35) * 30;
      py += (r() - 0.5) * 22;
      x.lineTo(px, py);
    }
    x.strokeStyle = `rgba(110,104,96,${0.15 + r() * 0.35})`;
    x.lineWidth = 0.6 + r() * 2.2;
    x.stroke();
  }
  return c;
}

function tint(src, deep, surface) {
  const c = document.createElement('canvas');
  c.width = src.width;
  c.height = src.height;
  const x = c.getContext('2d');
  x.drawImage(src, 0, 0);
  const img = x.getImageData(0, 0, c.width, c.height);
  const a = new THREE.Color(deep), b = new THREE.Color(surface);
  const A = [a.r * 255, a.g * 255, a.b * 255], B = [b.r * 255, b.g * 255, b.b * 255];
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const t = d[i] / 255;
    const k = t * t * (3 - 2 * t);
    d[i] = A[0] + (B[0] - A[0]) * k;
    d[i + 1] = A[1] + (B[1] - A[1]) * k;
    d[i + 2] = A[2] + (B[2] - A[2]) * k;
  }
  x.putImageData(img, 0, 0);
  return c;
}

let baseRings = null;
const gemTex = new Map();
function gemTexture(gem) {
  if (gemTex.has(gem.id)) return gemTex.get(gem.id);
  let canvas;
  if (gem.stone) canvas = stonePattern(1024, 512);
  else {
    baseRings = baseRings || ringPattern(1024, 512, 7);
    canvas = tint(gem.noise ? ringPattern(1024, 512, 31) : baseRings, gem.deep, gem.surface);
  }
  const t = new THREE.CanvasTexture(canvas);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  gemTex.set(gem.id, t);
  return t;
}

const gemMats = new Map();
export function gemMaterial(id, { ghost = false, simple = false } = {}) {
  const key = `${id}|${ghost}|${simple}`;
  if (gemMats.has(key)) return gemMats.get(key);
  const g = GEM[id] || GEM.coral;
  let m;
  if (simple) {
    m = new THREE.MeshStandardMaterial({ map: gemTexture(g), roughness: 0.25, metalness: 0.05, emissive: new THREE.Color(g.surface).multiplyScalar(0.18) });
  } else {
    m = new THREE.MeshPhysicalMaterial({
      map: gemTexture(g),
      roughness: g.stone ? 0.35 : 0.08,
      metalness: 0,
      clearcoat: 1,
      clearcoatRoughness: 0.04,
      iridescence: g.stone ? 0 : 0.35,
      iridescenceIOR: 1.6,
      sheen: g.stone ? 0 : 0.4,
      sheenColor: new THREE.Color(g.surface),
      emissive: new THREE.Color(g.surface),
      emissiveIntensity: g.stone ? 0 : 0.07,
      envMapIntensity: 1.25
    });
  }
  if (ghost) {
    m.transparent = true;
    m.opacity = 0.5;
    m.depthWrite = false;
  }
  gemMats.set(key, m);
  return m;
}

export const MARBLE_GEO = new THREE.SphereGeometry(MARBLE_R, 56, 36);

let woodTex = null;
export function woodTexture() {
  if (woodTex) return woodTex;
  const c = document.createElement('canvas');
  c.width = c.height = 512;
  const x = c.getContext('2d');
  let s = 3;
  const r = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  const planks = 8;
  for (let i = 0; i < planks; i++) {
    const y0 = (i / planks) * 512;
    const base = 0.86 + r() * 0.22;
    x.fillStyle = `rgb(${168 * base | 0},${112 * base | 0},${63 * base | 0})`;
    x.fillRect(0, y0, 512, 512 / planks);
    for (let g = 0; g < 18; g++) {
      const gy = y0 + r() * (512 / planks);
      x.beginPath();
      x.moveTo(0, gy);
      for (let px = 0; px <= 512; px += 32) x.lineTo(px, gy + Math.sin(px * 0.02 + g) * 2.5 + (r() - 0.5) * 2);
      x.strokeStyle = `rgba(70,38,16,${0.08 + r() * 0.16})`;
      x.lineWidth = 0.6 + r() * 1.4;
      x.stroke();
    }
    x.fillStyle = 'rgba(40,20,8,0.55)';
    x.fillRect(0, y0, 512, 2);
    const cut = r() * 512;
    x.fillRect(cut, y0, 2, 512 / planks);
  }
  woodTex = new THREE.CanvasTexture(c);
  woodTex.colorSpace = THREE.SRGBColorSpace;
  woodTex.wrapS = woodTex.wrapT = THREE.RepeatWrapping;
  woodTex.anisotropy = 8;
  return woodTex;
}

const woodMats = new Map();
export function woodMaterial(rx, ry, tintColor, { ghost = false, faded = false } = {}) {
  const qx = Math.max(1, Math.round(rx * 4) / 4), qy = Math.max(1, Math.round(ry * 4) / 4);
  const key = `${qx}|${qy}|${tintColor}|${ghost}|${faded}`;
  if (woodMats.has(key)) return woodMats.get(key);
  const t = woodTexture().clone();
  t.needsUpdate = true;
  t.repeat.set(qx, qy);
  const m = new THREE.MeshStandardMaterial({ map: t, color: tintColor && tintColor !== '#a8703f' ? new THREE.Color(tintColor).lerp(new THREE.Color('#ffffff'), 0.5) : '#ffffff', roughness: 0.72, metalness: 0, envMapIntensity: 0.5 });
  if (ghost || faded) {
    m.transparent = true;
    m.opacity = ghost ? 0.5 : 0.28;
    m.depthWrite = !ghost;
  }
  woodMats.set(key, m);
  return m;
}

const ringMat = new THREE.MeshStandardMaterial({ color: '#5fc8ff', metalness: 0.9, roughness: 0.18, emissive: '#2a7cff', emissiveIntensity: 0.45, envMapIntensity: 1.4 });
const ringGhost = ringMat.clone();
ringGhost.transparent = true;
ringGhost.opacity = 0.45;
export function finishRings(ghost) {
  const g = new THREE.Group();
  [1, 0.82, 0.64, 0.46, 0.28].forEach((f, k) => {
    const t = new THREE.Mesh(new THREE.TorusGeometry(48 * f, 3.2 * f + 0.6, 14, 72).rotateY(Math.PI / 2), ghost ? ringGhost : ringMat);
    t.userData.spin = (k % 2 ? -1 : 1) * (0.25 + k * 0.12);
    t.castShadow = true;
    g.add(t);
  });
  g.userData.rings = true;
  return g;
}

const guyMat = new THREE.MeshStandardMaterial({ color: '#a9e2ff', emissive: '#16357a', emissiveIntensity: 0.3, roughness: 0.14, metalness: 0.2, flatShading: true });
let guyGeo = null;

function guyGeometry() {
  if (guyGeo) return guyGeo;
  const G = globalThis.HB_GUY;
  const p = G.pose(G.REST);
  const pos = new Float32Array(p.length);
  for (let i = 0; i < p.length; i += 3) {
    pos[i] = p[i];
    pos[i + 1] = p[i + 2];
    pos[i + 2] = p[i + 1];
  }
  const idx = new Uint16Array(G.index.length);
  for (let i = 0; i < idx.length; i += 3) {
    idx[i] = G.index[i];
    idx[i + 1] = G.index[i + 2];
    idx[i + 2] = G.index[i + 1];
  }
  guyGeo = new THREE.BufferGeometry();
  guyGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  guyGeo.setIndex(new THREE.BufferAttribute(idx, 1));
  guyGeo.computeVertexNormals();
  return guyGeo;
}

export function diamondGuy() {
  const g = new THREE.Group();
  if (!globalThis.HB_GUY) return g;
  const m = new THREE.Mesh(guyGeometry(), guyMat);
  m.rotation.y = Math.PI / 2;
  m.castShadow = true;
  g.add(m);
  g.userData.height = globalThis.HB_GUY.height;
  return g;
}

export function playerFigure() {
  return diamondGuy();
}

export function arrowMesh(length, color, radius = 120, opacity = 0.95) {
  const g = new THREE.Group();
  const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false });
  const shaft = new THREE.Mesh(new THREE.CylinderGeometry(radius * 0.35, radius * 0.35, length * 0.8, 10), mat);
  shaft.rotation.z = -Math.PI / 2;
  shaft.position.x = length * 0.4;
  const head = new THREE.Mesh(new THREE.ConeGeometry(radius, length * 0.25, 14), mat);
  head.rotation.z = -Math.PI / 2;
  head.position.x = length * 0.88;
  g.add(shaft, head);
  return g;
}

export { GEMS };
