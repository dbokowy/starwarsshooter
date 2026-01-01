import './style.css';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { AudioLoader, AudioListener } from 'three';
import { CAMERA_RIG, PLAY_AREA, PLAYER_CONFIG, ASSETS_PATH } from './config.js';
import { createInputController } from './controls.js';
import { createSpaceDust, createStarfield, loadEnvironment, loadStarDestroyer, setupLights } from './environment.js';
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
const spaceDust = createSpaceDust(scene, IS_MOBILE ? 90 : 160);
let planet: THREE.Object3D | null = null;
let destroyer: THREE.Object3D | null = null;
const cameraRigController = new CameraRigController(CAMERA_RIG, renderer.domElement);
const explosions = new ExplosionManager(loader, scene, ASSETS_PATH, listener, renderer.capabilities.getMaxAnisotropy());
const enemies = new EnemySquadron(loader, scene, ASSETS_PATH, explosions);
const prevPlayerPos = new THREE.Vector3();
const playerDrift = new THREE.Vector3();

const hud = new Hud({
  healthBar: document.getElementById('health-bar'),
  speedBar: document.getElementById('speed-bar')
});
const crosshairEl = document.getElementById('crosshair') as HTMLElement | null;
const loadingEl = document.getElementById('loading') as HTMLElement | null;
const controlsModal = document.getElementById('controls-modal') as HTMLElement | null;
const controlsCloseBtn = document.getElementById('controls-close') as HTMLButtonElement | null;
const testExplosionHandler = (event: KeyboardEvent) => {
  if (event.code === 'KeyT') {
    handlePlayerDestroyed();
  }
};
const immortalityBtn = document.getElementById('toggle-immortal') as HTMLButtonElement | null;
const enemyFireBtn = document.getElementById('toggle-enemy-fire') as HTMLButtonElement | null;
const enemyExplosionBtn = document.getElementById('trigger-enemy-explosion') as HTMLButtonElement | null;
const resultModal = document.getElementById('result-modal') as HTMLElement | null;
const resultMessage = document.getElementById('result-message') as HTMLElement | null;
const resultRetryBtn = document.getElementById('result-retry') as HTMLButtonElement | null;
const fullscreenBtn = document.getElementById('fullscreen-btn') as HTMLButtonElement | null;
let immortal = false;
let gameStarted = false;
let winPending = false;
let winTimer: number | null = null;

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
  audioLoader.load(`${ASSETS_PATH}/plasma_strike.mp3`, buffer => player.setHitSound(buffer));
  audioLoader.load(`${ASSETS_PATH}/explosion-fx-2.mp3`, buffer => explosions.setSoundBuffer(buffer));
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
  prevPlayerPos.copy(player.root.position);

  smoothedLook.copy(player.root.position).add(CAMERA_RIG.lookOffset);
  window.addEventListener('resize', onResize);
  window.addEventListener('keydown', testExplosionHandler);
  bindToggles();
  setupFullscreenToggle();
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
  if (gameStarted && !player.isDestroyed()) {
    enemies.update(delta, player, camera, buildObstacles(), now, onPlayerHit, onEnemyDestroyed);
  }
  updateCamera();
  player.updateFlames(elapsed * 2); // match prior timing scale
  player.updateModelSway(elapsed);
  playerDrift.copy(player.root.position).sub(prevPlayerPos);
  const playerVelocity = playerDrift.clone().divideScalar(Math.max(delta, 0.0001));
  const playerForward = new THREE.Vector3(0, 0, -1).applyQuaternion(player.root.quaternion).normalize();
  spaceDust.update(delta, player.root.position, playerVelocity, playerForward);
  starfield.update(delta, playerDrift);
  prevPlayerPos.copy(player.root.position);
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
  // add subtle speed-based shake
  const shakeStrength = throttle * 0.08;
  const shake = new THREE.Vector3(
    THREE.MathUtils.randFloatSpread(shakeStrength),
    THREE.MathUtils.randFloatSpread(shakeStrength * 0.7),
    THREE.MathUtils.randFloatSpread(shakeStrength * 0.6)
  );

  camera.position.lerp(desiredPosition.add(shake), 0.12);

  const lookTarget = rigOffsets.lookOffset.clone().applyQuaternion(player.root.quaternion).add(player.root.position);
  smoothedLook.lerp(lookTarget, 0.2);
  camera.lookAt(smoothedLook);

  // Dynamic FOV tied to throttle
  const baseFov = 70;
  const targetFov = THREE.MathUtils.lerp(baseFov, baseFov + 10, throttle);
  camera.fov = THREE.MathUtils.lerp(camera.fov, targetFov, 0.1);
  camera.updateProjectionMatrix();

  renderer.domElement.style.filter = '';
}

function updateCrosshair() {
  if (!crosshairEl) return;
  // Anchor the crosshair near the laser convergence line (forward of the muzzle cluster)
  const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(player.root.quaternion).normalize();
  const muzzleAverage = PLAYER_CONFIG.muzzleOffsets
    .reduce((acc, v) => acc.add(v), new THREE.Vector3())
    .multiplyScalar(1 / PLAYER_CONFIG.muzzleOffsets.length)
    .applyQuaternion(player.root.quaternion);
  const aimOrigin = player.root.position.clone().add(muzzleAverage);
  const aimDistance = 180; // closer to pull reticle down toward laser convergence
  const verticalNudge = new THREE.Vector3(0, -1, 0).applyQuaternion(player.root.quaternion).multiplyScalar(6); // slight drop
  const aimPoint = aimOrigin
    .clone()
    .add(forward.clone().multiplyScalar(aimDistance))
    .add(verticalNudge);

  const projBase = aimPoint.project(camera);
  const baseX = ((projBase.x + 1) / 2) * 100;
  const baseY = ((-projBase.y + 1) / 2) * 100;
  crosshairEl.style.left = `${baseX}%`;
  crosshairEl.style.top = `${baseY}%`;
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
    startGame();
  });
}

function onPlayerHit(): void {
  if (immortal) return;
  const damage = PLAYER_CONFIG.maxHealth * 0.05; // 1/20th of max
  const destroyed = player.takeDamage(damage);
  if (destroyed) {
    handlePlayerDestroyed();
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

function onEnemyDestroyed(): void {
  if (enemies.getCount() === 0 && !winPending && !player.isDestroyed()) {
    handleVictory();
  }
}

function startGame(): void {
  gameStarted = true;
  enemies.setActive(true);
  enemies.setFireEnabled(true);
  if (resultModal) resultModal.classList.add('hidden');
  clearWinTimer();
  winPending = false;
}

function showResult(text: string, isLoss: boolean): void {
  if (!resultModal || !resultMessage) return;
  resultMessage.textContent = text;
  resultModal.classList.remove('hidden');
  if (resultRetryBtn) {
    resultRetryBtn.style.display = 'block';
    resultRetryBtn.textContent = 'Zagraj ponownie';
  }
  enemies.setActive(false);
  enemies.setFireEnabled(false);
}

function clearWinTimer(): void {
  if (winTimer !== null) {
    window.clearTimeout(winTimer);
    winTimer = null;
  }
}

function bindToggles(): void {
  if (immortalityBtn) {
    immortalityBtn.addEventListener('click', () => {
      immortal = !immortal;
      immortalityBtn.classList.toggle('active', immortal);
      immortalityBtn.textContent = immortal ? 'Niesmiertelnosc: ON' : 'Niesmiertelnosc: OFF';
    });
    immortalityBtn.textContent = 'Niesmiertelnosc: OFF';
    immortalityBtn.classList.remove('active');
  }

  if (enemyFireBtn) {
    enemyFireBtn.addEventListener('click', () => {
      const active = enemyFireBtn.classList.toggle('active');
      enemyFireBtn.textContent = active ? 'Ogien Wrogow: ON' : 'Ogien Wrogow: OFF';
      enemies.setFireEnabled(active);
    });
    enemyFireBtn.textContent = 'Ogien Wrogow: ON';
    enemyFireBtn.classList.add('active');
  }

  if (enemyExplosionBtn) {
    enemyExplosionBtn.addEventListener('click', () => {
      enemies.debugExplodeOne();
    });
  }

  if (resultRetryBtn) {
    resultRetryBtn.addEventListener('click', () => {
      restartGame();
    });
  }
}

function handlePlayerDestroyed(): void {
  if (!player.isDestroyed()) {
    player.destroy();
  }
  explosions.trigger(player.root.position, 18);
  enemies.setFireEnabled(false);
  gameStarted = false;
  clearWinTimer();
  showResult('Przegrana', true);
}

function handleVictory(): void {
  winPending = false;
  clearWinTimer();
  showResult('Zwyciestwo', false);
}

function setupFullscreenToggle(): void {
  if (!fullscreenBtn) return;
  const updateState = () => {
    fullscreenBtn.classList.toggle('active', !!document.fullscreenElement);
  };
  fullscreenBtn.addEventListener('click', () => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().catch(() => undefined);
    } else if (document.exitFullscreen) {
      document.exitFullscreen().catch(() => undefined);
    }
  });
  document.addEventListener('fullscreenchange', updateState);
  updateState();
}

async function restartGame(): Promise<void> {
  clearWinTimer();
  winPending = false;
  gameStarted = false;
  if (resultModal) resultModal.classList.add('hidden');
  player.reset();
  await enemies.reset(2, player, destroyer ? destroyer.position : undefined);
  startGame();
}
