import * as THREE from 'three';
import { CameraRig } from './types.js';

export class CameraRigController {
  private yawOffset = 0;
  private pitchOffset = 0;
  private rotating = false;
  private lastX = 0;
  private lastY = 0;
  private readonly sensitivity = 0.005; // radians per pixel

  constructor(private readonly base: CameraRig, domElement: HTMLElement) {
    const onContextMenu = (e: MouseEvent) => e.preventDefault();
    const onMouseDown = (e: MouseEvent) => {
      if (e.button !== 2) return;
      this.rotating = true;
      this.lastX = e.clientX;
      this.lastY = e.clientY;
    };
    const onMouseMove = (e: MouseEvent) => {
      if (!this.rotating) return;
      const dx = e.clientX - this.lastX;
      const dy = e.clientY - this.lastY;
      this.lastX = e.clientX;
      this.lastY = e.clientY;

      this.yawOffset += dx * this.sensitivity;
      this.pitchOffset = THREE.MathUtils.clamp(this.pitchOffset + dy * this.sensitivity, -Math.PI / 6, Math.PI / 6);
    };
    const onMouseUp = (e: MouseEvent) => {
      if (e.button === 2) {
        this.rotating = false;
        this.yawOffset = 0;
        this.pitchOffset = 0;
      }
    };

    domElement.addEventListener('contextmenu', onContextMenu);
    domElement.addEventListener('mousedown', onMouseDown);
    domElement.addEventListener('mousemove', onMouseMove);
    domElement.addEventListener('mouseup', onMouseUp);

    this.cleanup = () => {
      domElement.removeEventListener('contextmenu', onContextMenu);
      domElement.removeEventListener('mousedown', onMouseDown);
      domElement.removeEventListener('mousemove', onMouseMove);
      domElement.removeEventListener('mouseup', onMouseUp);
    };
  }

  private cleanup: () => void;

  dispose(): void {
    this.cleanup();
  }

  getOffsets(): CameraRig {
    const rot = new THREE.Quaternion().setFromEuler(new THREE.Euler(this.pitchOffset, this.yawOffset, 0));
    return {
      cameraOffset: this.base.cameraOffset.clone().applyQuaternion(rot),
      lookOffset: this.base.lookOffset.clone().applyQuaternion(rot)
    };
  }
}
