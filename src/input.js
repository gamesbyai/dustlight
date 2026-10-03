// Keyboard (WASD/arrows, Space), mouse drag to look, wheel to zoom, and touch: a left-thumb joystick,
// drag anywhere else to look, and a hop button. Game code reads `input` once per frame.
import * as THREE from 'three';

export const input = {
  move: new THREE.Vector2(),   // x = right, y = forward, length <= 1
  hop: false,                  // true for one frame after a hop press
  look: new THREE.Vector2(),   // accumulated drag in pixels since the last frame
  zoom: 0,
  lastLook: -1e9,              // time of the last manual look, for the auto-follow camera
  enabled: true,
};

const keys = new Set();
let hopQueued = false;
const stick = { id: null, x: 0, y: 0, dx: 0, dy: 0 };
const lookers = new Map();

export function initInput(canvas, ui) {
  addEventListener('keydown', (e) => {
    if (e.code === 'Space' && !(e.target instanceof HTMLButtonElement)) { if (!e.repeat) hopQueued = true; e.preventDefault(); }
    keys.add(e.code);
  });
  addEventListener('keyup', (e) => keys.delete(e.code));
  addEventListener('blur', () => keys.clear());

  canvas.addEventListener('pointerdown', (e) => {
    try { canvas.setPointerCapture(e.pointerId); } catch { /* the pointer is already gone */ }
    if (e.pointerType === 'touch' && e.clientX < innerWidth * 0.45 && stick.id === null) {
      Object.assign(stick, { id: e.pointerId, x: e.clientX, y: e.clientY, dx: 0, dy: 0 });
      ui.showStick(e.clientX, e.clientY);
    } else {
      lookers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    }
  });
  canvas.addEventListener('pointermove', (e) => {
    if (e.pointerId === stick.id) {
      const max = 55;
      let dx = e.clientX - stick.x, dy = e.clientY - stick.y;
      const l = Math.hypot(dx, dy);
      if (l > max) { dx *= max / l; dy *= max / l; }
      stick.dx = dx / max; stick.dy = dy / max;
      ui.moveStick(dx, dy);
    } else if (lookers.has(e.pointerId)) {
      const p = lookers.get(e.pointerId);
      const k = e.pointerType === 'touch' ? 1.4 : 1;
      input.look.x += (e.clientX - p.x) * k;
      input.look.y += (e.clientY - p.y) * k;
      p.x = e.clientX; p.y = e.clientY;
    }
  });
  const end = (e) => {
    if (e.pointerId === stick.id) { stick.id = null; stick.dx = stick.dy = 0; ui.hideStick(); }
    lookers.delete(e.pointerId);
  };
  canvas.addEventListener('pointerup', end);
  canvas.addEventListener('pointercancel', end);
  canvas.addEventListener('wheel', (e) => { input.zoom += Math.sign(e.deltaY); e.preventDefault(); }, { passive: false });
  ui.onHop(() => { hopQueued = true; });
}

// Called once per frame by the game before it reads `input`.
export function pollInput() {
  const k = (...codes) => codes.some((c) => keys.has(c));
  let x = (k('KeyD', 'ArrowRight') ? 1 : 0) - (k('KeyA', 'ArrowLeft') ? 1 : 0);
  let y = (k('KeyW', 'ArrowUp') ? 1 : 0) - (k('KeyS', 'ArrowDown') ? 1 : 0);
  if (stick.id !== null) { x = stick.dx; y = -stick.dy; }
  input.move.set(x, y);
  if (input.move.length() > 1) input.move.normalize();
  input.hop = hopQueued;
  hopQueued = false;
}
