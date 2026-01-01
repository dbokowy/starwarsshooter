import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { Box3, Sphere } from 'three';

export type StarLayer = { points: THREE.Points; parallax: number };

export type Starfield = {
  group: THREE.Group;
  update: (delta: number, drift?: THREE.Vector3) => void;
  layers: StarLayer[];
};

export type SpaceDust = {
  points: THREE.Points;
  update: (delta: number, playerPos: THREE.Vector3, playerVel: THREE.Vector3, playerForward: THREE.Vector3) => void;
};

export function setupLights(scene: THREE.Scene, enableShadows: boolean = true, sunDirection: THREE.Vector3 = new THREE.Vector3(0.4, 0.9, 0.3)): void {
  scene.add(new THREE.HemisphereLight(0x406080, 0x080810, 0.9));

  const dir = sunDirection.clone().normalize();
  const keyLight = new THREE.DirectionalLight(0xffffff, 2.32); // +40% vs previous
  keyLight.position.copy(dir.clone().multiplyScalar(200));
  keyLight.target.position.set(0, 0, 0);
  scene.add(keyLight.target);
  keyLight.castShadow = enableShadows;
  keyLight.shadow.bias = -0.0002;
  keyLight.shadow.mapSize.set(enableShadows ? 2048 : 1024, enableShadows ? 2048 : 1024);
  keyLight.shadow.camera.far = 600;
  scene.add(keyLight);

  const rimLight = new THREE.DirectionalLight(0x6fc2ff, 0.4);
  rimLight.position.set(-40, -10, -60);
  scene.add(rimLight);
}

export function createStarfield(scene: THREE.Scene, densityScale: number = 1): Starfield {
  const starGroup = new THREE.Group();
  const density = THREE.MathUtils.clamp(densityScale, 0.2, 1);
  const layers: StarLayer[] = [];

  const fillShell = (count: number, minRadius: number, maxRadius: number): Float32Array => {
    const positions = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      const r = THREE.MathUtils.randFloat(minRadius, maxRadius);
      const theta = THREE.MathUtils.randFloat(0, Math.PI * 2);
      const phi = Math.acos(THREE.MathUtils.randFloatSpread(2));
      const x = r * Math.sin(phi) * Math.cos(theta);
      const y = r * Math.sin(phi) * Math.sin(theta);
      const z = r * Math.cos(phi);
      positions[i * 3] = x;
      positions[i * 3 + 1] = y;
      positions[i * 3 + 2] = z;
    }
    return positions;
  };

  const makeLayer = (opts: { count: number; size: number; minRadius: number; maxRadius: number; color: number; opacity: number; parallax: number }) => {
    const positions = fillShell(Math.floor(opts.count * density), opts.minRadius, opts.maxRadius);
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));

    const material = new THREE.PointsMaterial({
      color: opts.color,
      size: opts.size,
      sizeAttenuation: true,
      transparent: true,
      opacity: opts.opacity,
      depthWrite: false,
      fog: false
    });

    const points = new THREE.Points(geometry, material);
    starGroup.add(points);
    layers.push({ points, parallax: opts.parallax });
  };

  // Four-layer starfield for depth/parallax
  makeLayer({ count: 2200, size: 0.8, minRadius: 11000, maxRadius: 19000, color: 0xbfd8ff, opacity: 0.6, parallax: 0.3 }); // far background
  makeLayer({ count: 1200, size: 1.1, minRadius: 8500, maxRadius: 16000, color: 0xa9d0ff, opacity: 0.75, parallax: 0.55 });
  makeLayer({ count: 520, size: 1.9, minRadius: 6500, maxRadius: 12500, color: 0xddeeff, opacity: 0.9, parallax: 0.9 });
  makeLayer({ count: 220, size: 2.8, minRadius: 5200, maxRadius: 11000, color: 0xffffff, opacity: 0.95, parallax: 1.35 }); // near layer

  scene.add(starGroup);

  return {
    group: starGroup,
    layers,
    update: (delta: number, drift: THREE.Vector3 = new THREE.Vector3()) => {
      starGroup.rotation.y += delta * 0.01;
      // parallax drift opposite to movement to enhance motion depth
      if (drift.lengthSq() > 0) {
        const driftScaled = drift.clone().multiplyScalar(0.4);
        layers.forEach(layer => {
          layer.points.position.addScaledVector(driftScaled, -layer.parallax);
        });
      }
    }
  };
}

export function createSun(scene: THREE.Scene, position: THREE.Vector3, radius: number = 600): THREE.Object3D {
  // emissive sphere (core)
  const sunGeom = new THREE.SphereGeometry(radius * 0.3, 48, 48); // small solid core, mostly hidden by glow
  const sunMat = new THREE.MeshBasicMaterial({
    color: 0x000000,
    emissive: 0x000000,
    emissiveIntensity: 0,
    transparent: true,
    opacity: 0,
    fog: false
  });
  const sunMesh = new THREE.Mesh(sunGeom, sunMat);
  sunMesh.position.set(0, 0, 0);
  sunMesh.frustumCulled = false;
  sunMesh.renderOrder = 2;

  // soft core glow sprite to blur the center
  const coreMat = new THREE.SpriteMaterial({
    map: getCoreTexture(),
    color: 0xfff4d0,
    transparent: true,
    opacity: 0.9,
    alphaTest: 0.01,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    depthTest: false,
    fog: false
  });
  const coreSprite = new THREE.Sprite(coreMat);
  const coreScale = radius * 6; // soft core glow
  coreSprite.scale.set(coreScale, coreScale, 1);
  coreSprite.renderOrder = 4;
  coreSprite.frustumCulled = false;

  // halo sprite
  const haloMat = new THREE.SpriteMaterial({
    map: getHaloTexture(),
    color: 0xffd890,
    transparent: true,
    opacity: 0.28,
    alphaTest: 0.01,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    depthTest: false,
    fog: false
  });
  const halo = new THREE.Sprite(haloMat);
  const haloScale = radius * 12; // wider falloff
  halo.scale.set(haloScale, haloScale, 1);
  halo.renderOrder = 5;
  halo.frustumCulled = false;
  halo.name = 'sun-halo';

  const sunGroup = new THREE.Group();
  sunGroup.add(halo);
  sunGroup.add(coreSprite);
  sunGroup.add(sunMesh);
  sunGroup.position.copy(position);
  sunGroup.frustumCulled = false;
  scene.add(sunGroup);
  return sunGroup;
}

let cachedHaloTexture: THREE.Texture | null = null;
function getHaloTexture(): THREE.Texture {
  if (cachedHaloTexture) return cachedHaloTexture;
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    const grad = ctx.createRadialGradient(size / 2, size / 2, size * 0.05, size / 2, size / 2, size * 0.6);
    grad.addColorStop(0, 'rgba(255, 255, 255, 0.7)');
    grad.addColorStop(0.2, 'rgba(255, 230, 180, 0.5)');
    grad.addColorStop(0.5, 'rgba(255, 200, 120, 0.22)');
    grad.addColorStop(1, 'rgba(255, 200, 120, 0)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, size, size);
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.encoding = THREE.sRGBColorSpace;
  tex.generateMipmaps = false;
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.needsUpdate = true;
  cachedHaloTexture = tex;
  return tex;
}

let cachedCoreTexture: THREE.Texture | null = null;
function getCoreTexture(): THREE.Texture {
  if (cachedCoreTexture) return cachedCoreTexture;
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    const grad = ctx.createRadialGradient(size / 2, size / 2, size * 0.02, size / 2, size / 2, size * 0.6);
    grad.addColorStop(0, 'rgba(255,255,255,0.85)');
    grad.addColorStop(0.2, 'rgba(255, 235, 190, 0.7)');
    grad.addColorStop(0.45, 'rgba(255, 210, 150, 0.45)');
    grad.addColorStop(1, 'rgba(255, 200, 120, 0)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, size, size);
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.encoding = THREE.sRGBColorSpace;
  tex.generateMipmaps = false;
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.needsUpdate = true;
  cachedCoreTexture = tex;
  return tex;
}

export function createSpaceDust(
  scene: THREE.Scene,
  count: number = 120,
  radius: number = 700,
  size: number = 0.7
): SpaceDust {
  const positions = new Float32Array(count * 3);
  const temp = new THREE.Vector3();
  const playerOffset = new THREE.Vector3();
  const randomDir = () => new THREE.Vector3().randomDirection().multiplyScalar(0.55).add(new THREE.Vector3(0, 0, 1)).normalize();

  const respawn = (i: number, playerPos: THREE.Vector3, forward: THREE.Vector3) => {
    const spread = randomDir().add(forward.clone().multiplyScalar(2)).normalize();
    const dist = radius * (0.5 + Math.random() * 0.5);
    const pos = playerPos.clone().add(spread.multiplyScalar(dist));
    positions[i * 3] = pos.x;
    positions[i * 3 + 1] = pos.y;
    positions[i * 3 + 2] = pos.z;
  };

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  const material = new THREE.PointsMaterial({
    color: 0x6f7072, // neutral gray
    size,
    sizeAttenuation: true,
    transparent: true,
    opacity: 0.65,
    depthWrite: false
  });
  const points = new THREE.Points(geometry, material);
  points.renderOrder = 2;
  scene.add(points);

  const positionsVec: THREE.Vector3[] = new Array(count)
    .fill(0)
    .map(() => new THREE.Vector3());
  for (let i = 0; i < count; i += 1) {
    respawn(i, new THREE.Vector3(), new THREE.Vector3(0, 0, -1));
    positionsVec[i].set(positions[i * 3], positions[i * 3 + 1], positions[i * 3 + 2]);
  }

  return {
    points,
    update: (delta: number, playerPos: THREE.Vector3, playerVel: THREE.Vector3, playerForward: THREE.Vector3) => {
      const velScale = playerVel.length();
      const forward = playerForward.clone().normalize();
      material.opacity = 0.7;

      for (let i = 0; i < count; i += 1) {
        const pos = positionsVec[i];
        pos.addScaledVector(playerVel, -delta * 1.45);
        pos.addScaledVector(forward, -delta * velScale * 0.12);
        pos.addScaledVector(randomDir(), delta * 6); // slight jitter

        playerOffset.copy(pos).sub(playerPos);
        if (playerOffset.lengthSq() > radius * radius || playerOffset.dot(forward) < -radius * 0.3) {
          respawn(i, playerPos, forward);
          positionsVec[i].set(positions[i * 3], positions[i * 3 + 1], positions[i * 3 + 2]);
        } else {
          positions[i * 3] = pos.x;
          positions[i * 3 + 1] = pos.y;
          positions[i * 3 + 2] = pos.z;
        }
      }
      geometry.attributes.position.needsUpdate = true;
    }
  };
}

export function loadModel(loader: GLTFLoader, path: string): Promise<THREE.Object3D> {
  return new Promise((resolve, reject) => {
    loader.load(
      path,
      gltf => {
        gltf.scene.traverse(child => {
          if ('isMesh' in child && child.isMesh) {
            child.castShadow = true;
            child.receiveShadow = true;
          }
        });
        resolve(gltf.scene);
      },
      undefined,
      error => reject(error)
    );
  });
}

export async function loadEnvironment(loader: GLTFLoader, scene: THREE.Scene, assetsPath: string): Promise<THREE.Object3D | null> {
  try {
    const model = await loadModel(loader, `${assetsPath}/planet_of_phoenix/scene.gltf`);
    model.scale.setScalar(2646); // half the previous size
    model.position.set(0, -2000, -12000); // keep distance, smaller apparent size
    model.rotation.y = Math.PI * 0.2;
    model.traverse(obj => {
      if ('material' in obj && obj.material) {
        const mat = obj.material as THREE.Material & { fog?: boolean };
        mat.fog = false; // keep planet clear through scene fog
      }
    });
    scene.add(model);
    return model;
  } catch (error) {
    console.error(error);
    return null;
  }
}

export async function loadStarDestroyer(loader: GLTFLoader, scene: THREE.Scene, assetsPath: string): Promise<THREE.Object3D | null> {
  try {
    const model = await loadModel(loader, `${assetsPath}/destructor_pesado_imperial_isd_1/scene.gltf`);
    model.scale.setScalar(30); // ~1/30 of original planet-relative size
    model.position.set(20000, -120, 7000); // ~30x farther than initial placement
    model.rotation.y = -Math.PI / 8;
    model.traverse(obj => {
      if ('material' in obj && obj.material) {
        const mat = obj.material as THREE.Material & { fog?: boolean };
        mat.fog = false;
      }
    });
    scene.add(model);
    return model;
  } catch (error) {
    console.error(error);
    return null;
  }
}
