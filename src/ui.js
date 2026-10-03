// The DOM layer: loading bar, title, ember HUD, the keeper's subtitles, hints, pause and end cards, touch
// controls. Opacities are animated from game time (not CSS transitions) so capture frames are exact.
const $ = (id) => document.getElementById(id);

export function createUI({ onStart, onRestart, onPause, touch }) {
  const el = Object.fromEntries(['loading', 'title', 'hud', 'subtitle', 'hint', 'pause', 'end', 'stick'].map((id) => [id, $(id)]));
  const pauseButton = $('pause-button');
  document.body.classList.toggle('is-touch', touch);
  const fades = new Map(); // element -> { value, target, speed }
  const fade = (e, target, speed = 1.2) => {
    const f = fades.get(e) ?? { value: Number(e.style.opacity || 0), target, speed };
    Object.assign(f, { target, speed });
    fades.set(e, f);
  };
  let subtitleUntil = -1, hintUntil = -1, now = 0;

  // Any click, tap or Enter/Space on the title starts the game (and unlocks audio).
  const begin = () => { if (!el.title.hidden && el.title.dataset.ready) onStart(); };
  addEventListener('pointerdown', begin);
  addEventListener('keydown', (e) => {
    if (e.code === 'Enter' || e.code === 'Space') begin();
    if (e.code === 'Escape' || e.code === 'KeyP') onPause();
  });
  $('restart').addEventListener('click', () => onRestart());
  $('resume').addEventListener('click', () => onPause(false));
  $('start-over').addEventListener('click', () => { onPause(false); onRestart(); });
  pauseButton.addEventListener('pointerdown', (e) => e.stopPropagation());
  pauseButton.addEventListener('click', () => onPause(true));

  return {
    setLoading(p) {
      $('loadpct').textContent = `${Math.round(p * 100)}%`;
      $('loadbar').style.width = `${(p * 100).toFixed(1)}%`;
    },
    showTitle() {
      el.loading.hidden = true;
      el.title.hidden = false;
      el.title.style.opacity = 0;
      fade(el.title, 1, 0.5);
      el.title.dataset.ready = '1';
    },
    skipTitle() { el.loading.hidden = true; el.title.hidden = true; el.title.dataset.ready = ''; el.hud.hidden = false; },
    hideTitle() {
      fade(el.title, 0, 1.5);
      el.title.dataset.ready = '';
      el.hud.hidden = pauseButton.hidden = false;
      el.hud.style.opacity = 0;
      fade(el.hud, 1, 0.8);
      document.body.classList.add('playing');
    },
    setPips(n) {
      [...el.hud.querySelectorAll('i')].forEach((p, i) => p.classList.toggle('lit', i < n));
      $('found').textContent = n;
    },
    subtitle(text, seconds) { $('subtitle-text').textContent = text; fade(el.subtitle, 1, 3); subtitleUntil = now + seconds; },
    hint(text, seconds) {
      if (!text) { fade(el.hint, 0, 2); hintUntil = -1; return; }
      el.hint.textContent = text; fade(el.hint, 1, 2); hintUntil = now + seconds;
    },
    showPause(on) { el.pause.hidden = !on; if (on) $('resume').focus({ preventScroll: true }); },
    showEnd({ found, seconds }) {
      $('end-found').textContent = found;
      $('end-time').textContent = `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;
      el.end.hidden = false;
      el.end.style.opacity = 0;
      fade(el.end, 1, 0.35);
      fade(el.hud, 0, 1);
      pauseButton.hidden = true;
      document.body.classList.remove('playing');
    },
    hideEnd() {
      el.end.hidden = true;
      el.hud.style.opacity = 1;
      fades.delete(el.hud);
      pauseButton.hidden = false;
      document.body.classList.add('playing');
    },
    showStick(x, y) { Object.assign(el.stick.style, { display: 'block', left: `${x}px`, top: `${y}px` }); },
    moveStick(dx, dy) { el.stick.firstElementChild.style.transform = `translate(${dx}px, ${dy}px)`; },
    hideStick() { el.stick.style.display = 'none'; el.stick.firstElementChild.style.transform = ''; },
    onHop(fn) { $('hop').addEventListener('pointerdown', (e) => { e.stopPropagation(); fn(); }); },
    cinematic(on) { document.body.classList.toggle('cinematic', on); },
    update(t, dt) {
      now = t;
      if (subtitleUntil >= 0 && t > subtitleUntil) { fade(el.subtitle, 0, 1.5); subtitleUntil = -1; }
      if (hintUntil >= 0 && t > hintUntil) { fade(el.hint, 0, 1.5); hintUntil = -1; }
      for (const [e, f] of fades) {
        f.value += Math.sign(f.target - f.value) * Math.min(Math.abs(f.target - f.value), f.speed * dt);
        e.style.opacity = f.value.toFixed(3);
        if (f.value === 0 && f.target === 0 && (e === el.title || e === el.end)) e.hidden = true;
      }
    },
  };
}
