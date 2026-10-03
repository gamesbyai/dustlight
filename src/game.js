// The game's story as state: the islands gather from dust -> embers -> landmarks assemble -> the fifth
// ember on the lighthouse gallery -> the lamp ignites -> the sky whale assembles from the stars -> end card.
// All timing is game time, so capture mode can replay it frame by frame.
import * as THREE from 'three';
import { layout, palette } from './config.js';
import { U } from './effects.js';
import { createBeam, createEmber, createUpdraft, glowSprite } from './world.js';
import { audio } from './audio.js';
import { rand } from './clock.js';
import { finaleShot } from './shots.js';

const ease = (x) => x * x * (3 - 2 * x);
const clamp01 = (x) => Math.min(1, Math.max(0, x));
const ASSEMBLE = 3.2;   // seconds for a landmark to settle
const GATHER = 3.0;     // seconds for an island to gather from dust at the start
const PICKUP = 1.25;    // metres between the lantern and an ember
const STILL = new THREE.Vector2();

export function createGame({ scene, world, player, rig, ui, touch }) {
  const g = { phase: 'title', t: 0, found: 0, events: [], sparks: [], gathered: null, started: 0, ignited: null, swim: null, stepAt: 0, paused: false };
  const after = (s, fn) => g.events.push({ at: g.t + s, fn });

  const lighthouse = world.landmarks.find((l) => l.name === 'lighthouse');
  const base = lighthouse.mesh.position;
  const lampPos = base.clone().add(new THREE.Vector3(0, lighthouse.height * layout.lamp, 0));
  const toCentre = new THREE.Vector3(-base.x, 0, -base.z).normalize();
  const fifthPos = base.clone().addScaledVector(toCentre, lighthouse.size.x + 0.6).setY(base.y + lighthouse.height * layout.gallery);

  // Embers: one in front of each landmark, the fifth hidden until four landmarks stand.
  const embers = world.landmarks.map((lm) => ({ ...createEmber(scene, lm.emberPos), landmark: lm, taken: false }));
  const fifth = { ...createEmber(scene, fifthPos), landmark: null, taken: false };
  fifth.group.visible = false;
  embers.push(fifth);
  const updraftBase = fifthPos.clone().setY(world.ground(fifthPos.x, fifthPos.z) ?? base.y);
  const updraft = createUpdraft(scene, updraftBase, fifthPos.y - updraftBase.y + 1.5);
  const beam = createBeam(scene, lampPos);
  const lamp = glowSprite(palette.beam, 9, 0);
  lamp.position.copy(lampPos);
  scene.add(lamp);
  U.beamPos.value.copy(lampPos);

  const spawn = new THREE.Vector3(0, world.ground(0, 0) ?? 0, 0);
  player.spawn(spawn);

  // The islands gather from dust (title -> play); their ground drains of colour as it lands.
  // gather(true) puts them in place at once (cinematic shots).
  function gather(now = false) {
    g.gathered = g.t - (now ? 100 : 0);
  }

  // The keeper's restore lines follow the order you restore landmarks in, not which one it is.
  const RESTORE_LINES = ['keeper-03', 'keeper-02'];
  g.lines = [...RESTORE_LINES];

  function reset() {
    g.found = 0; g.events = []; g.ignited = null; g.swim = null; g.lines = [...RESTORE_LINES];
    for (const s of g.sparks) scene.remove(s.sprite);
    g.sparks = [];
    world.landmarks.forEach((lm, i) => {
      lm.state = 'dust'; lm.progress.value = 0;
      world.colliders.remove(lm.holder);
      U.pools[i].value.set(1e5, 0, 0, 0.01);
    });
    for (const e of embers) { e.taken = false; e.group.visible = e !== fifth; e.group.scale.setScalar(1); }
    updraft.visible = false; beam.group.visible = false; lamp.material.opacity = 0;
    U.beamOn.value = 0; U.restoreAll.value = 0;
    if (world.whale) world.whale.progress.value = 0;
    player.spawn(spawn);
    ui.setPips(0);
  }

  function start() {
    if (g.phase !== 'title') return;
    g.phase = 'play';
    g.started = g.t;
    audio.unlock();
    audio.play('ui-start', { volume: 0.6 });
    audio.play('assemble', { volume: 0.7 });
    audio.play('ambient-wind', { volume: 0.45, loop: true });
    ui.hideTitle();
    gather();
    // Watch the islands gather from the title's orbit, then fly down behind the lantern.
    after(GATHER * 0.7, () => {
      rig.yaw = Math.atan2(-toCentre.x, -toCentre.z) + 0.5 + Math.PI; // looking towards the lighthouse
      rig.focus.set(player.pos.x, player.pos.y + 1, player.pos.z);
      rig.setMode('follow', 2.6, 6);
    });
    after(GATHER + 1.2, () => audio.voice('keeper-01'));
    after(GATHER, () => ui.hint(touch ? 'Left thumb to move · drag to look · tap ↑ to hop' : 'WASD to move · Space to hop · drag to look', 7));
  }

  function restart() {
    reset();
    ui.hideEnd();
    g.phase = 'play';
    g.started = g.t;
    rig.setMode('follow', 1.5);
    after(1.5, () => audio.voice('keeper-01'));
  }

  function pause(on) {
    if (g.phase !== 'play' || g.paused === on) return;
    g.paused = on;
    audio.pause(on);
    ui.showPause(on);
  }

  function take(e) {
    e.taken = true;
    g.found++;
    ui.setPips(g.found);
    audio.play('ember-pickup');
    if (e === fifth) return ignite();
    // A spark carries the ember to its landmark, which then pulls itself together.
    const lm = e.landmark;
    const sprite = glowSprite(palette.lime, 1.6, 1);
    sprite.position.copy(e.group.position);
    scene.add(sprite);
    const to = lm.mesh.position.clone().add(new THREE.Vector3(0, lm.height * 0.45, 0));
    g.sparks.push({ sprite, from: e.group.position.clone(), to, t0: g.t, lm });
  }

  function assemble(lm) {
    lm.state = 'assembling';
    lm.t0 = g.t;
    audio.play('assemble');
    after(ASSEMBLE + 0.2, () => {
      lm.state = 'standing';
      world.colliders.add(lm.holder);
      const last = world.landmarks.every((l) => l.state === 'standing');
      if (lm.name === 'shrine-arch') audio.play('bell', { volume: 0.6 });
      // The last landmark always gets "One more. The lamp is waiting."; the arch rings its bell ("Can you hear the bell?").
      const line = last ? 'keeper-05' : lm.name === 'shrine-arch' ? 'keeper-04' : g.lines.shift();
      if (line) audio.voice(line);
      if (last) after(2.5, revealFifth);
    });
  }

  function revealFifth() {
    fifth.group.visible = true;
    fifth.group.scale.setScalar(0.01);
    updraft.visible = true;
    audio.play('bell', { volume: 0.7 });
    ui.hint('Ride the updraft to the lighthouse gallery', 6);
  }

  // `ago` starts the finale part-way through (cinematic shots); the end card follows 20 s after ignition.
  function ignite(ago = 0, endCard = true) {
    g.ignited = g.t - ago;
    updraft.visible = false;
    ui.hint('');
    beam.group.visible = true;
    if (ago === 0) {
      audio.play('ignite');
      after(3.0, () => audio.voice('keeper-06'));
      after(2.5, () => audio.play('whale'));
      rig.play(finaleShot({ world, game: { lampPos } }), 3);
    }
    if (endCard) {
      const seconds = g.t - g.started;
      after(20 - ago, () => { g.phase = 'end'; ui.showEnd({ found: g.found, seconds }); audio.play('bell', { volume: 0.8 }); });
    }
  }

  // Shots and tests: put the islands and every landmark in their final state at once.
  function standAll() {
    gather(true);
    world.landmarks.forEach((lm, i) => {
      lm.state = 'standing'; lm.t0 = g.t - ASSEMBLE; lm.progress.value = 1;
      world.colliders.add(lm.holder);
      embers[i].taken = true; embers[i].group.visible = false;
    });
    g.found = 4;
    ui.setPips(4);
  }

  function update(dt, move, hop) {
    if (g.paused) return;
    g.t += dt;
    for (const ev of g.events.filter((e) => e.at <= g.t)) { g.events.splice(g.events.indexOf(ev), 1); ev.fn(); }

    // Islands: dust until the game starts, then each gathers in turn and its ground drains.
    world.islands.forEach((isl, i) => { isl.progress.value = g.gathered === null ? 0 : clamp01((g.t - g.gathered - i * 0.3) / GATHER); });
    const landed = world.island.progress.value;
    world.drained.value = ease(clamp01((landed - 0.55) / 0.45));
    const ready = landed > 0.85; // the lantern appears once its island is (nearly) whole
    player.mesh.visible = player.glow.visible = ready;

    if (g.phase !== 'title') {
      // Updraft: rise while inside the column, until the gallery.
      const dx = player.pos.x - updraftBase.x, dz = player.pos.z - updraftBase.z;
      const inside = updraft.visible && Math.hypot(dx, dz) < 1.4 && player.pos.y < fifthPos.y + 0.6;
      player.lift = inside ? 5 : 0;
      const wasGliding = player.gliding;
      player.update(dt, ready ? move : STILL, g.phase === 'play' && hop, g.t);
      if (player.gliding && !wasGliding) audio.play('glide', { volume: 0.5 });
      if (player.air === 0 && move.lengthSq() > 0.05 && g.t > g.stepAt) {
        audio.play(`step-${1 + Math.floor(rand() * 3)}`, { volume: 0.22, rate: 0.9 + rand() * 0.2 });
        g.stepAt = g.t + 0.4;
      }
      for (const e of embers) if (!e.taken && e.group.visible && player.light.distanceTo(e.group.position) < PICKUP && g.phase === 'play') take(e);
    }

    // Embers bob and glow; collected ones shrink away.
    embers.forEach((e, i) => {
      e.group.position.y = e.home.y + 0.12 * Math.sin(g.t * 2 + i);
      const s = e.taken ? Math.max(0.001, e.group.scale.x - dt * 3) : Math.min(1, e.group.scale.x + dt);
      e.group.scale.setScalar(s);
      e.glow.material.opacity = 0.6 + 0.15 * Math.sin(g.t * 5 + i * 2);
    });

    // Sparks fly in an arc, then start their landmark's assembly.
    for (const s of [...g.sparks]) {
      const k = clamp01((g.t - s.t0) / 1.0);
      s.sprite.position.lerpVectors(s.from, s.to, ease(k)).y += Math.sin(Math.PI * k) * 2.5;
      if (k >= 1) { scene.remove(s.sprite); g.sparks.splice(g.sparks.indexOf(s), 1); assemble(s.lm); }
    }

    // Landmarks: progress and the pool of colour around them.
    world.landmarks.forEach((lm, i) => {
      if (lm.state === 'dust') return;
      const k = clamp01((g.t - lm.t0) / ASSEMBLE);
      lm.progress.value = k;
      const p = lm.mesh.position;
      U.pools[i].value.set(p.x, p.y, p.z, 0.01 + ease(k) * (lm.size.x * 1.2 + 3.5));
    });

    // Finale: lamp, beam sweep, colour returns everywhere, the whale assembles and swims.
    if (g.ignited !== null) {
      const k = clamp01((g.t - g.ignited) / 2);
      U.beamOn.value = k;
      beam.material.uniforms.on.value = k;
      lamp.material.opacity = k * (0.85 + 0.15 * Math.sin(g.t * 3));
      beam.group.rotation.y = (g.t - g.ignited) * 0.55;
      U.beamDir.value.set(Math.cos(beam.group.rotation.y), 0, -Math.sin(beam.group.rotation.y));
      U.restoreAll.value = ease(clamp01((g.t - g.ignited - 0.5) / 6));
      if (world.whale) world.whale.progress.value = clamp01((g.t - g.ignited - 2.5) / 7);
    }
    updateWhale();
    if (fifth.group.visible && !fifth.taken) fifth.group.scale.setScalar(Math.min(1, fifth.group.scale.x + dt));
  }

  // The whale holds its start pose while it assembles, then loops the islands.
  function updateWhale() {
    const w = world.whale;
    if (!w) return;
    if (w.progress.value >= 1 && g.swim === null) g.swim = g.t;
    const s = g.swim === null ? 0 : g.t - g.swim;
    const a = 2.2 + s * 0.11;
    const r = w.path.radius;
    w.mesh.position.set(Math.cos(a) * r, w.path.height + 2 * Math.sin(s * 0.4), Math.sin(a) * r);
    w.mesh.rotation.set(0.05 * Math.cos(s * 0.4), Math.atan2(-Math.sin(a), Math.cos(a)), 0.12);
  }

  return { g, start, restart, reset, pause, update, take, ignite, standAll, gather, revealFifth, embers, fifth, fifthPos, lampPos, updraftBase, spawn, lighthouse };
}
