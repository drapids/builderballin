import { rotateVec, add, sub } from './ue.js';

const smooth = (f) => f * f * (3 - 2 * f);

export function moveOffset(m, t) {
  const pts = m.mode === 'loop' ? [...m.points, m.points[0]] : m.points;
  const n = pts.length - 1;
  if (n < 1) return [0, 0, 0];
  let u = Math.max(0, t - (m.delay || 0)) / m.duration;
  if (m.mode === 'pingpong') {
    u = u % 2;
    if (u > 1) u = 2 - u;
  } else if (m.mode === 'loop') u = u % 1;
  else u = Math.min(1, u);
  const x = u * n;
  const i = Math.min(n - 1, Math.floor(x));
  let f = x - i;
  if (m.ease === 'smooth') f = smooth(f);
  const a = pts[i], b = pts[i + 1];
  return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f];
}

export function evalAnim(anim, t, basePos, baseAxes) {
  let pos = basePos;
  let axes = baseAxes;
  let visible = true;
  if (!anim) return { pos, axes, visible };
  const rots = [];
  if (anim.spin) rots.push([anim.spin.axis, (anim.spin.speed * t * Math.PI) / 180]);
  if (anim.swing) rots.push([anim.swing.axis, (anim.swing.angle * Math.sin((2 * Math.PI * t) / anim.swing.period) * Math.PI) / 180]);
  if (rots.length) {
    let rel = sub(pos, anim.pivot);
    for (const [ax, ang] of rots) {
      rel = rotateVec(rel, ax, ang);
      axes = axes.map((v) => rotateVec(v, ax, ang));
    }
    pos = add(anim.pivot, rel);
  }
  if (anim.move) pos = add(pos, moveOffset(anim.move, t));
  if (anim.blink && t > 0) {
    const c = anim.blink.on + anim.blink.off;
    visible = c <= 0 || (((t + anim.blink.offset) % c) + c) % c < anim.blink.on;
  }
  return { pos, axes, visible };
}
