import * as THREE from 'three';

export type InputState = {
  yawLeft: boolean;
  yawRight: boolean;
  strafeLeft: boolean;
  strafeRight: boolean;
  pitchUp: boolean;
  pitchDown: boolean;
  up: boolean;
  down: boolean;
  boost: boolean;
  rollLeft: boolean;
  rollRight: boolean;
};

export type Bullet = {
  mesh: THREE.Object3D;
  velocity: THREE.Vector3;
  life: number;
};

export type PlayArea = {
  minZ: number;
  maxZ: number;
  maxX: number;
  minX: number;
  maxY: number;
  minY: number;
};

export type PlayerConfig = {
  baseSpeed: number;
  strafeSpeed: number;
  boostMultiplier: number;
  maxHealth: number;
  muzzleOffsets: THREE.Vector3[];
  flameOffsets: THREE.Vector3[];
};

export type CameraRig = {
  cameraOffset: THREE.Vector3;
  lookOffset: THREE.Vector3;
};

export type HudElements = {
  healthBar: HTMLElement | null;
  speedBar: HTMLElement | null;
};
