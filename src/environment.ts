import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

export type Starfield = {
  group: THREE.Group;
  update: (delta: number) => void;
};

export function setupLights(scene: THREE.Scene): void {
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

export function createStarfield(scene: THREE.Scene): Starfield {
  const starGroup = new THREE.Group();

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

  const makeLayer = (opts: { count: number; size: number; minRadius: number; maxRadius: number; color: number; opacity: number }) => {
    const positions = fillShell(opts.count, opts.minRadius, opts.maxRadius);
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
  };

  makeLayer({ count: 2400, size: 0.9, minRadius: 9000, maxRadius: 18000, color: 0xcde7ff, opacity: 0.7 });
  makeLayer({ count: 900, size: 1.5, minRadius: 7000, maxRadius: 15000, color: 0x9fd5ff, opacity: 0.85 });
  makeLayer({ count: 260, size: 2.6, minRadius: 6000, maxRadius: 13000, color: 0xffffff, opacity: 0.95 });

  scene.add(starGroup);

  return {
    group: starGroup,
    update: (delta: number) => {
      starGroup.rotation.y += delta * 0.01;
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
    model.scale.setScalar(80);
    model.position.set(-1200, -240, -10000);
    model.rotation.y = Math.PI * 0.2;
    scene.add(model);
    return model;
  } catch (error) {
    console.error(error);
    return null;
  }
}
