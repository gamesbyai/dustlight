// The backdrop: a night sky with stars and a faint band of haze (one shader on a big sphere), and a sea of
// procedural splat clouds far below, lit from underneath by neon light pools in the brand's three colours.
import * as THREE from 'three';
import { SplatMesh, dyno } from '@sparkjsdev/spark';
import { palette } from './config.js';
import { rand } from './clock.js';
import { U, driftModifier, lookModifier } from './effects.js';
import { glowSprite, setModifiers } from './world.js';

export function createSky() {
  const uniforms = {
    zenith: { value: palette.zenith }, horizon: { value: palette.horizon },
    lime: { value: palette.lime }, cyan: { value: palette.cyan }, magenta: { value: palette.magenta },
    time: { value: 0 },
  };
  const material = new THREE.ShaderMaterial({
    uniforms, side: THREE.BackSide, depthWrite: false,
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main() {
        vDir = position;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        gl_Position.z = gl_Position.w; // always at the far plane
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 zenith, horizon, lime, cyan, magenta;
      uniform float time;
      varying vec3 vDir;
      float hash(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
      // A soft neon glow low on the horizon at azimuth az (radians).
      vec3 haze(vec3 d, vec3 colour, float az, float width) {
        float da = atan(sin(atan(d.z, d.x) - az), cos(atan(d.z, d.x) - az));
        return colour * exp(-da * da / width) * exp(-abs(d.y) * 7.0);
      }
      void main() {
        vec3 d = normalize(vDir);
        float y = d.y;
        // Near-black overhead, dark indigo at the horizon, darker again below it.
        vec3 col = mix(horizon, zenith, smoothstep(-0.02, 0.55, y));
        col = mix(col, zenith, smoothstep(0.0, -0.5, y));
        col += 0.010 * haze(d, magenta, 2.9, 0.5) + 0.008 * haze(d, cyan, -0.6, 0.35) + 0.006 * haze(d, lime, 1.2, 0.3);
        // A faint band of haze across the sky, where stars are denser.
        float band = exp(-pow(dot(d, normalize(vec3(0.35, 0.5, 0.79))), 2.0) * 24.0);
        col += vec3(0.010, 0.011, 0.024) * band * smoothstep(0.0, 0.3, y);
        // Stars: one candidate per cell of a 3D grid of directions.
        vec3 g = d * 260.0, cell = floor(g);
        float h = hash(cell);
        if (h > 0.975 - 0.02 * band && y > 0.02) {
          vec3 c = cell + 0.5 + 0.35 * (vec3(hash(cell + 1.7), hash(cell + 3.1), hash(cell + 5.3)) - 0.5);
          float tw = 0.6 + 0.4 * sin(time * (1.0 + 3.0 * h) + h * 400.0);
          float b = smoothstep(0.24, 0.0, length(g - c)) * tw * smoothstep(0.02, 0.25, y);
          float tint = hash(cell + 9.1);
          vec3 star = tint < 0.06 ? cyan : tint < 0.1 ? magenta : tint < 0.13 ? lime : vec3(0.85, 0.9, 1.0);
          col += mix(vec3(1.0), star, 0.6) * b * (h > 0.996 ? 1.4 : 0.55);
        }
        gl_FragColor = vec4(col, 1.0);
        #include <colorspace_fragment>
        gl_FragColor.rgb += (hash(vec3(gl_FragCoord.xy, 3.7)) - 0.5) / 255.0; // dither: no banding in the dark
      }`,
  });
  const sky = new THREE.Mesh(new THREE.SphereGeometry(1500, 48, 24), material);
  sky.renderOrder = -1;
  sky.frustumCulled = false;
  return { mesh: sky, uniforms };
}

// Cloud heaps on a wide ring far below: dark indigo, starlit on top, and glowing over a few neon light pools
// underneath (like lights under a night cloud deck). Returns a group: the cloud splats plus the pools' glows.
export function createClouds() {
  // Splat colours are sRGB, so the cloud colours are sRGB too (Color.setStyle would convert to linear).
  const srgb = (hex) => new THREE.Color().setHex(hex, THREE.LinearSRGBColorSpace);
  const top = srgb(0x1c2343), shade = srgb(0x0d1126), deep = srgb(0x070912);
  const neon = [palette.lime, palette.cyan, palette.magenta];
  const pools = [];
  for (let i = 0; i < 9; i++) {
    const a = rand() * Math.PI * 2, r = 70 + rand() * 300;
    pools.push({ x: Math.cos(a) * r, z: Math.sin(a) * r, r: 28 + rand() * 40, light: neon[i % 3], colour: neon[i % 3].clone().convertLinearToSRGB() });
  }
  const group = new THREE.Group();
  const mesh = new SplatMesh({
    constructSplats: (splats) => {
      const p = new THREE.Vector3(), s = new THREE.Vector3(), q = new THREE.Quaternion(), c = new THREE.Color(), n = new THREE.Vector3();
      const light = (x, z, under) => { // add the pools' glow to colour c
        for (const pl of pools) {
          const f = Math.exp(-((x - pl.x) ** 2 + (z - pl.z) ** 2) / (pl.r * pl.r));
          c.r += pl.colour.r * f * under; c.g += pl.colour.g * f * under; c.b += pl.colour.b * f * under;
        }
      };
      for (let i = 0; i < 600; i++) {
        const a = rand() * Math.PI * 2, r = 35 + Math.pow(rand(), 0.75) * 430;
        const cx = Math.cos(a) * r, cz = Math.sin(a) * r, cy = -60 + rand() * 9, R = 6 + rand() * 14;
        const count = Math.round(R * 14);
        for (let k = 0; k < count; k++) {
          // Puffs sit mostly on the heap's upper surface: starlit on top, glowing underneath.
          n.set(rand() * 2 - 1, Math.pow(rand(), 0.7) * 1.1 - 0.1, rand() * 2 - 1).normalize();
          const rr = R * (0.55 + 0.45 * Math.cbrt(rand()));
          p.set(cx + n.x * rr, cy + n.y * rr * 0.6, cz + n.z * rr);
          const size = 1.0 + rand() * 1.7;
          s.set(size, size * 0.65, size);
          c.copy(shade).lerp(top, Math.max(0, n.y) * 0.9).lerp(deep, Math.max(0, -n.y) * 0.8);
          light(p.x, p.z, 0.35 + 0.35 * (1 - n.y));
          splats.pushSplat(p, s, q, 0.5 + rand() * 0.4, c);
        }
      }
      for (let i = 0; i < 1200; i++) { // a soft floor that closes the gaps
        const a = rand() * Math.PI * 2, r = Math.sqrt(rand()) * 480;
        const size = 12 + rand() * 14;
        p.set(Math.cos(a) * r, -64 + rand() * 3, Math.sin(a) * r);
        s.set(size, size * 0.12, size);
        c.copy(deep).lerp(shade, rand() * 0.6);
        light(p.x, p.z, 0.8);
        splats.pushSplat(p, s, q, 0.55, c);
      }
    },
  });
  setModifiers(mesh, [driftModifier()], [lookModifier(dyno.dynoFloat(0))]);
  group.add(mesh);
  for (const pl of pools) { // the light itself, seen through the cloud deck
    const glow = glowSprite(pl.light, pl.r * 2.2, 0.16);
    glow.position.set(pl.x, -68, pl.z);
    group.add(glow);
  }
  return group;
}

export function updateSky(sky, clouds, camera) {
  sky.mesh.position.copy(camera.position);
  sky.uniforms.time.value = U.time.value;
  clouds.rotation.y = U.time.value * 0.004; // the cloud sea and its lights turn very slowly
}
