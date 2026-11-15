// Input: pointer lock + keyboard + mouse, with a lock-click guard so the click
// that acquires the lock never fires the gun, and a firing watchdog so a gun
// never sticks firing. Also reports freshly pressed keys (buy menu, grenade,
// weapon slots, plant) as edge events.
export function createInput(canvas, onLockChange) {
  const state = { keys: new Set(), firing: false, ads: false, locked: false };
  const pressed = new Set();
  let lookX = 0;
  let lookY = 0;
  let mouseButtons = 0;
  let lockJustAcquired = false;

  function onKeyDown(event) {
    if (event.repeat) return;
    state.keys.add(event.code);
    pressed.add(event.code);
    if (event.code === 'Space') event.preventDefault();
  }
  function onKeyUp(event) {
    state.keys.delete(event.code);
  }
  function onMouseDown(event) {
    mouseButtons = event.buttons;
    if (!state.locked) return;
    if (lockJustAcquired) { lockJustAcquired = false; return; }
    if (event.button === 0) state.firing = true;
    if (event.button === 2) state.ads = true;
  }
  function onMouseUp(event) {
    mouseButtons = event.buttons;
    if (event.button === 0) state.firing = false;
    if (event.button === 2) state.ads = false;
  }
  function onMouseMove(event) {
    mouseButtons = event.buttons;
    if (!state.locked) return;
    lookX += event.movementX;
    lookY += event.movementY;
  }
  function onLock() {
    const locked = document.pointerLockElement === canvas;
    state.locked = locked;
    if (locked) lockJustAcquired = true;
    else { state.firing = false; state.ads = false; }
    if (onLockChange) onLockChange(locked);
  }
  function onContextMenu(event) { event.preventDefault(); }

  document.addEventListener('keydown', onKeyDown);
  document.addEventListener('keyup', onKeyUp);
  document.addEventListener('mousedown', onMouseDown);
  document.addEventListener('mouseup', onMouseUp);
  document.addEventListener('mousemove', onMouseMove);
  document.addEventListener('pointerlockchange', onLock);
  document.addEventListener('contextmenu', onContextMenu);

  return {
    state,
    requestLock() {
      canvas.requestPointerLock();
    },
    takeLook() {
      const out = { x: lookX, y: lookY };
      lookX = 0;
      lookY = 0;
      return out;
    },
    // Edge-triggered keys since the last call (consumed once).
    takePressed() {
      const out = [...pressed];
      pressed.clear();
      return out;
    },
    // Firing watchdog: if the OS says no button is held, the gun stops —
    // a mouseup that arrived outside the window can never leave it firing.
    watchdog() {
      if (state.firing && !(mouseButtons & 1)) state.firing = false;
      if (state.ads && !(mouseButtons & 2)) state.ads = false;
    },
  };
}
