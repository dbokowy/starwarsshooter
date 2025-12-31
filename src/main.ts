import './style.css';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { AudioLoader, AudioListener } from 'three';
import { CAMERA_RIG, PLAY_AREA, PLAYER_CONFIG, ASSETS_PATH } from './config.js';
import { createInputController } from './controls.js';
import { createStarfield, loadEnvironment, loadStarDestroyer, setupLights } from './environment.js';
import { Hud } from './hud.js';
import { PlayerController } from './player.js';
import { CameraRigController } from './camera.js';
import { ExplosionManager } from './explosions.js';
import { EnemySquadron, Obstacle } from './enemy.js';

const IS_MOBILE = window.matchMedia('(pointer: coarse)').matches || navigator.maxTouchPoints > 1;
const renderer = createRenderer(IS_MOBILE);
const scene = createScene();
const camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.1, 25000);
const listener = new AudioListener();
camera.add(listener);
const clock = new THREE.Clock();
const loader = new GLTFLoader();
const audioLoader = new AudioLoader();
const MUSIC_URL = `${ASSETS_PATH}/darth-maul.ogg`;
let bgMusicEl: HTMLAudioElement | null = new Audio();
let musicReady = false;
let userInteracted = false;
let pendingPlayRequest = false;
let musicLoadStarted = false;
const gestureEvents = ['pointerdown', 'touchstart', 'touchend', 'click'];

const player = new PlayerController(loader, scene, PLAYER_CONFIG, PLAY_AREA, listener);
const starfield = createStarfield(scene, IS_MOBILE ? 0.45 : 1);
let planet: THREE.Object3D | null = null;
let destroyer: THREE.Object3D | null = null;
const cameraRigController = new CameraRigController(CAMERA_RIG, renderer.domElement);
const explosions = new ExplosionManager(loader, scene, ASSETS_PATH, listener);
const enemies = new EnemySquadron(loader, scene, ASSETS_PATH, explosions);

const hud = new Hud({
  healthBar: document.getElementById('health-bar'),
  speedBar: document.getElementById('speed-bar')
});
const crosshairEl = document.getElementById('crosshair') as HTMLElement | null;
const loadingEl = document.getElementById('loading') as HTMLElement | null;
const controlsModal = document.getElementById('controls-modal') as HTMLElement | null;
const controlsCloseBtn = document.getElementById('controls-close') as HTMLButtonElement | null;
const raycaster = new THREE.Raycaster();
const testExplosionHandler = (event: KeyboardEvent) => {
  if (event.code === 'KeyT') {
    if (!player.isDestroyed()) {
      player.destroy();
      explosions.trigger(player.root.position, 18);
    } else {
      explosions.trigger(player.root.position, 18);
    }
  }
};
const immortalityBtn = document.getElementById('toggle-immortal') as HTMLButtonElement | null;
const enemyFireBtn = document.getElementById('toggle-enemy-fire') as HTMLButtonElement | null;
const enemyExplosionBtn = document.getElementById('trigger-enemy-explosion') as HTMLButtonElement | null;
let immortal = true;

const smoothedLook = new THREE.Vector3();
const inputController = createInputController(renderer.domElement, () => player.shoot(performance.now()));

init();

async function init() {
  document.body.classList.toggle('is-touch', IS_MOBILE);
  setupLights(scene, !IS_MOBILE);
  planet = await loadEnvironment(loader, scene, ASSETS_PATH);
  if (!IS_MOBILE) {
    destroyer = await loadStarDestroyer(loader, scene, ASSETS_PATH);
  }
  audioLoader.load(`${ASSETS_PATH}/tie-fighter-fire-1.mp3`, buffer => player.setFireSound(buffer));
  audioLoader.load(`${ASSETS_PATH}/explosion-fx-425453.mp3`, buffer => explosions.setSoundBuffer(buffer));
  await explosions.init();
  loadBackgroundMusic();
  await player.loadModel(
    `${ASSETS_PATH}/x-wing-thruster-glow/scene.gltf`,
    new THREE.Euler(0.1745329, Math.PI / 12, -Math.PI / 18),
    0.9337123125,
    new THREE.Vector3(0, -2, 0)
  );
  await enemies.init(2, player, destroyer ? destroyer.position : undefined);
  hideLoading();

  smoothedLook.copy(player.root.position).add(CAMERA_RIG.lookOffset);
  window.addEventListener('resize', onResize);
  window.addEventListener('keydown', testExplosionHandler);
  bindToggles();
  onResize();
  renderer.setAnimationLoop(update);
  showControlsModal();
}

function update() {
  const delta = clock.getDelta();
  const elapsed = clock.getElapsedTime();
  const now = performance.now();

  player.update(delta, inputController.state);
  player.updateBullets(delta);
  enemies.update(delta, player, camera, buildObstacles(), now, onPlayerHit);
  updateCamera();
  player.updateFlames(elapsed * 2); // match prior timing scale
  player.updateModelSway(elapsed);
  starfield.update(delta);
  if (planet) planet.rotation.y += delta * 0.005; // slower spin for backdrop planet
  updateCrosshair();
  explosions.update(delta);

  hud.updateHealth(player.health, PLAYER_CONFIG.maxHealth);
  hud.updateSpeed(player.currentSpeed, PLAYER_CONFIG.baseSpeed, PLAYER_CONFIG.boostMultiplier);

  renderer.render(scene, camera);
}

function updateCamera() {
  const rigOffsets = cameraRigController.getOffsets();
  const throttle = THREE.MathUtils.clamp(player.currentSpeed / (PLAYER_CONFIG.baseSpeed * PLAYER_CONFIG.boostMultiplier), 0, 1);

  // Pull camera back up to ~70% farther at max throttle.
  const basePullback = THREE.MathUtils.lerp(1, 1.7, throttle);
  const topSegment = THREE.MathUtils.clamp((throttle - 0.8) / 0.2, 0, 1);
  const cameraPullback = THREE.MathUtils.lerp(basePullback, basePullback * 2, topSegment); // double effect in last 20%
  const offset = rigOffsets.cameraOffset.clone().multiplyScalar(cameraPullback);

  const desiredPosition = offset.applyQuaternion(player.root.quaternion).add(player.root.position);
  camera.position.lerp(desiredPosition, 0.1);

  const lookTarget = rigOffsets.lookOffset.clone().applyQuaternion(player.root.quaternion).add(player.root.position);
  smoothedLook.lerp(lookTarget, 0.2);
  camera.lookAt(smoothedLook);

  // Blur disabled for clarity at high speed.
  renderer.domElement.style.filter = '';
}

function updateCrosshair() {
  if (!crosshairEl) return;
  // Cast forward from camera to a distant plane to position the crosshair
  const forward = new THREE.Vector3();
  camera.getWorldDirection(forward);
  const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(forward, camera.position.clone().add(forward.multiplyScalar(100)));

  raycaster.setFromCamera(new THREE.Vector2(0, 0), camera);
  const point = raycaster.ray.intersectPlane(plane, new THREE.Vector3());
  if (!point) return;

  const proj = point.project(camera);
  const x = ((proj.x + 1) / 2) * 100;
  const y = ((-proj.y + 1) / 2) * 100;
  crosshairEl.style.left = `${x}%`;
  crosshairEl.style.top = `${y}%`;
}

function onResize() {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
}

function createRenderer(isMobile: boolean): THREE.WebGLRenderer {
  const webgl = new THREE.WebGLRenderer({
    antialias: !isMobile,
    powerPreference: isMobile ? 'low-power' : 'high-performance'
  });
  webgl.setSize(window.innerWidth, window.innerHeight);
  webgl.setPixelRatio(isMobile ? 1 : Math.min(2, window.devicePixelRatio));
  webgl.outputColorSpace = THREE.SRGBColorSpace;
  webgl.shadowMap.enabled = !isMobile;
  document.body.appendChild(webgl.domElement);
  return webgl;
}

function createScene(): THREE.Scene {
  const newScene = new THREE.Scene();
  newScene.background = new THREE.Color(0x02040a);
  newScene.fog = new THREE.FogExp2(0x02040a, 0.0012);
  return newScene;
}

function playBackgroundMusic() {
  if (!musicReady || !bgMusicEl) return;
  bgMusicEl.muted = false;
  bgMusicEl.play()
    .then(() => {
      removeGestureListeners();
    })
    .catch(err => console.error('Music play error', err));
}

const resumeMusicOnInteract = () => {
  userInteracted = true;
  pendingPlayRequest = true;
  if (!musicReady) loadBackgroundMusic();
  playBackgroundMusic();
};

function addGestureListeners() {
  gestureEvents.forEach(evt => {
    window.addEventListener(evt, resumeMusicOnInteract, { passive: true });
  });
}

function removeGestureListeners() {
  gestureEvents.forEach(evt => {
    window.removeEventListener(evt, resumeMusicOnInteract);
  });
}

addGestureListeners();

function loadBackgroundMusic() {
  if (musicLoadStarted) return;
  musicLoadStarted = true;
  if (!bgMusicEl) {
    bgMusicEl = new Audio();
  }
  bgMusicEl.loop = true;
  bgMusicEl.volume = 0.7;
  bgMusicEl.preload = 'auto';
  // inline flag matters for iOS/Safari autoplay after user gesture
  // @ts-ignore
  bgMusicEl.playsInline = true;
  bgMusicEl.src = MUSIC_URL;
  bgMusicEl.load();
  bgMusicEl.addEventListener(
    'canplaythrough',
    () => {
      musicReady = true;
      if (userInteracted || pendingPlayRequest) {
        pendingPlayRequest = false;
        playBackgroundMusic();
      }
    },
    { once: true }
  );

  if (userInteracted || pendingPlayRequest) {
    pendingPlayRequest = false;
    playBackgroundMusic();
  }
}

function hideLoading() {
  if (!loadingEl) return;
  loadingEl.classList.add('hidden');
}

function showControlsModal() {
  if (!controlsModal || !controlsCloseBtn) return;
  controlsModal.classList.remove('hidden');
  controlsCloseBtn.addEventListener('click', () => {
    controlsModal.classList.add('hidden');
  });
}

function onPlayerHit(): void {
  if (immortal) return;
  const destroyed = player.takeDamage(PLAYER_CONFIG.maxHealth * 0.1);
  if (destroyed) {
    explosions.trigger(player.root.position, 18);
  }
}

function buildObstacles(): Obstacle[] {
  const list: Obstacle[] = [{ position: player.root.position, radius: player.collisionRadius + 10 }];
  if (planet) {
    list.push({ position: planet.position, radius: 1200 });
  }
  if (destroyer) {
    list.push({ position: destroyer.position, radius: 420 });
  }
  return list;
}

function bindToggles(): void {
  if (immortalityBtn) {
    immortalityBtn.addEventListener('click', () => {
      immortal = !immortal;
      immortalityBtn.classList.toggle('active', immortal);
      immortalityBtn.textContent = immortal ? 'Niesmiertelnosc: ON' : 'Niesmiertelnosc: OFF';
    });
    immortalityBtn.textContent = 'Niesmiertelnosc: ON';
    immortalityBtn.classList.add('active');
  }

  if (enemyFireBtn) {
    enemyFireBtn.addEventListener('click', () => {
      const active = enemyFireBtn.classList.toggle('active');
      enemyFireBtn.textContent = active ? 'Ogień Wrogow: ON' : 'Ogień Wrogow: OFF';
      enemies.setFireEnabled(active);
    });
    enemyFireBtn.textContent = 'Ogień Wrogow: ON';
    enemyFireBtn.classList.add('active');
  }

  if (enemyExplosionBtn) {
    enemyExplosionBtn.addEventListener('click', () => {
      enemies.debugExplodeOne();
    });
  }
}
