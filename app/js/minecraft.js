import { gunzipSync } from '../vendor/loaders.js';
import { Grid, hex, parseHex } from './voxels.js';

export function readNbt(buf) {
  let bytes = new Uint8Array(buf);
  if (bytes[0] === 0x1f && bytes[1] === 0x8b) bytes = gunzipSync(bytes);
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const td = new TextDecoder();
  let p = 0;
  const str = () => {
    const n = dv.getUint16(p);
    p += 2;
    const s = td.decode(bytes.subarray(p, p + n));
    p += n;
    return s;
  };
  const payload = (t) => {
    switch (t) {
      case 1: return dv.getInt8(p++);
      case 2: { const v = dv.getInt16(p); p += 2; return v; }
      case 3: { const v = dv.getInt32(p); p += 4; return v; }
      case 4: { const v = dv.getBigInt64(p); p += 8; return v; }
      case 5: { const v = dv.getFloat32(p); p += 4; return v; }
      case 6: { const v = dv.getFloat64(p); p += 8; return v; }
      case 7: { const n = dv.getInt32(p); p += 4; const v = new Int8Array(bytes.buffer, bytes.byteOffset + p, n).slice(); p += n; return v; }
      case 8: return str();
      case 9: {
        const et = dv.getUint8(p++);
        const n = dv.getInt32(p);
        p += 4;
        const out = [];
        for (let i = 0; i < n; i++) out.push(payload(et));
        return out;
      }
      case 10: {
        const o = {};
        for (;;) {
          const ct = dv.getUint8(p++);
          if (ct === 0) break;
          const name = str();
          o[name] = payload(ct);
        }
        return o;
      }
      case 11: { const n = dv.getInt32(p); p += 4; const v = new Int32Array(n); for (let i = 0; i < n; i++) { v[i] = dv.getInt32(p); p += 4; } return v; }
      case 12: { const n = dv.getInt32(p); p += 4; const v = new BigInt64Array(n); for (let i = 0; i < n; i++) { v[i] = dv.getBigInt64(p); p += 8; } return v; }
      default: throw new Error('Broken NBT file');
    }
  };
  const t = dv.getUint8(p++);
  if (t !== 10) throw new Error("That doesn't look like a Minecraft file.");
  const rootName = str();
  const root = payload(10);
  return { name: rootName, root };
}

const DYES = {
  white: ['#e9ecec', '#cfd5d6', '#d1b2a1'], orange: ['#f07613', '#e06100', '#a15325'], magenta: ['#bd44b3', '#a9309f', '#95586c'], light_blue: ['#3aafd9', '#2389c6', '#716c89'],
  yellow: ['#f8c527', '#f1af15', '#ba8523'], lime: ['#70b919', '#5ea818', '#677534'], pink: ['#ed8dac', '#d5658e', '#a14e4e'], gray: ['#3e4447', '#36393d', '#392a23'],
  light_gray: ['#8e8e86', '#7d7d73', '#876a61'], cyan: ['#158991', '#157788', '#575b5b'], purple: ['#792aac', '#64209c', '#764656'], blue: ['#35399d', '#2c2e8f', '#4a3b5b'],
  brown: ['#724728', '#603b1f', '#4d3323'], green: ['#546d1b', '#495b24', '#4c532a'], red: ['#a12722', '#8e2020', '#8f3d2e'], black: ['#141519', '#080a0f', '#251610']
};
const DYE_NAMES = Object.keys(DYES).sort((a, b) => b.length - a.length);

const COLORS = {
  stone: '#7d7d7d', smooth_stone: '#9e9e9e', granite: '#956755', polished_granite: '#9a6b59', diorite: '#bcbcbc', polished_diorite: '#c0c0c1', andesite: '#888889', polished_andesite: '#848686',
  deepslate: '#505053', cobbled_deepslate: '#4d4d50', polished_deepslate: '#484849', deepslate_bricks: '#464646', deepslate_tiles: '#363637', tuff: '#6c6d67', calcite: '#dfe0dc',
  dirt: '#866043', coarse_dirt: '#77553b', rooted_dirt: '#90674c', podzol: '#5c3f18', mud: '#3c393d', grass_block: '#5d953a', mycelium: '#6f6265', dirt_path: '#94793f', farmland: '#7a5032',
  cobblestone: '#7f7f7f', mossy_cobblestone: '#6e7562', bedrock: '#555555', sand: '#dbcfa3', red_sand: '#be6721', gravel: '#837f7e', clay: '#a0a6b3',
  sandstone: '#d8cb9b', smooth_sandstone: '#dfd6aa', cut_sandstone: '#d9cd9e', chiseled_sandstone: '#d8ca9b', red_sandstone: '#b5621f', smooth_red_sandstone: '#b5621f',
  oak_log: '#6d5532', oak_wood: '#6d5532', stripped_oak_log: '#b29157', oak_planks: '#a2834f', spruce_log: '#3a2611', spruce_wood: '#3a2611', stripped_spruce_log: '#745a35', spruce_planks: '#735531',
  birch_log: '#d8d7d2', birch_wood: '#d8d7d2', stripped_birch_log: '#c5b07b', birch_planks: '#c0af79', jungle_log: '#554419', jungle_wood: '#554419', stripped_jungle_log: '#ab8455', jungle_planks: '#a07351',
  acacia_log: '#676157', acacia_wood: '#676157', stripped_acacia_log: '#af5c3b', acacia_planks: '#a85a32', dark_oak_log: '#3c2e1a', dark_oak_wood: '#3c2e1a', stripped_dark_oak_log: '#604c31', dark_oak_planks: '#42230f',
  mangrove_log: '#544229', mangrove_planks: '#763631', cherry_log: '#361b23', cherry_planks: '#e3b3ad', bamboo_planks: '#c2ad53', bamboo_mosaic: '#bea950', bamboo_block: '#7f9032',
  crimson_planks: '#653147', warped_planks: '#2b6963', crimson_stem: '#5c1919', warped_stem: '#3a3a4d', pale_oak_planks: '#e4dbd9', pale_oak_log: '#58534f',
  leaves: '#3d6e27', oak_leaves: '#4a7a32', spruce_leaves: '#3b5f3b', birch_leaves: '#5c7f3a', jungle_leaves: '#3f8a22', acacia_leaves: '#4d7a24', dark_oak_leaves: '#3d6a1f', mangrove_leaves: '#4b7a2a',
  azalea_leaves: '#5a7a2d', flowering_azalea_leaves: '#6f7a4a', cherry_leaves: '#e6aec0', pale_oak_leaves: '#a3a89c',
  glass: '#c8e2ea', tinted_glass: '#2c2630', glass_pane: '#c8e2ea', iron_bars: '#8a8b88',
  bricks: '#966153', stone_bricks: '#7a7a7a', mossy_stone_bricks: '#737969', cracked_stone_bricks: '#767676', chiseled_stone_bricks: '#777777', nether_bricks: '#2c1519', red_nether_bricks: '#450709',
  end_stone_bricks: '#dbe0a3', prismarine: '#63a397', prismarine_bricks: '#63ab9e', dark_prismarine: '#335b4b', sea_lantern: '#acc8be', quartz_block: '#ece6df', smooth_quartz: '#ece6df',
  quartz_bricks: '#eae5dd', quartz_pillar: '#ebe6e0', chiseled_quartz_block: '#e7e2da', purpur_block: '#a97ea9', purpur_pillar: '#ab81ab', netherrack: '#6f3634', soul_sand: '#513e32', soul_soil: '#4b3a2f',
  basalt: '#515157', polished_basalt: '#636266', blackstone: '#2a2328', polished_blackstone: '#353038', polished_blackstone_bricks: '#302a30', glowstone: '#ab8654', shroomlight: '#f09347',
  obsidian: '#0f0a18', crying_obsidian: '#200a3c', end_stone: '#dbde9e', snow_block: '#f9fefe', snow: '#f9fefe', powder_snow: '#f8fdfd', ice: '#91b7fd', packed_ice: '#8db4fa', blue_ice: '#74a7fd',
  water: '#3f76e4', lava: '#cf5b13', iron_block: '#dcdcdc', gold_block: '#f6d03d', diamond_block: '#62ede4', emerald_block: '#2acb57', lapis_block: '#1f438c', redstone_block: '#af1805',
  coal_block: '#101010', netherite_block: '#423d3f', copper_block: '#c06c50', cut_copper: '#bf6b51', exposed_copper: '#a17e68', weathered_copper: '#6c9d6b', oxidized_copper: '#52a284',
  amethyst_block: '#8662bf', raw_iron_block: '#a6886b', raw_gold_block: '#dda92e', raw_copper_block: '#9a6a4f', bookshelf: '#75603d', chiseled_bookshelf: '#73593a', crafting_table: '#7a5c37',
  furnace: '#6e6e6e', blast_furnace: '#636263', smoker: '#5a5148', hay_block: '#a68b0c', pumpkin: '#c67418', carved_pumpkin: '#c06c14', jack_o_lantern: '#d78a1f', melon: '#6f911f',
  tnt: '#db441a', sponge: '#c3c04a', wet_sponge: '#ab9f3c', terracotta: '#985e43', magma_block: '#8e3f1f', slime_block: '#6fc05b', honey_block: '#f9b931', honeycomb_block: '#e59720',
  mud_bricks: '#89684f', packed_mud: '#8e6b50', moss_block: '#596d2d', dripstone_block: '#86695a', sculk: '#0c1d24', note_block: '#583a28', jukebox: '#5a3c2a', target: '#e2aa9e',
  redstone_lamp: '#5f3620', ochre_froglight: '#f6e9b5', verdant_froglight: '#e5f4e4', pearlescent_froglight: '#f5f0ef', dried_kelp_block: '#323b27', bone_block: '#e5e1cf', nether_wart_block: '#720b0a',
  warped_wart_block: '#167879', nether_gold_ore: '#73362a', ancient_debris: '#5f3f37', lodestone: '#939599', respawn_anchor: '#4b1a8c', beacon: '#75ddd7', chest: '#9c6e2a', trapped_chest: '#9c6e2a',
  ender_chest: '#2a3a3c', barrel: '#86643a', composter: '#784c26', lectern: '#b08b55', loom: '#8e7754', cartography_table: '#685133', fletching_table: '#c5b483', smithing_table: '#3a3a45',
  stonecutter: '#7b7671', grindstone: '#8e8e8e', anvil: '#454545', cauldron: '#4a4a4c', hopper: '#4b4b4c', dispenser: '#6a6a6a', dropper: '#6a6a6a', observer: '#636363', piston: '#9c8a68',
  sticky_piston: '#86925a', spawner: '#1e2e3c', enchanting_table: '#7f3a3a', brewing_stand: '#7a6a51', mangrove_roots: '#4a3b26', muddy_mangrove_roots: '#45392e', reinforced_deepslate: '#525452'
};

const SKIP = new Set(['air', 'cave_air', 'void_air', 'structure_void', 'barrier', 'light', 'torch', 'wall_torch', 'soul_torch', 'soul_wall_torch', 'redstone_torch', 'redstone_wall_torch', 'lantern', 'soul_lantern',
  'dandelion', 'poppy', 'blue_orchid', 'allium', 'azure_bluet', 'oxeye_daisy', 'cornflower', 'lily_of_the_valley', 'wither_rose', 'sunflower', 'lilac', 'rose_bush', 'peony', 'torchflower', 'pitcher_plant',
  'grass', 'short_grass', 'tall_grass', 'fern', 'large_fern', 'dead_bush', 'seagrass', 'tall_seagrass', 'kelp', 'kelp_plant', 'vine', 'ladder', 'redstone_wire', 'lever', 'tripwire', 'tripwire_hook',
  'flower_pot', 'cobweb', 'brown_mushroom', 'red_mushroom', 'sugar_cane', 'wheat', 'carrots', 'potatoes', 'beetroots', 'bubble_column', 'fire', 'soul_fire', 'scaffolding', 'chain', 'end_rod',
  'lightning_rod', 'bell', 'lily_pad', 'nether_portal', 'end_portal', 'end_gateway', 'moving_piston', 'piston_head', 'repeater', 'comparator', 'daylight_detector', 'glow_lichen', 'sculk_vein',
  'hanging_roots', 'spore_blossom', 'big_dripleaf', 'small_dripleaf', 'cave_vines', 'cave_vines_plant', 'twisting_vines', 'twisting_vines_plant', 'weeping_vines', 'weeping_vines_plant',
  'sweet_berry_bush', 'cocoa', 'nether_sprouts', 'warped_roots', 'crimson_roots', 'warped_fungus', 'crimson_fungus', 'pink_petals', 'water', 'lava']);

const SKIP_END = ['_sapling', '_button', '_pressure_plate', '_sign', '_banner', '_door', '_trapdoor', '_tulip', '_head', '_skull', '_candle', 'candle', '_coral', '_coral_fan', '_bed', 'rail', '_propagule', '_frame', 'potted_'];

function baseName(raw) {
  return raw.replace(/^minecraft:/, '').replace(/\[.*$/, '');
}

function propsOf(raw, given) {
  if (given) return given;
  const m = raw.match(/\[(.*)\]$/);
  const out = {};
  if (m) for (const kv of m[1].split(',')) {
    const [k, v] = kv.split('=');
    out[k] = v;
  }
  return out;
}

const cache = new Map();
export function blockColor(name) {
  if (cache.has(name)) return cache.get(name);
  const c = resolveColor(name);
  cache.set(name, c);
  return c;
}

function mix(h, t, k) {
  const a = parseHex(h);
  const b = parseHex(t);
  return hex(...a.map((v, i) => v + (b[i] - v) * k));
}

function resolveColor(n) {
  if (COLORS[n]) return COLORS[n];
  for (const d of DYE_NAMES) {
    if (!n.startsWith(d + '_')) continue;
    const rest = n.slice(d.length + 1);
    const [wool, concrete, terra] = DYES[d];
    if (rest === 'concrete') return concrete;
    if (rest === 'concrete_powder') return mix(concrete, '#ffffff', 0.15);
    if (rest === 'terracotta') return terra;
    if (rest === 'glazed_terracotta') return mix(wool, '#ffffff', 0.1);
    if (rest.includes('stained_glass')) return mix(wool, '#ffffff', 0.35);
    return wool;
  }
  const cut = n.replace(/_(stairs|slab|wall|fence_gate|fence|carpet|pane)$/, '');
  if (cut !== n) {
    if (COLORS[cut]) return COLORS[cut];
    if (COLORS[cut + '_planks']) return COLORS[cut + '_planks'];
    if (COLORS[cut + 's']) return COLORS[cut + 's'];
    if (COLORS[cut + '_block']) return COLORS[cut + '_block'];
    return resolveColor(cut);
  }
  if (COLORS[n + '_block']) return COLORS[n + '_block'];
  if (n.startsWith('waxed_')) return resolveColor(n.slice(6));
  if (n.startsWith('infested_')) return resolveColor(n.slice(9));
  if (n.endsWith('_ore')) return n.includes('deepslate') ? COLORS.deepslate : n.includes('nether') ? COLORS.netherrack : COLORS.stone;
  if (n.includes('leaves')) return COLORS.leaves;
  if (n.includes('log') || n.endsWith('_wood') || n.includes('stem') || n.includes('hyphae')) return COLORS.oak_log;
  if (n.includes('planks')) return COLORS.oak_planks;
  if (n.includes('copper')) return COLORS.copper_block;
  if (n.includes('deepslate')) return COLORS.deepslate;
  if (n.includes('blackstone')) return COLORS.blackstone;
  if (n.includes('sandstone')) return COLORS.sandstone;
  if (n.includes('quartz')) return COLORS.quartz_block;
  if (n.includes('brick')) return COLORS.bricks;
  if (n.includes('stone')) return COLORS.stone;
  if (n.includes('glass')) return COLORS.glass;
  if (n.includes('ice')) return COLORS.ice;
  if (n.includes('snow')) return COLORS.snow;
  if (n.includes('coral')) return '#c8509a';
  if (n.includes('wool') || n.includes('carpet')) return DYES.white[0];
  return '#9a9a96';
}

function shapeOf(n, props, opts) {
  if (SKIP.has(n)) {
    if ((n === 'water' || n === 'lava') && opts.fluids) return { full: true };
    return null;
  }
  if (n.endsWith('_wall_torch') || n.endsWith('_wall_sign') || n.endsWith('_wall_banner') || n.endsWith('_wall_head') || n.endsWith('_wall_skull') || n.endsWith('_wall_fan')) return null;
  for (const s of SKIP_END) if (n.endsWith(s) || n.startsWith(s)) return null;
  if (n.endsWith('_slab')) {
    if (props.type === 'double') return { full: true };
    return { box: props.type === 'top' ? [0, 0.5, 0, 1, 1, 1] : [0, 0, 0, 1, 0.5, 1] };
  }
  if (n.endsWith('_carpet')) return { box: [0, 0, 0, 1, 1 / 16, 1] };
  if (n === 'snow') return { box: [0, 0, 0, 1, Math.max(1, +props.layers || 1) / 8, 1] };
  if (n.endsWith('_pane') || n === 'iron_bars') return { link: 1 / 8, h: 1 };
  if (n.endsWith('_fence')) return { link: 1 / 4, h: 1 };
  if (n.endsWith('_wall')) return { link: 1 / 2, h: 1 };
  if (n.endsWith('_fence_gate')) {
    const ew = props.facing === 'north' || props.facing === 'south';
    return { box: ew ? [0, 0, 0.4, 1, 1, 0.6] : [0.4, 0, 0, 0.6, 1, 1] };
  }
  if (n === 'chest' || n === 'trapped_chest' || n === 'ender_chest') return { box: [1 / 16, 0, 1 / 16, 15 / 16, 14 / 16, 15 / 16] };
  return { full: true };
}

function linked(v) {
  return v !== undefined && v !== 'false' && v !== 'none';
}

function linkBoxes(s, props) {
  const t = s.link / 2;
  const lo = 0.5 - t;
  const hi = 0.5 + t;
  const out = [[lo, 0, lo, hi, s.h, hi]];
  if (linked(props.east)) out.push([hi, 0, lo, 1, s.h, hi]);
  if (linked(props.west)) out.push([0, 0, lo, lo, s.h, hi]);
  if (linked(props.south)) out.push([lo, 0, hi, hi, s.h, 1]);
  if (linked(props.north)) out.push([lo, 0, 0, hi, s.h, lo]);
  return out;
}

class Builder {
  constructor(opts) {
    this.opts = opts;
    this.blocks = [];
    this.palette = [];
    this.palIndex = new Map();
    this.min = [Infinity, Infinity, Infinity];
    this.max = [-Infinity, -Infinity, -Infinity];
  }
  add(x, y, z, raw, props) {
    const n = baseName(raw);
    const pr = propsOf(raw, props);
    const s = shapeOf(n, pr, this.opts);
    if (!s) return;
    const color = blockColor(n);
    let ci = this.palIndex.get(color);
    if (ci === undefined) {
      ci = this.palette.length;
      this.palette.push(color);
      this.palIndex.set(color, ci);
    }
    this.blocks.push([x, y, z, ci, s, pr]);
    if (x < this.min[0]) this.min[0] = x;
    if (y < this.min[1]) this.min[1] = y;
    if (z < this.min[2]) this.min[2] = z;
    if (x > this.max[0]) this.max[0] = x;
    if (y > this.max[1]) this.max[1] = y;
    if (z > this.max[2]) this.max[2] = z;
  }
  grid(blockSize) {
    if (!this.blocks.length) throw new Error('No solid blocks found in that file.');
    const [ax, ay, az] = this.min;
    const sx = this.max[0] - ax + 1;
    const sy = this.max[1] - ay + 1;
    const sz = this.max[2] - az + 1;
    const g = new Grid(sx, sz, sy, [blockSize, blockSize, blockSize]);
    for (const [x, y, z, ci, s, pr] of this.blocks) {
      const gx = x - ax;
      const gy = z - az;
      const gz = y - ay;
      if (s.full) g.set(gx, gy, gz, ci + 1);
      else {
        const list = s.box ? [s.box] : linkBoxes(s, pr);
        for (const b of list) g.extra.push([gx + b[0], gy + b[2], gz + b[1], gx + b[3], gy + b[5], gz + b[4], ci]);
      }
    }
    return { grid: g, palette: this.palette.slice() };
  }
}

function spongeLike(root, b) {
  const s = root.Schematic && typeof root.Schematic === 'object' && !Array.isArray(root.Schematic) ? root.Schematic : root;
  const W = s.Width;
  const H = s.Height;
  const L = s.Length;
  const blocksTag = s.Blocks && s.Blocks.Palette ? s.Blocks : null;
  const pal = blocksTag ? blocksTag.Palette : s.Palette;
  const data = blocksTag ? blocksTag.Data : s.BlockData;
  if (!pal || !data) return false;
  const names = [];
  for (const [k, v] of Object.entries(pal)) names[v] = k;
  let p = 0;
  let i = 0;
  const total = W * H * L;
  while (i < total && p < data.length) {
    let v = 0;
    let shift = 0;
    for (;;) {
      const byte = data[p++] & 0xff;
      v |= (byte & 0x7f) << shift;
      if (!(byte & 0x80)) break;
      shift += 7;
    }
    const x = i % W;
    const z = Math.floor(i / W) % L;
    const y = Math.floor(i / (W * L));
    if (names[v]) b.add(x, y, z, names[v]);
    i++;
  }
  return true;
}

const LEGACY = {
  1: 'stone', 2: 'grass_block', 3: 'dirt', 4: 'cobblestone', 5: 'oak_planks', 7: 'bedrock', 12: 'sand', 13: 'gravel', 14: 'gold_ore', 15: 'iron_ore', 16: 'coal_ore', 17: 'oak_log', 18: 'oak_leaves',
  19: 'sponge', 20: 'glass', 21: 'lapis_ore', 22: 'lapis_block', 23: 'dispenser', 24: 'sandstone', 25: 'note_block', 35: 'white_wool', 41: 'gold_block', 42: 'iron_block', 43: 'stone_slab[type=double]',
  44: 'stone_slab', 45: 'bricks', 46: 'tnt', 47: 'bookshelf', 48: 'mossy_cobblestone', 49: 'obsidian', 52: 'spawner', 53: 'oak_stairs', 54: 'chest', 56: 'diamond_ore', 57: 'diamond_block', 58: 'crafting_table',
  60: 'farmland', 61: 'furnace', 62: 'furnace', 67: 'cobblestone_stairs', 73: 'redstone_ore', 74: 'redstone_ore', 78: 'snow', 79: 'ice', 80: 'snow_block', 82: 'clay', 84: 'jukebox', 85: 'oak_fence',
  86: 'pumpkin', 87: 'netherrack', 88: 'soul_sand', 89: 'glowstone', 91: 'jack_o_lantern', 95: 'white_stained_glass', 97: 'stone', 98: 'stone_bricks', 99: 'brown_mushroom_block', 100: 'red_mushroom_block',
  101: 'iron_bars', 102: 'glass_pane', 103: 'melon', 107: 'oak_fence_gate', 108: 'brick_stairs', 109: 'stone_brick_stairs', 110: 'mycelium', 112: 'nether_bricks', 113: 'nether_brick_fence',
  114: 'nether_brick_stairs', 121: 'end_stone', 123: 'redstone_lamp', 124: 'redstone_lamp', 125: 'oak_planks', 126: 'oak_slab', 128: 'sandstone_stairs', 129: 'emerald_ore', 130: 'ender_chest', 133: 'emerald_block',
  134: 'spruce_stairs', 135: 'birch_stairs', 136: 'jungle_stairs', 139: 'cobblestone_wall', 146: 'trapped_chest', 152: 'redstone_block', 153: 'nether_quartz_ore', 155: 'quartz_block', 156: 'quartz_stairs',
  159: 'white_terracotta', 160: 'white_stained_glass_pane', 161: 'acacia_leaves', 162: 'acacia_log', 163: 'acacia_stairs', 164: 'dark_oak_stairs', 165: 'slime_block', 168: 'prismarine', 169: 'sea_lantern',
  170: 'hay_block', 171: 'white_carpet', 172: 'terracotta', 173: 'coal_block', 174: 'packed_ice', 179: 'red_sandstone', 180: 'red_sandstone_stairs', 181: 'red_sandstone_slab[type=double]', 182: 'red_sandstone_slab',
  183: 'spruce_fence_gate', 184: 'birch_fence_gate', 185: 'jungle_fence_gate', 186: 'dark_oak_fence_gate', 187: 'acacia_fence_gate', 188: 'spruce_fence', 189: 'birch_fence', 190: 'jungle_fence',
  191: 'dark_oak_fence', 192: 'acacia_fence', 201: 'purpur_block', 202: 'purpur_pillar', 203: 'purpur_stairs', 206: 'end_stone_bricks', 208: 'dirt_path', 213: 'magma_block', 214: 'nether_wart_block',
  215: 'red_nether_bricks', 216: 'bone_block', 251: 'white_concrete', 252: 'white_concrete_powder'
};
const LEGACY_DYE = ['white', 'orange', 'magenta', 'light_blue', 'yellow', 'lime', 'pink', 'gray', 'light_gray', 'cyan', 'purple', 'blue', 'brown', 'green', 'red', 'black'];
const LEGACY_WOOD = ['oak', 'spruce', 'birch', 'jungle', 'acacia', 'dark_oak'];

function legacyName(id, data) {
  if ([35, 95, 159, 160, 171, 251, 252].includes(id)) return LEGACY[id].replace('white', LEGACY_DYE[data & 15]);
  if (id === 5 || id === 125) return LEGACY_WOOD[(data & 7) % 6] + '_planks';
  if (id === 126) return LEGACY_WOOD[(data & 7) % 6] + (data & 8 ? '_slab[type=top]' : '_slab');
  if (id === 17) return LEGACY_WOOD[data & 3] + '_log';
  if (id === 18) return LEGACY_WOOD[data & 3] + '_leaves';
  if (id === 162) return (data & 1 ? 'dark_oak' : 'acacia') + '_log';
  if (id === 44) return ['smooth_stone', 'sandstone', 'oak', 'cobblestone', 'brick', 'stone_brick', 'nether_brick', 'quartz'][data & 7] + (data & 8 ? '_slab[type=top]' : '_slab');
  if (id === 1) return ['stone', 'granite', 'polished_granite', 'diorite', 'polished_diorite', 'andesite', 'polished_andesite'][data] || 'stone';
  if (id === 98) return ['stone_bricks', 'mossy_stone_bricks', 'cracked_stone_bricks', 'chiseled_stone_bricks'][data & 3];
  if (id === 24) return 'sandstone';
  return LEGACY[id] || (id ? 'stone' : null);
}

function legacySchematic(root, b) {
  const W = root.Width;
  const H = root.Height;
  const L = root.Length;
  const ids = root.Blocks;
  const data = root.Data || new Int8Array(ids.length);
  const add = root.AddBlocks;
  for (let y = 0; y < H; y++)
    for (let z = 0; z < L; z++)
      for (let x = 0; x < W; x++) {
        const i = (y * L + z) * W + x;
        let id = ids[i] & 0xff;
        if (add) id |= ((i & 1 ? add[i >> 1] & 0x0f : (add[i >> 1] >> 4) & 0x0f) << 8);
        if (!id) continue;
        const name = legacyName(id, data[i] & 0xff);
        if (name) b.add(x, y, z, name);
      }
}

function structure(root, b) {
  const pal = root.palette || (root.palettes && root.palettes[0]);
  if (!pal || !root.blocks) return false;
  for (const bl of root.blocks) {
    const st = pal[bl.state];
    if (!st) continue;
    const [x, y, z] = bl.pos;
    b.add(x, y, z, st.Name, st.Properties || {});
  }
  return true;
}

function litematic(root, b) {
  if (!root.Regions) return false;
  for (const reg of Object.values(root.Regions)) {
    const sx = reg.Size.x;
    const sy = reg.Size.y;
    const sz = reg.Size.z;
    const ax = Math.abs(sx);
    const ay = Math.abs(sy);
    const az = Math.abs(sz);
    const ox = reg.Position.x + (sx < 0 ? sx + 1 : 0);
    const oy = reg.Position.y + (sy < 0 ? sy + 1 : 0);
    const oz = reg.Position.z + (sz < 0 ? sz + 1 : 0);
    const pal = reg.BlockStatePalette;
    const longs = reg.BlockStates;
    const bits = Math.max(2, Math.ceil(Math.log2(pal.length)));
    const mask = (1n << BigInt(bits)) - 1n;
    const total = ax * ay * az;
    const u = new BigUint64Array(longs.buffer, longs.byteOffset, longs.length);
    for (let i = 0; i < total; i++) {
      const start = i * bits;
      const li = Math.floor(start / 64);
      const off = BigInt(start % 64);
      let v = u[li] >> off;
      if (Number(off) + bits > 64) v |= u[li + 1] << (64n - off);
      const idx = Number(v & mask);
      const st = pal[idx];
      if (!st || st.Name === 'minecraft:air') continue;
      const x = i % ax;
      const z = Math.floor(i / ax) % az;
      const y = Math.floor(i / (ax * az));
      b.add(ox + x, oy + y, oz + z, st.Name, st.Properties || {});
    }
  }
  return true;
}

export function parseMinecraft(buf, opts = {}) {
  const { root } = readNbt(buf);
  const b = new Builder(opts);
  if (litematic(root, b)) return b;
  if (structure(root, b)) return b;
  if (root.Blocks && root.Width !== undefined && !root.Blocks.Palette) {
    legacySchematic(root, b);
    return b;
  }
  if (spongeLike(root, b)) return b;
  throw new Error("Couldn't read that Minecraft file. Try .schem, .schematic, .litematic or a structure .nbt.");
}
