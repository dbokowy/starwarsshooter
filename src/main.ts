import './style.css';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { CAMERA_RIG, PLAY_AREA, PLAYER_CONFIG, ASSETS_PATH } from './config.js';
import { createInputController } from './controls.js';
import { createStarfield, loadEnvironment, setupLights } from './environment.js';
import { Hud } from './hud.js';
import { PlayerController } from './player.js';
import { CameraRigController } from './camera.js';

const renderer = createRenderer();
const scene = createScene();
const camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.1, 25000);
const clock = new THREE.Clock();
const loader = new GLTFLoader();

const player = new PlayerController(loader, scene, PLAYER_CONFIG, PLAY_AREA);
const starfield = createStarfield(scene);
let planet: THREE.Object3D | null = null;
const cameraRigController = new CameraRigController(CAMERA_RIG, renderer.domElement);

const hud = new Hud({
  healthBar: document.getElementById('health-bar'),
  speedBar: document.getElementById('speed-bar')
});

const smoothedLook = new THREE.Vector3();
const inputController = createInputController(renderer.domElement, () => player.shoot(performance.now()));

init();

async function init() {
  setupLights(scene);
  planet = await loadEnvironment(loader, scene, ASSETS_PATH);
  await player.loadModel(
    `${ASSETS_PATH}/x-wing-thruster-glow/scene.gltf`,
    new THREE.Euler(0.1745329, Math.PI / 12, -Math.PI / 18),
    0.9337123125,
    new THREE.Vector3(0, -2, 0)
  );

  smoothedLook.copy(player.root.position).add(CAMERA_RIG.lookOffset);
  window.addEventListener('resize', onResize);
  onResize();
  renderer.setAnimationLoop(update);
}

function update() {
  const delta = clock.getDelta();
  const elapsed = clock.getElapsedTime();

  player.update(delta, inputController.state);
  player.updateBullets(delta);
  updateCamera();
  player.updateFlames(elapsed * 2); // match prior timing scale
  player.updateModelSway(elapsed);
  starfield.update(delta);
  if (planet) planet.rotation.y += delta * 0.05;

  hud.updateHealth(player.health, PLAYER_CONFIG.maxHealth);
  hud.updateSpeed(player.currentSpeed, PLAYER_CONFIG.baseSpeed, PLAYER_CONFIG.boostMultiplier);

  renderer.render(scene, camera);
}

function updateCamera() {
  const rigOffsets = cameraRigController.getOffsets();
  const throttle = THREE.MathUtils.clamp(player.currentSpeed / (PLAYER_CONFIG.baseSpeed * PLAYER_CONFIG.boostMultiplier), 0, 1);

  // Pull camera back up to ~70% farther at max throttle.
  const cameraPullback = THREE.MathUtils.lerp(1, 1.7, throttle);
  const offset = rigOffsets.cameraOffset.clone().multiplyScalar(cameraPullback);

  const desiredPosition = offset.applyQuaternion(player.root.quaternion).add(player.root.position);
  camera.position.lerp(desiredPosition, 0.1);

  const lookTarget = rigOffsets.lookOffset.clone().applyQuaternion(player.root.quaternion).add(player.root.position);
  smoothedLook.lerp(lookTarget, 0.2);
  camera.lookAt(smoothedLook);

  // Blur kicks in only past 70% throttle.
  const blurFactor = THREE.MathUtils.clamp((throttle - 0.8) / 0.2, 0, 1);
  const blurStrength = THREE.MathUtils.lerp(0, 2.5, blurFactor);
  renderer.domElement.style.filter = `blur(${blurStrength}px)`;
}

function onResize() {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
}

function createRenderer(): THREE.WebGLRenderer {
  const webgl = new THREE.WebGLRenderer({ antialias: true });
  webgl.setSize(window.innerWidth, window.innerHeight);
  webgl.setPixelRatio(Math.min(2, window.devicePixelRatio));
  webgl.outputColorSpace = THREE.SRGBColorSpace;
  webgl.shadowMap.enabled = true;
  document.body.appendChild(webgl.domElement);
  return webgl;
}

function createScene(): THREE.Scene {
  const newScene = new THREE.Scene();
  newScene.background = new THREE.Color(0x02040a);
  newScene.fog = new THREE.FogExp2(0x02040a, 0.0012);
  return newScene;
}
