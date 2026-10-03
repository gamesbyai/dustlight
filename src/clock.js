// Game time and randomness. In capture mode nothing reads the wall clock: tools/capture.mjs calls
// window.__dustlight.step() and every frame advances exactly 1/60 s. Randomness is always seeded.
import { params } from './config.js';

export const STEP = 1 / 60;

export const clock = { time: 0, frame: 0 };

let s = (params.seed * 2654435761) >>> 0;
export function rand() {
  s = (s + 0x6d2b79f5) >>> 0;
  let t = s;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

// Real-time driver: calls tick(dt) once per animation frame with a clamped delta.
export function runRealtime(renderer, tick) {
  let last = performance.now();
  renderer.setAnimationLoop((now) => {
    const dt = Math.min(0.05, Math.max(0, (now - last) / 1000));
    last = now;
    tick(dt);
  });
}
