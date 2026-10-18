import * as THREE from 'three';

const D = Math.PI / 180;

export function axesFromRot(r) {
  const p = (r[0] || 0) * D;
  const y = (r[1] || 0) * D;
  const ro = (r[2] || 0) * D;
  const SP = Math.sin(p), CP = Math.cos(p), SY = Math.sin(y), CY = Math.cos(y), SR = Math.sin(ro), CR = Math.cos(ro);
  return [
    [CP * CY, CP * SY, SP],
    [SR * SP * CY - CR * SY, SR * SP * SY + CR * CY, -SR * CP],
    [-(CR * SP * CY + SR * SY), CY * SR - CR * SP * SY, CR * CP]
  ];
}

export function rotFromAxes(A) {
  const [X, Y, Z] = A;
  const pitch = Math.atan2(X[2], Math.hypot(X[0], X[1]));
  const yaw = Math.atan2(X[1], X[0]);
  const sy = [-Math.sin(yaw), Math.cos(yaw), 0];
  const roll = Math.atan2(Z[0] * sy[0] + Z[1] * sy[1] + Z[2] * sy[2], Y[0] * sy[0] + Y[1] * sy[1] + Y[2] * sy[2]);
  return [clean(pitch / D), clean(yaw / D), clean(roll / D)];
}

function clean(v) {
  const r = Math.round(v * 1000) / 1000;
  return Object.is(r, -0) ? 0 : r;
}

export function applyAxes(A, v) {
  return [
    v[0] * A[0][0] + v[1] * A[1][0] + v[2] * A[2][0],
    v[0] * A[0][1] + v[1] * A[1][1] + v[2] * A[2][1],
    v[0] * A[0][2] + v[1] * A[1][2] + v[2] * A[2][2]
  ];
}

export function composeAxes(parent, child) {
  return child.map((a) => applyAxes(parent, a));
}

export function rotateVec(v, axis, angle) {
  const [kx, ky, kz] = norm(axis);
  const c = Math.cos(angle), s = Math.sin(angle);
  const dot = kx * v[0] + ky * v[1] + kz * v[2];
  const cx = ky * v[2] - kz * v[1];
  const cy = kz * v[0] - kx * v[2];
  const cz = kx * v[1] - ky * v[0];
  return [v[0] * c + cx * s + kx * dot * (1 - c), v[1] * c + cy * s + ky * dot * (1 - c), v[2] * c + cz * s + kz * dot * (1 - c)];
}

export function norm(v) {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
}

export const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const mul = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
export const hadamard = (a, b) => [a[0] * b[0], a[1] * b[1], a[2] * b[2]];

export const toThree = (v) => new THREE.Vector3(v[0], v[2], v[1]);
export const fromThree = (v) => [v.x, v.z, v.y];
export const scaleToThree = (s) => new THREE.Vector3(s[0], s[2], s[1]);
export const scaleFromThree = (v) => [v.x, v.z, v.y];

export function quatFromRot(r) {
  const [X, Y, Z] = axesFromRot(r);
  const m = new THREE.Matrix4().makeBasis(toThree(X), toThree(Z), toThree(Y));
  return new THREE.Quaternion().setFromRotationMatrix(m);
}

export function rotFromQuat(q) {
  const m = new THREE.Matrix4().makeRotationFromQuaternion(q);
  const c0 = new THREE.Vector3(), c1 = new THREE.Vector3(), c2 = new THREE.Vector3();
  m.extractBasis(c0, c1, c2);
  return rotFromAxes([fromThree(c0), fromThree(c2), fromThree(c1)]);
}

export function quatFromAxes(A) {
  const m = new THREE.Matrix4().makeBasis(toThree(A[0]), toThree(A[2]), toThree(A[1]));
  return new THREE.Quaternion().setFromRotationMatrix(m);
}
