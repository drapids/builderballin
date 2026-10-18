import { blankMap, newObject, blankAnim } from './mapfile.js';

const D = Math.PI / 180;

function make(map, piece, pos, extra = {}) {
  const o = newObject(piece, pos.map((v) => Math.round(v)));
  if (extra.size) o.scale = extra.size.map((v) => v / 100);
  if (extra.scale) o.scale = extra.scale;
  if (extra.rot) o.rot = extra.rot.map((v) => Math.round(v * 100) / 100);
  if (extra.color) o.color = extra.color;
  if (extra.p) Object.assign(o.p, extra.p);
  if (extra.name) o.name = extra.name;
  if (extra.group) o.group = extra.group;
  if (extra.anim) o.anim = { ...blankAnim(), ...extra.anim };
  if (extra.look) Object.assign(o.look, extra.look);
  map.objects.push(o);
  return o;
}

function at(seg, v) {
  const c = Math.cos(seg.yaw * D);
  const s = Math.sin(seg.yaw * D);
  return [seg.pos[0] + v[0] * c - v[1] * s, seg.pos[1] + v[0] * s + v[1] * c, seg.pos[2] + v[2]];
}

class Path {
  constructor(map, pos, yaw, look = {}) {
    this.map = map;
    this.pos = pos.slice();
    this.yaw = yaw;
    this.width = look.width || 10000;
    this.walls = look.walls ?? 1800;
  }
  here() {
    return { pos: this.pos.slice(), yaw: this.yaw };
  }
  local(v) {
    return at(this.here(), v);
  }
  straight(length, drop, extra = {}) {
    const start = this.here();
    make(this.map, 'track', this.pos, { rot: [0, this.yaw, 0], group: 'track', p: { length, drop, width: extra.width || this.width, thickness: 400, walls: extra.walls ?? this.walls } });
    this.pos = this.local([length, 0, -drop]);
    return start;
  }
  right(radius, angle, rise, bank = 12) {
    const start = this.here();
    make(this.map, 'track_curve', this.pos, { rot: [0, this.yaw, 0], group: 'track', p: { radius, angle, rise, bank, width: this.width, thickness: 400, segments: Math.max(8, Math.round(angle / 4)) } });
    this.pos = this.local([radius * Math.sin(angle * D), radius * (1 - Math.cos(angle * D)), rise]);
    this.yaw += angle;
    return start;
  }
  kicker(radius, angle) {
    const start = this.here();
    make(this.map, 'track_kicker', this.pos, { rot: [0, this.yaw, 0], group: 'track', p: { radius, angle, width: this.width, thickness: 400, segments: 12 } });
    this.pos = this.local([radius * Math.sin(angle * D), 0, radius * (1 - Math.cos(angle * D))]);
    return start;
  }
}

function feed(map, seg, o = {}) {
  return make(map, 'spawner', at(seg, [o.ahead ?? 2500, o.side ?? 0, o.height ?? 3200]), {
    rot: [0, seg.yaw, 0],
    name: o.name || 'Marble feed',
    p: { interval: o.every ?? 0.3, spread: o.spread ?? 6500, speedMin: o.min ?? 4500, speedMax: o.max ?? 10000, angle: o.angle ?? 26, max: o.cap ?? 40, mode: o.mode || 'roll', color: o.color || 'random', channel: '' }
  });
}

function line(map, seg, v, o = {}) {
  return make(map, 'marble_line', at(seg, v), { rot: [0, seg.yaw + (o.yaw || 0), 0], p: { count: o.count ?? 8, spacing: o.spacing ?? 4400, rise: o.rise ?? 300, turn: o.turn ?? 0, sway: o.sway ?? 0, color: o.color || 'random', mode: o.mode || 'float' }, anim: o.anim });
}

function cloud(map, seg, v, o = {}) {
  return make(map, 'marble_cloud', at(seg, v), { rot: [0, seg.yaw, 0], p: { count: o.count ?? 24, sizeX: o.x ?? 30000, sizeY: o.y ?? 16000, sizeZ: o.z ?? 6000, gap: o.gap ?? 1200, seed: o.seed ?? 1, color: o.color || 'random', mode: o.mode || 'float' }, anim: o.anim });
}

function stream(map, seg, from, to, o = {}) {
  let x = from;
  let i = 0;
  const pattern = o.pattern || [9, -1, 5, 12, -1, 4, 8];
  const out = [];
  while (x < to) {
    const n = pattern[i % pattern.length];
    if (n < 0) x += o.gap ?? 9000;
    else {
      out.push(line(map, seg, [x, o.side ?? 0, o.height ?? 2600], { count: n, spacing: o.spacing ?? 3900, rise: o.rise ?? 120, sway: o.sway ?? 0, color: o.color, mode: o.mode }));
      x += n * (o.spacing ?? 3900) + (o.step ?? 2400);
    }
    i++;
  }
  return out;
}

function kill(map, center, size = 500000) {
  make(map, 'kill', center, { size: [size, size, 2000] });
}

function meta(m, name, desc, diff, gems) {
  m.meta.name = name;
  m.meta.description = desc;
  m.meta.difficulty = diff;
  m.meta.gems = gems;
}

function blank() {
  const m = blankMap();
  meta(m, 'Untitled map', '', 'Easy', { diamond: 0, emerald: 0, gold: 0, steel: 0, rock: 0 });
  const s = { pos: [0, 0, 0], yaw: 0 };
  make(m, 'spawn', [0, 0, 0], { p: { mode: 'float', speedMin: 3000, speedMax: 3000 } });
  line(m, s, [5200, 0, 600], { count: 7, spacing: 4600, rise: 250, color: 'cycle' });
  make(m, 'finish', at(s, [42000, 0, 3500]), { p: { size: 1 } });
  kill(m, [20000, 0, -40000], 250000);
  return m;
}

function simple() {
  const m = blankMap();
  meta(m, 'First roll', 'One long wooden ramp with marbles pouring down it and floaters at the bottom. Good for getting the feel.', 'Chill', { diamond: 22, emerald: 28, gold: 36, steel: 50, rock: 75 });
  const p = new Path(m, [0, 0, 0], 0, { width: 12000, walls: 2400 });
  const s1 = p.straight(70000, 12000);
  const s2 = p.straight(30000, 2500);
  const end = p.here();
  make(m, 'spawn', at(s1, [3000, 0, 0]), { rot: [0, 0, 0], p: { mode: 'roll', speedMin: 6000, speedMax: 8000, color: 'coral' } });
  feed(m, s1, { name: 'Top feed', every: 0.22, cap: 55 });
  feed(m, s2, { name: 'Bottom feed', every: 0.4, cap: 25, color: 'lime' });
  stream(m, end, 6000, 46000, { height: 2400, rise: 260, pattern: [10, -1, 8, 10], color: 'cycle' });
  make(m, 'track_pad', at(end, [58000, 0, 6500]), { size: [14000, 14000, 400] });
  make(m, 'finish', at(end, [58000, 0, 11000]), { p: { size: 1.3 } });
  make(m, 'sign', at(s1, [9000, -10000, 4500]), { rot: [0, 180, 0], p: { text: 'floors hurt. ride the marbles', height: 2200 } });
  kill(m, [60000, 0, -50000], 400000);
  return m;
}

function marbleRun() {
  const m = blankMap();
  meta(m, 'Marble run', 'Long wooden run that never stops pouring marbles. Ride one, hop to the next, and take the kicker into the floaters.', 'Easy', { diamond: 32, emerald: 40, gold: 50, steel: 68, rock: 100 });
  const p = new Path(m, [0, 0, 0], 0, { width: 11000, walls: 2200 });
  const s1 = p.straight(45000, 7000);
  const c1 = p.right(26000, 90, -4500, 14);
  const s2 = p.straight(55000, 9000);
  const c2 = p.right(26000, 90, -4500, 14);
  const s3 = p.straight(40000, 7000);
  p.kicker(16000, 32);
  const lip = p.here();
  make(m, 'spawn', at(s1, [3000, 0, 0]), { rot: [0, s1.yaw, 0], p: { mode: 'roll', speedMin: 7000, speedMax: 9000, color: 'coral' } });
  feed(m, s1, { name: 'Top feed', every: 0.2, cap: 45 });
  feed(m, c1, { name: 'Bend feed', every: 0.35, cap: 25, color: 'magenta', angle: 18 });
  feed(m, s2, { name: 'Middle feed', every: 0.25, cap: 35, color: 'lime' });
  feed(m, s3, { name: 'Bottom feed', every: 0.3, cap: 30, color: 'yellow' });
  stream(m, s1, 4000, 42000, { side: 7800, height: 4200, rise: -120, pattern: [6, -1, 4, 7], color: 'mint' });
  stream(m, s2, 6000, 52000, { side: -7800, height: 4600, rise: -140, pattern: [5, 8, -1, 6], color: 'ember' });
  make(m, 'checkpoint', at(s2, [6000, 0, 3500]), { rot: [0, s2.yaw, 0], size: [9000, 11000, 7000] });
  make(m, 'checkpoint', at(s3, [6000, 0, 3500]), { rot: [0, s3.yaw, 0], size: [9000, 11000, 7000], p: { order: 2 } });
  cloud(m, lip, [22000, 0, 4500], { count: 30, x: 26000, y: 14000, z: 5000, seed: 4, color: 'cycle' });
  line(m, lip, [38000, 0, 6200], { count: 6, spacing: 4200, rise: 650, color: 'yellow' });
  make(m, 'track_pad', at(lip, [70000, 0, 10000]), { rot: [0, lip.yaw, 0], size: [16000, 16000, 400] });
  make(m, 'finish', at(lip, [70000, 0, 14500]), { rot: [0, lip.yaw, 0], p: { size: 1.4 } });
  make(m, 'g_pillar', at(c1, [12000, 34000, -52000]));
  make(m, 'g_pillar', at(c2, [12000, 34000, -60000]));
  make(m, 'light', at(c2, [0, 26000, 12000]), { color: '#ffd9a0', p: { intensity: 500000, radius: 60000 } });
  kill(m, [40000, 50000, -60000]);
  return m;
}

function corkscrew() {
  const m = blankMap();
  meta(m, 'Corkscrew', 'A banked spiral winding down a tower with marbles racing the whole way round. The floaters in the middle are a shortcut if you can stick it.', 'Medium', { diamond: 36, emerald: 44, gold: 56, steel: 75, rock: 110 });
  const R = 30000;
  const p = new Path(m, [0, 0, 0], 0, { width: 10000, walls: 1600 });
  const s0 = p.straight(22000, 3000);
  const center = p.local([0, R, 0]);
  const turns = [];
  for (let i = 0; i < 7; i++) turns.push(p.right(R, 90, -6500, 18));
  const s1 = p.straight(30000, 5000);
  p.kicker(14000, 34);
  const lip = p.here();
  make(m, 'spawn', at(s0, [2500, 0, 0]), { rot: [0, s0.yaw, 0], p: { mode: 'roll', speedMin: 8000, speedMax: 10000, color: 'mint' } });
  feed(m, s0, { name: 'Tower feed', every: 0.18, cap: 50, min: 6000, max: 11000 });
  feed(m, turns[2], { name: 'Upper feed', every: 0.45, cap: 20, color: 'magenta', height: 3600, angle: 14 });
  feed(m, turns[5], { name: 'Lower feed', every: 0.45, cap: 20, color: 'yellow', height: 3600, angle: 14 });
  make(m, 'g_pillar', [center[0], center[1], center[2] - 52000], { scale: [3, 3, 1.4] });
  make(m, 'marble_spiral', [center[0], center[1], center[2] - 44000], { p: { count: 26, radius: 9500, turn: -32, rise: 1600, color: 'yellow', mode: 'float' } });
  make(m, 'marble_ring', [center[0], center[1], center[2] - 14000], { p: { count: 16, radius: 16000, wobble: 2200, waves: 3, color: 'cycle', mode: 'float' } });
  make(m, 'marble_ring', [center[0], center[1], center[2] - 34000], { p: { count: 12, radius: 18000, wobble: 1500, waves: 2, color: 'lime', mode: 'drift' } });
  make(m, 'checkpoint', at(turns[3], [0, 0, 3500]), { rot: [0, turns[3].yaw, 0], size: [10000, 10000, 7000] });
  make(m, 'checkpoint', at(s1, [5000, 0, 3500]), { rot: [0, s1.yaw, 0], size: [10000, 10000, 7000], p: { order: 2 } });
  make(m, 'marble_zig', at(lip, [8000, 0, 3000]), { rot: [0, lip.yaw, 0], p: { count: 10, spacing: 4200, offset: 2800, rise: 600, color: 'cycle', mode: 'float' } });
  cloud(m, lip, [60000, 0, 9000], { count: 18, x: 16000, y: 14000, z: 6000, seed: 9, color: 'magenta' });
  make(m, 'bounce', at(lip, [74000, 0, 4000]), { rot: [0, lip.yaw, 0], size: [5000, 5000, 800], p: { power: 9000, keep: true } });
  make(m, 'finish', at(lip, [82000, 0, 20000]), { rot: [0, lip.yaw, 0], p: { size: 1.5 } });
  make(m, 'light', [center[0], center[1], center[2] - 10000], { color: '#9dffca', p: { intensity: 600000, radius: 70000 } });
  kill(m, [center[0], center[1], -90000]);
  return m;
}

function feverGap() {
  const m = blankMap();
  meta(m, 'Fever gap', 'A half pipe into a canyon full of drifting marbles in slow motion, then moving lines and hook points. Use every ability you have.', 'Hard', { diamond: 46, emerald: 58, gold: 74, steel: 100, rock: 145 });
  const p = new Path(m, [0, 0, 0], 0, { width: 9000, walls: 1500 });
  const s0 = p.straight(30000, 6000);
  const split = p.here();
  const tilt = Math.atan2(6000, 40000);
  make(m, 'track_pipe', at(split, [0, 0, -150]), { rot: [-tilt / D, split.yaw, 0], p: { radius: 6000, length: 40000, sides: 14, thickness: 300, sweep: 170 } });
  const p2 = new Path(m, at(split, [40000 * Math.cos(tilt), 0, -40000 * Math.sin(tilt)]), split.yaw, { width: 9000, walls: 1500 });
  const s1 = p2.straight(25000, 7000);
  p2.right(22000, 60, -3500, 16);
  const s2 = p2.straight(30000, 5000);
  p2.kicker(12000, 40);
  const lip = p2.here();
  make(m, 'spawn', at(s0, [2500, 0, 0]), { rot: [0, s0.yaw, 0], p: { mode: 'roll', speedMin: 9000, speedMax: 11000, color: 'ember' } });
  feed(m, s0, { name: 'Start feed', every: 0.16, cap: 40, min: 7000, max: 12000 });
  feed(m, s1, { name: 'Pipe exit feed', every: 0.3, cap: 25, color: 'magenta' });
  feed(m, s2, { name: 'Last feed', every: 0.3, cap: 25, color: 'mint' });
  make(m, 'checkpoint', at(s1, [4000, 0, 3500]), { rot: [0, s1.yaw, 0], size: [9000, 9000, 7000] });
  const gap = at(lip, [32000, 0, 6000]);
  make(m, 'slowmo', gap, { rot: [0, lip.yaw, 0], size: [50000, 32000, 26000], p: { speed: 0.5 } });
  cloud(m, lip, [32000, 0, 6000], { count: 55, x: 46000, y: 26000, z: 14000, gap: 1300, seed: 11, color: 'cycle', mode: 'drift' });
  make(m, 'g_hookpoint', at(lip, [24000, -9000, 18000]), { scale: [0.6, 0.6, 0.6] });
  make(m, 'g_hookpoint', at(lip, [46000, 8000, 21000]), { scale: [0.6, 0.6, 0.6] });
  line(m, lip, [64000, 0, 9000], { count: 7, spacing: 4300, rise: 700, color: 'yellow', sway: 2600, anim: { move: { points: [[0, 4200, 0]], duration: 2.4, mode: 'pingpong', ease: 'smooth', delay: 0 } } });
  line(m, lip, [64000, -9000, 12500], { count: 5, spacing: 5200, rise: 500, color: 'lime', anim: { move: { points: [[0, 0, 3500]], duration: 1.8, mode: 'pingpong', ease: 'smooth', delay: 0.6 } } });
  make(m, 'track_pad', at(lip, [104000, 0, 14000]), { rot: [0, lip.yaw, 0], size: [12000, 12000, 400] });
  make(m, 'finish', at(lip, [104000, 0, 18500]), { rot: [0, lip.yaw, 0], p: { size: 1.3 } });
  make(m, 'light', gap, { color: '#ff8fb8', p: { intensity: 700000, radius: 60000 } });
  kill(m, [60000, 20000, -70000]);
  return m;
}

function skyField() {
  const m = blankMap();
  meta(m, 'Sky field', 'No track at all. Islands of floating marbles with empty sky between them. Pick a line and keep moving.', 'Medium', { diamond: 40, emerald: 50, gold: 64, steel: 86, rock: 125 });
  const s = { pos: [0, 0, 0], yaw: 0 };
  make(m, 'spawn', [0, 0, 0], { p: { mode: 'float', speedMin: 5000, speedMax: 6000, color: 'yellow' } });
  const isl = [
    [16000, 0, 1500, 28, 18000, 14000, 4000, 'coral'],
    [52000, 12000, 4500, 34, 22000, 18000, 6000, 'lime'],
    [92000, -6000, 8500, 30, 20000, 16000, 7000, 'magenta'],
    [130000, 14000, 13000, 36, 24000, 20000, 8000, 'mint'],
    [170000, 0, 18000, 26, 18000, 14000, 6000, 'cycle']
  ];
  isl.forEach(([x, y, z, n, sx, sy, sz, c], i) => cloud(m, s, [x, y, z], { count: n, x: sx, y: sy, z: sz, seed: 20 + i, color: c, mode: i % 2 ? 'drift' : 'float' }));
  line(m, s, [30000, 4000, 2500], { count: 5, spacing: 4200, rise: 500, yaw: 20, color: 'yellow' });
  line(m, s, [108000, 6000, 10000], { count: 5, spacing: 4400, rise: 700, yaw: 25, color: 'yellow' });
  make(m, 'checkpoint', at(s, [92000, -6000, 10000]), { size: [12000, 12000, 9000] });
  make(m, 'finish', at(s, [196000, 0, 24000]), { p: { size: 1.4 } });
  make(m, 'light', at(s, [92000, 0, 20000]), { color: '#dddaff', p: { intensity: 700000, radius: 90000 } });
  kill(m, [100000, 0, -40000]);
  return m;
}

function arena() {
  const m = blankMap();
  meta(m, 'Marble arena', 'A walled bowl with four spawners firing marbles at each other. The Dominus floats over the middle, get up there.', 'Hard', { diamond: 30, emerald: 38, gold: 50, steel: 70, rock: 100 });
  const R = 40000;
  make(m, 'track_pad', [0, 0, -400], { size: [R * 2.2, R * 2.2, 400] });
  for (let i = 0; i < 4; i++) {
    const a = i * 90;
    const c = Math.cos(a * D);
    const s = Math.sin(a * D);
    make(m, 'wall', [c * R * 1.1, s * R * 1.1, 4000], { rot: [0, a + 90, 0], size: [R * 2.2, 800, 9000], color: '#2a2740' });
    feed(m, { pos: [c * (R - 4000), s * (R - 4000), 0], yaw: a + 180 }, { name: 'Corner feed', every: 0.28, cap: 30, min: 8000, max: 15000, angle: 50, ahead: 0, height: 2400, color: ['coral', 'lime', 'magenta', 'yellow'][i] });
  }
  make(m, 'spawn', [-R * 0.6, 0, 0], { rot: [0, 0, 0], p: { mode: 'roll', speedMin: 6000, speedMax: 8000, color: 'mint' } });
  make(m, 'marble_ring', [0, 0, 7000], { p: { count: 18, radius: 22000, wobble: 2000, waves: 3, color: 'cycle', mode: 'float' } });
  make(m, 'marble_spiral', [0, 0, 9000], { p: { count: 22, radius: 9000, turn: 34, rise: 1100, color: 'yellow', mode: 'float' } });
  make(m, 'g_pillar', [0, 0, -2000], { scale: [2, 2, 0.8] });
  make(m, 'finish', [0, 0, 38000], { p: { size: 1.6 } });
  make(m, 'light', [0, 0, 22000], { color: '#ffd9a0', p: { intensity: 800000, radius: 90000 } });
  kill(m, [0, 0, -40000], 300000);
  return m;
}

function gauntlet() {
  const m = blankMap();
  meta(m, 'Gauntlet', 'Steep, fast and mean. Rollers flying down a narrow chute, moving floaters, crosswind and long gaps where nothing is there for you.', 'Brutal', { diamond: 50, emerald: 62, gold: 80, steel: 110, rock: 160 });
  const p = new Path(m, [0, 0, 0], 0, { width: 7500, walls: 1200 });
  const s1 = p.straight(50000, 16000);
  const c1 = p.right(18000, 120, -6000, 22);
  const s2 = p.straight(40000, 14000);
  p.kicker(10000, 45);
  const lip = p.here();
  make(m, 'spawn', at(s1, [2500, 0, 0]), { rot: [0, 0, 0], p: { mode: 'roll', speedMin: 11000, speedMax: 13000, color: 'ember' } });
  feed(m, s1, { name: 'Chute feed', every: 0.14, cap: 45, min: 9000, max: 15000, spread: 5000 });
  feed(m, c1, { name: 'Bend feed', every: 0.3, cap: 20, color: 'magenta', angle: 10 });
  feed(m, s2, { name: 'Drop feed', every: 0.22, cap: 30, color: 'yellow' });
  make(m, 'wind', at(s2, [20000, 0, 5000]), { rot: [0, s2.yaw + 90, 0], size: [18000, 30000, 12000], p: { force: 2600 } });
  make(m, 'checkpoint', at(s2, [3000, 0, 3000]), { rot: [0, s2.yaw, 0], size: [8000, 8000, 6000] });
  line(m, lip, [14000, 0, 4000], { count: 6, spacing: 4000, rise: 400, color: 'lime', anim: { move: { points: [[0, 6000, 0]], duration: 1.6, mode: 'pingpong', ease: 'smooth', delay: 0 } } });
  line(m, lip, [56000, 0, 7000], { count: 5, spacing: 4200, rise: 500, color: 'mint', anim: { move: { points: [[0, -6000, 2000]], duration: 1.3, mode: 'pingpong', ease: 'smooth', delay: 0.4 } } });
  cloud(m, lip, [84000, 0, 10000], { count: 22, x: 14000, y: 12000, z: 8000, seed: 33, color: 'cycle', mode: 'drift' });
  make(m, 'finish', at(lip, [104000, 0, 22000]), { rot: [0, lip.yaw, 0], p: { size: 1.1 } });
  kill(m, [60000, 30000, -80000]);
  return m;
}

export const TEMPLATES = [
  { id: 'blank', name: 'Blank', blurb: 'A start, a few marbles and the Dominus. Build from there.', make: blank },
  { id: 'simple', name: 'First roll', blurb: 'One ramp, lots of marbles. Learn the feel.', make: simple },
  { id: 'run', name: 'Marble run', blurb: 'Long wooden run, four spawners, a kicker into floaters.', make: marbleRun },
  { id: 'cork', name: 'Corkscrew', blurb: 'Banked spiral down a tower with a floating shortcut.', make: corkscrew },
  { id: 'sky', name: 'Sky field', blurb: 'Islands of floating marbles with nothing between them.', make: skyField },
  { id: 'fever', name: 'Fever gap', blurb: 'Half pipe, slow motion canyon, drifters, hook points.', make: feverGap },
  { id: 'arena', name: 'Marble arena', blurb: 'Four spawners firing into a bowl. Climb to the Dominus.', make: arena },
  { id: 'gauntlet', name: 'Gauntlet', blurb: 'Steep chute, crosswind, moving floaters, long gaps.', make: gauntlet }
];
