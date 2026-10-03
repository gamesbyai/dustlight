// Sound effects, the wind loop and the keeper's voice lines, through Web Audio. Every file is optional:
// a missing one is simply silent. Every cue is also logged with game time, so a capture can be scored.
// The AudioContext starts suspended and is resumed by the first click (browsers require a gesture).
import { clock } from './clock.js';

const SFX = ['ember-pickup', 'assemble', 'ignite', 'whale', 'ambient-wind', 'step-1', 'step-2', 'step-3', 'glide', 'bell', 'ui-start'];
const VOICES = ['keeper-01', 'keeper-02', 'keeper-03', 'keeper-04', 'keeper-05', 'keeper-06'];

const AC = window.AudioContext || window.webkitAudioContext;
const ctx = AC ? new AC() : null;
const buffers = {};
let lines = {};
let master = null;

export const audio = {
  log: [],
  onSubtitle: () => {},

  async load(silent) {
    // Subtitles load even in capture mode (silent): the video shows them.
    const text = fetch('./audio/voice/lines.json').then((r) => r.json()).then((j) => { lines = normaliseLines(j); }, () => {});
    if (!ctx || silent) return text;
    master = ctx.createGain();
    master.connect(ctx.destination);
    const get = (url) => fetch(url).then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(r.status))).then((b) => ctx.decodeAudioData(b));
    await Promise.all([
      text,
      ...SFX.map((n) => get(`./audio/${n}.ogg`).then((b) => { buffers[n] = b; }, () => {})),
      ...VOICES.map((n) => get(`./audio/voice/${n}.ogg`).then((b) => { buffers[n] = b; }, () => {})),
    ]);
  },

  unlock() { ctx?.resume(); },
  pause(on) { if (ctx) on ? ctx.suspend() : ctx.resume(); },

  play(name, { volume = 1, rate = 1, loop = false } = {}) {
    this.log.push({ t: +clock.time.toFixed(3), cue: name });
    const buffer = buffers[name];
    if (!ctx || !buffer || ctx.state !== 'running') return null;
    const src = ctx.createBufferSource();
    const gain = ctx.createGain();
    src.buffer = buffer;
    src.loop = loop;
    src.playbackRate.value = rate;
    gain.gain.value = volume;
    src.connect(gain).connect(master);
    src.start();
    return { src, gain };
  },

  // A keeper line: plays the recording (if any) and shows its text as a subtitle while it plays.
  voice(id) {
    this.play(id, { volume: 1 });
    const text = lines[id];
    const seconds = lines[`${id}:seconds`] ?? buffers[id]?.duration ?? (text ? 1.5 + text.split(' ').length * 0.32 : 0);
    if (text) this.onSubtitle(text, seconds + 0.6);
  },
};

// lines.json may be { "keeper-01": "text" } or [{ id|name|file, text|line, seconds|duration }].
function normaliseLines(j) {
  const entries = Array.isArray(j) ? j.map((e) => [e.id ?? e.name ?? e.file, e]) : Object.entries(j);
  const out = {};
  for (const [key, v] of entries) {
    const id = String(key ?? '').replace(/^.*\//, '').replace(/\.ogg$/, '');
    out[id] = typeof v === 'string' ? v : v.text ?? v.line ?? '';
    const s = typeof v === 'object' ? Number(v.seconds ?? v.duration) : NaN;
    if (s > 0) out[`${id}:seconds`] = s;
  }
  return out;
}
