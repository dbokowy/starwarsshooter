import * as THREE from 'three';
import { CameraRig, PlayArea, PlayerConfig } from './types.js';

export const ASSETS_PATH = '/assets';

export const CAMERA_RIG: CameraRig = {
  cameraOffset: new THREE.Vector3(0, 6, 14),
  lookOffset: new THREE.Vector3(0, 2.3, -14)
};

export const PLAY_AREA: PlayArea = {
  minZ: -2500,
  maxZ: 800,
  maxX: 1200,
  minX: -1200,
  maxY: 800,
  minY: -800
};

export const PLAYER_CONFIG: PlayerConfig = {
  baseSpeed: 4.6,
  strafeSpeed: 18,
  boostMultiplier: 1.8,
  maxHealth: 100,
  muzzleOffsets: [
    new THREE.Vector3(1.6, 0.15, -1.8),
    new THREE.Vector3(1.6, -0.35, -1.8),
    new THREE.Vector3(-1.6, 0.15, -1.8),
    new THREE.Vector3(-1.6, -0.35, -1.8)
  ],
  flameOffsets: [
    new THREE.Vector3(1.4, 0.3605, 2.244),
    new THREE.Vector3(1.4, -0.385, 2.244),
    new THREE.Vector3(-1.4, 0.3605, 2.244),
    new THREE.Vector3(-1.4, -0.385, 2.244)
  ]
};
