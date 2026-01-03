import './style.css';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { AudioLoader, AudioListener } from 'three';
import { CAMERA_RIG, PLAY_AREA, PLAYER_CONFIG, ASSETS_PATH } from './config.js';
import { createInputController } from './controls.js';
import { createSpaceDust, createStarfield, createSun, loadEnvironment, loadStarDestroyer, setupLights } from './environment.js';
import { clone } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { Hud } from './hud.js';
import { PlayerController } from './player.js';
import { CameraRigController } from './camera.js';
import { ExplosionManager } from './explosions.js';
import { EnemySquadron, EnemyType, Obstacle } from './enemy.js';

const IS_MOBILE = window.matchMedia('(pointer: coarse)').matches || navigator.maxTouchPoints > 1;
const loadingManager = new THREE.LoadingManager();
const renderer = createRenderer(IS_MOBILE);
const scene = createScene();
const camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.1, 25000);
const listener = new AudioListener();
camera.add(listener);
scene.add(camera);
const clock = new THREE.Clock();
const loader = new GLTFLoader(loadingManager);
const audioLoader = new AudioLoader(loadingManager);
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
let sun: THREE.Mesh | null = null;
type Asteroid = { mesh: THREE.Object3D; radius: number };
const asteroids: Asteroid[] = [];
type AsteroidPrefab = { scene: THREE.Object3D; radius: number };
const asteroidPrefabs: AsteroidPrefab[] = [];
let highlightAsteroids = false;
const cameraRigController = new CameraRigController(CAMERA_RIG, renderer.domElement);
const frustum = new THREE.Frustum();
const projScreenMatrix = new THREE.Matrix4();
const explosions = new ExplosionManager(loader, scene, ASSETS_PATH, listener, renderer.capabilities.getMaxAnisotropy());
const enemies = new EnemySquadron(loader, scene, ASSETS_PATH, explosions, IS_MOBILE);
const prevPlayerPos = new THREE.Vector3();
const playerDrift = new THREE.Vector3();
const viewForward = new THREE.Vector3();
const viewUp = new THREE.Vector3();
const viewRight = new THREE.Vector3();

const enemyIconsEl = document.getElementById('enemy-icons-list') as HTMLElement | null;
const hud = new Hud({
  healthBar: document.getElementById('health-bar'),
  speedBar: document.getElementById('speed-bar')
});
const crosshairEl = document.getElementById('crosshair') as HTMLElement | null;
const loadingEl = document.getElementById('loading') as HTMLElement | null;
const loadingBarFill = document.querySelector('.loading-bar-fill') as HTMLElement | null;
const loadingTipEl = document.querySelector('.loading-tip') as HTMLElement | null;
const LOADING_TIPS = [
  'Przy dużej liczbie wrogów dobrze jest schować się w pasie asteroidów',
  'Podczas manewru beczki masz 70% mniej szans na trafienie',
  'Statki wroga typu TIE Interceptor sa szybsze i zwrotniejsze od myśliwców TIE Fighter',
  'Boost przyspieszenia powyżej 70% zwiększa dwukrotnie prędkość X-winga i ma 10 sekundowy cooldown'
];
const MIN_LOADING_MS = 4000;
let loadingShownAt = performance.now();
let loadingHidden = false;
const controlsModal = document.getElementById('controls-modal') as HTMLElement | null;
const controlsCloseBtn = document.getElementById('controls-close') as HTMLButtonElement | null;
const fpsEl = document.getElementById('dev-fps') as HTMLElement | null;
let devUiVisible = false;
const toggleDevUi = (visible: boolean) => {
  devUiVisible = visible;
  if (immortalityBtn) immortalityBtn.style.display = visible ? 'inline-flex' : 'none';
  if (enemyFireBtn) enemyFireBtn.style.display = visible ? 'inline-flex' : 'none';
  if (enemyExplosionBtn) enemyExplosionBtn.style.display = visible ? 'inline-flex' : 'none';
  if (asteroidHighlightBtn) asteroidHighlightBtn.style.display = visible ? 'inline-flex' : 'none';
  if (asteroidExplosionBtn) asteroidExplosionBtn.style.display = visible ? 'inline-flex' : 'none';
  if (musicToggleBtn) musicToggleBtn.style.display = visible ? 'inline-flex' : 'none';
  if (fpsEl) fpsEl.style.display = visible ? 'block' : 'none';
};
const devToggleHandler = (event: KeyboardEvent) => {
  if (event.code === 'KeyT') {
    toggleDevUi(!devUiVisible);
  }
};
const immortalityBtn = document.getElementById('toggle-immortal') as HTMLButtonElement | null;
const enemyFireBtn = document.getElementById('toggle-enemy-fire') as HTMLButtonElement | null;
const enemyExplosionBtn = document.getElementById('trigger-enemy-explosion') as HTMLButtonElement | null;
const asteroidHighlightBtn = document.getElementById('toggle-asteroid-highlight') as HTMLButtonElement | null;
const asteroidExplosionBtn = document.getElementById('trigger-asteroid-explosion') as HTMLButtonElement | null;
const musicToggleBtn = document.getElementById('toggle-music') as HTMLButtonElement | null;
const resultModal = document.getElementById('result-modal') as HTMLElement | null;
const resultMessage = document.getElementById('result-message') as HTMLElement | null;
const resultRetryBtn = document.getElementById('result-retry') as HTMLButtonElement | null;
const fullscreenBtn = document.getElementById('fullscreen-btn') as HTMLButtonElement | null;
let immortal = false;
let gameStarted = false;
let winPending = false;
let winTimer: number | null = null;
let firstWaveTimer: number | null = null;
let wave = 1;
let enemiesTotal = 0;
let enemiesDestroyed = 0;
let loopStarted = false;
let arrivalFocusUntil = 0;
let arrivalFocusTarget: THREE.Vector3 | null = null;
const ARRIVAL_CAMERA_MS = 3000;

const smoothedLook = new THREE.Vector3();
const inputController = createInputController(renderer.domElement, () => player.shoot(performance.now()));
const startPosition = new THREE.Vector3(0, 0, 40);
let loadingPct = 0;

function setArrivalFocusFromEnemies(): void {
  const roots = enemies.getEnemyRoots();
  if (!roots.length) {
    arrivalFocusTarget = destroyer ? destroyer.position.clone() : null;
    arrivalFocusUntil = performance.now() + ARRIVAL_CAMERA_MS;
    return;
  }
  const centroid = roots.reduce((acc, obj) => acc.add(obj.position), new THREE.Vector3());
  centroid.multiplyScalar(1 / roots.length);
  arrivalFocusTarget = centroid;
  arrivalFocusUntil = performance.now() + ARRIVAL_CAMERA_MS;
}

init();

loadingManager.onProgress = (_url, loaded, total) => {
  if (!loadingBarFill || !loadingEl) return;
  if (total > 0) {
    const pct = Math.min(100, (loaded / total) * 100);
    loadingPct = Math.max(loadingPct, pct); // never regress
    loadingBarFill.style.width = `${loadingPct}%`;
  }
};
loadingManager.onLoad = () => {
  loadingPct = 100;
  if (loadingBarFill) loadingBarFill.style.width = '100%';
};

async function init() {
  loadingShownAt = performance.now();
  document.body.classList.toggle('is-touch', IS_MOBILE);
  setRandomLoadingTip();
  toggleDevUi(false); // hide dev controls by default
  const sunPos = new THREE.Vector3(-13000, 1600, -9000); // further left, closer in front of planet
  planet = await loadEnvironment(loader, scene, ASSETS_PATH);
  sun = (await createSun(scene, sunPos, 784, loader, ASSETS_PATH, planet)) as THREE.Mesh; // reduced sun size by ~30%
  setupLights(scene, !IS_MOBILE, sunPos.clone().normalize());
  if (!IS_MOBILE) {
    destroyer = await loadStarDestroyer(loader, scene, ASSETS_PATH);
  }
  await spawnAsteroids(200);
  audioLoader.load(`${ASSETS_PATH}/tie-fighter-fire-1.mp3`, buffer => {
    player.setFireSound(buffer);
    enemies.setAudio(listener, buffer);
  });
  audioLoader.load(`${ASSETS_PATH}/plasma_strike.mp3`, buffer => player.setHitSound(buffer));
  audioLoader.load(`${ASSETS_PATH}/xwing_boost.mp3`, buffer => player.setBoostSound(buffer));
  audioLoader.load(`${ASSETS_PATH}/xwing_pass.mp3`, buffer => player.setRollSound(buffer));
  audioLoader.load(`${ASSETS_PATH}/explosion-fx-2.mp3`, buffer => explosions.setSoundBuffer(buffer));
  await explosions.init();
  loadBackgroundMusic();
  await player.loadModel(
    `${ASSETS_PATH}/x-wing-thruster-glow/scene.gltf`,
    new THREE.Euler(0.1745329, Math.PI / 12, -Math.PI / 18),
    0.9337123125,
    new THREE.Vector3(0, -2, 0)
  );
  await enemies.init(1, player, destroyer ? destroyer.position : undefined);
  resetEnemyIcons(enemies.getEnemyTypes());
  setArrivalFocusFromEnemies();
  hideLoading();
  prevPlayerPos.copy(player.root.position);

  smoothedLook.copy(player.root.position).add(CAMERA_RIG.lookOffset);
  window.addEventListener('resize', onResize);
  window.addEventListener('keydown', devToggleHandler);
  bindToggles();
  setupFullscreenToggle();
  onResize();
  renderer.render(scene, camera); // draw initial frame before gameplay starts
  showControlsModal();
}

function update() {
  const delta = clock.getDelta();
  const elapsed = clock.getElapsedTime();
  const now = performance.now();
  if (fpsEl && devUiVisible && delta > 0) {
    fpsEl.textContent = `${(1 / delta).toFixed(0)} fps`;
  }

  camera.getWorldDirection(viewForward);
  viewUp.set(0, 1, 0).applyQuaternion(camera.quaternion).normalize();
  viewRight.crossVectors(viewForward, viewUp).normalize();

  player.update(delta, inputController.state, { up: viewUp, right: viewRight, forward: viewForward });
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
  handleAsteroidBulletHits();
  handleAsteroidCollisions(onEnemyDestroyed);
  updateSunHalo(elapsed);
  prevPlayerPos.copy(player.root.position);
  if (planet) planet.rotation.y += delta * 0.005; // slower spin for backdrop planet
  updateCrosshair();
  explosions.update(delta);

  hud.updateHealth(player.health, PLAYER_CONFIG.maxHealth);
  hud.updateSpeed(player.currentSpeed, PLAYER_CONFIG.baseSpeed, PLAYER_CONFIG.boostMultiplier, player.getBoostRegenRatio());

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
  camera.position.lerp(desiredPosition, 0.12);

  const now = performance.now();
  let lookTarget = rigOffsets.lookOffset.clone().applyQuaternion(player.root.quaternion).add(player.root.position);
  if (arrivalFocusTarget && now < arrivalFocusUntil) {
    lookTarget = arrivalFocusTarget.clone();
  }
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

function updateSunHalo(time: number): void {
  if (!sun) return;
  const halo = sun.getObjectByName('sun-halo') as THREE.Sprite | null;
  if (!halo) return;
  const baseScale = halo.userData.baseScale ?? halo.scale.x;
  const distance = camera.position.distanceTo(sun.position);
  const scaleFactor = THREE.MathUtils.clamp(distance / 6000, 0.6, 3.2);
  const pulsate = 1 + Math.sin(time * 0.6) * 0.06;
  halo.scale.setScalar(baseScale * scaleFactor * pulsate);

  const mat = halo.material as THREE.SpriteMaterial;
  mat.opacity = THREE.MathUtils.clamp(0.5 + Math.sin(time * 0.8) * 0.15, 0.25, 0.8);
  halo.userData.baseScale = baseScale;
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
  webgl.toneMapping = THREE.ACESFilmicToneMapping;
  webgl.toneMappingExposure = 1.1;
  document.body.appendChild(webgl.domElement);
  return webgl;
}

function createScene(): THREE.Scene {
  const newScene = new THREE.Scene();
  newScene.background = new THREE.Color(0x000000);
  newScene.fog = new THREE.FogExp2(0x000000, 0.001);
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
  if (!loadingEl || loadingHidden) return;
  const elapsed = performance.now() - loadingShownAt;
  const delay = Math.max(0, MIN_LOADING_MS - elapsed);
  window.setTimeout(() => {
    if (loadingHidden) return;
    loadingEl.classList.add('hidden');
    loadingHidden = true;
  }, delay);
}

function setRandomLoadingTip(): void {
  if (!loadingTipEl || !LOADING_TIPS.length) return;
  const tip = LOADING_TIPS[Math.floor(Math.random() * LOADING_TIPS.length)];
  loadingTipEl.textContent = tip;
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
  asteroids.forEach(ast => list.push({ position: ast.mesh.position, radius: ast.radius + 8 }));
  return list;
}

function resetEnemyIcons(types: EnemyType[]): void {
  enemiesTotal = types.length;
  enemiesDestroyed = 0;
  if (!enemyIconsEl) return;
  enemyIconsEl.innerHTML = '';
  types.forEach(type => {
    const icon = document.createElement('div');
    icon.className = 'enemy-icon';
    if (type === EnemyType.Interceptor) {
      icon.classList.add('interceptor');
    }
    enemyIconsEl.appendChild(icon);
  });
}

function markEnemyDestroyed(type: EnemyType): void {
  if (!enemyIconsEl || !enemiesTotal) return;
  const selector =
    type === EnemyType.Interceptor ? '.enemy-icon.interceptor:not(.down)' : '.enemy-icon:not(.interceptor):not(.down)';
  const icon = enemyIconsEl.querySelector(selector) as HTMLElement | null;
  if (icon) {
    icon.classList.add('down');
  } else {
    const fallback = enemyIconsEl.querySelector('.enemy-icon:not(.down)') as HTMLElement | null;
    fallback?.classList.add('down');
  }
  enemiesDestroyed = Math.min(enemiesDestroyed + 1, enemiesTotal);
}

function onEnemyDestroyed(type: EnemyType): void {
  markEnemyDestroyed(type);
  if (enemies.getCount() === 0 && !winPending && !player.isDestroyed()) {
    advanceWave();
  }
}

function startGame(): void {
  gameStarted = true;
  if (!loopStarted) {
    clock.start(); // reset delta so first frame isn't huge
    renderer.setAnimationLoop(update);
    loopStarted = true;
  }
  clearWinTimer();
  enemies.setActive(false);
  enemies.setFireEnabled(false);
  if (firstWaveTimer !== null) {
    window.clearTimeout(firstWaveTimer);
  }
  firstWaveTimer = window.setTimeout(() => {
    enemies.setActive(true);
    enemies.setFireEnabled(true);
    setArrivalFocusFromEnemies();
  }, 5000);
  if (resultModal) resultModal.classList.add('hidden');
  winPending = false;
  wave = 1;
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
  if (firstWaveTimer !== null) {
    window.clearTimeout(firstWaveTimer);
    firstWaveTimer = null;
  }
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
      const before = enemies.getCount();
      const type = enemies.debugExplodeOne();
      if (enemies.getCount() < before && type) {
        onEnemyDestroyed(type);
      }
    });
  }

  if (asteroidHighlightBtn) {
    asteroidHighlightBtn.addEventListener('click', () => {
      highlightAsteroids = !highlightAsteroids;
      asteroidHighlightBtn.classList.toggle('active', highlightAsteroids);
      asteroidHighlightBtn.textContent = highlightAsteroids ? 'Podswietl asteroidy: ON' : 'Podswietl asteroidy: OFF';
      applyAsteroidHighlight(highlightAsteroids);
    });
    asteroidHighlightBtn.textContent = 'Podswietl asteroidy: OFF';
  }

  if (asteroidExplosionBtn) {
    asteroidExplosionBtn.addEventListener('click', () => {
      const idx = getNearestAsteroidInView(camera);
      if (idx === -1) return;
      const ast = asteroids[idx];
      explosions.trigger(ast.mesh.position, ast.radius * 1.4, undefined, { scaleMultiplier: 1 / 3, intensity: 1 });
      removeAsteroid(idx);
    });
  }

  if (resultRetryBtn) {
    resultRetryBtn.addEventListener('click', () => {
      restartGame();
    });
  }

  if (musicToggleBtn) {
    musicToggleBtn.addEventListener('click', () => {
      if (!bgMusicEl) return;
      const enabled = !(bgMusicEl.muted ?? false);
      bgMusicEl.muted = enabled;
      musicToggleBtn.classList.toggle('active', !enabled);
      musicToggleBtn.textContent = enabled ? 'Muzyka: OFF' : 'Muzyka: ON';
      if (!enabled && musicReady && !bgMusicEl.paused) {
        // ensure playback resumes if already loaded
        bgMusicEl.play().catch(() => undefined);
      }
    });
    musicToggleBtn.textContent = 'Muzyka: ON';
    musicToggleBtn.classList.add('active');
  }
}

function handlePlayerDestroyed(skipExplosion: boolean = false): void {
  if (!player.isDestroyed()) {
    player.destroy();
  }
  if (!skipExplosion) {
    const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(player.root.quaternion);
    explosions.trigger(player.root.position, player.collisionRadius * 1.6, forward);
  }
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

function scheduleNextWave(fighters: number, interceptors: number = 0): void {
  clearWinTimer();
  winTimer = window.setTimeout(async () => {
    player.fullyHeal();
    await enemies.reset(fighters, player, destroyer ? destroyer.position : undefined, interceptors);
    resetEnemyIcons(enemies.getEnemyTypes());
    enemies.setActive(true);
    enemies.setFireEnabled(true);
    setArrivalFocusFromEnemies();
  }, 10000);
}

async function advanceWave(): Promise<void> {
  if (wave === 1) {
    wave = 2;
    scheduleNextWave(2); // 2 Fighters
  } else if (wave === 2) {
    wave = 3;
    scheduleNextWave(3); // 3 Fighters
  } else if (wave === 3) {
    wave = 4;
    scheduleNextWave(2, 1); // 2 Fighters + 1 Interceptor
  } else if (wave === 4) {
    wave = 5;
    scheduleNextWave(3, 1); // 3 Fighters + 1 Interceptor
  } else if (wave === 5) {
    wave = 6;
    scheduleNextWave(3, 2); // 3 Fighters + 2 Interceptors
  } else {
    handleVictory();
  }
}

function getNearestAsteroidInView(cam: THREE.Camera): number {
  projScreenMatrix.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);
  frustum.setFromProjectionMatrix(projScreenMatrix);

  let bestIdx = -1;
  let bestDist = Infinity;
  for (let i = 0; i < asteroids.length; i += 1) {
    const pos = asteroids[i].mesh.position;
    if (!frustum.containsPoint(pos)) continue;
    const dist = cam.position.distanceToSquared(pos);
    if (dist < bestDist) {
      bestDist = dist;
      bestIdx = i;
    }
  }
  return bestIdx;
}

async function loadAsteroidPrefabs(): Promise<void> {
  if (asteroidPrefabs.length) return;
  const gltf = await loader.loadAsync(`${ASSETS_PATH}/asteroids_pack_metallic_version/scene.gltf`);
  gltf.scene.updateMatrixWorld(true);

  gltf.scene.traverse(obj => {
    if ('isMesh' in obj && (obj as THREE.Mesh).isMesh) {
      const mesh = obj as THREE.Mesh;
      const meshClone = mesh.clone(true);

      // bake world transform into the clone so each variant is self-contained
      mesh.matrixWorld.decompose(meshClone.position, meshClone.quaternion, meshClone.scale);
      meshClone.updateMatrix();
      meshClone.updateMatrixWorld(true);

      const container = new THREE.Object3D();
      container.add(meshClone);
      const bounds = new THREE.Box3().setFromObject(container);
      const sphere = new THREE.Sphere();
      bounds.getBoundingSphere(sphere);
      asteroidPrefabs.push({ scene: container, radius: sphere.radius || 1 });
    }
  });
}

function randomAsteroidPosition(): THREE.Vector3 {
  const pos = new THREE.Vector3();
  const radius = 1050; // 1.5x previous space dust envelope
  do {
    pos.randomDirection().multiplyScalar(THREE.MathUtils.randFloat(180, radius)).add(startPosition);
  } while (pos.distanceTo(startPosition) < 150); // avoid spawning too close
  return pos;
}

async function spawnAsteroids(count: number): Promise<void> {
  await loadAsteroidPrefabs();
  if (!asteroidPrefabs.length) return;

  for (let i = 0; i < count; i += 1) {
    const prefab = asteroidPrefabs[Math.floor(Math.random() * asteroidPrefabs.length)];
    const roll = Math.random();
    let sizeRand: number;
    if (roll < 0.9) {
      sizeRand = THREE.MathUtils.randFloat(0.1, 2.0); // 90%: 10%–200% X-wing
    } else if (roll < 0.98) {
      sizeRand = THREE.MathUtils.randFloat(2.0, 4.0); // 8%: 200%–400%
    } else {
      sizeRand = THREE.MathUtils.randFloat(4.0, 8.0); // 2%: 400%–800%
    }
    const targetRadius = player.collisionRadius * sizeRand;
    const scale = prefab.radius > 0 ? targetRadius / prefab.radius : 1;
    const rock = clone(prefab.scene);
    rock.scale.setScalar(scale);
    rock.traverse(obj => {
      obj.castShadow = false;
      obj.receiveShadow = false;
      obj.frustumCulled = false;
      // store original materials for highlight toggle
      if ('material' in obj && obj.material) {
        const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
        mats.forEach(mat => {
          const m = mat as THREE.MeshStandardMaterial;
          obj.userData.originalColor = m.color ? m.color.clone() : null;
          obj.userData.originalEmissive = m.emissive ? m.emissive.clone() : null;
        });
      }
    });
    rock.position.copy(randomAsteroidPosition());
    rock.rotation.set(
      THREE.MathUtils.randFloat(0, Math.PI * 2),
      THREE.MathUtils.randFloat(0, Math.PI * 2),
      THREE.MathUtils.randFloat(0, Math.PI * 2)
    );
    scene.add(rock);
    asteroids.push({ mesh: rock, radius: targetRadius });
    if (highlightAsteroids) applyHighlightToRock(rock, true);
  }
}

function removeAsteroid(index: number): void {
  const ast = asteroids[index];
  scene.remove(ast.mesh);
  asteroids.splice(index, 1);
}

function handleAsteroidBulletHits(): void {
  for (let i = asteroids.length - 1; i >= 0; i -= 1) {
    const ast = asteroids[i];
    for (let j = player.bullets.length - 1; j >= 0; j -= 1) {
      const bullet = player.bullets[j];
      const hitRadius = ast.radius + 1.2;
      if (bullet.mesh.position.distanceTo(ast.mesh.position) <= hitRadius) {
        scene.remove(bullet.mesh);
        player.bullets.splice(j, 1);
        explosions.trigger(ast.mesh.position, ast.radius * 1.4, undefined, { scaleMultiplier: 1 / 3, intensity: 1 });
        removeAsteroid(i);
        break;
      }
    }
  }
}

function handleAsteroidCollisions(onEnemyDestroyedCb: (type: EnemyType) => void): void {
  for (let i = asteroids.length - 1; i >= 0; i -= 1) {
    const ast = asteroids[i];
    const pos = ast.mesh.position;

    // player collision
    if (!player.isDestroyed() && pos.distanceTo(player.root.position) <= ast.radius + player.collisionRadius) {
      explosions.trigger(pos, player.collisionRadius * 1.6);
      player.destroy();
      handlePlayerDestroyed(true);
      removeAsteroid(i);
      gameStarted = false;
      if (resultModal) resultModal.classList.remove('hidden');
      if (resultMessage) resultMessage.textContent = 'Przegrana';
      enemies.setActive(false);
      enemies.setFireEnabled(false);
      continue;
    }

    // enemy collisions
    const enemyRoots = enemies.getEnemyRoots();
    let collided = false;
    for (const root of enemyRoots) {
      if (pos.distanceTo(root.position) <= ast.radius + 8) {
        const destroyedType = enemies.destroyEnemyByRoot(root);
        if (destroyedType) {
          explosions.trigger(pos, player.collisionRadius * 1.6, undefined, { scaleMultiplier: 1 / 3, intensity: 1 });
          onEnemyDestroyedCb(destroyedType);
          removeAsteroid(i);
          collided = true;
          break;
        }
      }
    }
    if (collided) continue;
  }
}

function applyHighlightToRock(rock: THREE.Object3D, highlight: boolean): void {
  rock.traverse(obj => {
    if ('material' in obj && obj.material) {
      const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
      mats.forEach(mat => {
        const m = mat as THREE.MeshStandardMaterial;
        if (!m) return;
        if (highlight) {
          if (!obj.userData.originalColor) obj.userData.originalColor = m.color.clone();
          if (!obj.userData.originalEmissive) obj.userData.originalEmissive = m.emissive.clone();
          m.color.set(0xff5555);
          m.emissive.set(0xff2222);
          m.emissiveIntensity = 1.5;
        } else {
          if (obj.userData.originalColor) m.color.copy(obj.userData.originalColor);
          if (obj.userData.originalEmissive) m.emissive.copy(obj.userData.originalEmissive);
          m.emissiveIntensity = 1;
        }
        m.needsUpdate = true;
      });
    }
  });
}

function applyAsteroidHighlight(highlight: boolean): void {
  asteroids.forEach(ast => applyHighlightToRock(ast.mesh, highlight));
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
  wave = 1;
  await enemies.reset(1, player, destroyer ? destroyer.position : undefined);
  resetEnemyIcons(enemies.getEnemyTypes());
  startGame();
}
