// Copies delivered assets into the game. An asset folder counts once its READY file exists:
//   ../assets/out/<name>/{<name>.ply, <name>-collider.glb, meta.json, READY}
//     -> public/splats/<name>/{<name>.spz, <name>-collider.glb, meta.json}   (the PLY is shipped as SPZ)
//   ../audio/out/sfx/*.ogg -> public/audio/
//   ../audio/out/voice/{keeper-*.ogg, lines.json} -> public/audio/voice/
// Usage: node tools/sync-assets.mjs [--assets <dir>] [--audio <dir>] [--force] [--draft]
//   --draft also takes assets that are not READY yet (for a look; captures want READY ones).
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { plyToSpz, readJson, root } from './lib.mjs';

const arg = (k, d) => { const i = process.argv.indexOf(k); return i >= 0 ? process.argv[i + 1] : d; };
const force = process.argv.includes('--force');
const draft = process.argv.includes('--draft');
const assets = arg('--assets', join(root, '..', 'assets', 'out'));
const audio = arg('--audio', join(root, '..', 'audio', 'out'));
const stale = (src, dst) => force || !existsSync(dst) || statSync(src).mtimeMs > statSync(dst).mtimeMs;
const updated = [];
const UNUSED = ['cloud-sea'];                      // the game draws its own cloud sea (src/sky.js)
const NO_COLLIDER = ['sky-whale', 'lantern-spirit']; // nothing walks on these
const copy = (src, dst, always = false) => {
  if (!always && !stale(src, dst)) return;
  mkdirSync(dirname(dst), { recursive: true });
  copyFileSync(src, dst);
  updated.push(dst.slice(root.length + 1));
};

if (existsSync(assets)) {
  for (const name of readdirSync(assets).filter((n) => !UNUSED.includes(n))) {
    const src = join(assets, name), dst = join(root, 'public', 'splats', name);
    const ply = join(src, `${name}.ply`), spz = join(dst, `${name}.spz`);
    if (!existsSync(join(src, 'READY')) && !(draft && existsSync(ply))) { console.log(`wait ${name}: not READY`); continue; }
    const placeholder = readJson(join(dst, 'meta.json'), {}).placeholder === true; // always replaced
    if (placeholder || stale(ply, spz)) {
      mkdirSync(dst, { recursive: true });
      const bytes = await plyToSpz(readFileSync(ply));
      writeFileSync(spz, bytes);
      updated.push(`public/splats/${name}/${name}.spz`);
      console.log(`${name}: ${(statSync(ply).size / 1e6).toFixed(1)} MB PLY -> ${(bytes.length / 1e6).toFixed(2)} MB SPZ`);
    }
    const files = NO_COLLIDER.includes(name) ? ['meta.json'] : [`${name}-collider.glb`, 'meta.json'];
    for (const f of files) if (existsSync(join(src, f))) copy(join(src, f), join(dst, f), placeholder);
  }
}
const sfx = join(audio, 'sfx');
if (existsSync(sfx)) for (const f of readdirSync(sfx)) if (f.endsWith('.ogg')) copy(join(sfx, f), join(root, 'public', 'audio', f));
const voice = join(audio, 'voice');
if (existsSync(voice)) for (const f of readdirSync(voice)) if (/^keeper-\d+\.ogg$|^lines\.json$/.test(f)) copy(join(voice, f), join(root, 'public', 'audio', 'voice', f));
console.log(JSON.stringify({ updated }));
