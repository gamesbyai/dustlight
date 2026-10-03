// Everything tunable in one place: URL switches, quality, layout and the brand palette.
import * as THREE from 'three';

const q = new URLSearchParams(location.search);
const touch = matchMedia('(pointer: coarse)').matches;

export const params = {
  capture: q.get('capture') === '1',            // deterministic virtual time, driven by tools/capture.mjs
  shot: q.get('shot'),                          // cinematic camera move (see src/shots.js)
  seed: Number(q.get('seed') ?? 1),
  quality: q.get('quality') ?? (touch ? 'low' : 'high'),
  debug: q.get('debug') === '1',
  touch,
};

export const quality = params.quality === 'low'
  ? { maxDpr: 1, keep: 0.5, maxStdDev: Math.sqrt(5) }   // keep = fraction of splats drawn
  : { maxDpr: 1.5, keep: 1, maxStdDev: Math.sqrt(8) };

// Landmarks sit on the main island in polar coordinates over its footprint ellipse: angle in degrees
// (0 = +x, 90 = +z), r = 1 at the edge. They are dropped onto the ground with a raycast.
export const layout = {
  landmarks: [
    { name: 'shrine-arch', angle: 125, r: 0.6 },
    { name: 'blossom-tree', angle: 40, r: 0.55 },
    { name: 'cottage', angle: -60, r: 0.55 },
    { name: 'lighthouse', angle: 182, r: 0.8 },
  ],
  // Small islands: direction in degrees, gap to the main island edge in metres, height offset.
  smallIslands: [
    { name: 'island-small-1', angle: 25, gap: 4.5, dy: 0.2 },
    { name: 'island-small-2', angle: 145, gap: 4.0, dy: 0.6 },
    { name: 'island-small-3', angle: 265, gap: 5.0, dy: -0.4 },
  ],
  playerHeight: 0.8,          // the lantern spirit is scaled to this height
  emberGap: 1.6,              // metres between a landmark's footprint and its ember
  emberMin: 3.5,              // no ember closer than this to the island centre (the spawn)
  lamp: 0.81,                 // lighthouse lamp room and gallery heights, as fractions of its height
  gallery: 0.68,
};

// The GamesByAI night (docs/standards/design-system.md): a near-black canvas, dark indigo at the horizon,
// and three neons. The painted models keep their own colours; only light and atmosphere use these.
const c = (hex) => new THREE.Color(hex);
export const palette = {
  zenith: c('#07080b'),
  horizon: c('#10142a'),
  fog: c('#0d1124'),          // distant splats fade into the horizon's indigo
  lime: c('#c6ff3d'),
  cyan: c('#3de0ff'),
  magenta: c('#ff3ea5'),
  lantern: c('#ffb36b'),      // the spirit's own light stays warm
  beam: c('#dcff8f'),         // lime-white lighthouse beam
};
