import * as THREE from 'three';
import { CameraRig, PlayArea, PlayerConfig } from './types.js';

export const ASSETS_PATH = `${import.meta.env.BASE_URL}assets`;

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
    new THREE.Vector3(6.6, 1.4, -3.2),   // upper right wingtip
    new THREE.Vector3(6.6, -1.4, -3.2),  // lower right wingtip
    new THREE.Vector3(-5.6, 0.9, -3.2),  // upper left wingtip
    new THREE.Vector3(-5.6, -0.9, -3.2)  // lower left wingtip
  ],
  flameOffsets: [
    new THREE.Vector3(-0.6, 2.1, 4.8),
    new THREE.Vector3(-0.6, -0.2, 4.8),
    new THREE.Vector3(2.4, 2.1, 4.8),
    new THREE.Vector3(2.4, -0.2, 4.8)
  ]
};
