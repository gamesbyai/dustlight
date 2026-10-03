// Dustlight: boots three.js + Spark, loads the world and runs the frame loop.
// In capture mode (?capture=1) there is no animation loop: tools/capture.mjs calls
// window.__dustlight.step() to advance exactly 1/60 s, then settle() before each screenshot.
import * as THREE from 'three';
import { SparkRenderer, SplatMesh } from '@sparkjsdev/spark';
import { params, quality } from './config.js';
import { clock, STEP, runRealtime } from './clock.js';
import { U } from './effects.js';
import { createClouds, createSky, updateSky } from './sky.js';
import { createWorld, updateEyes } from './world.js';
import { Player } from './player.js';
import { CameraRig } from './camera.js';
import { initInput, input, pollInput } from './input.js';
import { createGame } from './game.js';
import { createUI } from './ui.js';
import { audio } from './audio.js';
import { createDirector } from './capture.js';

const canvas = document.getElementById('game');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, quality.maxDpr));
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 4000);
// One SparkRenderer draws every SplatMesh in the scene, sorted together.
const spark = new SparkRenderer({ renderer, maxStdDev: quality.maxStdDev, enableLod: false });
scene.add(spark);

function resize() {
  renderer.setSize(innerWidth, innerHeight, false);
  camera.aspect = innerWidth / innerHeight;
  camera.fov = camera.aspect < 1 ? 66 : 50; // taller view in portrait
  camera.updateProjectionMatrix();
}
addEventListener('resize', resize);
resize();

let game;
const ui = createUI({
  touch: params.touch,
  onStart: () => game?.start(),
  onRestart: () => game?.restart(),
  onPause: (on) => game?.pause(on ?? !game.g.paused),
});
audio.onSubtitle = (text, seconds) => ui.subtitle(text, seconds);

const sky = createSky();
const clouds = createClouds();
scene.add(sky.mesh, clouds);
const [world] = await Promise.all([createWorld(scene, (p) => ui.setLoading(p)), audio.load(params.capture)]);
const player = new Player(scene, world);
const rig = new CameraRig(camera, world);
game = createGame({ scene, world, player, rig, ui, touch: params.touch });
const director = createDirector({ game, world, player, rig, ui, params });
initInput(canvas, ui);

const splats = [];
scene.traverse((o) => { if (o instanceof SplatMesh) splats.push(o); });
const fwd = new THREE.Vector2(), right = new THREE.Vector2(), move = new THREE.Vector2();

function tick(dt) {
  clock.time += dt;
  clock.frame++;
  U.time.value = clock.time;

  pollInput();
  if (!game.g.paused) {
    director?.update(dt, clock.time);
    if (rig.mode === 'follow' && input.enabled) {
      rig.yaw -= input.look.x * 0.005;
      rig.pitch += input.look.y * 0.004;
      rig.dist = THREE.MathUtils.clamp(rig.dist + input.zoom * 0.6, 3, 14);
      if (input.look.lengthSq() > 0) input.lastLook = clock.time;
    }
    // Camera-relative movement (the bot gives a world direction directly).
    if (director?.move) move.copy(director.move);
    else {
      fwd.set(-Math.sin(rig.yaw), -Math.cos(rig.yaw));
      right.set(Math.cos(rig.yaw), -Math.sin(rig.yaw));
      move.copy(right).multiplyScalar(input.move.x).addScaledVector(fwd, input.move.y);
      if (rig.mode === 'follow' && clock.time - input.lastLook > 1.5 && input.move.y > 0.3) rig.follow(player.heading, 0.9 * input.move.y, dt);
    }
    game.update(dt, move, director ? director.hop : input.hop);
    rig.update(dt, clock.time, player);
  }
  input.look.set(0, 0);
  input.zoom = 0;

  U.camera.value.copy(camera.position);
  updateEyes(camera);
  U.lantern.value.copy(player.light);
  U.lanternRadius.value = 5 + 0.3 * Math.sin(clock.time * 2.1);
  updateSky(sky, clouds, camera);
  ui.update(clock.time, dt);
  for (const m of splats) m.updateVersion(); // re-run the dyno effects for this frame
  renderer.render(scene, camera);
  fps.frame();
}

// Rolling frame rate for ?debug=1 and the bench tool.
const fps = { value: 0, n: 0, since: performance.now(), frame() {
  this.n++;
  const now = performance.now();
  if (now - this.since > 1000) { this.value = (this.n * 1000) / (now - this.since); this.n = 0; this.since = now; if (params.debug) document.title = `${this.value.toFixed(0)} fps`; }
} };

// Pause when the tab or the embedding page hides the game.
document.addEventListener('visibilitychange', () => { if (document.hidden && !params.capture) game.pause(true); });

window.__dustlight = {
  step(n = 1) { for (let i = 0; i < n; i++) tick(STEP); },
  // Wait for Spark's background depth sort to catch up with the last frame, then draw it again; repeat while
  // that draw starts another sort (Spark shows a new set of meshes only once its first sort is done).
  async settle() {
    const until = performance.now() + 8000;
    do {
      while ((spark.sorting || spark.sortDirty) && performance.now() < until) await new Promise((r) => setTimeout(r, 1));
      renderer.render(scene, camera);
    } while ((spark.sorting || spark.sortDirty) && performance.now() < until);
  },
  state: () => ({ t: clock.time, frame: clock.frame, phase: game.g.phase, found: game.g.found, fps: fps.value, splats: splats.reduce((s, m) => s + (m.numSplats || 0), 0), respawns: player.respawns, pos: player.pos.toArray() }),
  shotSeconds: director?.seconds ?? null,
  audioLog: audio.log,
  game, world, player, rig, spark, renderer,
};

ui.showTitle();
if (params.capture) tick(0);
else runRealtime(renderer, tick);
