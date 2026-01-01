import { InputState } from './types.js';

export type InputController = {
  state: InputState;
  dispose: () => void;
};

type CleanupFn = () => void;

export function createInputController(target: HTMLElement, onShoot: () => void): InputController {
  const state: InputState = {
    left: false,
    right: false,
    pitchUp: false,
    pitchDown: false,
    up: false,
    down: false,
    boost: false,
    rollLeft: false,
    rollRight: false
  };

  const handleKey = (event: KeyboardEvent, isDown: boolean) => {
    switch (event.code) {
      case 'KeyW':
      case 'ArrowUp':
        state.pitchUp = isDown;
        break;
      case 'KeyS':
      case 'ArrowDown':
        state.pitchDown = isDown;
        break;
      case 'KeyA':
      case 'ArrowLeft':
        state.left = isDown;
        break;
      case 'KeyD':
      case 'ArrowRight':
        state.right = isDown;
        break;
      case 'Space':
      case 'KeyR':
        state.up = isDown;
        break;
      case 'ControlLeft':
      case 'KeyF':
        state.down = isDown;
        break;
      case 'ShiftLeft':
      case 'ShiftRight':
        state.boost = isDown;
        break;
      case 'KeyQ':
        state.rollLeft = isDown;
        break;
      case 'KeyE':
        state.rollRight = isDown;
        break;
      default:
        break;
    }
  };

  const handlePointer = (event: PointerEvent) => {
    if ((event.target as HTMLElement | null)?.closest('#mobile-ui')) return; // ignore taps on HUD buttons
    if (event.button !== 0) return; // only left click shoots; right click reserved for camera orbit
    onShoot();
  };

  const keyDown = (event: KeyboardEvent) => handleKey(event, true);
  const keyUp = (event: KeyboardEvent) => handleKey(event, false);

  const cleanups: CleanupFn[] = [];

  cleanups.push(() => window.removeEventListener('keydown', keyDown));
  cleanups.push(() => window.removeEventListener('keyup', keyUp));
  window.addEventListener('keydown', keyDown);
  window.addEventListener('keyup', keyUp);

  target.style.touchAction = 'none';
  cleanups.push(() => target.removeEventListener('pointerdown', handlePointer));
  target.addEventListener('pointerdown', handlePointer);

  let teardownMobile: CleanupFn | null = null;
  if (isTouchDevice()) {
    document.body.classList.add('is-touch');
    teardownMobile = setupMobileControls(state, onShoot);
  }

  const dispose = () => {
    cleanups.forEach(fn => fn());
    teardownMobile?.();
    document.body.classList.remove('is-touch');
    resetState(state);
  };

  return { state, dispose };
}

function setupMobileControls(state: InputState, onShoot: () => void): CleanupFn {
  const mobileRoot = document.getElementById('mobile-ui');
  const pad = document.getElementById('mobile-pad');
  const stick = document.getElementById('mobile-stick');
  const fireBtn = document.getElementById('mobile-fire');
  const boostBtn = document.getElementById('mobile-boost');
  const rollLeftBtn = document.getElementById('mobile-roll-left');
  const rollRightBtn = document.getElementById('mobile-roll-right');
  if (!mobileRoot) return () => undefined;

  mobileRoot.classList.add('visible');
  const cleanups: CleanupFn[] = [];

  if (pad && stick) {
    cleanups.push(bindVirtualStick(pad, stick, state));
  }

  if (fireBtn) {
    cleanups.push(bindFireButton(fireBtn, onShoot));
  }

  if (boostBtn) {
    cleanups.push(bindHoldButton(boostBtn, active => (state.boost = active)));
  }

  if (rollLeftBtn) {
    cleanups.push(bindTapButton(rollLeftBtn, () => {
      state.rollLeft = true;
      setTimeout(() => (state.rollLeft = false), 50);
    }));
  }

  if (rollRightBtn) {
    cleanups.push(bindTapButton(rollRightBtn, () => {
      state.rollRight = true;
      setTimeout(() => (state.rollRight = false), 50);
    }));
  }

  cleanups.push(() => {
    mobileRoot.classList.remove('visible');
    resetState(state);
  });

  return () => cleanups.forEach(fn => fn());
}

function bindVirtualStick(pad: HTMLElement, stick: HTMLElement, state: InputState): CleanupFn {
  let activePointer: number | null = null;

  const reset = () => {
    state.left = false;
    state.right = false;
    state.pitchUp = false;
    state.pitchDown = false;
    stick.style.transform = 'translate(-50%, -50%)';
  };

  const updateFromEvent = (event: PointerEvent) => {
    const rect = pad.getBoundingClientRect();
    const x = ((event.clientX - rect.left) / rect.width) * 2 - 1; // -1..1
    const y = ((event.clientY - rect.top) / rect.height) * 2 - 1;

    const deadZone = 0.15;
    state.left = x < -deadZone;
    state.right = x > deadZone;
    state.pitchUp = y < -deadZone;
    state.pitchDown = y > deadZone;

    const travel = rect.width * 0.22; // thumb throw distance
    const clampedX = clamp(x, -1, 1) * travel;
    const clampedY = clamp(y, -1, 1) * travel;
    stick.style.transform = `translate(calc(-50% + ${clampedX}px), calc(-50% + ${clampedY}px))`;
  };

  const onDown = (event: PointerEvent) => {
    if (activePointer !== null) return;
    activePointer = event.pointerId;
    pad.setPointerCapture(activePointer);
    event.preventDefault();
    updateFromEvent(event);
  };

  const onMove = (event: PointerEvent) => {
    if (event.pointerId !== activePointer) return;
    event.preventDefault();
    updateFromEvent(event);
  };

  const onUp = (event: PointerEvent) => {
    if (event.pointerId !== activePointer) return;
    event.preventDefault();
    pad.releasePointerCapture(activePointer);
    activePointer = null;
    reset();
  };

  pad.style.touchAction = 'none';
  pad.addEventListener('pointerdown', onDown);
  pad.addEventListener('pointermove', onMove);
  pad.addEventListener('pointerup', onUp);
  pad.addEventListener('pointercancel', onUp);
  pad.addEventListener('pointerleave', onUp);

  return () => {
    pad.removeEventListener('pointerdown', onDown);
    pad.removeEventListener('pointermove', onMove);
    pad.removeEventListener('pointerup', onUp);
    pad.removeEventListener('pointercancel', onUp);
    pad.removeEventListener('pointerleave', onUp);
    reset();
  };
}

function bindHoldButton(button: HTMLElement, onChange: (active: boolean) => void): CleanupFn {
  const activate = (event: PointerEvent) => {
    event.preventDefault();
    button.setPointerCapture?.(event.pointerId);
    onChange(true);
  };

  const deactivate = (event: PointerEvent) => {
    event.preventDefault();
    button.releasePointerCapture?.(event.pointerId);
    onChange(false);
  };

  button.addEventListener('pointerdown', activate);
  button.addEventListener('pointerup', deactivate);
  button.addEventListener('pointerleave', deactivate);
  button.addEventListener('pointercancel', deactivate);

  return () => {
    button.removeEventListener('pointerdown', activate);
    button.removeEventListener('pointerup', deactivate);
    button.removeEventListener('pointerleave', deactivate);
    button.removeEventListener('pointercancel', deactivate);
    onChange(false);
  };
}

function bindTapButton(button: HTMLElement, onTap: () => void): CleanupFn {
  const handler = (event: PointerEvent) => {
    event.preventDefault();
    onTap();
  };
  button.addEventListener('pointerdown', handler);
  button.addEventListener('pointerup', handler);
  button.addEventListener('pointercancel', handler);

  return () => {
    button.removeEventListener('pointerdown', handler);
    button.removeEventListener('pointerup', handler);
    button.removeEventListener('pointercancel', handler);
  };
}

function bindFireButton(button: HTMLElement, onShoot: () => void): CleanupFn {
  let fireInterval: number | null = null;

  const stop = (event?: PointerEvent) => {
    event?.preventDefault();
    if (event) {
      button.releasePointerCapture?.(event.pointerId);
    }
    if (fireInterval !== null) {
      window.clearInterval(fireInterval);
      fireInterval = null;
    }
  };

  const start = (event: PointerEvent) => {
    event.preventDefault();
    button.setPointerCapture?.(event.pointerId);
    stop();
    onShoot();
    fireInterval = window.setInterval(() => onShoot(), 200);
  };

  button.addEventListener('pointerdown', start);
  button.addEventListener('pointerup', stop);
  button.addEventListener('pointerleave', stop);
  button.addEventListener('pointercancel', stop);

  return () => {
    button.removeEventListener('pointerdown', start);
    button.removeEventListener('pointerup', stop);
    button.removeEventListener('pointerleave', stop);
    button.removeEventListener('pointercancel', stop);
    stop();
  };
}

function isTouchDevice(): boolean {
  return window.matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;
}

function resetState(state: InputState): void {
  state.left = false;
  state.right = false;
  state.pitchUp = false;
  state.pitchDown = false;
  state.up = false;
  state.down = false;
  state.boost = false;
  state.rollLeft = false;
  state.rollRight = false;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
