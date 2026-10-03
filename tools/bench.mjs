// Frame-rate check in real time (not capture mode): headed Chrome on the real GPU, 1920x1080 by default.
// Reads the game's rolling fps on the title screen, while playing, and in the finale with every splat on screen.
// By default vsync is on (the result is capped at the display's refresh rate). --uncapped turns vsync and the
// frame-rate limit off and makes every frame wait for the GPU (a 1-pixel readPixels after render), so the
// number is the honest frame rate this machine could reach.
// Usage: node tools/bench.mjs [--quality low] [--size 1280x720] [--uncapped] [--no-lock]   (needs `npm run build`)
import { GPU_ARGS, chromium, serveDist, withGpuLock } from './lib.mjs';

const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const [W, H] = opt('--size', '1920x1080').split('x').map(Number);
const quality = opt('--quality', 'high');
const uncapped = args.includes('--uncapped');

const run = async () => {
  const { server, url } = await serveDist();
  const flags = [...GPU_ARGS, `--window-size=${W},${H}`, ...(uncapped ? ['--disable-gpu-vsync', '--disable-frame-rate-limit'] : [])];
  const browser = await chromium().launch({ channel: 'chrome', headless: process.env.CAPTURE_HEADED !== '1', args: flags }); // headless: no window pops up on the desktop
  const page = await browser.newPage({ viewport: { width: W, height: H } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`${url}?quality=${quality}`);
  await page.waitForFunction(() => window.__dustlight, null, { timeout: 120000 });
  const gpu = await page.evaluate((sync) => {
    const { renderer } = window.__dustlight;
    const gl = renderer.getContext();
    if (sync) { // wait for the GPU after every frame
      const px = new Uint8Array(4), render = renderer.render.bind(renderer);
      renderer.render = (scene, camera) => { render(scene, camera); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px); };
    }
    const info = gl.getExtension('WEBGL_debug_renderer_info');
    return info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : 'unknown';
  }, uncapped);
  const sample = async (label) => {
    await page.waitForTimeout(5000);
    const s = await page.evaluate(() => window.__dustlight.state());
    console.log(`${label.padEnd(7)} ${s.fps.toFixed(0).padStart(4)} fps   ${s.splats.toLocaleString('en')} splats loaded`);
    return +s.fps.toFixed(1);
  };
  const r = { gpu, size: [W, H], quality, uncapped };
  r.title = await sample('title');
  await page.evaluate(() => window.__dustlight.game.start());
  await page.waitForTimeout(3000);
  r.play = await sample('play');
  await page.evaluate(() => { const d = window.__dustlight; d.game.standAll(); d.game.ignite(); });
  await page.waitForTimeout(9000); // the whale has assembled
  r.finale = await sample('finale');
  console.log(JSON.stringify({ ...r, errors }));
  await browser.close();
  server.close();
};
if (args.includes('--no-lock')) await run();
else await withGpuLock('dustlight-bench', run);
