// Capture mode. With ?capture=1 a scripted bot plays the whole game (about 90 s); with ?shot=<name> one
// cinematic camera move from shots.js runs instead. Both only feed the same inputs a player would
// (a move direction, a hop) or a camera path, so the footage is real gameplay.
import * as THREE from 'three';
import { shots } from './shots.js';
import { lerpAngle } from './player.js';

export function createDirector(ctx) {
  if (ctx.params.shot) return shotDirector(ctx);
  if (ctx.params.capture) return botDirector(ctx);
  return null;
}

function botDirector({ game, world, player, rig }) {
  const move = new THREE.Vector2();
  // Title, start, let the islands gather and the camera land, then a slow look around before walking.
  const steps = [{ wait: 3.5 }, { do: () => game.start() }, { wait: 4.6 }, { look: 6.5 }];
  const order = ['shrine-arch', 'blossom-tree', 'cottage', 'lighthouse'];
  let from = game.spawn.clone();
  for (const name of order) {
    const lm = world.landmarks.find((l) => l.name === name);
    const ember = game.embers.find((e) => e.landmark === lm);
    // Via a point between the two stops, pulled towards the centre, so the path stays clear of landmarks.
    const via = from.clone().add(ember.home).multiplyScalar(0.5 * 0.55);
    steps.push({ go: via, hop: true }, { go: ember.home }, { watch: lm, seconds: name === 'cottage' || name === 'lighthouse' ? 10.5 : 9.5 });
    from = ember.home.clone();
  }
  steps.push({ until: () => game.fifth.group.visible }, { go: game.updraftBase, until: () => game.fifth.taken });
  steps.push({ wait: 1e9 });

  let i = 0, t0 = null;
  const d = {
    move: null, hop: false,
    update(dt, t) {
      d.hop = false;
      move.set(0, 0);
      const s = steps[i];
      if (t0 === null) t0 = t;
      let done = false;
      if (s.wait !== undefined) done = t - t0 >= s.wait;
      if (s.do) { s.do(); done = true; }
      if (s.watch) done = t - t0 >= s.seconds;
      if (s.look) done = t - t0 >= s.look;
      if (s.go) {
        const dx = s.go.x - player.pos.x, dz = s.go.z - player.pos.z, dist = Math.hypot(dx, dz);
        if (s.hop && t - t0 < dt * 1.5) d.hop = true;
        if (dist > 0.3) move.set(dx / dist, dz / dist).multiplyScalar(Math.min(1, dist / 1.2));
        done = s.until ? s.until() : dist <= 0.3;
      } else if (s.until) done = s.until();
      if (done) { i = Math.min(i + 1, steps.length - 1); t0 = t; }
      d.move = move;

      // Camera: behind the walk direction, or framing the landmark being watched.
      if (rig.mode === 'follow') {
        if (s.look) {
          rig.yaw += 0.5 * dt; // turn slowly, from high above the dust, to take in the island
          rig.pitch += (0.85 - rig.pitch) * (1 - Math.exp(-1.5 * dt));
          rig.dist += (11 - rig.dist) * (1 - Math.exp(-1.2 * dt));
        } else if (s.watch) {
          const p = s.watch.mesh.position;
          rig.yaw = lerpAngle(rig.yaw, Math.atan2(player.pos.x - p.x, player.pos.z - p.z) + 0.35, 1 - Math.exp(-1.6 * dt));
          rig.pitch += (0.12 - rig.pitch) * (1 - Math.exp(-1.5 * dt));
          rig.dist += (Math.max(8, s.watch.height * 0.9) - rig.dist) * (1 - Math.exp(-1.2 * dt));
        } else if (move.lengthSq() > 0.01) {
          rig.yaw = lerpAngle(rig.yaw, Math.atan2(-move.x, -move.y), 1 - Math.exp(-1.4 * dt));
          rig.pitch += (0.3 - rig.pitch) * (1 - Math.exp(-1.5 * dt));
          rig.dist += (6.5 - rig.dist) * (1 - Math.exp(-1.2 * dt));
        }
      }
    },
  };
  return d;
}

function shotDirector({ game, world, player, rig, ui, params }) {
  const shot = shots[params.shot];
  if (!shot) throw new Error(`unknown shot "${params.shot}"; try ${Object.keys(shots).join(', ')}`);
  const move = new THREE.Vector2();
  let t0 = null;
  const at = (st, dt, s) => st >= s && st - dt < s; // true on the frame the shot clock passes s seconds
  const d = {
    move: null, hop: false, seconds: shot.seconds,
    update(dt, t) {
      if (t0 === null) {
        t0 = t;
        if (params.shot === 'title') return;
        ui.cinematic(true);
        ui.skipTitle();
        game.g.phase = 'play';
        if (!shot.gather) game.gather(true);
        if (shot.ignite !== undefined) { game.standAll(); world.landmarks.forEach((lm) => { lm.t0 = -100; }); }
        if (shot.ignite < 0) game.ignite(-shot.ignite, false);
        if (shot.walk) { // from the far tip towards the lighthouse, along the island's long axis
          const x = world.radius * 0.65;
          player.spawn(new THREE.Vector3(x, world.ground(x, 0) ?? 0, 0));
        }
        rig.play(shot.camera({ game, world, player }), 0);
      }
      const st = t - t0;
      if (shot.gather && at(st, dt, shot.gather)) game.gather();
      if (shot.landmark && at(st, dt, 1.2)) game.take(game.embers.find((x) => x.landmark?.name === shot.landmark));
      if (shot.ignite > 0 && at(st, dt, shot.ignite)) { game.take(game.fifth); rig.play(shot.camera({ game, world, player }), 0); }
      move.set(0, 0);
      if (shot.walk) move.set(-0.55, 0);
      d.move = move;
    },
  };
  return d;
}
