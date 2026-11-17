// Small shared helpers for SOLMAR BAY. No external code: everything here is
// written for this game. The city generator, traffic and missions all draw
// their randomness from one seeded generator so a fresh load looks the same.
import * as THREE from 'three';
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function next() {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function makeRng(seed) {
  const next = mulberry32(seed);
  return {
    next,
    range(min, max) { return min + next() * (max - min); },
    int(min, max) { return Math.floor(min + next() * (max - min + 1)); },
    pick(list) { return list[Math.floor(next() * list.length)]; },
    chance(p) { return next() < p; },
  };
}
// Pick an entry from `items` with probability proportional to `weights`
// (same length, non-negative). Falls back to a uniform pick when the total
// weight is zero, so callers never need a separate guard.
export function weightedPick(rng, items, weights) {
  let total = 0;
  for (const w of weights) total += w;
  if (total <= 0) return rng.pick(items);
  let r = rng.next() * total;
  for (let i = 0; i < items.length; i++) {
    r -= weights[i];
    if (r <= 0) return items[i];
  }
  return items[items.length - 1];
}

export function clamp(v, min, max) { return v < min ? min : v > max ? max : v; }
export function clamp01(v) { return v < 0 ? 0 : v > 1 ? 1 : v; }
// Exponential damp toward a target: frame-rate independent smoothing.
// rate ~12/s reaches the target in ~0.2 s, the same feel as a 0.18 s
// animation crossfade. Used by the player animation state machine.
export function damp(v, target, rate, dt) {
  return v + (target - v) * (1 - Math.exp(-rate * dt));
}
export function lerp(a, b, t) { return a + (b - a) * t; }
export function wrapAngle(a) {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}
export function dist2D(ax, az, bx, bz) {
  const dx = ax - bx, dz = az - bz;
  return Math.sqrt(dx * dx + dz * dz);
}
// Move a value toward a target by at most `step` per call. Returns the result.
export function approach(v, target, step) {
  if (v < target) return Math.min(target, v + step);
  if (v > target) return Math.max(target, v - step);
  return v;
}
// Format a dollar amount with commas, e.g. 2850 -> "$2,850".
export function money(n) {
  return '$' + Math.floor(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}
// Build a small canvas texture from a painter callback. Used for facades,
// road surfaces and shop signs so the game needs no image files at all.
export function canvasTexture(w, h, paint) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  paint(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}
