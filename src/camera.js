// Camera rig with three modes: 'orbit' (title: a slow turn around the dust), 'follow' (third person,
// mouse/touch orbit, pulled in when terrain is in the way) and 'script' (capture shots set pos/target).
// Switching modes blends from the current view.
import * as THREE from 'three';
import { lerpAngle } from './player.js';

const ray = new THREE.Raycaster();
const ease = (x) => x * x * (3 - 2 * x);

export class CameraRig {
  constructor(camera, world) {
    this.camera = camera;
    this.world = world;
    this.mode = 'orbit';
    this.yaw = 0.6;
    this.pitch = 0.32;
    this.dist = 7;
    this.lift = 1;                         // how far above the player the camera aims
    this.focus = new THREE.Vector3();      // smoothed follow target
    this.look = new THREE.Vector3();       // current look-at point
    this.from = { pos: new THREE.Vector3(), look: new THREE.Vector3() };
    this.blend = 1;
    this.blendTime = 1;
    this.arc = 0;
    this.script = null;                    // (t) => { pos, look } in 'script' mode
    this.want = { pos: new THREE.Vector3(), look: new THREE.Vector3() };
  }

  // arc lifts the camera's path in the middle of the blend (metres), so a long move can pass over things.
  setMode(mode, blendTime = 2, arc = 0) {
    this.from.pos.copy(this.camera.position);
    this.from.look.copy(this.look);
    this.mode = mode;
    this.blend = blendTime > 0 ? 0 : 1;
    this.blendTime = blendTime;
    this.arc = arc;
  }

  // Run a camera path from shots.js; its clock starts now.
  play(path, blendTime = 2) {
    const t0 = this.now ?? 0;
    this.script = (t) => path(t - t0);
    this.setMode('script', blendTime);
  }

  // Ease the yaw behind the player's heading (keyboard play, the bot).
  follow(heading, amount, dt) {
    this.yaw = lerpAngle(this.yaw, heading + Math.PI, 1 - Math.exp(-amount * dt));
  }

  update(dt, t, player) {
    const { want } = this;
    this.now = t;
    if (this.mode === 'orbit') {
      const a = t * 0.04 + 0.2, R = this.world.radius * 3.4;
      want.pos.set(Math.cos(a) * R, 12 + 2 * Math.sin(t * 0.07), Math.sin(a) * R);
      want.look.set(0, -4, 0);
    } else if (this.mode === 'follow') {
      this.focus.lerp(v3(player.pos.x, player.pos.y + this.lift, player.pos.z), 1 - Math.exp(-10 * dt));
      this.pitch = THREE.MathUtils.clamp(this.pitch, -0.15, 1.2);
      const dir = v3(Math.sin(this.yaw) * Math.cos(this.pitch), Math.sin(this.pitch), Math.cos(this.yaw) * Math.cos(this.pitch));
      ray.set(this.focus, dir);
      ray.far = this.dist;
      const hit = ray.intersectObjects(this.world.colliders.children, true)[0];
      const d = hit ? Math.max(1.2, hit.distance - 0.4) : this.dist;
      want.pos.copy(this.focus).addScaledVector(dir, d);
      want.look.copy(this.focus);
    } else if (this.script) {
      const s = this.script(t);
      want.pos.copy(s.pos);
      want.look.copy(s.look);
    }
    this.blend = this.blendTime > 0 ? Math.min(1, this.blend + dt / this.blendTime) : 1;
    const k = ease(this.blend);
    this.camera.position.lerpVectors(this.from.pos, want.pos, k);
    this.camera.position.y += this.arc * Math.sin(Math.PI * k);
    this.look.lerpVectors(this.from.look, want.look, k);
    this.camera.lookAt(this.look);
  }
}

const tmp = new THREE.Vector3();
function v3(x, y, z) { return tmp.set(x, y, z); }
