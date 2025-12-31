import { InputState } from './types.js';

export type InputController = {
  state: InputState;
  dispose: () => void;
};

export function createInputController(target: HTMLElement, onShoot: () => void): InputController {
  const state: InputState = {
    left: false,
    right: false,
    pitchUp: false,
    pitchDown: false,
    up: false,
    down: false,
    boost: false
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
      default:
        break;
    }
  };

  const handlePointer = () => onShoot();

  const keyDown = (event: KeyboardEvent) => handleKey(event, true);
  const keyUp = (event: KeyboardEvent) => handleKey(event, false);

  window.addEventListener('keydown', keyDown);
  window.addEventListener('keyup', keyUp);
  target.addEventListener('pointerdown', handlePointer);

  const dispose = () => {
    window.removeEventListener('keydown', keyDown);
    window.removeEventListener('keyup', keyUp);
    target.removeEventListener('pointerdown', handlePointer);
  };

  return { state, dispose };
}
