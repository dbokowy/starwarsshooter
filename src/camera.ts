import * as THREE from 'three';
import { CameraRig } from './types.js';

export class CameraRigController {
  private lookBack = false;

  constructor(private readonly base: CameraRig, domElement: HTMLElement) {
    const onContextMenu = (e: MouseEvent) => e.preventDefault();
    const onMouseDown = (e: MouseEvent) => {
      if (e.button !== 2) return;
      this.lookBack = true;
    };
    const onMouseUp = (e: MouseEvent) => {
      if (e.button === 2) {
        this.lookBack = false;
      }
    };

    domElement.addEventListener('contextmenu', onContextMenu);
    domElement.addEventListener('mousedown', onMouseDown);
    domElement.addEventListener('mouseup', onMouseUp);

    this.cleanup = () => {
      domElement.removeEventListener('contextmenu', onContextMenu);
      domElement.removeEventListener('mousedown', onMouseDown);
      domElement.removeEventListener('mouseup', onMouseUp);
    };
  }

  private cleanup: () => void;

  dispose(): void {
    this.cleanup();
  }

  getOffsets(): CameraRig {
    if (!this.lookBack) {
      return {
        cameraOffset: this.base.cameraOffset.clone(),
        lookOffset: this.base.lookOffset.clone()
      };
    }

    const rot = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, Math.PI, 0));
    const backOffset = this.base.cameraOffset.clone().applyQuaternion(rot);
    const backLook = this.base.lookOffset.clone().applyQuaternion(rot);
    return {
      cameraOffset: backOffset,
      lookOffset: backLook
    };
  }
}
