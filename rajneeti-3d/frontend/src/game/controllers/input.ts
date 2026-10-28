/**
 * Single shared input state. Keyboard and touch controls both write here,
 * and the engine reads it, so movement logic exists exactly once.
 */
export interface InputState {
  moveX: number; // -1 (left) .. 1 (right)
  moveY: number; // -1 (back) .. 1 (forward)
  run: boolean;
  jump: boolean;
  interactPressed: boolean;
}

export const inputState: InputState = { moveX: 0, moveY: 0, run: false, jump: false, interactPressed: false };

const keys = new Set<string>();

function recompute(): void {
  const x = (keys.has('KeyD') || keys.has('ArrowRight') ? 1 : 0) - (keys.has('KeyA') || keys.has('ArrowLeft') ? 1 : 0);
  const y = (keys.has('KeyW') || keys.has('ArrowUp') ? 1 : 0) - (keys.has('KeyS') || keys.has('ArrowDown') ? 1 : 0);
  // Keyboard only overrides when a movement key is held, so the touch joystick still works.
  if (x !== 0 || y !== 0 || keyboardActive) {
    inputState.moveX = x;
    inputState.moveY = y;
  }
  keyboardActive = x !== 0 || y !== 0;
  inputState.run = keys.has('ShiftLeft') || keys.has('ShiftRight') || touchRun;
  inputState.jump = keys.has('Space');
}

let keyboardActive = false;
let touchRun = false;

export function setTouchMove(x: number, y: number): void {
  if (!keyboardActive) {
    inputState.moveX = x;
    inputState.moveY = y;
  }
}
export function setTouchRun(v: boolean): void {
  touchRun = v;
  recompute();
}
export function triggerInteract(): void {
  inputState.interactPressed = true;
}
export function resetInput(): void {
  keys.clear();
  keyboardActive = false;
  touchRun = false;
  inputState.moveX = 0;
  inputState.moveY = 0;
  inputState.run = false;
  inputState.jump = false;
  inputState.interactPressed = false;
}

const GAME_KEYS = new Set(['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'ShiftLeft', 'ShiftRight', 'Space']);

export function attachKeyboard(): () => void {
  const down = (e: KeyboardEvent) => {
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
    if (GAME_KEYS.has(e.code)) {
      e.preventDefault();
      keys.add(e.code);
      recompute();
    }
    if (e.code === 'KeyE' && !e.repeat) triggerInteract();
  };
  const up = (e: KeyboardEvent) => {
    if (keys.delete(e.code)) recompute();
  };
  const blur = () => resetInput();
  window.addEventListener('keydown', down);
  window.addEventListener('keyup', up);
  window.addEventListener('blur', blur);
  return () => {
    window.removeEventListener('keydown', down);
    window.removeEventListener('keyup', up);
    window.removeEventListener('blur', blur);
    resetInput();
  };
}
