export const MARBLE_R = 778;
export const M = 100;

export const GEMS = [
  { id: 'coral', name: 'Coral', surface: '#ff8165', deep: '#2d2c1d', glow: '#180100', mat: '/Game/Assets/Materials/MI_GemBasic2', odds: 0.386 },
  { id: 'ember', name: 'Ember', surface: '#ff8165', deep: '#3a1a10', glow: '#180100', mat: '/Game/Assets/Materials/MI_GemBasic1', odds: 0.077, noise: true },
  { id: 'lime', name: 'Lime', surface: '#7fe100', deep: '#360800', glow: '#001000', mat: '/Game/Assets/Materials/MI_GemBasic4', odds: 0.2 },
  { id: 'yellow', name: 'Yellow', surface: '#fff600', deep: '#443a00', glow: '#1a1600', mat: '/Game/Assets/Materials/MI_GemBasic6', odds: 0.133 },
  { id: 'magenta', name: 'Magenta', surface: '#e400db', deep: '#360800', glow: '#0d221c', mat: '/Game/Assets/Materials/MI_GemBasic5', odds: 0.111 },
  { id: 'mint', name: 'Mint', surface: '#9dffca', deep: '#002b79', glow: '#00100d', mat: '/Game/Assets/Materials/MI_GemBasic3', odds: 0.093 },
  { id: 'feather', name: 'Feather', surface: '#ece8df', deep: '#9a958c', glow: '#000000', mat: '/Game/Marble_Materials_4K/Materials/MI_Marble_01', odds: 0, stone: true }
];
export const DOMINUS = { path: '/Game/Assets/Dominus/scene/StaticMeshes/BP_Dominus', reach: 3000 };
export const GEM = Object.fromEntries(GEMS.map((g) => [g.id, g]));
const CYCLE = ['coral', 'lime', 'yellow', 'magenta', 'mint'];

export const COLOR_CHOICES = [['random', 'Random'], ['cycle', 'Rainbow'], ...GEMS.map((g) => [g.id, g.name])];
export const MODE_CHOICES = [['float', 'Floats'], ['drift', 'Drifts'], ['roll', 'Rolls']];
export const MODE_INFO = {
  float: 'Hangs in the air and drifts back home after you jump off it.',
  drift: 'No gravity. It keeps going wherever you push it.',
  roll: 'Normal gravity, like in the game. Put a track under it.'
};

function hash(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) h = Math.imul(h ^ str.charCodeAt(i), 16777619);
  return h >>> 0;
}
export function rng(seed) {
  let s = (typeof seed === 'string' ? hash(seed) : seed >>> 0) || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return (s >>> 0) / 4294967296;
  };
}

export function pickGem(setting, index, seedKey) {
  if (GEM[setting]) return setting;
  if (setting === 'cycle') return CYCLE[index % CYCLE.length];
  const r = rng(`${seedKey}:${index}`)();
  let acc = 0;
  for (const g of GEMS) {
    acc += g.odds;
    if (r < acc) return g.id;
  }
  return 'coral';
}

export const GLAZES = [
  ['Teak', '#a8703f'],
  ['Pine', '#d9a066'],
  ['Walnut', '#5e3a22'],
  ['Concrete', '#9a9a96'],
  ['Night', '#2a2740'],
  ['Moon', '#f3ead8'],
  ['Lavender', '#b9b2f2'],
  ['Chrome', '#5fc8ff'],
  ['Coral', '#ff8165'],
  ['Lime', '#7fe100'],
  ['Magenta', '#e400db'],
  ['Yellow', '#fff600']
];

export const ZONE_COLORS = {
  finish: '#5fc8ff',
  checkpoint: '#fff600',
  kill: '#ff4a3d',
  bounce: '#7fe100',
  boost: '#5fc8ff',
  speed: '#b9b2f2',
  gravity: '#8f86ff',
  wind: '#9dffca',
  teleport: '#e400db',
  trigger: '#ff8165',
  message: '#dddaff',
  slowmo: '#b9b2f2'
};

const D = Math.PI / 180;
const cube = (pos, rot, size, extra = {}) => ({ kind: 'shape', shape: 'cube', pos, rot, scale: [size[0] / 100, size[1] / 100, size[2] / 100], ...extra });

function arcParts(p, vertical, extra = {}) {
  const parts = [];
  const n = Math.max(2, Math.round(p.segments));
  const total = p.angle * D;
  const segAng = total / n;
  const chord = 2 * p.radius * Math.sin(segAng / 2) + 20;
  for (let i = 0; i < n; i++) {
    const a = segAng * (i + 0.5);
    if (!vertical) {
      const x = p.radius * Math.sin(a);
      const y = p.radius - p.radius * Math.cos(a);
      const z = (p.rise || 0) * ((i + 0.5) / n);
      const pitch = p.rise ? Math.atan2(p.rise / n, chord) / D : 0;
      parts.push(cube([x, y, z], [pitch, a / D, p.bank || 0], [chord, p.width, p.thickness], extra));
    } else {
      const x = p.radius * Math.sin(a);
      const z = p.radius - p.radius * Math.cos(a);
      const y = (p.shift || 0) * ((i + 0.5) / n);
      parts.push(cube([x, y, z], [a / D, 0, 0], [chord, p.width, p.thickness], extra));
    }
  }
  return parts;
}

function ringParts(radius, sides, length, thickness, from = 0, to = 360, slabWidth, extra = {}) {
  const parts = [];
  const span = (to - from) * D;
  const step = span / sides;
  const w = slabWidth ?? 2 * radius * Math.tan(step / 2) + 20;
  for (let i = 0; i < sides; i++) {
    const a = from * D + step * (i + 0.5);
    const y = Math.sin(a) * radius;
    const z = -Math.cos(a) * radius;
    parts.push(cube([0, y, z + radius], [0, 0, a / D], [length, w, thickness], extra));
  }
  return parts;
}

function walls(p, len, wood) {
  if (!p.walls) return [];
  const h = p.walls;
  const t = Math.max(100, p.thickness);
  return [-1, 1].map((s) => cube([len / 2, s * (p.width / 2 + t / 2), h / 2], [0, 0, 0], [len, t, h + p.thickness], wood));
}

const WOOD = { mat: 'wood' };
const len = (key, label, min, max, def, step = 100) => ({ key, label, min, max, step, def, unit: 'm', div: M });
const deg = (key, label, min, max, def, step = 1) => ({ key, label, min, max, step, def, unit: '°' });
const num = (key, label, min, max, def, step = 1) => ({ key, label, min, max, step, def });
const colorParam = (def = 'random') => ({ key: 'color', label: 'Colour', type: 'gem', def });
const modeParam = (def = 'float') => ({ key: 'mode', label: 'Behaviour', type: 'choice', options: MODE_CHOICES, def });

function marbleLine(p) {
  const out = [];
  let x = 0, y = 0, z = 0, yaw = 0;
  for (let i = 0; i < p.count; i++) {
    const side = p.sway ? Math.sin(i * Math.PI * 0.5) * p.sway : 0;
    out.push({ pos: [x - Math.sin(yaw) * side, y + Math.cos(yaw) * side, z], i });
    yaw += p.turn * D;
    x += Math.cos(yaw) * p.spacing;
    y += Math.sin(yaw) * p.spacing;
    z += p.rise;
  }
  return out;
}

function marbleRing(p) {
  return Array.from({ length: p.count }, (_, i) => {
    const a = (i / p.count) * Math.PI * 2;
    return { pos: [Math.cos(a) * p.radius, Math.sin(a) * p.radius, Math.sin(a * p.waves) * p.wobble], i };
  });
}

function marbleSpiral(p) {
  return Array.from({ length: p.count }, (_, i) => {
    const a = i * p.turn * D;
    return { pos: [Math.cos(a) * p.radius, Math.sin(a) * p.radius, i * p.rise], i };
  });
}

function marbleCloud(p) {
  const r = rng(`cloud:${p.seed}`);
  const out = [];
  let tries = 0;
  const gap = MARBLE_R * 2 + p.gap;
  while (out.length < p.count && tries < p.count * 60) {
    tries++;
    const c = [(r() - 0.5) * p.sizeX, (r() - 0.5) * p.sizeY, (r() - 0.5) * p.sizeZ];
    if (out.every((o) => Math.hypot(o.pos[0] - c[0], o.pos[1] - c[1], o.pos[2] - c[2]) >= gap)) out.push({ pos: c, i: out.length });
  }
  return out;
}

function marbleZig(p) {
  return Array.from({ length: p.count }, (_, i) => ({ pos: [i * p.spacing, (i % 2 ? 1 : -1) * p.offset, i * p.rise], i }));
}

const pushRange = (minDef = 0, maxDef = 0, label = 'Push') => [
  { ...len('pushMin', `${label}, slowest`, 0, 30000, minDef, 100), unit: 'm/s', pairMax: 'pushMax' },
  { ...len('pushMax', `${label}, fastest`, 0, 30000, maxDef, 100), unit: 'm/s', pairMin: 'pushMin' }
];
const marbleBase = [colorParam(), modeParam()];

export function speedRange(p, minKey = 'pushMin', maxKey = 'pushMax', legacy = 'push', legacyMin = 1) {
  const old = p[legacy];
  let lo = p[minKey] ?? (old !== undefined ? old * legacyMin : 0);
  let hi = p[maxKey] ?? (old !== undefined ? old : 0);
  if (lo > hi) [lo, hi] = [hi, lo];
  return [lo, hi];
}

export const PIECES = [
  { id: 'marble', cat: 'marbles', name: 'Marble', kind: 'marble', desc: 'One marble. Same size as every marble in the game', params: [...marbleBase, ...pushRange()] },
  { id: 'marble_line', cat: 'marbles', name: 'Marble line', kind: 'marbles', desc: 'A row of marbles to hop along. Bend it, climb it, wiggle it', gen: marbleLine, params: [...marbleBase, num('count', 'Marbles', 2, 80, 8), len('spacing', 'Gap between', 1600, 20000, 4800), len('rise', 'Climb each', -5000, 5000, 300, 50), deg('turn', 'Turn each', -60, 60, 0), len('sway', 'Wiggle', 0, 8000, 0, 100), ...pushRange()] },
  { id: 'marble_zig', cat: 'marbles', name: 'Marble zigzag', kind: 'marbles', desc: 'Marbles left, right, left, right', gen: marbleZig, params: [...marbleBase, num('count', 'Marbles', 2, 60, 8), len('spacing', 'Step forward', 1600, 15000, 3800), len('offset', 'Step aside', 0, 10000, 2200), len('rise', 'Climb each', -4000, 4000, 200, 50), ...pushRange()] },
  { id: 'marble_ring', cat: 'marbles', name: 'Marble ring', kind: 'marbles', desc: 'A circle of marbles around a point', gen: marbleRing, params: [...marbleBase, num('count', 'Marbles', 3, 60, 10), len('radius', 'Radius', 2000, 40000, 8000), len('wobble', 'Wave height', 0, 10000, 0), num('waves', 'Waves', 0, 8, 2), ...pushRange()] },
  { id: 'marble_spiral', cat: 'marbles', name: 'Marble spiral', kind: 'marbles', desc: 'Corkscrew of marbles going up', gen: marbleSpiral, params: [...marbleBase, num('count', 'Marbles', 3, 80, 14), len('radius', 'Radius', 1500, 30000, 6000), deg('turn', 'Turn each', 5, 120, 40), len('rise', 'Climb each', -4000, 4000, 900, 50), ...pushRange()] },
  { id: 'marble_cloud', cat: 'marbles', name: 'Marble cloud', kind: 'marbles', desc: 'A loose swarm of marbles in a box', gen: marbleCloud, params: [colorParam(), modeParam('drift'), num('count', 'Marbles', 3, 120, 24), len('sizeX', 'Length', 2000, 200000, 40000, 500), len('sizeY', 'Width', 2000, 200000, 24000, 500), len('sizeZ', 'Height', 0, 100000, 8000, 500), len('gap', 'Min gap', 0, 10000, 1500), num('seed', 'Shuffle', 1, 999, 1), ...pushRange()] },
  {
    id: 'spawner', cat: 'marbles', name: 'Marble spawner', kind: 'spawner', desc: 'Throws marbles out on a timer, like the game does on every stage',
    params: [colorParam(), modeParam('roll'), { ...num('interval', 'Every', 0.1, 10, 0.35, 0.05), unit: 's' }, len('spread', 'Spread', 0, 30000, 6500), { ...len('speedMin', 'Throw, slowest', 0, 30000, 4500, 100), unit: 'm/s', pairMax: 'speedMax' }, { ...len('speedMax', 'Throw, fastest', 0, 30000, 13000, 100), unit: 'm/s', pairMin: 'speedMin' }, deg('angle', 'Throw angle', 0, 180, 60), num('max', 'Max alive', 1, 200, 60), { key: 'channel', label: 'Wait for channel', type: 'text', def: '' }]
  },

  { id: 'track', cat: 'track', name: 'Track', kind: 'smart', mat: 'wood', color: '#a8703f', desc: 'Straight wooden track for marbles to roll on', params: [len('length', 'Length', 2000, 200000, 30000, 500), len('width', 'Width', 2000, 40000, 9000), len('thickness', 'Thickness', 50, 3000, 400, 50), len('walls', 'Side walls', 0, 8000, 0, 100), len('drop', 'Drop', -50000, 50000, 0, 100)], build: (p) => {
    const pitch = Math.atan2(-p.drop, p.length) / D;
    const L = Math.hypot(p.length, p.drop);
    return [cube([p.length / 2, 0, -p.drop / 2 - p.thickness / 2], [pitch, 0, 0], [L, p.width, p.thickness], WOOD), ...walls(p, p.length, WOOD).map((w) => ({ ...w, pos: [w.pos[0], w.pos[1], w.pos[2] - p.drop / 2], rot: [pitch, 0, 0], scale: [L / 100, w.scale[1], w.scale[2]] }))];
  } },
  { id: 'track_curve', cat: 'track', name: 'Track bend', kind: 'smart', mat: 'wood', color: '#a8703f', desc: 'Wooden bend that can bank and drop', params: [len('radius', 'Radius', 3000, 200000, 20000, 500), deg('angle', 'Turn', 10, 360, 90, 5), len('width', 'Width', 2000, 40000, 9000), len('thickness', 'Thickness', 50, 3000, 400, 50), deg('bank', 'Bank', -60, 60, 10), len('rise', 'Climb', -60000, 60000, -3000, 100), num('segments', 'Smoothness', 4, 96, 24)], build: (p) => arcParts({ ...p, rise: p.rise }, false, WOOD).map((q) => ({ ...q, pos: [q.pos[0], q.pos[1], q.pos[2] - p.thickness / 2] })) },
  { id: 'track_pipe', cat: 'track', name: 'Half pipe', kind: 'smart', mat: 'wood', color: '#a8703f', desc: 'U-shaped channel that keeps marbles in', params: [len('radius', 'Radius', 2000, 40000, 6000), len('length', 'Length', 2000, 200000, 30000, 500), num('sides', 'Sides', 4, 32, 12), len('thickness', 'Thickness', 50, 2000, 300, 50), deg('sweep', 'Sweep', 60, 300, 160, 5)], build: (p) => ringParts(p.radius, p.sides, p.length, p.thickness, -p.sweep / 2, p.sweep / 2, undefined, WOOD).map((q) => ({ ...q, pos: [p.length / 2, q.pos[1], q.pos[2]] })) },
  { id: 'track_kicker', cat: 'track', name: 'Kicker', kind: 'smart', mat: 'wood', color: '#a8703f', desc: 'Curves up at the end and throws marbles into the air', params: [len('radius', 'Radius', 3000, 100000, 15000, 500), deg('angle', 'Lip angle', 10, 80, 35), len('width', 'Width', 2000, 40000, 9000), len('thickness', 'Thickness', 50, 3000, 400, 50), num('segments', 'Smoothness', 4, 48, 12)], build: (p) => {
    const out = [];
    const n = p.segments;
    const seg = (p.angle * D) / n;
    const chord = 2 * p.radius * Math.sin(seg / 2) + 20;
    for (let i = 0; i < n; i++) {
      const a = seg * (i + 0.5);
      out.push(cube([p.radius * Math.sin(a), 0, p.radius - p.radius * Math.cos(a) - p.thickness / 2], [a / D, 0, 0], [chord, p.width, p.thickness], WOOD));
    }
    return out;
  } },
  { id: 'track_pad', cat: 'track', name: 'Wide deck', kind: 'solid', mat: 'wood', color: '#a8703f', size: [40000, 40000, 400], desc: 'Big flat wooden deck' },

  { id: 'spawn', cat: 'play', name: 'Start', kind: 'marker', marker: 'spawn', color: '#5fc8ff', desc: 'Where you start. You get dropped onto a marble here, like the game does', params: [{ ...len('speedMin', 'Start speed, slowest', 0, 30000, 10000, 100), unit: 'm/s', pairMax: 'speedMax' }, { ...len('speedMax', 'Start speed, fastest', 0, 30000, 10000, 100), unit: 'm/s', pairMin: 'speedMin' }, colorParam('random'), modeParam('roll')] },
  { id: 'finish', cat: 'play', name: 'Dominus', kind: 'dominus', desc: 'The finish from the game. Touch it to go on to your next custom map', params: [num('size', 'Size', 0.25, 10, 1, 0.05)] },
  { id: 'checkpoint', cat: 'play', name: 'Checkpoint', kind: 'zone', zone: 'checkpoint', size: [6000, 6000, 6000], desc: 'Respawn here after a fall', params: [num('order', 'Order', 1, 99, 1)] },
  { id: 'kill', cat: 'play', name: 'Kill zone', kind: 'zone', zone: 'kill', size: [100000, 100000, 2000], desc: 'Sends you back to your last checkpoint' },
  { id: 'bounce', cat: 'play', name: 'Bounce pad', kind: 'zone', zone: 'bounce', size: [3000, 3000, 800], desc: 'Launches you straight up', params: [{ ...len('power', 'Power', 500, 30000, 6000, 100), unit: 'm/s' }, { key: 'keep', label: 'Keep sideways speed', type: 'bool', def: true }], pad: true },
  { id: 'boost', cat: 'play', name: 'Boost pad', kind: 'zone', zone: 'boost', size: [4000, 3000, 800], desc: 'Shoves you the way the arrow points', params: [{ ...len('power', 'Power', 500, 40000, 9000, 100), unit: 'm/s' }, { ...len('lift', 'Lift', 0, 20000, 800, 100), unit: 'm/s' }], pad: true },
  { id: 'speed', cat: 'play', name: 'Speed zone', kind: 'zone', zone: 'speed', size: [6000, 6000, 6000], desc: 'Multiplies your speed once on entry', params: [num('mult', 'Multiplier', 0.1, 5, 1.6, 0.05)] },
  { id: 'gravity', cat: 'play', name: 'Gravity zone', kind: 'zone', zone: 'gravity', size: [20000, 20000, 20000], desc: 'Changes gravity while you are inside', params: [num('scale', 'Gravity', -2, 4, 0.3, 0.05)] },
  { id: 'wind', cat: 'play', name: 'Wind', kind: 'zone', zone: 'wind', size: [20000, 8000, 8000], desc: 'Pushes you along the arrow while inside', params: [{ ...len('force', 'Strength', 100, 20000, 3000, 100), unit: 'm/s²' }] },
  { id: 'slowmo', cat: 'play', name: 'Slow motion', kind: 'zone', zone: 'slowmo', size: [15000, 15000, 10000], desc: 'Time slows down inside', params: [num('speed', 'Time speed', 0.05, 1, 0.4, 0.05)] },
  { id: 'teleport', cat: 'play', name: 'Teleporter', kind: 'zone', zone: 'teleport', size: [3000, 3000, 3000], desc: 'Comes with an exit you can move', params: [{ key: 'keep', label: 'Keep speed', type: 'bool', def: true }] },
  { id: 'exit', cat: 'play', name: 'Teleport exit', kind: 'marker', marker: 'exit', color: '#e400db', desc: 'Where a teleporter drops you', hidden: true },
  { id: 'trigger', cat: 'play', name: 'Trigger', kind: 'zone', zone: 'trigger', size: [6000, 6000, 6000], desc: 'Starts anything listening on its channel', params: [{ key: 'channel', label: 'Channel', type: 'text', def: 'A' }, { key: 'once', label: 'Only once', type: 'bool', def: true }] },
  { id: 'message', cat: 'play', name: 'Message', kind: 'zone', zone: 'message', size: [8000, 8000, 6000], desc: 'Shows text when entered', params: [{ key: 'text', label: 'Text', type: 'text', def: 'keep rolling' }] },

  { id: 'g_tracks', cat: 'game', name: 'Game track', kind: 'game', mesh: '/Game/Assets/TrackPieces/tracks1_3a1/StaticMeshes/tracks1_3a1', box: { o: [-10650, 0, 2343], e: [10650, 16528, 3911] }, wood: true, desc: 'The wooden track mesh every stage is built from' },
  { id: 'g_track_round', cat: 'game', name: 'Green track', kind: 'game', mesh: '/Game/Assets/TrackPieces/greentrackrounded/StaticMeshes/greentrackrounded', box: { o: [0, 0, -2786], e: [14139, 25854, 5027] } },
  { id: 'g_large_green', cat: 'game', name: 'Big green', kind: 'game', mesh: '/Game/Assets/TrackPieces/largegreenexpg/StaticMeshes/largegreenexpg', box: { o: [0, 0, 0], e: [14139, 21141, 2241] } },
  { id: 'g_halftunnel', cat: 'game', name: 'Half tunnel', kind: 'game', mesh: '/Game/Assets/TrackPieces/tracks1_3a1/StaticMeshes/halftunnel3/StaticMeshes/halftunnel3', box: { o: [13105, -3416, 7304], e: [13105, 12423, 9768] } },
  { id: 'g_halftunnel_m', cat: 'game', name: 'Half tunnel, flipped', kind: 'game', mesh: '/Game/Assets/TrackPieces/tracks1_3a1/StaticMeshes/halftunnel3/StaticMeshes/halftunnel3mirror', box: { o: [13105, 3416, 7304], e: [13105, 12423, 9768] } },
  { id: 'g_window_tunnel', cat: 'game', name: 'Window tunnel', kind: 'game', mesh: '/Game/Assets/TrackPieces/tracks1_3a1/StaticMeshes/windowhalftunnel2b1/StaticMeshes/windowhalftunnel2b1', box: { o: [13105, -3416, 7304], e: [13105, 12423, 9768] } },
  { id: 'g_block', cat: 'game', name: 'Wall block', kind: 'game', mesh: '/Game/Assets/TrackPieces/StraightWalls/Block1a1/StaticMeshes/Block1a1', box: { o: [0, 0, 0], e: [953, 1952, 500] }, defScale: 20, desc: 'Stone block. Stage 1-1 uses it at 20 times size' },
  { id: 'g_lowceiling', cat: 'game', name: 'Low ceiling', kind: 'game', mesh: '/Game/Assets/TrackPieces/Lowceiling/SM_staple3', box: { o: [-10, 1174, 2385], e: [12947, 6435, 276] } },
  { id: 'g_bowl', cat: 'game', name: 'Bowl', kind: 'game', mesh: '/Game/Assets/TrackPieces/Bowls/scene/StaticMeshes/scene', box: { o: [0, 0, 909], e: [2334, 2334, 1034] }, round: true, defScale: 10 },
  { id: 'g_spinplate', cat: 'game', name: 'Spinning plate', kind: 'game', cls: '/Game/Assets/TrackPieces/spinplate/spinplateexp/StaticMeshes/BP_spinningplate', box: { o: [-1676, 304, 4440], e: [60783, 60453, 5481] }, round: true },
  { id: 'g_plate', cat: 'game', name: 'Striped plate', kind: 'game', mesh: '/Game/Assets/TrackPieces/spinplate/spinplateexp/StaticMeshes/Decorative_plate', box: { o: [-493, 90, 1306], e: [17877, 17780, 1612] }, round: true },
  { id: 'g_tube', cat: 'game', name: 'Steel post', kind: 'game', mesh: '/Game/Assets/TrackPieces/spinplate/spinplateexp/StaticMeshes/Rounded_square_steel_tube_PL', box: { o: [212, 20, -15051], e: [1972, 1972, 14885] } },
  { id: 'g_pillar', cat: 'game', name: 'Triangle pillar', kind: 'game', mesh: '/Game/Assets/TrackPieces/pillartriangle/Models/p1a2eg2/StaticMeshes/p1a2eg2', box: { o: [0, 0, 22640], e: [1491, 1491, 23057] } },
  { id: 'g_pillar_boost', cat: 'game', name: 'Boost pillar', kind: 'game', cls: '/Game/Assets/TrackPieces/pillartriangle/BP_PillarBoost', box: { o: [0, 0, 6000], e: [3000, 3000, 6000] }, approx: true, defScale: 2 },
  { id: 'g_pillar_bounce', cat: 'game', name: 'Bounce pillar', kind: 'game', cls: '/Game/Assets/TrackPieces/pillartriangle/BP_PillarBounce', box: { o: [0, 0, 6000], e: [3000, 3000, 6000] }, approx: true },
  { id: 'g_hookpoint', cat: 'game', name: 'Hook point', kind: 'game', cls: '/Game/Assets/TrackPieces/Hookpoint/hookpointexp/StaticMeshes/BP_hookpoint', box: { o: [0, 0, 0], e: [5001, 5001, 5001] }, round: true },
  { id: 'g_pipe', cat: 'game', name: 'Big pipe', kind: 'game', mesh: '/Game/Courses/Levels/_GENERATED/Desktop1/SM_pipe1b2', box: { o: [-36303, 0, 0], e: [36310, 22960, 22960] } },
  { id: 'g_torus', cat: 'game', name: 'Ring', kind: 'game', mesh: '/Game/Assets/Misc/SM_Torus', box: { o: [0, 0, 0], e: [125, 125, 25] }, round: true, defScale: 40 },
  { id: 'g_marker', cat: 'game', name: 'Marker', kind: 'game', mesh: '/Game/Assets/Misc/marker/StaticMeshes/marker', box: { o: [0, 0, 0], e: [187, 159, 167] }, defScale: 10 },
  { id: 'g_gorilla', cat: 'game', name: 'Gorilla', kind: 'game', skel: '/Game/Assets/Misc/Random/Gorilla/Gorilla_hd', box: { o: [0, 0, 90], e: [75, 75, 90] }, approx: true, defScale: 10 },

  { id: 'platform', cat: 'blocks', name: 'Slab', kind: 'solid', size: [20000, 20000, 400], color: '#a8703f', desc: 'Flat slab' },
  { id: 'cube', cat: 'blocks', name: 'Cube', kind: 'solid', size: [5000, 5000, 5000], color: '#b9b2f2', desc: 'Big block' },
  { id: 'beam', cat: 'blocks', name: 'Beam', kind: 'solid', size: [30000, 800, 800], color: '#5e3a22', desc: 'Long thin rail' },
  { id: 'wall', cat: 'blocks', name: 'Wall', kind: 'solid', size: [30000, 600, 10000], color: '#9a9a96', desc: 'Upright panel' },
  { id: 'cylinder', cat: 'blocks', name: 'Column', kind: 'solid', shape: 'cylinder', size: [4000, 4000, 20000], color: '#9a9a96', desc: 'Round column' },
  { id: 'disc', cat: 'blocks', name: 'Disc', kind: 'solid', shape: 'cylinder', size: [20000, 20000, 400], color: '#f3ead8', desc: 'Round platform' },
  { id: 'sphere', cat: 'blocks', name: 'Ball', kind: 'solid', shape: 'sphere', size: [5000, 5000, 5000], color: '#e400db', desc: 'Solid ball. Not a marble, you can\'t ride it' },
  { id: 'cone', cat: 'blocks', name: 'Cone', kind: 'solid', shape: 'cone', size: [5000, 5000, 5000], color: '#fff600', desc: 'Spike or hill' },
  {
    id: 'ramp', cat: 'blocks', name: 'Ramp', kind: 'smart', color: '#a8703f', desc: 'Slope with a set rise',
    params: [len('length', 'Length', 1000, 100000, 15000), len('rise', 'Rise', -40000, 40000, 4000, 50), len('width', 'Width', 500, 40000, 9000), len('thickness', 'Thickness', 50, 3000, 400, 50)],
    build: (p) => {
      const pitch = Math.atan2(p.rise, p.length);
      const L = Math.hypot(p.length, p.rise);
      return [cube([p.length / 2, 0, p.rise / 2], [pitch / D, 0, 0], [L, p.width, p.thickness])];
    }
  },
  { id: 'stairs', cat: 'blocks', name: 'Stairs', kind: 'smart', color: '#9a9a96', desc: 'Steps going up', params: [num('steps', 'Steps', 2, 60, 8), len('run', 'Step depth', 200, 10000, 2000, 50), len('riseStep', 'Step height', 50, 5000, 600, 50), len('width', 'Width', 500, 30000, 6000), len('gap', 'Gap', 0, 8000, 0, 50)], build: (p) => Array.from({ length: p.steps }, (_, i) => cube([i * (p.run + p.gap) + p.run / 2, 0, i * p.riseStep + p.riseStep / 2], [0, 0, 0], [p.run, p.width, p.riseStep])) },
  { id: 'curve', cat: 'blocks', name: 'Curve', kind: 'smart', color: '#9a9a96', desc: 'Bent road, can bank and climb', params: [len('radius', 'Radius', 1000, 80000, 10000, 500), deg('angle', 'Turn', 10, 1080, 90, 5), len('width', 'Width', 500, 30000, 4000), len('thickness', 'Thickness', 50, 3000, 400, 50), deg('bank', 'Bank', -80, 80, 0), len('rise', 'Climb', -80000, 80000, 0, 100), num('segments', 'Smoothness', 2, 96, 16)], build: (p) => arcParts(p, false) },
  { id: 'loop', cat: 'blocks', name: 'Loop', kind: 'smart', color: '#9a9a96', desc: 'Vertical loop or corkscrew', params: [len('radius', 'Radius', 2000, 60000, 9000, 500), deg('angle', 'Sweep', 30, 360, 360, 5), len('width', 'Width', 500, 20000, 3500), len('thickness', 'Thickness', 50, 3000, 400, 50), len('shift', 'Side shift', -30000, 30000, 4500, 100), num('segments', 'Smoothness', 6, 96, 28)], build: (p) => arcParts(p, true) },
  { id: 'tube', cat: 'blocks', name: 'Tube', kind: 'smart', color: '#5fc8ff', desc: 'Pipe you roll through', params: [len('radius', 'Radius', 1000, 30000, 3500), len('length', 'Length', 1000, 80000, 12000, 500), num('sides', 'Sides', 6, 48, 16), len('thickness', 'Thickness', 50, 2000, 300, 50)], build: (p) => ringParts(p.radius, p.sides, p.length, p.thickness).map((q) => ({ ...q, pos: [p.length / 2, q.pos[1], q.pos[2]] })) },
  { id: 'pillars', cat: 'blocks', name: 'Pillar row', kind: 'smart', color: '#9a9a96', desc: 'Row of columns', params: [num('count', 'Count', 2, 60, 6), len('spacing', 'Spacing', 500, 30000, 3500), len('height', 'Height', 500, 50000, 6000), len('diameter', 'Diameter', 200, 20000, 1800), len('step', 'Height step', -10000, 10000, 0)], build: (p) => Array.from({ length: p.count }, (_, i) => ({ kind: 'shape', shape: 'cylinder', pos: [i * p.spacing, 0, (p.height + i * p.step) / 2], rot: [0, 0, 0], scale: [p.diameter / 100, p.diameter / 100, (p.height + i * p.step) / 100] })) },
  { id: 'hoop', cat: 'blocks', name: 'Hoop', kind: 'smart', color: '#fff600', desc: 'Ring to fly through', params: [len('radius', 'Radius', 1000, 30000, 4000), num('sides', 'Sides', 6, 48, 20), len('thickness', 'Thickness', 100, 3000, 400, 50)], build: (p) => ringParts(p.radius, p.sides, p.thickness, p.thickness).map((q) => ({ ...q, pos: [0, q.pos[1], q.pos[2] - p.radius] })) },

  { id: 'import', cat: 'import', name: 'Imported build', kind: 'import', hidden: true, color: '#b9b2f2', desc: 'Something you brought in from a file', params: [] },

  { id: 'sign', cat: 'decor', name: 'Sign', kind: 'decor', decor: 'text', color: '#dddaff', desc: 'Floating text', params: [{ key: 'text', label: 'Text', type: 'text', def: 'hello' }, len('height', 'Text size', 100, 20000, 3000, 50)] },
  { id: 'light', cat: 'decor', name: 'Light', kind: 'decor', decor: 'light', color: '#ffd9a0', desc: 'Coloured point light', params: [num('intensity', 'Brightness', 100, 2000000, 200000, 100), len('radius', 'Reach', 1000, 200000, 30000, 500)] }
];

export const PIECE = Object.fromEntries(PIECES.map((p) => [p.id, p]));

export const CATS = [
  ['marbles', 'Marbles'],
  ['track', 'Track'],
  ['play', 'Gameplay'],
  ['game', 'Game parts'],
  ['blocks', 'Blocks'],
  ['decor', 'Decor'],
  ['import', 'Import']
];

export function defaultParams(piece) {
  const p = {};
  for (const prm of piece.params || []) p[prm.key] = prm.def;
  return p;
}

export function initialScale(piece) {
  if (piece.kind === 'game') return [piece.defScale || 1, piece.defScale || 1, piece.defScale || 1];
  if (piece.kind === 'solid' || piece.kind === 'zone') return piece.size.map((v) => v / 100);
  return [1, 1, 1];
}

export function pieceColor(piece) {
  if (piece.kind === 'zone') return ZONE_COLORS[piece.zone];
  return piece.color || '#9a9a96';
}

export function marblePoints(obj) {
  const piece = PIECE[obj.piece];
  const p = { ...defaultParams(piece), ...obj.p };
  if (piece.kind === 'marble') return [{ pos: [0, 0, 0], i: 0, gem: pickGem(p.color, 0, obj.id) }];
  if (piece.kind !== 'marbles') return [];
  return piece.gen(p).map((m) => ({ ...m, gem: pickGem(p.color, m.i, obj.id) }));
}

export function localParts(obj) {
  const piece = PIECE[obj.piece];
  if (!piece) return [];
  if (piece.kind === 'smart') return piece.build({ ...defaultParams(piece), ...obj.p });
  return [{ kind: 'shape', shape: piece.shape || 'cube', pos: [0, 0, 0], rot: [0, 0, 0], scale: [1, 1, 1], unit: true, mat: piece.mat }];
}
