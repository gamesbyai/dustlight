# Dustlight: how it works

A small browser game drawn with 3D Gaussian splats. You are a paper-lantern spirit on a sky archipelago at
night. Every landmark has crumbled into drifting dust; your lantern brings colour back wherever it goes.
Pick up five embers: each of the first four makes its landmark pull itself together from swirling splats,
the fifth (on the lighthouse gallery) lights the lamp, and a sky whale gathers itself out of the stars.
A GamesByAI game, made with Blender 5.3's native Gaussian splats and AI.

Built with three.js 0.186.1 and Spark 2.3.1 (`@sparkjsdev/spark`), bundled by Vite 8.3.2. About 1,700
lines of JavaScript in `src/` plus 200 of HTML and CSS, and about 570 lines of tools.

## Run it

```
npm install
npm run dev              # http://localhost:5270
npm run build            # static site in dist/ (relative paths: works from any folder or host)
npm run preview          # serves dist/ on :5271
```

URL switches: `?quality=low` (touch devices get it automatically: pixel ratio 1, half the splats of the
islands, landmarks and whale), `?debug=1` (fps in the tab title), `?capture=1`, `?shot=<name>` and
`?seed=<n>` (see Capture below).

## Controls

| | Keyboard and mouse | Touch |
| --- | --- | --- |
| Move | WASD or arrow keys | left thumb: a joystick appears where you touch (left 45% of the screen) |
| Look | drag the mouse; wheel zooms | drag anywhere else |
| Hop | Space | the ↑ button, bottom right |
| Glide | automatic: stay in the air for a moment and the lantern floats down slowly | same |
| Pause | Esc or P, or the pause button top right | pause button |

Fall off the world and you are put back on the last ground you stood on. Pointer lock is never used, so the
game works in a sandboxed iframe; audio starts with the first click or tap (browsers require that).

## How it works, in plain words

**One renderer for every splat.** `main.js` creates a three.js `WebGLRenderer` and one `SparkRenderer`.
Every splat object is a `SplatMesh` added to the normal three.js scene; Spark collects them all each frame,
sorts every splat by distance from the camera in a background worker, and draws them back to front. Plain
three.js objects (sprites for glows, the lighthouse beam, the sky sphere) render in the same scene.

**Effects are small GPU programs per splat.** Spark lets you attach "dyno" modifiers to a `SplatMesh`: a
function that receives one splat (centre, scales, rotation, colour and opacity, index, flags) and returns
it changed. It runs on the GPU for every splat whenever the mesh's version changes; `main.js` bumps every
mesh's version each frame (`updateVersion()`), so the effects animate. Object-space modifiers run before
the mesh's own position and rotation are applied, world-space ones after. `effects.js` wraps the dyno API
in one helper, `modifier(uniforms, glsl)`, so each effect is just a few lines of GLSL where `$in` is the
splat before, `$out` the splat after and `$name` a uniform the game sets from JavaScript.

**The effects** (`src/effects.js`):

- `dustModifier` (object space, islands and landmarks). Each splat gets a stable random number from its
  index. A few thousand of them are shown as neon motes (lime, cyan or magenta) swirling slowly over the
  object's footprint; the rest are switched off (`flags = 0`). When `progress` goes from 0 to 1, every splat
  flies home on a spiral: the radius and height blend from the dust position to the real one while the
  angle unwinds one extra turn, with a little lift in the middle. Low splats start first and each one has
  some random delay, so things build from the ground up. In flight the splats are tinted neon and land in
  their painted colour. Motes near the camera fade out (the game passes the camera position in the
  object's own space as `eye`).
- `lookModifier` (world space, everything you walk on and the landmarks). Turns colour into dim night slate
  ("drained") except near the lantern, inside the colour pools around restored landmarks and after the
  finale (`restoreAll`). The lantern adds a warm glow; a thin lime ring marks the edge of its light and of
  each pool. The lighthouse beam brightens splats inside its sweeping cone. Distant splats fade into the
  horizon's indigo, and splats right in front of the camera fade out.
- `starModifier` (world space, the whale). Every splat starts on a sphere 320 m out in the high sky; 3% of
  them are visible as twinkling stars. In the finale they stream in, pass through cyan and become the whale.
- `whaleModifier` (object space, the whale). A travelling sine wave bends the body, more at the tail; the
  light-blue freckles painted on its back are lit brand cyan.
- `flameModifier` and `riseModifier` drive splats that have no shape of their own: the lime ember flames
  and the updraft column.
- `driftModifier` makes the cloud sea breathe.

**The world** (`world.js`). Loads each asset (`.spz` splats plus a `-collider.glb` mesh), drops the main
island so its walkable top sits at y = 0, places the three small islands around it and the four landmarks
on it (polar positions over its footprint ellipse, then a raycast down onto the collider), and turns each
landmark to face the island centre. Collision never touches the splats: walking, the camera and placement
all raycast against the invisible collider meshes. A landmark's collider joins the world only once it has
assembled.

**The player** (`player.js`). A capsule-free controller: one ray down for the ground, two rays ahead (knee
and chest) to slide along walls, gravity, a hop, and a glide that caps the fall speed after 0.35 s in the
air. It leaves a short lime trail of glowing motes (sprites). The camera (`camera.js`) orbits behind it and
is pulled in when a collider is in the way.

**The story** (`game.js`). A small state machine on game time: the title (islands as dust) → the islands
gather and drain of colour → four embers → each one sends a spark to its landmark, which assembles in
3.2 s and plays a keeper line → the fifth ember appears on the lighthouse gallery with an updraft to reach
it → the lamp ignites, the beam sweeps, colour returns everywhere, the whale gathers from the stars and
swims a loop → end card. Timers are game time, not the wall clock, so everything replays exactly.

**The look** follows the GamesByAI brand (gamesbyai.win `docs/standards/design-system.md`): a near-black
sky (#07080b) fading to dark indigo (#10142a) at the horizon, stars, faint neon haze on the horizon, and a
cloud sea far below lit from underneath by lime, cyan and magenta light pools (`sky.js`). The painted
models keep the colours from their drawings; neon is only light, dust and atmosphere. The UI (`index.html`,
`style.css`, `ui.js`) uses the brand glass panels (rgb(14 17 25 / 0.68), backdrop blur, a 1 px
lime → cyan → magenta hairline), pill buttons (lime primary, dark ink), Big Shoulders Display for the title
and numbers, Geist for text and system monospace for labels. Fonts are self-hosted in `public/fonts` with
their SIL Open Font License files; nothing loads from another host.

## File map

| File | What it does |
| --- | --- |
| `index.html` | the canvas and the DOM layer: loading bar, title, ember HUD, subtitle chip, hint, pause and end cards, touch controls |
| `src/main.js` | boots three.js + Spark, the frame loop, `window.__dustlight` for the tools |
| `src/config.js` | URL switches, quality levels, layout of islands and landmarks, brand palette |
| `src/effects.js` | every dyno effect (above) and the shared uniforms `U` |
| `src/world.js` | loading, placement, colliders; embers, updraft, beam, glow sprites |
| `src/sky.js` | night sky shader; procedural cloud sea with neon light pools |
| `src/game.js` | the story state machine, pickups, finale, whale path |
| `src/player.js` | movement, collision, glide, respawn, lime trail |
| `src/camera.js` | orbit / follow / scripted camera with blends |
| `src/input.js` | keyboard, mouse drag, wheel, touch joystick and look |
| `src/ui.js` | DOM layer; fades run on game time so captures are exact |
| `src/audio.js` | Web Audio: effects, wind loop, keeper lines with subtitles, a cue log |
| `src/capture.js` | the bot that plays the game, and the cinematic shot director |
| `src/shots.js` | camera paths for the finale and the cinematic shots |
| `src/clock.js` | game time, seeded random numbers, the real-time loop |
| `src/style.css` | brand theme |
| `tools/sync-assets.mjs` | copies READY assets in, converting PLY to SPZ; copies audio |
| `tools/placeholders.mjs` | writes stand-in assets with the same names (used before the real ones landed) |
| `tools/capture.mjs` | frame-exact MP4 and PNG capture |
| `tools/bench.mjs` | frame rate check |
| `tools/lib.mjs` | static server for dist/, Chromium, GPU lock, PLY → SPZ |

## Assets and how to swap them

Each asset is a folder `public/splats/<name>/` with `<name>.spz` and (for things you can stand on or
bump into) `<name>-collider.glb`, plus `meta.json` for reference. The asset pipeline (Blender) writes
`../assets/out/<name>/{<name>.ply, <name>-collider.glb, meta.json, READY}` next to this repo: a 3DGS PLY, Y up,
metres, origin at the base centre.

```
node tools/sync-assets.mjs            # copies every READY asset in (PLY -> SPZ) and the audio
node tools/sync-assets.mjs --draft    # also assets without READY, for a look
npm run build
```

SPZ conversion uses Spark's own `transcodeSpz` in Node (SPZ v3, colour only), about 5x smaller than the
PLY. The game reads sizes from the splats themselves, so a new asset of a different size still lands in
place. The pipeline's `cloud-sea` asset is not used: the game draws its own cloud sea so the brand light
pools can be part of it.

Audio comes from `../audio/out/`: `sfx/*.ogg` → `public/audio/`, `voice/keeper-0N.ogg` and
`lines.json` (text and duration of each line) → `public/audio/voice/`. Any missing file is just silent.

| Asset | Splats | SPZ |
| --- | --- | --- |
| island | 469,597 | 6.4 MB |
| blossom-tree | 249,690 | 3.5 MB |
| island-small-2 | 160,000 | 2.2 MB |
| sky-whale | 150,492 | 2.0 MB |
| lighthouse | 149,767 | 2.0 MB |
| cottage | 120,527 | 1.6 MB |
| island-small-1 | 99,703 | 1.4 MB |
| shrine-arch | 80,284 | 1.1 MB |
| island-small-3 | 62,836 | 0.9 MB |
| lantern-spirit | 59,859 | 0.7 MB |
| procedural (cloud sea, embers, updraft) | about 115,000 | built in code |
| **total** | **about 1.70 million** | **21.8 MB** |

## Download size

`dist/` is 26.8 MB: splats 21.8 MB, JavaScript 3.2 MB (1.08 MB gzipped; most of it is Spark, which
inlines its WebAssembly module and its worker), audio 1.0 MB, colliders 0.6 MB, fonts 37 KB, CSS 8 KB, logo
and favicon 29 KB. About 24.6 MB over the wire. No request leaves the site's own folder; the only outside
link is the end card's link to gamesbyai.win, which opens in a new tab.

## Frame rate

Measured with `tools/bench.mjs` (headed Chrome 154, ANGLE D3D11, RTX 3080 Ti, 1920×1080, every final asset
loaded: 1,717,317 splats; other CPU jobs were running on the same machine):

| | title | playing | finale (everything visible) |
| --- | --- | --- | --- |
| uncapped, waiting for the GPU every frame, high quality | 106 fps | 88 fps | 110 fps |
| uncapped, low quality | 125 fps | 106 fps | 112 fps |
| vsync on (144 Hz display), high quality, earlier asset versions (1.68 M splats) | 144 fps | 143 fps | 145 fps |

Not measured on a mid-range or phone GPU. Quality levels: `high` caps the pixel ratio at 1.5; `low` uses
pixel ratio 1 and draws half the splats of the islands, landmarks and whale, each a little larger so
surfaces stay closed.

## Capture (for the video)

`?capture=1` turns off the real-time loop: the page only advances when `window.__dustlight.step()` is
called, exactly 1/60 s per step, with seeded random numbers, so every run is identical. `?shot=<name>`
runs one cinematic camera move instead of the bot. `tools/capture.mjs` drives headless Chrome on the real
GPU: for every frame it steps, waits for Spark's background sort to finish (`settle()`), takes a
screenshot and pipes it to ffmpeg (H.264 at CRF 14, preset medium, BT.709, 60 fps).

```
npm run build
node tools/capture.mjs                      # the bot plays the whole game (about 85 s) -> play-1920x1080.mp4
node tools/capture.mjs --shot all           # every cinematic shot -> <shot>-1920x1080.mp4
node tools/capture.mjs --shot ignite,gather # some shots
node tools/capture.mjs --vertical ...       # 1080x1920 for the Short
node tools/capture.mjs --stills 3,12,40     # PNG stills at those game seconds -> stills/
node tools/capture.mjs --shot all --cues-only  # only rewrite the .cues.json files (no video)
```

Output goes to `../captures/` next to the repo (`--out` to change). Each video gets a `.cues.json` with the game
time of every sound cue and voice line, so the editor can lay the audio (capture mode plays no sound).
The tool serves a private copy of `dist/` (in `.capture/`), so rebuilding the game during a long capture
cannot break it.
Shots: `title`, `gather`, `dust-orbit`, `assemble-lighthouse`, `assemble-tree`, `assemble-cottage`,
`assemble-arch`, `reveal-walk`, `ignite`, `whale-flyby`. Speed: 80-100 ms per 1920×1080 frame (frames are
grabbed as JPEG at quality 95; a PNG grab is about nine times slower), so an 8 s shot takes under a minute
and the full bot run about 8 minutes. Captures do not take the GPU lock: they are frame-stepped and light.
`tools/bench.mjs` does take it, because a frame rate measured next to a render job means nothing.

## Known issues

- When a set of meshes changes (something appears or disappears), Spark shows it after the first depth
  sort of the new set, one or two frames later in real time. Capture waits for it.
- Spark stores splat centres as half floats; each mesh keeps its own coordinates near its origin (the
  biggest, the main island, reaches 18 m: steps of about 1.6 cm), so nothing visibly snaps. The stars the
  whale is made from sit 320 m out, where the step is coarse, but they are points of light.
- Dust swirls are big on a small island: the third-person camera sometimes passes through one, and nearby
  motes then show as soft out-of-focus dots (they fade out within 8 m of the camera).
- The colliders are 6,000-triangle meshes from the asset pipeline and include roofs and the tree canopy,
  so the follow camera is pulled in sharply when one of them comes between it and the lantern.
- The game is short (about a minute for a player who knows the way), because the main island is 30 × 17 m.
- WebGL timer queries gave no usable GPU times in this setup, so the frame rates above come from the frame
  loop (with a forced GPU sync for the uncapped numbers).

## Sources for the Spark facts above

Spark 2.3.1 as installed (`node_modules/@sparkjsdev/spark/dist/`), and our tested pipeline notes ("P"):

- Modifiers, `updateGenerator()`, `updateVersion()` and the `Gsplat` fields: P section 5; `SplatMesh.update`
  in `spark.module.js` rebuilds the generator when it is dirty and re-runs it when the version changes.
- Object-space modifiers before the mesh transform, world-space after: `spark.module.js` lines 10708-10716
  (`objectModifiers`, then `transform.applyGsplat`, then `worldModifiers`).
- `flags = 0` switches a splat off: `GSPLAT_FLAG_ACTIVE = 1u << 0u`, `spark.module.js` line 3145.
- Sorting in a background worker, radial distance by default: `driveSort` (`sortWorker.call("sortSplats32")`)
  in `spark.module.js`; `sortRadial` "@default true" in `types/SparkRenderer.d.ts`.
- A new set of meshes is shown after its first sort: `SparkRenderer.update` and `driveSort` swap the
  displayed accumulator only when the sorted mapping matches (`spark.module.js` around lines 12510-12600).
- Half-float centres: P gotcha 10 (`packSplatEncoding` uses `packHalf2x16`).
- WebAssembly inlined as base64: `spark.module.js` line 2922 (`spark_rs_bg.wasm?arraybuffer&base64`).
- SPZ v3 from `transcodeSpz`: P section 5 (`web/ply2spz.mjs`); sizes here measured by `tools/sync-assets.mjs`.
