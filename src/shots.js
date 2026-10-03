// Camera paths. Each returns (t) => { pos, look } for CameraRig's 'script' mode, t in seconds since the
// shot began. The finale is part of the game; the rest are cinematic shots for ?shot=<name> captures.
import * as THREE from 'three';

const ease = (x) => { x = Math.min(1, Math.max(0, x)); return x * x * (3 - 2 * x); };
const polar = (a, r, y, c = new THREE.Vector3()) => new THREE.Vector3(c.x + Math.cos(a) * r, y, c.z + Math.sin(a) * r);
const angleOf = (p) => Math.atan2(p.z, p.x);

// After the lamp ignites: pull back from the lighthouse to a wide view where the whale gathers.
export function finaleShot({ world, game }) {
  const R = world.radius, lamp = game.lampPos, lh = angleOf(lamp);
  const start = polar(lh + 2.5, R * 0.9, lamp.y + 2), end = polar(lh + 2.2, R * 1.7, 11);
  const pos = new THREE.Vector3(), look = new THREE.Vector3();
  return (t) => {
    const k = ease(t / 9);
    pos.lerpVectors(start, end, k);
    pos.applyAxisAngle(new THREE.Vector3(0, 1, 0), -t * 0.012);
    look.lerpVectors(lamp, world.whale ? world.whale.mesh.position : lamp, ease((t - 2) / 8) * 0.65);
    return { pos, look };
  };
}

export const shots = {
  // The title screen as the player first sees it: the islands as turning dust.
  title: { seconds: 8, camera: null },

  // The islands gather from dust (as when the game starts, 1.5 s in), seen from a slow orbit.
  gather: {
    seconds: 8,
    gather: 1.5,
    camera: ({ world }) => (t) => ({ pos: polar(0.6 + t * 0.05, world.radius * 2.1, 9 - t * 0.3), look: new THREE.Vector3(0, -5 + t * 0.5, 0) }),
  },

  // A slow orbit around the drained island with its landmarks still as dust.
  'dust-orbit': {
    seconds: 9,
    camera: ({ world }) => (t) => ({ pos: polar(0.9 + t * 0.06, world.radius * 1.45, 6 + t * 0.15), look: new THREE.Vector3(0, 2, 0) }),
  },

  // Push in on a landmark while it assembles (triggered 1.2 s into the shot).
  'assemble-lighthouse': { seconds: 9, landmark: 'lighthouse', camera: (ctx) => landmarkCam(ctx, 'lighthouse', 3.2, 0.9) },
  'assemble-tree': { seconds: 8, landmark: 'blossom-tree', camera: (ctx) => landmarkCam(ctx, 'blossom-tree', 2.2, 0.6) },
  'assemble-cottage': { seconds: 8, landmark: 'cottage', camera: (ctx) => landmarkCam(ctx, 'cottage', 2.4, 0.7) },
  'assemble-arch': { seconds: 8, landmark: 'shrine-arch', camera: (ctx) => landmarkCam(ctx, 'shrine-arch', 2.4, 0.6) },

  // Low tracking shot beside the lantern walking over drained ground, colour following it.
  'reveal-walk': {
    seconds: 8,
    walk: true,
    camera: ({ player }) => {
      const pos = new THREE.Vector3(), look = new THREE.Vector3();
      return () => {
        look.set(player.pos.x, player.pos.y + 0.6, player.pos.z);
        pos.set(player.pos.x + 3.2, player.pos.y + 1.3, player.pos.z + 1.8);
        return { pos, look };
      };
    },
  },

  // Looking up at the lighthouse from beside it as the lamp ignites (1 s in) and the beam starts to sweep.
  ignite: {
    seconds: 9,
    ignite: 1,
    camera: ({ game }) => {
      const lamp = game.lampPos, base = game.lighthouse.mesh.position, a = Math.atan2(-base.z, -base.x) - 0.7;
      return (t) => ({ pos: polar(a - t * 0.03, 7.5 - t * 0.1, base.y + 1.4 + t * 0.12, base), look: lamp.clone().setY(lamp.y - 1.2 + 0.08 * t) });
    },
  },

  // The assembled whale swimming past the island with the beam sweeping.
  'whale-flyby': {
    seconds: 10,
    ignite: -14,
    camera: ({ world }) => {
      const pos = new THREE.Vector3(), look = new THREE.Vector3();
      return (t) => {
        const w = world.whale.mesh.position;
        pos.set(w.x * 0.55, w.y - 4 + t * 0.1, w.z * 0.55).applyAxisAngle(new THREE.Vector3(0, 1, 0), 0.35);
        look.copy(w);
        return { pos, look };
      };
    },
  },
};

function landmarkCam({ world }, name, dist, height) {
  const lm = world.landmarks.find((l) => l.name === name);
  const p = lm.mesh.position, toCentre = Math.atan2(-p.z, -p.x);
  const R = lm.size.x * dist + 4, H = lm.height;
  return (t) => ({
    pos: polar(toCentre + 0.45 - t * 0.025, R - t * 0.25, p.y + H * height + t * 0.05, p),
    look: new THREE.Vector3(p.x, p.y + H * 0.48, p.z),
  });
}
