import { PIECE, defaultParams, localParts, pieceColor, initialScale, marblePoints, GEM, MARBLE_R, speedRange, DOMINUS } from './pieces.js';
import { assetParts } from './voxels.js';
import { colliderChunks } from './collide.js';
import { axesFromRot, rotFromAxes, applyAxes, composeAxes, add, hadamard } from './ue.js';

export const FORMAT = 'builderballin';
export const VERSION = 2;

export const DIFFICULTIES = ['Chill', 'Easy', 'Medium', 'Hard', 'Brutal', 'Fever'];
export const GEM_NAMES = ['diamond', 'emerald', 'gold', 'steel', 'rock'];

export function uid() {
  return Math.random().toString(36).slice(2, 9);
}

export function blankMap() {
  return {
    format: FORMAT,
    version: VERSION,
    meta: { name: 'Untitled map', author: '', description: '', difficulty: 'Easy', gems: { diamond: 0, emerald: 0, gold: 0, steel: 0, rock: 0 }, created: Date.now(), updated: Date.now() },
    rules: { gravity: 1, speed: 1, jump: 1, killHeight: -60000, needCheckpoints: false, timeLimit: 0 },
    assets: {},
    objects: []
  };
}

export function newObject(pieceId, pos, extra = {}) {
  const piece = PIECE[pieceId];
  const s = initialScale(piece);
  return {
    id: uid(),
    piece: pieceId,
    name: '',
    pos: pos.slice(),
    rot: [0, 0, 0],
    scale: s,
    color: pieceColor(piece),
    p: defaultParams(piece),
    look: { ice: false, visible: true, collide: true },
    anim: null,
    group: '',
    ...extra
  };
}

export function blankAnim() {
  return { start: 'always', channel: 'A', pivot: 'self', move: null, spin: null, swing: null, blink: null };
}

export const MOVE_DEFAULT = () => ({ points: [[0, 0, 400]], duration: 3, mode: 'pingpong', ease: 'smooth', delay: 0 });
export const SPIN_DEFAULT = () => ({ axis: 'world-up', speed: 45 });
export const SWING_DEFAULT = () => ({ axis: 'object-forward', angle: 35, period: 3 });
export const BLINK_DEFAULT = () => ({ on: 2, off: 1, offset: 0 });

export function axisVector(name, objAxes) {
  if (name === 'world-up') return [0, 0, 1];
  if (name === 'world-forward') return [1, 0, 0];
  if (name === 'world-side') return [0, 1, 0];
  if (name === 'object-forward') return objAxes[0];
  if (name === 'object-side') return objAxes[1];
  return objAxes[2];
}

function groupCenters(objects) {
  const g = {};
  for (const o of objects) {
    if (!o.group) continue;
    (g[o.group] = g[o.group] || []).push(o.pos);
  }
  const out = {};
  for (const [k, list] of Object.entries(g)) out[k] = [0, 1, 2].map((i) => list.reduce((s, p) => s + p[i], 0) / list.length);
  return out;
}

function resolveAnim(o, axes, centers) {
  const a = o.anim;
  if (!a || !(a.move || a.spin || a.swing || a.blink)) return null;
  const out = { start: a.start, channel: a.channel || 'A', pivot: a.pivot === 'group' && o.group && centers[o.group] ? centers[o.group] : o.pos.slice() };
  if (a.move && a.move.points.length) out.move = { points: [[0, 0, 0], ...a.move.points.map((p) => p.slice())], duration: Math.max(0.05, a.move.duration), mode: a.move.mode, ease: a.move.ease, delay: a.move.delay || 0 };
  if (a.spin) out.spin = { axis: axisVector(a.spin.axis, axes), speed: a.spin.speed };
  if (a.swing) out.swing = { axis: axisVector(a.swing.axis, axes), angle: a.swing.angle, period: Math.max(0.1, a.swing.period) };
  if (a.blink) out.blink = { on: Math.max(0.05, a.blink.on), off: Math.max(0, a.blink.off), offset: a.blink.offset || 0 };
  return out;
}

export function flatten(map) {
  const objects = map.objects;
  const centers = groupCenters(objects);
  const byId = Object.fromEntries(objects.map((o) => [o.id, o]));
  const build = { spawn: null, parts: [], zones: [], marbles: [], spawners: [], checkpoints: 0, marbleRadius: MARBLE_R };
  for (const o of objects) {
    const piece = PIECE[o.piece];
    if (!piece) continue;
    const axes = axesFromRot(o.rot);
    const anim = resolveAnim(o, axes, centers);
    const common = { id: o.id, anim };
    if (piece.kind === 'marker') {
      if (piece.marker === 'spawn' && !build.spawn) {
        const prm = { ...defaultParams(piece), ...o.p };
        const [lo, hi] = speedRange(o.p, 'speedMin', 'speedMax', 'speed', 1);
        build.spawn = { pos: o.pos.slice(), yaw: o.rot[1], speedMin: o.p.speedMin === undefined && o.p.speed === undefined ? prm.speedMin : lo, speedMax: o.p.speedMax === undefined && o.p.speed === undefined ? prm.speedMax : hi, color: prm.color, mode: prm.mode, gems: gemList(prm.color) };
      }
      continue;
    }
    if (piece.kind === 'marble' || piece.kind === 'marbles') {
      const prm = { ...defaultParams(piece), ...o.p };
      const fwd = axes[0];
      const [pushMin, pushMax] = speedRange(o.p);
      marblePoints(o).forEach((m, i) => {
        build.marbles.push({
          id: `${o.id}:${i}`,
          pos: add(o.pos, applyAxes(axes, m.pos)),
          gem: m.gem,
          mat: GEM[m.gem].mat,
          feather: m.gem === 'feather',
          mode: prm.mode,
          dir: pushMax > 0 ? fwd.slice() : null,
          pushMin,
          pushMax,
          anim
        });
      });
      continue;
    }
    if (piece.kind === 'dominus') {
      const sz = Math.max(0.05, (o.p && o.p.size) || 1);
      build.parts.push({ ...common, kind: 'bp', path: DOMINUS.path, pos: o.pos.slice(), rot: o.rot.slice(), scale: [sz, sz, sz], color: null, ice: false, hidden: false, collide: false, dominus: true });
      const r = DOMINUS.reach * sz;
      build.zones.push({ ...common, type: 'finish', pos: o.pos.slice(), rot: o.rot.slice(), ext: [r, r, r], params: {}, sphere: r });
      continue;
    }
    if (piece.kind === 'spawner') {
      const prm = { ...defaultParams(piece), ...o.p };
      build.spawners.push({ ...common, pos: o.pos.slice(), rot: o.rot.slice(), interval: prm.interval, spread: prm.spread, ...spawnerSpeed(o.p, prm), angle: prm.angle, max: prm.max, mode: prm.mode, channel: (prm.channel || '').trim(), color: prm.color, gems: gemList(prm.color) });
      continue;
    }
    if (piece.kind === 'zone') {
      const z = { ...common, type: piece.zone, pos: o.pos.slice(), rot: o.rot.slice(), ext: o.scale.map((s) => Math.abs(s) * 50), params: { ...defaultParams(piece), ...o.p } };
      if (piece.zone === 'teleport') {
        const ex = byId[o.p.exit];
        z.to = ex ? { pos: ex.pos.slice(), yaw: ex.rot[1] } : null;
      }
      if (piece.zone === 'checkpoint') build.checkpoints += 1;
      build.zones.push(z);
      if (piece.rings) {
        const r = Math.min(o.scale[1], o.scale[2]) * 50;
        [1, 0.82, 0.64, 0.46, 0.28].forEach((f, k) => {
          const s = (r * f) / 125;
          build.parts.push({ ...common, id: `${o.id}:ring${k}`, kind: 'mesh', path: '/Game/Assets/Misc/SM_Torus', pos: o.pos.slice(), rot: rotFromAxes(composeAxes(axes, axesFromRot([90, 0, k * 18]))), scale: [s, s, s * 1.6], color: null, ice: false, hidden: false, collide: false, spinRing: k });
        });
      }
      if (piece.pad) {
        const hz = o.scale[2] * 50;
        build.parts.push({ ...common, id: o.id + ':pad', kind: 'shape', shape: piece.zone === 'bounce' ? 'cylinder' : 'cube', pos: add(o.pos, applyAxes(axes, [0, 0, -hz + 10])), rot: o.rot.slice(), scale: [o.scale[0] * 0.95, o.scale[1] * 0.95, 0.2], color: pieceColor(piece), ice: false, hidden: false, collide: true });
      }
      continue;
    }
    if (piece.kind === 'game') {
      const part = { ...common, kind: piece.cls ? 'bp' : piece.skel ? 'skel' : 'mesh', path: piece.cls || piece.skel || piece.mesh, pos: o.pos.slice(), rot: o.rot.slice(), scale: o.scale.slice(), color: null, ice: o.look.ice, hidden: !o.look.visible, collide: o.look.collide };
      build.parts.push(part);
      continue;
    }
    if (piece.kind === 'decor') {
      const prm = { ...defaultParams(piece), ...o.p };
      if (piece.decor === 'text') build.parts.push({ ...common, kind: 'text', text: prm.text, size: prm.height, pos: o.pos.slice(), rot: o.rot.slice(), scale: [1, 1, 1], color: o.color });
      else build.parts.push({ ...common, kind: 'light', intensity: prm.intensity, radius: prm.radius, pos: o.pos.slice(), rot: [0, 0, 0], scale: [1, 1, 1], color: o.color });
      continue;
    }
    if (piece.kind === 'import' && map.assets && map.assets[o.p.ref] && map.assets[o.p.ref].kind === 'mesh') {
      const a = map.assets[o.p.ref];
      const solid = o.look.collide !== false;
      const chunks = solid ? colliderChunks(a.collider) : [];
      const proxy = solid && !chunks.length && !!(a.fallback && a.fallback.boxes);
      a.sections.forEach((sec, i) => {
        build.parts.push({ ...common, id: `${o.id}:m${i}`, kind: 'procmesh', group: o.id, pos: o.pos.slice(), rot: o.rot.slice(), scale: o.scale.slice(), color: a.palette[sec.c] || '#9a9a96', sec: { b: sec.b, p: sec.p, n: sec.n, i: sec.i }, two: !!a.twoSided, ice: o.look.ice, hidden: !o.look.visible, collide: solid && !chunks.length && !proxy });
      });
      chunks.forEach((d, i) => {
        build.parts.push({ ...common, id: `${o.id}:c${i}`, kind: 'collider', group: o.id, pos: o.pos.slice(), rot: o.rot.slice(), scale: o.scale.slice(), boxes: d, ice: o.look.ice, hidden: true, collide: true });
      });
      if (a.fallback && a.fallback.boxes) {
        assetParts({ palette: a.fallback.palette, boxes: a.fallback.boxes }).forEach((lp, i) => {
          build.parts.push({ ...common, id: `${o.id}:f${i}`, kind: 'shape', shape: 'cube', fallbackFor: o.id, proxy, pos: add(o.pos, applyAxes(axes, hadamard(lp.pos, o.scale))), rot: o.rot.slice(), scale: hadamard(lp.scale, o.scale), color: lp.color, mat: null, ice: o.look.ice, hidden: !o.look.visible, collide: o.look.collide });
        });
      }
      continue;
    }
    const parts = piece.kind === 'import' ? (map.assets && map.assets[o.p.ref] ? assetParts(map.assets[o.p.ref]) : []) : localParts(o);
    parts.forEach((lp, i) => {
      const la = axesFromRot(lp.rot);
      const wa = composeAxes(axes, la);
      build.parts.push({
        ...common,
        id: `${o.id}:${i}`,
        kind: 'shape',
        shape: lp.shape,
        pos: add(o.pos, applyAxes(axes, hadamard(lp.pos, o.scale))),
        rot: rotFromAxes(wa),
        scale: hadamard(lp.scale, o.scale),
        color: lp.color || o.color,
        mat: lp.mat || (o.look.wood ? 'wood' : null),
        ice: o.look.ice,
        hidden: !o.look.visible,
        collide: o.look.collide
      });
    });
  }
  return build;
}

function spawnerSpeed(raw, prm) {
  if (raw.speedMin === undefined && raw.speedMax === undefined && raw.speed !== undefined) {
    const [lo, hi] = speedRange(raw, 'speedMin', 'speedMax', 'speed', 0.35);
    return { speedMin: lo, speedMax: hi };
  }
  const [lo, hi] = speedRange({ speedMin: prm.speedMin, speedMax: prm.speedMax }, 'speedMin', 'speedMax');
  return { speedMin: lo, speedMax: hi };
}

function gemList(setting) {
  if (setting === 'random' || !setting) return null;
  if (setting === 'cycle') return ['coral', 'lime', 'yellow', 'magenta', 'mint'].map((g) => GEM[g].mat);
  return GEM[setting] ? [GEM[setting].mat] : null;
}

export function exportMap(map) {
  const out = JSON.parse(JSON.stringify(map));
  out.meta.updated = Date.now();
  out.build = flatten(map);
  out.build.counts = { parts: out.build.parts.length, zones: out.build.zones.length, marbles: out.build.marbles.length, spawners: out.build.spawners.length };
  return JSON.stringify(out);
}

export function importMap(text) {
  const data = JSON.parse(text);
  if (data.format !== FORMAT) throw new Error("That file isn't a Builderballin map.");
  if ((data.version || 0) > VERSION) throw new Error('That map was made with a newer Builderballin. Refresh the page and try again.');
  const base = blankMap();
  const map = {
    ...base,
    ...data,
    meta: { ...base.meta, ...data.meta, gems: { ...base.meta.gems, ...(data.meta && data.meta.gems) } },
    rules: { ...base.rules, ...data.rules },
    assets: { ...(data.assets || {}) },
    objects: (data.objects || []).map((o) => (o.piece === 'g_marble' ? { ...o, piece: 'marble', scale: [1, 1, 1], p: {} } : o)).filter((o) => PIECE[o.piece]).map((o) => ({ ...newObject(o.piece, o.pos || [0, 0, 0]), ...o, look: { ice: false, visible: true, collide: true, ...o.look } }))
  };
  map.version = VERSION;
  map.oldScale = (data.version || 1) < 2;
  delete map.build;
  return map;
}

export function validate(map) {
  const issues = [];
  const count = (id) => map.objects.filter((o) => o.piece === id).length;
  if (!count('spawn')) issues.push({ level: 'bad', text: 'Add a Start so the game knows where to drop you.', fix: 'spawn' });
  if (count('spawn') > 1) issues.push({ level: 'warn', text: 'There are several Starts. Only the first one is used.' });
  if (!count('finish')) issues.push({ level: 'bad', text: 'Add a Dominus so runs can end.', fix: 'finish' });
  const kinds = map.objects.map((o) => PIECE[o.piece].kind);
  if (!kinds.some((k) => k === 'marble' || k === 'marbles' || k === 'spawner')) issues.push({ level: 'warn', text: 'No marbles yet. Floors hurt in Hyperballin, so you need marbles to ride.', fix: 'marble_line', cat: 'marbles' });
  const rollers = map.objects.filter((o) => (PIECE[o.piece].kind === 'spawner' || PIECE[o.piece].kind.startsWith('marble')) && (o.p.mode ?? PIECE[o.piece].params.find((x) => x.key === 'mode')?.def) === 'roll');
  if (rollers.length && !kinds.some((k) => k === 'smart' || k === 'solid' || k === 'game' || k === 'import')) issues.push({ level: 'warn', text: 'Some marbles roll but there is nothing under them. Add a track or switch them to Floats.', fix: 'track', cat: 'track' });
  const ids = new Set(map.objects.map((o) => o.id));
  for (const o of map.objects) {
    if (o.piece === 'teleport' && !ids.has(o.p.exit)) issues.push({ level: 'warn', text: `${o.name || 'A teleporter'} has no exit.`, id: o.id });
    if (o.piece === 'import' && !(map.assets && map.assets[o.p.ref])) issues.push({ level: 'warn', text: `${o.name || 'An imported build'} lost its file data. Delete it and import it again.`, id: o.id });
    if (o.anim && o.anim.start === 'trigger' && !map.objects.some((t) => t.piece === 'trigger' && (t.p.channel || 'A') === (o.anim.channel || 'A'))) issues.push({ level: 'warn', text: `${o.name || PIECE[o.piece].name} waits for channel ${o.anim.channel}, but no trigger sends it.`, id: o.id });
  }
  const fb = flatten(map);
  const parts = fb.parts.length;
  if (parts > 4000) issues.push({ level: 'warn', text: `${parts} parts is a lot. The game might stutter while loading it.` });
  if (fb.marbles.length > 400) issues.push({ level: 'warn', text: `${fb.marbles.length} marbles is a lot. The game itself caps out around 330.` });
  return issues;
}
