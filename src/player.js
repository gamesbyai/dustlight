// The lantern spirit: walks on the collider meshes (one ray down for the ground, two ahead for walls),
// hops, turns any long fall into a slow glide, and respawns on the last island it stood on.
// Its light is warm; a lime trail of glowing motes follows it.
import * as THREE from 'three';
import { palette } from './config.js';
import { glowSprite } from './world.js';

const WALK = 4.2, HOP = 6.3, GRAVITY = 17, GLIDE_FALL = 1.5, GLIDE_SPEED = 5.2, RADIUS = 0.3;
const TRAIL = 22, TRAIL_LIFE = 1.1;       // motes in the trail, seconds each one lives
const ray = new THREE.Raycaster();
const v = new THREE.Vector3(), n = new THREE.Vector3(), DOWN = new THREE.Vector3(0, -1, 0);

export class Player {
  constructor(scene, world) {
    this.world = world;
    this.mesh = world.spirit.mesh;
    this.glow = glowSprite(palette.lantern, 3.2, 0.55);
    scene.add(this.glow);
    this.trail = Array.from({ length: TRAIL }, () => {
      const s = glowSprite(palette.lime, 0.5, 0);
      scene.add(s);
      return { sprite: s, born: -1e9 };
    });
    this.next = 0;                         // trail mote to reuse next
    this.dropAt = 0;                       // time of the last mote
    this.pos = new THREE.Vector3();
    this.vel = new THREE.Vector3();
    this.light = new THREE.Vector3();      // where the lantern's light sits
    this.safe = new THREE.Vector3();       // last solid ground
    this.heading = 0;
    this.air = 0;                          // seconds since last on the ground
    this.gliding = false;
    this.lift = 0;                         // updraft strength (set by the game)
    this.respawns = 0;
  }

  spawn(p) {
    this.pos.copy(p);
    this.safe.copy(p);
    this.vel.set(0, 0, 0);
    this.air = 0;
  }

  // move: world-space direction (x, z), length 0..1. hop: true on the frame Space was pressed.
  update(dt, move, hop, time) {
    const { pos, vel } = this;
    const grounded = this.air === 0;
    const speed = this.gliding ? GLIDE_SPEED : WALK;
    const accel = grounded ? 14 : 5;
    vel.x += (move.x * speed - vel.x) * Math.min(1, accel * dt);
    vel.z += (move.y * speed - vel.z) * Math.min(1, accel * dt);
    if (hop && grounded) vel.y = HOP;

    // Walls: slide along anything steep in the way, at knee and chest height.
    for (const h of [0.25, 0.6]) {
      v.set(vel.x, 0, vel.z);
      const len = v.length() * dt;
      if (len < 1e-5) break;
      const hit = this.cast(v.set(pos.x, pos.y + h, pos.z), n.set(vel.x, 0, vel.z).normalize(), len + RADIUS);
      if (hit && hit.normal.y < 0.5) {
        n.set(hit.normal.x, 0, hit.normal.z).normalize();
        const into = vel.x * n.x + vel.z * n.z;
        if (into < 0) { vel.x -= n.x * into; vel.z -= n.z * into; }
      }
    }

    // Gravity (or the updraft) and the glide.
    if (this.lift > 0) vel.y += (this.lift - vel.y) * Math.min(1, 4 * dt);
    else vel.y -= GRAVITY * dt;
    this.gliding = !grounded && vel.y < 0 && this.air > 0.35;
    if (this.gliding) vel.y = Math.max(vel.y, -GLIDE_FALL);
    pos.addScaledVector(vel, dt);

    // Ground: snap onto the surface below if we are falling onto it (or walking down a slope).
    const snap = grounded ? 0.45 : Math.max(0.05, -vel.y * dt + 0.05);
    const hit = vel.y <= 0 ? this.cast(v.set(pos.x, pos.y + 0.6, pos.z), DOWN, 0.6 + snap) : null;
    if (hit && hit.normal.y > 0.45) {
      pos.y = hit.point.y;
      vel.y = 0;
      this.air = 0;
      this.safe.copy(pos);
    } else {
      this.air += dt;
    }

    // Fell too far: back to the last island.
    if (pos.y < this.safe.y - 28) {
      this.spawn(this.safe);
      this.respawns++;
    }

    // Body: face the way we move, float and sway a little.
    const flat = Math.hypot(vel.x, vel.z);
    if (flat > 0.3) this.heading = lerpAngle(this.heading, Math.atan2(vel.x, vel.z), 1 - Math.exp(-10 * dt));
    const bob = 0.06 * Math.sin(time * 3.1) + (this.gliding ? 0.1 : 0);
    this.mesh.position.set(pos.x, pos.y + 0.08 + bob, pos.z);
    this.mesh.rotation.set(Math.min(0.25, flat * 0.04) + (this.gliding ? 0.15 : 0), this.heading, 0.05 * Math.sin(time * 1.7));
    this.light.set(pos.x, pos.y + 0.5 + bob, pos.z);
    this.glow.position.copy(this.light);
    this.updateTrail(time, dt, flat);
  }

  // Drop a lime mote behind the lantern while it moves; each drifts up, shrinks and fades.
  updateTrail(time, dt, speed) {
    if (speed > 0.6 && time - this.dropAt > 0.05) {
      const m = this.trail[this.next];
      this.next = (this.next + 1) % TRAIL;
      m.born = this.dropAt = time;
      m.sprite.position.copy(this.light).add(v.set(Math.sin(time * 13) * 0.08, -0.15, Math.cos(time * 11) * 0.08));
    }
    for (const m of this.trail) {
      const age = (time - m.born) / TRAIL_LIFE;
      const live = age >= 0 && age < 1;
      m.sprite.visible = live;
      if (!live) continue;
      m.sprite.position.y += 0.25 * dt;
      m.sprite.material.opacity = 0.55 * (1 - age);
      m.sprite.scale.setScalar(0.55 * (1 - 0.6 * age));
    }
  }

  // First hit against the world colliders, with a world-space normal.
  cast(origin, dir, far) {
    ray.set(origin, dir);
    ray.far = far;
    const hit = ray.intersectObjects(this.world.colliders.children, true)[0];
    if (!hit) return null;
    hit.normal = hit.face.normal.clone().transformDirection(hit.object.matrixWorld);
    if (hit.normal.dot(dir) > 0) hit.normal.negate(); // face the ray, whatever the winding
    return hit;
  }
}

export function lerpAngle(a, b, t) {
  const d = Math.atan2(Math.sin(b - a), Math.cos(b - a));
  return a + d * t;
}
