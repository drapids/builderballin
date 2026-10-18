const cache = new Map();

export function springCurve({ stiffness = 300, damping = 26, mass = 1, velocity = 0 } = {}) {
  const key = `${stiffness}|${damping}|${mass}|${velocity}`;
  if (cache.has(key)) return cache.get(key);
  const dt = 1 / 120;
  let x = 0;
  let v = velocity;
  const pts = [0];
  let t = 0;
  let still = 0;
  while (t < 4) {
    const a = (-stiffness * (x - 1) - damping * v) / mass;
    v += a * dt;
    x += v * dt;
    t += dt;
    pts.push(x);
    if (Math.abs(x - 1) < 0.001 && Math.abs(v) < 0.01) {
      still += 1;
      if (still > 6) break;
    } else still = 0;
  }
  const step = Math.max(1, Math.floor(pts.length / 60));
  const sampled = pts.filter((_, i) => i % step === 0);
  sampled[sampled.length - 1] = 1;
  const out = { duration: Math.round(t * 1000), easing: `linear(${sampled.map((p) => +p.toFixed(4)).join(', ')})` };
  cache.set(key, out);
  return out;
}

export const SPRINGS = {
  snappy: { stiffness: 420, damping: 30 },
  bouncy: { stiffness: 320, damping: 16 },
  gentle: { stiffness: 170, damping: 24 },
  soft: { stiffness: 120, damping: 20 }
};

const reduce = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

export function animate(el, keyframes, { spring = SPRINGS.snappy, delay = 0, fill = 'both' } = {}) {
  if (!el) return null;
  if (reduce()) {
    const last = Array.isArray(keyframes) ? keyframes[keyframes.length - 1] : Object.fromEntries(Object.entries(keyframes).map(([k, v]) => [k, Array.isArray(v) ? v[v.length - 1] : v]));
    return el.animate(last, { duration: 1, fill });
  }
  const { duration, easing } = springCurve(spring);
  return el.animate(keyframes, { duration, easing, delay, fill });
}

export function fadeIn(el, opts = {}) {
  return animate(el, { opacity: [0, 1], transform: [`translateY(${opts.y ?? 8}px) scale(${opts.scale ?? 0.98})`, 'none'] }, opts);
}

export class Spring {
  constructor(value = 0, { stiffness = 260, damping = 22, mass = 1 } = {}) {
    this.value = value;
    this.target = value;
    this.velocity = 0;
    this.k = stiffness;
    this.c = damping;
    this.m = mass;
  }
  set(v) {
    this.value = v;
    this.target = v;
    this.velocity = 0;
  }
  step(dt) {
    const steps = Math.ceil(dt / (1 / 240));
    const h = dt / steps;
    for (let i = 0; i < steps; i++) {
      const a = (-this.k * (this.value - this.target) - this.c * this.velocity) / this.m;
      this.velocity += a * h;
      this.value += this.velocity * h;
    }
    return this.value;
  }
  get done() {
    return Math.abs(this.value - this.target) < 0.0005 && Math.abs(this.velocity) < 0.001;
  }
}
