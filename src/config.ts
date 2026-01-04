import * as THREE from 'three';
import { CameraRig, PlayArea, PlayerConfig } from './types.js';

export const ASSETS_PATH = `${import.meta.env.BASE_URL}assets`;

export const CAMERA_RIG: CameraRig = {
  cameraOffset: new THREE.Vector3(0, 6, 14),
  lookOffset: new THREE.Vector3(0, 2.3, -14)
};

export const PLAY_AREA: PlayArea = {
  minZ: -5000,
  maxZ: 5200,
  maxX: 12000,
  minX: -12000,
  maxY: 5200,
  minY: -5200
};

export const PLAYER_CONFIG: PlayerConfig = {
  baseSpeed: 4.6,
  strafeSpeed: 18,
  boostMultiplier: 26.0869565217, // baseSpeed * boostMultiplier = 120 max cruise
  maxHealth: 100,
  muzzleOffsets: [
    new THREE.Vector3(7.6, 1.4, -3.2),   // upper right wingtip
    new THREE.Vector3(7.6, -1.4, -3.2),  // lower right wingtip
    new THREE.Vector3(-5.6, 0.9, -3.2),  // upper left wingtip
    new THREE.Vector3(-5.6, -0.9, -3.2)  // lower left wingtip
  ],
  flameOffsets: [
    new THREE.Vector3(-0.58, 2.1, 4.8),
    new THREE.Vector3(-0.7, -0.2, 4.8),
    new THREE.Vector3(2.3, 2.0, 4.8),
    new THREE.Vector3(2.4, -0.2, 4.8)
  ]
};


