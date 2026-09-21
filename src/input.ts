// Keyboard + mouse state with pointer lock.

export class Input {
  keys = new Set<string>();
  pressed = new Set<string>(); // keys that went down this frame
  mouseDX = 0; mouseDY = 0;
  mouseX = 0; mouseY = 0;
  buttons = [false, false, false];
  clicked = [false, false, false]; // went down this frame
  wheel = 0;
  locked = false;
  onLockChange: ((locked: boolean) => void) | null = null;

  constructor(private el: HTMLCanvasElement) {
    window.addEventListener('keydown', (e) => {
      if (e.code === 'Tab' || e.code === 'Space' || e.code.startsWith('Arrow') || e.code === 'F3' || e.code === 'F5') e.preventDefault();
      if (!e.repeat) this.pressed.add(e.code);
      this.keys.add(e.code);
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => { this.keys.clear(); this.buttons.fill(false); });
    el.addEventListener('mousemove', (e) => {
      if (this.locked) { this.mouseDX += e.movementX; this.mouseDY += e.movementY; }
      const r = el.getBoundingClientRect();
      this.mouseX = e.clientX - r.left; this.mouseY = e.clientY - r.top;
    });
    el.addEventListener('mousedown', (e) => { if (e.button < 3) { this.buttons[e.button] = true; this.clicked[e.button] = true; } });
    window.addEventListener('mouseup', (e) => { if (e.button < 3) this.buttons[e.button] = false; });
    el.addEventListener('contextmenu', (e) => e.preventDefault());
    el.addEventListener('wheel', (e) => { this.wheel += Math.sign(e.deltaY); e.preventDefault(); }, { passive: false });
    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === el;
      if (!this.locked) this.buttons.fill(false);
      this.onLockChange?.(this.locked);
    });
  }

  lock() {
    if (this.locked) return;
    try {
      const p = this.el.requestPointerLock() as unknown as Promise<void> | undefined;
      p?.catch?.(() => {});
    } catch { /* needs a user gesture; ignore */ }
  }

  unlock() { if (this.locked) document.exitPointerLock(); }

  endFrame() {
    this.pressed.clear();
    this.clicked.fill(false);
    this.mouseDX = 0; this.mouseDY = 0; this.wheel = 0;
  }
}
