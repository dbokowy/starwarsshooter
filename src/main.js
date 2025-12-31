import './style.css';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

const ASSETS = '/assets';

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.shadowMap.enabled = true;
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x02040a);
scene.fog = new THREE.FogExp2(0x02040a, 0.0012);

const camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.1, 25000);

const clock = new THREE.Clock();
const loader = new GLTFLoader();

const player = new THREE.Object3D();
scene.add(player);
player.position.set(0, 0, 40);

let playerModel = null;
const cameraOffset = new THREE.Vector3(0, 2.7, 14);
const lookOffset = new THREE.Vector3(0, 1.5, -14);
const smoothedLook = new THREE.Vector3();
const engineFlames = [];

const input = { left: false, right: false, pitchUp: false, pitchDown: false, up: false, down: false, boost: false };
const bullets = [];
let lastShot = 0;

const maxHealth = 100;
let health = maxHealth;
const baseSpeed = 46;
const strafeSpeed = 18;
const boostMultiplier = 1.8;
let currentSpeed = baseSpeed;
const playArea = {
  minZ: -2500,
  maxZ: 800,
  maxX: 1200,
  minX: -1200,
  maxY: 800,
  minY: -800
};

let planet = null;
let starGroup = null;

const healthBar = document.getElementById('health-bar');
const speedBar = document.getElementById('speed-bar');

init();

function init() {
  setupLights();
  createStarfield();
  loadEnvironment();
  loadPlayer();
  bindControls();
  smoothedLook.copy(player.position).add(lookOffset);
  window.addEventListener('resize', onResize);
  onResize();
  renderer.setAnimationLoop(update);
}

function setupLights() {
  scene.add(new THREE.HemisphereLight(0x406080, 0x080810, 0.9));

  const keyLight = new THREE.DirectionalLight(0xffffff, 1.1);
  keyLight.position.set(25, 60, 20);
  keyLight.castShadow = true;
  keyLight.shadow.bias = -0.0002;
  keyLight.shadow.mapSize.set(2048, 2048);
  keyLight.shadow.camera.far = 600;
  scene.add(keyLight);

  const rimLight = new THREE.DirectionalLight(0x6fc2ff, 0.4);
  rimLight.position.set(-40, -10, -60);
  scene.add(rimLight);
}

function createStarfield() {
  starGroup = new THREE.Group();

  const fillShell = (count, minRadius, maxRadius) => {
    const positions = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      const r = THREE.MathUtils.randFloat(minRadius, maxRadius);
      const theta = THREE.MathUtils.randFloat(0, Math.PI * 2);
      const phi = Math.acos(THREE.MathUtils.randFloatSpread(2)); // uniform sphere distribution
      const x = r * Math.sin(phi) * Math.cos(theta);
      const y = r * Math.sin(phi) * Math.sin(theta);
      const z = r * Math.cos(phi);
      positions[i * 3] = x;
      positions[i * 3 + 1] = y;
      positions[i * 3 + 2] = z;
    }
    return positions;
  };

  const makeLayer = ({ count, size, minRadius, maxRadius, color, opacity }) => {
    const positions = new Float32Array(count * 3);
    fillShell(count, minRadius, maxRadius).forEach((v, idx) => {
      positions[idx] = v;
    });

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));

    const material = new THREE.PointsMaterial({
      color,
      size,
      sizeAttenuation: true,
      transparent: true,
      opacity,
      depthWrite: false,
      fog: false
    });

    const points = new THREE.Points(geometry, material);
    starGroup.add(points);
  };

  // Fine star dust far away.
  makeLayer({
    count: 2400,
    size: 0.9,
    minRadius: 9000,
    maxRadius: 18000,
    color: 0xcde7ff,
    opacity: 0.7
  });

  // Medium glints closer but still unreachable.
  makeLayer({
    count: 900,
    size: 1.5,
    minRadius: 7000,
    maxRadius: 15000,
    color: 0x9fd5ff,
    opacity: 0.85
  });

  // Brighter hero stars.
  makeLayer({
    count: 260,
    size: 2.6,
    minRadius: 6000,
    maxRadius: 13000,
    color: 0xffffff,
    opacity: 0.95
  });

  scene.add(starGroup);
}

function loadModel(path) {
  return new Promise((resolve, reject) => {
    loader.load(
      path,
      gltf => {
        gltf.scene.traverse(child => {
          if (child.isMesh) {
            child.castShadow = true;
            child.receiveShadow = true;
          }
        });
        resolve(gltf.scene);
      },
      undefined,
      reject
    );
  });
}

function loadEnvironment() {
  loadModel(`${ASSETS}/planet_of_phoenix/scene.gltf`)
    .then(model => {
      planet = model;
      planet.scale.setScalar(80);
      planet.position.set(-1200, -240, -10000);
      planet.rotation.y = Math.PI * 0.2;
      scene.add(planet);
    })
    .catch(console.error);
}

function loadPlayer() {
  loadModel(`${ASSETS}/x-wing-thruster-glow/scene.gltf`)
    .then(model => {
      playerModel = model;
      model.scale.setScalar(0.575); // ~15% larger for closer framing
      model.rotation.set(-Math.PI / 20, Math.PI / 12, 0); // pitch ~5° up, yaw ~15° left
      player.add(model);
      createEngineFlames();d
    })
    .catch(console.error);
}

function bindControls() {
  window.addEventListener('keydown', event => setInput(event.code, true));
  window.addEventListener('keyup', event => setInput(event.code, false));
  renderer.domElement.addEventListener('pointerdown', shoot);
}

function setInput(code, isDown) {
  switch (code) {
    case 'KeyW':
    case 'ArrowUp':
      input.pitchUp = isDown;
      break;
    case 'KeyS':
    case 'ArrowDown':
      input.pitchDown = isDown;
      break;
    case 'KeyA':
    case 'ArrowLeft':
      input.left = isDown;
      break;
    case 'KeyD':
    case 'ArrowRight':
      input.right = isDown;
      break;
    case 'Space':
    case 'KeyR':
      input.up = isDown;
      break;
    case 'ControlLeft':
    case 'KeyF':
      input.down = isDown;
      break;
    case 'ShiftLeft':
    case 'ShiftRight':
      input.boost = isDown;
      break;
    default:
      break;
  }
}

function shoot() {
  if (!playerModel) return;

  const now = performance.now();
  if (now - lastShot < 160) return;
  lastShot = now;

  const muzzleOffsets = [
    new THREE.Vector3(1.6, 0.15, -1.8), // upper right cannon
    new THREE.Vector3(1.6, -0.35, -1.8), // lower right cannon
    new THREE.Vector3(-1.6, 0.15, -1.8), // upper left cannon
    new THREE.Vector3(-1.6, -0.35, -1.8) // lower left cannon
  ];

  const coreGeometry = new THREE.BoxGeometry(0.08, 0.08, 3.6);
  const glowGeometry = new THREE.BoxGeometry(0.18, 0.18, 3.6);
  const coreMaterial = new THREE.MeshBasicMaterial({
    color: 0xff4d4d,
    transparent: true,
    opacity: 0.95,
    blending: THREE.AdditiveBlending,
    depthWrite: false
  });
  const glowMaterial = new THREE.MeshBasicMaterial({
    color: 0xffb194,
    transparent: true,
    opacity: 0.35,
    blending: THREE.AdditiveBlending,
    depthWrite: false
  });

  muzzleOffsets.forEach(offset => {
    const core = new THREE.Mesh(coreGeometry, coreMaterial);
    const glow = new THREE.Mesh(glowGeometry, glowMaterial);
    const laser = new THREE.Group();
    laser.add(core);
    laser.add(glow);

    const worldOffset = offset.clone().applyQuaternion(player.quaternion);
    laser.position.copy(player.position).add(worldOffset);
    laser.quaternion.copy(player.quaternion);
    laser.position.add(new THREE.Vector3(0, 0, -1).applyQuaternion(player.quaternion));

    const velocity = new THREE.Vector3(0, 0, -1)
      .applyQuaternion(player.quaternion)
      .multiplyScalar(320);

    bullets.push({ mesh: laser, velocity, life: 2 });
    scene.add(laser);
  });
}

function update() {
  const delta = clock.getDelta();

  updatePlayer(delta);
  updateBullets(delta);
  updateCamera(delta);
  updateEngineFlames(delta);
  updateHud();

  if (planet) planet.rotation.y += delta * 0.05;
  if (starGroup) starGroup.rotation.y += delta * 0.01;

  renderer.render(scene, camera);
}

function updatePlayer(delta) {
  if (!playerModel) return;

  const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(player.quaternion).normalize();
  const right = new THREE.Vector3(1, 0, 0).applyQuaternion(player.quaternion).normalize();
  const up = new THREE.Vector3(0, 1, 0).applyQuaternion(player.quaternion).normalize();

  const targetSpeed = baseSpeed * (input.boost ? boostMultiplier : 1);
  const accelRate = 0.75; // base acceleration factor
  const baseSmoothing = 1 - Math.exp(-accelRate * delta);
  const easeOut = 1 - Math.pow(1 - baseSmoothing, 2.2); // snappier at start, slower near target
  currentSpeed = THREE.MathUtils.lerp(currentSpeed, targetSpeed, easeOut);

  const move = new THREE.Vector3();
  move.addScaledVector(forward, currentSpeed);
  move.addScaledVector(right, strafeSpeed * ((input.right ? 1 : 0) - (input.left ? 1 : 0)));
  move.addScaledVector(up, strafeSpeed * ((input.up ? 1 : 0) - (input.down ? 1 : 0)));

  player.position.addScaledVector(move, delta);

  const yawChange = ((input.left ? 1 : 0) - (input.right ? 1 : 0)) * delta * 1.3;
  const pitchChange = ((input.pitchUp ? 1 : 0) - (input.pitchDown ? 1 : 0)) * delta * 1.3;

  player.rotation.y += yawChange;
  player.rotation.x = THREE.MathUtils.clamp(player.rotation.x + pitchChange, -Math.PI / 3, Math.PI / 3);

  const targetRoll = THREE.MathUtils.clamp(((input.left ? 1 : 0) - (input.right ? 1 : 0)) * 0.4, -0.6, 0.6);
  player.rotation.z = THREE.MathUtils.lerp(player.rotation.z, targetRoll, 0.1);

  player.position.z = Math.max(playArea.minZ, Math.min(playArea.maxZ, player.position.z));
  player.position.x = Math.max(playArea.minX, Math.min(playArea.maxX, player.position.x));
  player.position.y = Math.max(playArea.minY, Math.min(playArea.maxY, player.position.y));
}

function updateBullets(delta) {
  for (let i = bullets.length - 1; i >= 0; i--) {
    const bullet = bullets[i];
    bullet.mesh.position.addScaledVector(bullet.velocity, delta);
    bullet.life -= delta;

    if (bullet.life <= 0) {
      scene.remove(bullet.mesh);
      bullets.splice(i, 1);
    }
  }
}

function updateCamera(delta) {
  const desiredPosition = cameraOffset.clone().applyQuaternion(player.quaternion).add(player.position);
  camera.position.lerp(desiredPosition, 0.1);

  const lookTarget = lookOffset.clone().applyQuaternion(player.quaternion).add(player.position);
  smoothedLook.lerp(lookTarget, 0.2);
  camera.lookAt(smoothedLook);
}

function createEngineFlames() {
  const coreMaterial = new THREE.MeshBasicMaterial({
    color: 0xfff2cc,
    transparent: true,
    opacity: 0.92,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide
  });

  const glowMaterial = new THREE.MeshBasicMaterial({
    color: 0xff7547,
    transparent: true,
    opacity: 0.34,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide
  });

  const coreGeometry = new THREE.ConeGeometry(0.38, 2.6, 18, 1, true);
  const glowGeometry = new THREE.ConeGeometry(0.75, 4.2, 18, 1, true);

  const offsets = [
    new THREE.Vector3(1.4, 0.3605, 2.244), // upper right engine (y +3%, z +2%)
    new THREE.Vector3(1.4, -0.385, 2.244), // lower right engine (y -10%, z +2%)
    new THREE.Vector3(-1.4, 0.3605, 2.244), // upper left engine (y +3%, z +2%)
    new THREE.Vector3(-1.4, -0.385, 2.244) // lower left engine (y -10%, z +2%)
  ];

  offsets.forEach(offset => {
    const flame = new THREE.Group();
    flame.rotation.x = -Math.PI / 2;
    flame.userData.offset = offset.clone();
    flame.userData.baseRadius = 0.55;
    flame.userData.baseLength = 1;

    const core = new THREE.Mesh(coreGeometry, coreMaterial.clone());
    const glow = new THREE.Mesh(glowGeometry, glowMaterial.clone());
    glow.position.y = 0.15; // trail glow slightly behind core

    flame.add(glow);
    flame.add(core);

    player.add(flame);
    engineFlames.push(flame);
  });
}

function updateEngineFlames(delta) {
  if (!engineFlames.length) return;

  const time = performance.now() * 0.002;
  const boostNorm = THREE.MathUtils.clamp(
    (currentSpeed - baseSpeed) / (baseSpeed * (boostMultiplier - 1)),
    0,
    1
  );
  const flare = 0.25 + boostNorm * 0.95;

  engineFlames.forEach((flame, idx) => {
    flame.position.copy(flame.userData.offset);

    const flicker = 1 + Math.sin(time * 1.8 + idx * 0.7) * 0.06 + Math.random() * 0.04;
    const lengthScale = THREE.MathUtils.lerp(1.1, 3.4, flare) * flicker;
    const radiusScale = THREE.MathUtils.lerp(0.65, 1.6, flare) * flicker;
    flame.scale.set(
      flame.userData.baseRadius * radiusScale,
      flame.userData.baseLength * lengthScale,
      flame.userData.baseRadius * radiusScale
    );

    const targetOpacity = THREE.MathUtils.lerp(0.18, 0.85, flare);
    flame.children.forEach(child => {
      child.material.opacity = THREE.MathUtils.lerp(child.material.opacity, targetOpacity, 0.2);
    });
  });
}

function updateHud() {
  if (healthBar) {
    const pct = Math.max(0, health) / maxHealth;
    healthBar.style.width = `${pct * 100}%`;
  }

  if (speedBar) {
    const minSpeed = baseSpeed;
    const maxSpeed = baseSpeed * boostMultiplier;
    const norm = THREE.MathUtils.clamp((currentSpeed - minSpeed) / (maxSpeed - minSpeed), 0, 1);
    const adjusted = 0.3 + norm * 0.7; // start at 30%, max 100%
    speedBar.style.width = `${adjusted * 100}%`;
  }
}

function onResize() {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
}
