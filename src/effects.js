// Per-splat GPU effects, written as Spark "dyno" modifiers. Spark runs a mesh's modifiers on every splat
// whenever the mesh's version changes (main.js bumps it every frame), so an effect is a few lines of GLSL
// that read and rewrite one splat: { center, scales, quaternion, rgba, index, flags }. Colours are sRGB.
//
//   dustModifier   (object space) a landmark's splats drift as neon motes, then spiral home and settle
//   starModifier   (world space)  the sky whale's splats sit among the stars, then stream in to form it
//   whaleModifier  (object space) the whale's body wave and its cyan freckles
//   lookModifier   (world space)  drained ground, the lantern's reveal with its lime rim, colour pools,
//                                 the lighthouse beam and fog
//   flameModifier / riseModifier  procedural splats for the embers and the updraft
import * as THREE from 'three';
import { dyno } from '@sparkjsdev/spark';
import { palette, quality } from './config.js';

const srgb = (color) => { const o = color.clone().convertLinearToSRGB(); return new THREE.Vector3(o.r, o.g, o.b); };

// Uniforms shared by every splat mesh. Game code writes .value; the GPU reads it on the next update.
export const U = {
  time: dyno.dynoFloat(0),
  keep: dyno.dynoFloat(quality.keep),                 // fraction of splats drawn (phone quality)
  lantern: dyno.dynoVec3(new THREE.Vector3()),        // the player's light
  lanternRadius: dyno.dynoFloat(5),
  camera: dyno.dynoVec3(new THREE.Vector3()),
  fogColor: dyno.dynoVec3(srgb(palette.fog)),
  fogNear: dyno.dynoFloat(40),
  fogFar: dyno.dynoFloat(420),
  restoreAll: dyno.dynoFloat(0),                      // finale: the whole ground regains colour
  pools: [0, 1, 2, 3].map(() => dyno.dynoVec4(new THREE.Vector4(1e5, 0, 0, 0.01))), // xyz + radius
  beamPos: dyno.dynoVec3(new THREE.Vector3()),
  beamDir: dyno.dynoVec3(new THREE.Vector3(1, 0, 0)),
  beamOn: dyno.dynoFloat(0),
};

const GLSL = dyno.unindent(/* glsl */ `
  const vec3 LIME = vec3(0.776, 1.0, 0.239);     // #c6ff3d
  const vec3 CYAN = vec3(0.239, 0.878, 1.0);     // #3de0ff
  const vec3 MAGENTA = vec3(1.0, 0.243, 0.647);  // #ff3ea5
  const vec3 WARM = vec3(1.0, 0.68, 0.36);       // the lantern's light
  vec3 dlHash3(uint n) {
    n = (n << 13u) ^ n;
    uvec3 v = uvec3(n * 1597334677u, n * 3812015801u, n * 2798796415u);
    v = (v ^ (v >> 16u)) * 2246822519u;
    v = v ^ (v >> 13u);
    return vec3(v) * (1.0 / 4294967296.0);
  }
  float dlLuma(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }
  vec3 dlNeon(float h) { return h < 0.4 ? CYAN : h < 0.75 ? LIME : MAGENTA; }
  // 1 on a thin ring at radius r (inner edge soft), 0 elsewhere.
  float dlRing(float d, float r) { return smoothstep(r * 0.8, r * 0.93, d) * (1.0 - smoothstep(r * 0.93, r * 1.04, d)); }
  // A colour pool around a restored landmark (xyz centre, w radius): (how far inside, its edge ring).
  vec2 dlPool(vec3 p, vec4 pool) {
    float d = distance(p.xz, pool.xz);
    return vec2(1.0 - smoothstep(pool.w * 0.55, pool.w, d), dlRing(d, pool.w));
  }
`);

// Wraps one GLSL snippet as a Gsplat -> Gsplat modifier. `uniforms` maps names to dyno values; in the
// snippet $in and $out are the splat before and after, $name is a uniform.
function modifier(uniforms, glsl) {
  const inTypes = { gsplat: dyno.Gsplat };
  for (const [k, v] of Object.entries(uniforms)) inTypes[k] = v.type;
  return dyno.dynoBlock({ gsplat: dyno.Gsplat }, { gsplat: dyno.Gsplat }, ({ gsplat }) => {
    const d = new dyno.Dyno({
      inTypes,
      outTypes: { gsplat: dyno.Gsplat },
      globals: () => [GLSL],
      statements: ({ inputs, outputs }) => {
        const names = { out: outputs.gsplat, in: inputs.gsplat };
        for (const k of Object.keys(uniforms)) names[k] = inputs[k];
        const src = glsl.replace(/\$(\w+)/g, (m, k) => names[k] ?? m);
        return dyno.unindentLines(`${names.out} = ${names.in};\n${src}`);
      },
    });
    return { gsplat: d.apply({ gsplat, ...uniforms }).gsplat };
  });
}

// progress 0 = dust, 1 = assembled. size = (footprint radius, height, fraction of splats shown as motes).
// eye = the camera in this mesh's own space: dust fades out near the lens.
export function dustModifier(progress, size, eye) {
  return modifier({ progress, size, eye, time: U.time, keep: U.keep }, /* glsl */ `
    vec3 h = dlHash3(uint($in.index));
    vec3 g = dlHash3(uint($in.index) * 7u + 3u);
    vec3 home = $in.center;
    float R = $size.x, H = $size.y;
    // Dust: a slow swirl of motes over the landmark's footprint. Some splats show as neon motes, a few of
    // those as big faint glows; the rest stay hidden until they fly home.
    // The swirl is rounded: heights cluster mid-way (sum of two random numbers), the radius narrows at the ends.
    float spin = h.x * 6.2832 + $time * (0.05 + 0.1 * h.z);
    float u = 0.5 * (g.x + fract(g.x * 7.31 + h.z * 3.7));
    float dy = H * (0.06 + 0.82 * u) + 0.3 * sin($time * 0.4 + h.y * 12.0);
    float rr = R * (0.2 + 0.8 * pow(h.y, 0.7)) * (0.45 + 0.55 * sin(3.1416 * u));
    bool mote = g.y < $size.z, halo = g.y < $size.z * 0.05;
    vec3 neon = dlNeon(g.z);
    // Assembly is staggered: low splats first, with some noise, each taking 45% of the timeline.
    float delay = 0.55 * clamp(0.7 * home.y / H + 0.3 * h.x, 0.0, 1.0);
    float p = clamp(($progress - delay) / 0.45, 0.0, 1.0);
    float e = p * p * (3.0 - 2.0 * p);
    // Spiral home: blend radius and height, unwind one extra turn of angle.
    float ah = atan(home.z, home.x);
    float ang = ah + (mod(spin - ah, 6.2832) + 6.2832) * (1.0 - e);
    float rad = mix(rr, length(home.xz), e);
    vec3 pos = vec3(cos(ang) * rad, mix(dy, home.y, e) + 0.8 * sin(3.1416 * e), sin(ang) * rad);
    $out.center = e >= 1.0 ? home : pos;
    float tw = 0.55 + 0.45 * sin($time * (1.1 + 2.3 * h.y) + h.x * 40.0);
    $out.scales = mix(vec3(halo ? 0.08 + 0.08 * h.y : 0.014 + 0.018 * h.y), $in.scales, e);
    // Colour: motes are neon and stay neon in flight; the other splats fly in tinted with neon and land in
    // their painted colour.
    vec3 flight = mote ? neon * (0.75 + 0.35 * tw) : mix($in.rgba.rgb, neon, 0.6);
    float settle = mote ? smoothstep(0.45, 1.0, e) : smoothstep(0.1, 0.7, e);
    $out.rgba.rgb = mix(flight, $in.rgba.rgb, settle) + neon * 0.2 * sin(3.1416 * e);
    $out.rgba.a = mix(mote ? (halo ? 0.08 : 0.65) * tw : 0.0, $in.rgba.a, smoothstep(0.0, 0.35, e));
    $out.rgba.a *= mix(smoothstep(2.0, 8.0, distance($out.center, $eye)), 1.0, e); // no dust in the lens
    if (h.z > $keep || (!mote && p <= 0.0)) $out.flags = 0u;
    else $out.scales /= sqrt($keep);
  `);
}

// The sky whale: 3% of its splats are stars; as progress rises every splat streams in through cyan.
export function starModifier(progress) {
  return modifier({ progress, time: U.time, keep: U.keep }, /* glsl */ `
    vec3 h = dlHash3(uint($in.index) + 7919u);
    vec3 g = dlHash3(uint($in.index) * 3u + 1u);
    vec3 dir = normalize(vec3(h.x * 2.0 - 1.0, 0.35 + 0.65 * h.y, h.z * 2.0 - 1.0)); // high sky only
    float delay = 0.6 * g.y;
    float p = clamp(($progress - delay) / 0.4, 0.0, 1.0);
    float e = p * p * (3.0 - 2.0 * p);
    $out.center = mix(dir * 320.0, $in.center, e);
    bool isStar = g.x > 0.97;
    float twinkle = 0.45 + 0.55 * sin($time * (1.0 + 3.0 * h.z) + h.x * 50.0);
    $out.scales = mix(vec3(isStar ? 0.6 : 0.2), $in.scales, e);
    $out.rgba.rgb = mix(mix(vec3(0.9, 0.95, 1.0), CYAN, smoothstep(0.0, 0.5, e)), $in.rgba.rgb, smoothstep(0.5, 1.0, e));
    $out.rgba.a = isStar ? mix(twinkle, $in.rgba.a, e) : $in.rgba.a * smoothstep(0.0, 0.25, p);
    if ((!isStar && p <= 0.0) || g.z > $keep) $out.flags = 0u;
    else $out.scales /= sqrt($keep);
  `);
}

// The whale's body wave (the tail swings more than the head) and its freckles: the light blue spots painted
// on its back shine brand cyan. bounds = (tail z, head z, back y, unused).
export function whaleModifier(bounds) {
  return modifier({ time: U.time, bounds }, /* glsl */ `
    vec3 c = $in.center;
    float u = clamp(($bounds.y - c.z) / ($bounds.y - $bounds.x), 0.0, 1.0);
    c.y += sin(c.z * 0.32 - $time * 1.5) * 0.55 * u * u;
    c.x += sin(c.z * 0.21 - $time * 1.1) * 0.25 * u;
    $out.center = c;
    vec3 col = $in.rgba.rgb;
    bool freckle = $in.center.y > $bounds.z && dlLuma(col) > 0.4 && col.b > col.r + 0.12;
    if (freckle) $out.rgba.rgb = CYAN * (1.05 + 0.25 * sin($time * 2.0 + float($in.index) * 0.37));
  `);
}

// drained = 1 makes this mesh dim slate except near the lantern, in colour pools and after restoreAll.
export function lookModifier(drained) {
  const pools = Object.fromEntries(U.pools.map((p, i) => [`pool${i}`, p]));
  return modifier({
    drained, ...pools, lantern: U.lantern, radius: U.lanternRadius, restoreAll: U.restoreAll,
    camera: U.camera, fogColor: U.fogColor, fogNear: U.fogNear, fogFar: U.fogFar,
    beamPos: U.beamPos, beamDir: U.beamDir, beamOn: U.beamOn,
  }, /* glsl */ `
    vec3 p = $in.center;
    vec3 c = $in.rgba.rgb;
    float d = distance(p, $lantern);
    float k = 1.0 - smoothstep($radius * 0.3, $radius, d);
    vec2 q0 = dlPool(p, $pool0), q1 = dlPool(p, $pool1), q2 = dlPool(p, $pool2), q3 = dlPool(p, $pool3);
    float pool = max(max(q0.x, q1.x), max(q2.x, q3.x));
    float rim = max(dlRing(d, $radius), 0.6 * max(max(q0.y, q1.y), max(q2.y, q3.y)));
    float reveal = max(max(k, pool), $restoreAll);
    vec3 night = vec3(dlLuma(c)) * vec3(0.36, 0.42, 0.62) + vec3(0.01, 0.012, 0.03);
    c = mix(c, mix(night, c, reveal), $drained);
    c *= mix(vec3(0.74, 0.78, 0.92), vec3(1.0), k);              // restored colour, in night light
    c += WARM * 0.3 * k * k * k;                                  // the lantern's warm light
    c += LIME * 0.3 * rim * (1.0 - reveal * 0.6) * $drained * (1.0 - $restoreAll); // lime edge of the light
    vec3 toP = p - $beamPos;
    float cosA = dot(toP, $beamDir) / max(length(toP), 1e-3);
    c += vec3(0.86, 1.0, 0.56) * 0.55 * $beamOn * smoothstep(0.988, 0.998, abs(cosA));
    float toCamera = distance(p, $camera);
    float fog = smoothstep($fogNear, $fogFar, toCamera) * 0.94;
    fog = max(fog, 0.6 * (1.0 - smoothstep(-70.0, -25.0, p.y)) * smoothstep(20.0, 120.0, length(p.xz)));
    $out.rgba.rgb = mix(c, $fogColor, fog);
    $out.rgba.a *= smoothstep(0.4, 2.0, toCamera);               // nothing blurs up right in front of the lens
  `);
}

// Embers: lime splats rise from a white-hot core, shrink and fade, then loop.
export function flameModifier() {
  return modifier({ time: U.time }, /* glsl */ `
    vec3 h = dlHash3(uint($in.index));
    float ph = fract(h.x + $time * (0.7 + 0.6 * h.y));
    float a = h.z * 6.2832 + $time * 2.0;
    float r = 0.11 * (1.0 - ph) * (0.4 + 0.6 * h.y);
    $out.center = vec3(cos(a) * r, ph * 0.42 - 0.12, sin(a) * r);
    $out.scales = vec3(mix(0.075, 0.012, ph));
    $out.rgba.rgb = mix(vec3(0.93, 1.0, 0.7), LIME, smoothstep(0.0, 0.3, ph));
    $out.rgba.a = (1.0 - ph * ph) * 0.9;
  `);
}

// Updraft column: lime and cyan motes spiral upwards and loop. size = (radius, height).
export function riseModifier(size) {
  return modifier({ time: U.time, size }, /* glsl */ `
    vec3 h = dlHash3(uint($in.index));
    float ph = fract(h.x + $time * (0.18 + 0.12 * h.y));
    float a = h.z * 6.2832 + $time * (0.8 + h.y) + ph * 6.0;
    float r = $size.x * (0.3 + 0.7 * h.y);
    $out.center = vec3(cos(a) * r, ph * $size.y, sin(a) * r);
    $out.scales = vec3(0.03 + 0.03 * h.z);
    $out.rgba.rgb = h.y < 0.6 ? LIME : CYAN;
    $out.rgba.a = 0.8 * sin(3.1416 * ph);
  `);
}

// The cloud sea breathes: every puff bobs slowly on its own phase.
export function driftModifier() {
  return modifier({ time: U.time }, /* glsl */ `
    vec3 h = dlHash3(uint($in.index));
    $out.center.y += 0.8 * sin($time * 0.15 + h.x * 6.2832);
  `);
}
