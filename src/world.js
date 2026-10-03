// Loads every splat asset with its collider, places them on the islands and builds the small effect
// objects (embers, updraft, lighthouse beam, glows). Assets live in public/splats/<name>/ as
// <name>.spz (the splats) and <name>-collider.glb (the walkable mesh).
import * as THREE from 'three';
import { SplatMesh, dyno } from '@sparkjsdev/spark';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { layout, palette } from './config.js';
import { dustModifier, flameModifier, lookModifier, riseModifier, starModifier, whaleModifier } from './effects.js';

const DOWN = new THREE.Vector3(0, -1, 0);
const ray = new THREE.Raycaster();
const gltf = new GLTFLoader();

const NO_COLLIDER = ['sky-whale', 'lantern-spirit']; // nothing walks on these

async function loadAsset(name, onProgress) {
  const dir = `./splats/${name}/`;
  const mesh = new SplatMesh({ url: `${dir}${name}.spz`, onProgress: (e) => onProgress(name, e.loaded, e.total) });
  const [collider] = await Promise.all([
    NO_COLLIDER.includes(name) ? null : gltf.loadAsync(`${dir}${name}-collider.glb`).then((g) => g.scene, () => null),
    mesh.initialized,
  ]);
  collider?.traverse((o) => { if (o.material) o.material.side = THREE.DoubleSide; }); // winding-proof rays
  collider?.updateMatrixWorld(true);
  return { name, mesh, collider, box: mesh.getBoundingBox(true) };
}

// Give a mesh its effects: object-space modifiers run before its transform, world-space ones after.
export function setModifiers(mesh, objectModifiers, worldModifiers) {
  mesh.objectModifiers = objectModifiers;
  mesh.worldModifiers = worldModifiers;
  mesh.updateGenerator();
}

// First hit straight down through `objects` at (x, z), or null.
export function castDown(objects, x, z, fromY = 400) {
  ray.set(new THREE.Vector3(x, fromY, z), DOWN);
  ray.far = 1000;
  return ray.intersectObjects(objects, true)[0] ?? null;
}

const radiusOf = (box) => 0.5 * Math.min(box.max.x - box.min.x, box.max.z - box.min.z);

// A mesh that starts as dust: its dust modifier, with the camera position in its own space (`eye`, updated
// every frame by updateEyes) so the motes can fade out near the lens.
const dusty = [];
function dust(a, progress) {
  a.eye = dyno.dynoVec3(new THREE.Vector3(0, 1e4, 0));
  dusty.push(a);
  return dustModifier(progress, dyno.dynoVec3(dustSize(a)), a.eye);
}
export function updateEyes(camera) {
  for (const a of dusty) a.mesh.worldToLocal(a.eye.value.copy(camera.position));
}

// The dust's size: (footprint radius, height, share of splats shown as motes). Motes grow with the footprint:
// 4,000 for a landmark, about 13,000 for the main island.
function dustSize(a) {
  const R = Math.max(1.5, 0.5 * Math.max(a.box.max.x - a.box.min.x, a.box.max.z - a.box.min.z));
  const motes = Math.max(4000, 60 * R * R);
  return new THREE.Vector3(R, a.box.max.y - Math.max(0, a.box.min.y), Math.min(0.33, motes / Math.max(1, a.mesh.numSplats)));
}

// onProgress(fraction) reports the splat download, 0..1.
export async function createWorld(scene, onProgress = () => {}) {
  const names = ['island', ...layout.smallIslands.map((s) => s.name), ...layout.landmarks.map((l) => l.name), 'sky-whale', 'lantern-spirit'];
  const bytes = {};
  const progress = (name, loaded, total) => {
    bytes[name] = [loaded, Math.max(total, loaded)];
    const all = Object.values(bytes);
    onProgress(all.reduce((s, b) => s + b[0], 0) / Math.max(1, all.reduce((s, b) => s + b[1], 0)) * (all.length / names.length));
  };
  const loaded = await Promise.all(names.map((n) => loadAsset(n, progress).catch((e) => { console.warn(`asset ${n} not loaded`, e); return null; })));
  const A = Object.fromEntries(loaded.filter(Boolean).map((a) => [a.name, a]));

  const colliders = new THREE.Group(); // invisible collision meshes, used only for raycasts
  const solid = (asset) => {
    if (!asset.collider) return null;
    const holder = new THREE.Group();
    holder.position.copy(asset.mesh.position);
    holder.quaternion.copy(asset.mesh.quaternion);
    holder.scale.copy(asset.mesh.scale);
    holder.add(asset.collider);
    holder.updateMatrixWorld(true);
    return holder;
  };
  // An island's walkable top in its own frame (its origin is the tip of the rock underneath).
  const topOf = (asset) => castDown([asset.collider], 0, 0)?.point.y ?? asset.box.max.y;

  // Islands: dust on the title screen, then they gather (game.js) with their ground drained of colour.
  const drained = dyno.dynoFloat(0);
  const islands = [];
  const addIsland = (a, position) => {
    a.mesh.position.copy(position);
    a.progress = dyno.dynoFloat(0);
    setModifiers(a.mesh, [dust(a, a.progress)], [lookModifier(drained)]);
    scene.add(a.mesh);
    colliders.add(solid(a));
    islands.push(a);
  };

  // Main island: top centre at y = 0. Layout angles and radii are relative to its footprint ellipse.
  const island = A.island;
  addIsland(island, new THREE.Vector3(0, -topOf(island), 0));
  const rx = 0.5 * (island.box.max.x - island.box.min.x), rz = 0.5 * (island.box.max.z - island.box.min.z);
  const onIsland = (deg, r) => { const a = THREE.MathUtils.degToRad(deg); return [Math.cos(a) * r * rx, Math.sin(a) * r * rz]; };
  const edge = (deg) => Math.hypot(...onIsland(deg, 1));
  const R = Math.max(rx, rz);
  const ground = (x, z) => castDown(colliders.children, x, z)?.point.y ?? null;

  for (const s of layout.smallIslands) {
    const a = A[s.name];
    if (!a) continue;
    const ang = THREE.MathUtils.degToRad(s.angle);
    const rim = ground(...onIsland(s.angle, 0.85)) ?? 0;
    const d = edge(s.angle) + s.gap + radiusOf(a.box);
    addIsland(a, new THREE.Vector3(Math.cos(ang) * d, rim + s.dy - topOf(a), Math.sin(ang) * d));
  }

  // Landmarks: dropped onto the main island, facing its centre, starting as dust.
  const landmarks = [];
  for (const L of layout.landmarks) {
    const a = A[L.name];
    if (!a) continue;
    let r = L.r, y = null, x = 0, z = 0;
    for (; r > 0 && y === null; r -= 0.03) { [x, z] = onIsland(L.angle, r); y = ground(x, z); }
    a.mesh.position.set(x, y ?? 0, z);
    a.mesh.rotation.y = Math.atan2(-x, -z); // local +z faces the island centre
    const size = dustSize(a);
    const progress = dyno.dynoFloat(0);
    setModifiers(a.mesh, [dust(a, progress)], [lookModifier(dyno.dynoFloat(0))]);
    scene.add(a.mesh);
    // Colliders join the world once the landmark has assembled. Its ember waits in front of it, on the way
    // to the island centre (where the player starts), but never closer to the centre than emberMin.
    const toLandmark = Math.hypot(x, z);
    const reach = Math.min(size.x + layout.emberGap, toLandmark - layout.emberMin);
    const ex = x - (x / toLandmark) * reach, ez = z - (z / toLandmark) * reach;
    const emberPos = new THREE.Vector3(ex, (ground(ex, ez) ?? a.mesh.position.y) + 0.9, ez);
    landmarks.push({ ...L, asset: a, mesh: a.mesh, holder: solid(a), size, height: size.y, progress, emberPos, state: 'dust', t0: 0 });
  }

  // Sky whale: its splats begin as stars and swim a slow loop once assembled (+z is the head).
  const whale = A['sky-whale'];
  if (whale) {
    const b = whale.box;
    whale.mesh.scale.setScalar(THREE.MathUtils.clamp(18 / Math.max(b.max.z - b.min.z, 1), 0.3, 3));
    whale.progress = dyno.dynoFloat(0);
    const bounds = new THREE.Vector4(b.min.z, b.max.z, THREE.MathUtils.lerp(b.min.y, b.max.y, 0.55), 0);
    setModifiers(whale.mesh, [whaleModifier(dyno.dynoVec4(bounds))], [starModifier(whale.progress)]);
    whale.path = { radius: R * 2.4, height: 17 };
    scene.add(whale.mesh);
  }

  // The player's body: painted colours, lit only by fog like everything else.
  const spirit = A['lantern-spirit'];
  const sb = spirit.box;
  spirit.mesh.scale.setScalar(layout.playerHeight / Math.max(0.05, sb.max.y - Math.min(0, sb.min.y)));
  setModifiers(spirit.mesh, [], [lookModifier(dyno.dynoFloat(0))]);
  scene.add(spirit.mesh);

  colliders.updateMatrixWorld(true);
  return { A, island, islands, drained, landmarks, whale, spirit, colliders, radius: R, ground };
}

// ---------- small effect objects ----------

let glowMap;
export function glowSprite(color, size, opacity = 1) {
  if (!glowMap) {
    const c = document.createElement('canvas');
    c.width = c.height = 128;
    const g = c.getContext('2d');
    const grd = g.createRadialGradient(64, 64, 0, 64, 64, 64);
    grd.addColorStop(0, 'rgba(255,255,255,1)');
    grd.addColorStop(0.18, 'rgba(255,255,255,0.5)');
    grd.addColorStop(0.5, 'rgba(255,255,255,0.1)');
    grd.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grd;
    g.fillRect(0, 0, 128, 128);
    glowMap = new THREE.CanvasTexture(c);
    glowMap.colorSpace = THREE.SRGBColorSpace;
  }
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowMap, color, opacity, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
  s.scale.setScalar(size);
  s.renderOrder = 10;
  return s;
}

// A SplatMesh of `count` placeholder splats whose look comes entirely from a modifier.
function proceduralSplats(count, modifier) {
  const zero = new THREE.Vector3(), one = new THREE.Vector3(0.05, 0.05, 0.05), q = new THREE.Quaternion(), c = new THREE.Color(1, 1, 1);
  const mesh = new SplatMesh({ constructSplats: (s) => { for (let i = 0; i < count; i++) s.pushSplat(zero, one, q, 1, c); } });
  setModifiers(mesh, [modifier], []);
  return mesh;
}

// An ember: a lime flame of splats inside a soft lime halo.
export function createEmber(scene, position) {
  const group = new THREE.Group();
  group.position.copy(position);
  group.add(proceduralSplats(320, flameModifier()));
  const glow = glowSprite(palette.lime, 2.8, 0.7);
  group.add(glow);
  scene.add(group);
  return { group, glow, home: position.clone() };
}

export function createUpdraft(scene, position, height) {
  const mesh = proceduralSplats(1500, riseModifier(dyno.dynoVec2(new THREE.Vector2(0.9, height))));
  mesh.position.copy(position);
  mesh.visible = false;
  scene.add(mesh);
  return mesh;
}

// Two opposite light cones from the lamp; additive, brightest where they face the camera.
export function createBeam(scene, position) {
  const geo = new THREE.ConeGeometry(7, 130, 40, 1, true);
  geo.translate(0, -65, 0);
  geo.rotateZ(Math.PI / 2); // apex at the lamp, opening along +x
  const material = new THREE.ShaderMaterial({
    uniforms: { on: { value: 0 }, color: { value: palette.beam } },
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    vertexShader: /* glsl */ `
      varying vec2 vUv; varying vec3 vNormal; varying vec3 vView;
      void main() {
        vUv = uv;
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vNormal = normalMatrix * normal;
        vView = -mv.xyz;
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */ `
      uniform float on; uniform vec3 color;
      varying vec2 vUv; varying vec3 vNormal; varying vec3 vView;
      void main() {
        float along = 1.0 - vUv.y;
        float facing = abs(dot(normalize(vNormal), normalize(vView)));
        float a = on * 0.22 * pow(facing, 2.5) * pow(1.0 - along, 1.8) * smoothstep(0.0, 0.04, along);
        gl_FragColor = vec4(color, a);
        #include <colorspace_fragment>
      }`,
  });
  const group = new THREE.Group();
  const a = new THREE.Mesh(geo, material), b = new THREE.Mesh(geo, material);
  b.rotation.y = Math.PI;
  a.renderOrder = b.renderOrder = 11;
  a.frustumCulled = b.frustumCulled = false;
  group.add(a, b);
  group.position.copy(position);
  group.visible = false;
  scene.add(group);
  return { group, material };
}
