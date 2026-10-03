// Frame-exact video capture of Dustlight. The game runs with ?capture=1: no animation loop, virtual time
// advanced 1/60 s per window.__dustlight.step(), seeded randomness. For each frame we step, wait for Spark's
// splat sort to settle, screenshot (JPEG at quality 95: a PNG takes ~9x longer to grab), and pipe it to ffmpeg.
// Files are named <shot>-<w>x<h>.mp4. Stills are PNG.
//
//   node tools/capture.mjs                         the bot plays the whole game -> play-1920x1080.mp4
//   node tools/capture.mjs --shot ignite           one cinematic shot -> ignite-1920x1080.mp4
//   node tools/capture.mjs --shot all              every shot, one after another
//   node tools/capture.mjs --shot title,gather     a list of shots
//   node tools/capture.mjs --vertical              1080x1920 (for the Short)
//   node tools/capture.mjs --stills 4,20,60        PNG stills at those game seconds -> stills/<shot>-t<s>.png
//   node tools/capture.mjs --shot all --cues-only   only rewrite the .cues.json files (sound cue times), no video
// Options: --seconds n  --frames (PNG sequence instead of MP4)  --out <dir>  --seed n  --quality low
// Needs `npm run build` first (serves dist/), Playwright (from the gamesbyai.win repo) and ffmpeg (FFMPEG env).
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { GPU_ARGS, chromium, root, serveDist } from './lib.mjs';

const SHOTS = ['title', 'gather', 'dust-orbit', 'assemble-lighthouse', 'assemble-tree', 'assemble-cottage', 'assemble-arch', 'reveal-walk', 'ignite', 'whale-flyby']; // as in src/shots.js
const FFMPEG = process.env.FFMPEG ?? 'ffmpeg';
const FPS = 60;

const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const has = (k) => args.includes(k);
const shotArg = opt('--shot', null);
const shots = shotArg === 'all' ? SHOTS : shotArg ? shotArg.split(',') : [null];
const [W, H] = has('--vertical') ? [1080, 1920] : [1920, 1080];
const out = opt('--out', join(root, '..', 'captures'));
const stills = opt('--stills', null)?.split(',').map(Number);
mkdirSync(join(out, 'stills'), { recursive: true });

const { server, url: base } = await serveDist({ snapshot: true });
// Headless by default (still on the real GPU through GPU_ARGS): a visible window flashes on the desktop and grabs
// the mouse. CAPTURE_HEADED=1 opens a window, parked off-screen.
const headed = process.env.CAPTURE_HEADED === '1';
const browser = await chromium().launch({ channel: process.env.CAPTURE_CHANNEL ?? 'chrome', headless: !headed, args: [...GPU_ARGS, '--hide-scrollbars', `--window-size=${W},${H}`, ...(headed ? ['--window-position=-32000,-32000'] : [])] });
try {
  for (const shot of shots) await capture(shot);
} finally {
  await browser.close();
  server.close();
}

async function capture(shot) {
  const name = `${shot ?? 'play'}-${W}x${H}`;
  const q = new URLSearchParams({ capture: '1', seed: opt('--seed', '1'), quality: opt('--quality', 'high') });
  if (shot) q.set('shot', shot);
  const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
  const log = [];
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') log.push(`[${m.type()}] ${m.text()}`); });
  page.on('pageerror', (e) => log.push(`[pageerror] ${e.message}`));
  await page.goto(`${base}?${q}`);
  await page.waitForFunction(() => window.__dustlight, null, { timeout: 120000 });
  await page.evaluate(() => document.fonts.ready);
  // The bot's run lasts until 6 s after the end card appears (at most 150 s), a shot as long as it says.
  const fixed = Number(opt('--seconds', 0)) || (await page.evaluate(() => window.__dustlight.shotSeconds));
  let frames = Math.round((fixed || 150) * FPS);

  if (has('--cues-only')) { // run the frames without pictures, keep the cue log
    await page.evaluate((n) => window.__dustlight.step(n), frames);
    const [state, cues] = await page.evaluate(() => [window.__dustlight.state(), window.__dustlight.audioLog]);
    writeFileSync(join(out, `${name}.cues.json`), JSON.stringify({ fps: FPS, size: [W, H], seconds: frames / FPS, state, cues }, null, 1));
    await page.close();
    console.log(`cues ${name}`);
    return;
  }
  let ff = null;
  const frameDir = join(out, name);
  if (!stills && !has('--frames')) {
    ff = spawn(FFMPEG, ['-y', '-loglevel', 'error', '-f', 'image2pipe', '-framerate', String(FPS), '-i', '-',
      '-vf', 'scale=in_color_matrix=bt601:in_range=full:out_color_matrix=bt709:out_range=tv,format=yuv420p', // JFIF -> BT.709
      '-c:v', 'libx264', '-preset', 'medium', '-rc-lookahead', '20', '-threads', '8', '-crf', '14', // modest memory: other jobs share this machine
      '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709', '-color_range', 'tv',
      '-movflags', '+faststart', join(out, `${name}.mp4`)], { stdio: ['pipe', 'inherit', 'inherit'] });
  } else if (!stills) mkdirSync(frameDir, { recursive: true });

  const want = new Set((stills ?? []).map((s) => Math.round(s * FPS)));
  const last = () => (stills ? Math.max(...want) : frames);
  const started = Date.now();
  console.log(`${name}: ${stills ? `${want.size} stills` : `${frames} frames`}`);
  for (let f = 1; f <= last(); f++) {
    if (stills && !want.has(f)) { // run on to the frame before the next still in one call
      const next = Math.min(...[...want].filter((w) => w > f));
      await page.evaluate((n) => window.__dustlight.step(n), next - f);
      f = next - 1;
      continue;
    }
    await page.evaluate(async () => { window.__dustlight.step(1); await window.__dustlight.settle(); });
    const img = await page.screenshot(ff ? { type: 'jpeg', quality: 95 } : { type: 'png' });
    if (ff) { if (!ff.stdin.write(img)) await new Promise((r) => ff.stdin.once('drain', r)); }
    else writeFileSync(stills ? join(out, 'stills', `${shot ?? 'play'}-t${(f / FPS).toFixed(1)}${H > W ? '-vertical' : ''}.png`) : join(frameDir, `${String(f).padStart(5, '0')}.png`), img);
    if (f % 600 === 0) console.log(`  ${f}/${last()} frames, ${((Date.now() - started) / f).toFixed(0)} ms per frame`);
    if (!fixed && !stills && f % 30 === 0 && f + 6 * FPS < frames && (await page.evaluate(() => window.__dustlight.state().phase)) === 'end') frames = f + 6 * FPS;
  }
  if (ff) { ff.stdin.end(); await new Promise((r) => ff.on('close', r)); }
  const state = await page.evaluate(() => window.__dustlight.state());
  const cues = await page.evaluate(() => window.__dustlight.audioLog);
  if (!stills) writeFileSync(join(out, `${name}.cues.json`), JSON.stringify({ fps: FPS, size: [W, H], seconds: frames / FPS, state, cues }, null, 1));
  if (log.length) console.log([...new Set(log)].filter((l) => !l.includes('X3203')).join('\n'));
  await page.close();
  console.log(`done ${name} (${((Date.now() - started) / 1000).toFixed(0)} s)`);
}
