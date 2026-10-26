// Keyboard / mouse state with pointer lock.
export class Input {
  constructor(element) {
    this.el = element;
    this.keys = new Set();
    this.pressed = new Set();
    this.released = new Set();
    this.mouseDX = 0;
    this.mouseDY = 0;
    this.wheel = 0;
    this.buttons = 0;
    this.clicked = new Set();
    this.locked = false;
    this.enabled = true;
    this.sensitivity = 1;
    this.invertY = false;

    window.addEventListener('keydown', (e) => {
      if (e.repeat) return;
      if (['Tab', 'Space', 'ArrowUp', 'ArrowDown'].includes(e.code)) e.preventDefault();
      this.keys.add(e.code);
      this.pressed.add(e.code);
    });
    window.addEventListener('keyup', (e) => {
      this.keys.delete(e.code);
      this.released.add(e.code);
    });
    window.addEventListener('blur', () => {
      this.keys.clear();
      this.buttons = 0;
    });
    window.addEventListener('mousemove', (e) => {
      if (!this.locked) return;
      this.mouseDX += e.movementX * this.sensitivity;
      this.mouseDY += e.movementY * this.sensitivity * (this.invertY ? -1 : 1);
    });
    window.addEventListener('mousedown', (e) => {
      this.buttons |= 1 << e.button;
      this.clicked.add(e.button);
    });
    window.addEventListener('mouseup', (e) => {
      this.buttons &= ~(1 << e.button);
    });
    window.addEventListener('wheel', (e) => {
      this.wheel += Math.sign(e.deltaY);
    }, { passive: true });
    window.addEventListener('contextmenu', (e) => e.preventDefault());
    document.addEventListener('pointerlockchange', () => {
      if (this.fallbackLock) return;
      this.locked = document.pointerLockElement === this.el;
      if (!this.locked) this.buttons = 0;
    });
    window.addEventListener('keydown', (e) => {
      if (e.code === 'Escape' && this.fallbackLock) this.unlock();
    });
  }

  lock() {
    if (this.locked) return;
    const fallback = () => {
      // pointer lock refused (e.g. embedded preview): look with raw mouse motion instead
      this.fallbackLock = true;
      this.locked = true;
      document.dispatchEvent(new Event('pointerlockchange'));
    };
    try {
      const p = this.el.requestPointerLock?.({ unadjustedMovement: true });
      if (p && p.catch) {
        p.catch(() => {
          const p2 = this.el.requestPointerLock();
          if (p2 && p2.catch) p2.catch(fallback);
        });
      }
    } catch (e) {
      fallback();
    }
  }

  unlock() {
    if (this.fallbackLock) {
      this.fallbackLock = false;
      this.locked = false;
      document.dispatchEvent(new Event('pointerlockchange'));
      return;
    }
    if (this.locked) document.exitPointerLock();
  }

  down(code) {
    return this.enabled && this.keys.has(code);
  }

  hit(code) {
    return this.enabled && this.pressed.has(code);
  }

  mouse(button) {
    return this.enabled && this.locked && (this.buttons & (1 << button)) !== 0;
  }

  mouseHit(button) {
    return this.enabled && this.locked && this.clicked.has(button);
  }

  endFrame() {
    this.pressed.clear();
    this.released.clear();
    this.clicked.clear();
    this.mouseDX = 0;
    this.mouseDY = 0;
    this.wheel = 0;
  }
}
