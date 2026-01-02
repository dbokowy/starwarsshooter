import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { clone } from 'three/examples/jsm/utils/SkeletonUtils.js';

type ExplosionInstance = {
  container: THREE.Group;
  mixer?: THREE.AnimationMixer;
  shockwave?: THREE.Sprite;
  particle?: THREE.Points;
  intensity: number;
  timeLeft: number;
  totalTime: number;
  startScale: number;
  endScale: number;
  materials: { mat: THREE.Material & { opacity?: number }; baseOpacity: number }[];
};

export class ExplosionManager {
  private sparkBase: THREE.Object3D | null = null;
  private sparkAnimations: THREE.AnimationClip[] = [];
  private readonly active: ExplosionInstance[] = [];
  private soundBuffer: AudioBuffer | null = null;
  private readonly anisotropy: number;

  constructor(
    private readonly loader: GLTFLoader,
    private readonly scene: THREE.Scene,
    private readonly assetsPath: string,
    private readonly listener: THREE.AudioListener,
    anisotropy: number = 8
  ) {
    this.anisotropy = anisotropy;
  }

  async init(): Promise<void> {
    const spark = await this.load(`${this.assetsPath}/sparksexplosion/scene.gltf`);
    this.sparkBase = spark.scene;
    this.sparkAnimations = spark.animations ?? [];
  }

  trigger(
    position: THREE.Vector3,
    scale: number = 16,
    forward?: THREE.Vector3,
    opts?: { scaleMultiplier?: number; intensity?: number }
  ): void {
    const base = this.sparkBase;
    const animations = this.sparkAnimations;
    if (!base) return;

    const scaleMult = opts?.scaleMultiplier ?? 1;
    const intensity = opts?.intensity ?? 1;

    const container = new THREE.Group();
    const pos = position.clone();
    if (forward && forward.lengthSq() > 0.0001) {
      const n = forward.clone().normalize();
      const offset = Math.max(scale * 0.6, 6); // push clearly in front of hull
      pos.add(n.multiplyScalar(offset));
    }
    container.position.copy(pos);

    const explosion = clone(base);
    const startScale = scale * 0.07 * scaleMult;
    const finalScale = scale * 2.0 * scaleMult;
    container.scale.setScalar(startScale);

    const materials: { mat: THREE.Material & { opacity?: number }; baseOpacity: number }[] = [];
    explosion.traverse(obj => {
      obj.frustumCulled = false;
      const material = (obj as THREE.Mesh).material as THREE.Material | THREE.Material[] | undefined;
      const ensure = (mat: THREE.Material) => {
        if ('transparent' in mat) mat.transparent = true;
        if ('depthWrite' in mat) mat.depthWrite = false;
        if ('fog' in mat) (mat as THREE.Material & { fog?: boolean }).fog = false;
        if ('blending' in mat) mat.blending = THREE.AdditiveBlending;
        if ('color' in mat) (mat as THREE.MeshBasicMaterial).color?.set(0xff4422);
        if ('emissive' in mat) (mat as THREE.MeshStandardMaterial).emissive?.set(0xcc2200);
        if ('color' in mat) (mat as THREE.MeshBasicMaterial).color?.multiplyScalar(intensity);
        if ('emissive' in mat) (mat as THREE.MeshStandardMaterial).emissive?.multiplyScalar(intensity);
        const typed = mat as THREE.Material & { map?: THREE.Texture; emissiveMap?: THREE.Texture };
        const updateTex = (tex?: THREE.Texture) => {
          if (!tex) return;
          tex.minFilter = THREE.LinearMipmapLinearFilter;
          tex.magFilter = THREE.LinearFilter;
          tex.anisotropy = this.anisotropy;
          tex.needsUpdate = true;
        };
        updateTex(typed.map);
        updateTex(typed.emissiveMap);
        const m = mat as THREE.Material & { opacity?: number };
        if (typeof m.opacity !== 'number' || Number.isNaN(m.opacity)) {
          (m as { opacity: number }).opacity = 1;
        }
        if (typeof m.opacity === 'number') m.opacity = 1 * intensity;
        materials.push({ mat: m, baseOpacity: typeof m.opacity === 'number' ? m.opacity : 1 * intensity });
      };
      if (Array.isArray(material)) material.forEach(ensure);
      else if (material) ensure(material);
    });

    explosion.renderOrder = 30;
    container.add(explosion);

    const shockwave =
      (() => {
        const shockMat = new THREE.SpriteMaterial({
          map: getShockwaveTexture(),
          color: 0xffbb88,
          transparent: true,
          opacity: 0.9 * intensity,
          depthWrite: false,
          depthTest: false,
          blending: THREE.AdditiveBlending
        });
        const sprite = new THREE.Sprite(shockMat);
        sprite.scale.setScalar(finalScale * 0.6);
        sprite.renderOrder = 31;
        sprite.frustumCulled = false;
        container.add(sprite);
        return sprite;
      })();

    const particle = this.createParticles(scale * 0.18);
    if (particle) {
      const pm = particle.material as THREE.PointsMaterial;
      pm.opacity *= intensity;
      container.add(particle);
    }

    const mixer = animations.length ? new THREE.AnimationMixer(explosion) : undefined;
    if (mixer) {
      animations.forEach(clip => {
        const action = mixer.clipAction(clip.clone(), explosion);
        action.reset();
        action.setLoop(THREE.LoopOnce, 1);
        action.clampWhenFinished = true;
        action.play();
      });
      mixer.update(0);
    }

    this.scene.add(container);
    this.active.push({
      container,
      mixer,
      intensity,
      timeLeft: 1.2,
      totalTime: 1.2,
      startScale,
      endScale: finalScale,
      materials,
      shockwave,
      particle
    });

    if (this.soundBuffer) {
      const sound = new THREE.Audio(this.listener);
      sound.setBuffer(this.soundBuffer);
      sound.setVolume(Math.min(1, 0.9 * 1.3)); // ~30% louder, clamped
      sound.play();
    }
  }

  update(delta: number): void {
    for (let i = this.active.length - 1; i >= 0; i -= 1) {
      const entry = this.active[i];
      entry.mixer?.update(delta);
      entry.timeLeft -= delta;
      const t = 1 - entry.timeLeft / entry.totalTime;
      const eased = THREE.MathUtils.smootherstep(Math.min(1, t / 0.45), 0, 1);
      const scale = THREE.MathUtils.lerp(entry.startScale, entry.endScale, eased);
      entry.container.scale.setScalar(scale);

      const fadeStart = 0.6;
      const fadeT = t < fadeStart ? 0 : (t - fadeStart) / (1 - fadeStart);
      const intensity = THREE.MathUtils.clamp(1 - fadeT, 0, 1);

      entry.materials.forEach(({ mat, baseOpacity }) => {
        if (typeof mat.opacity === 'number') {
          mat.opacity = THREE.MathUtils.clamp(baseOpacity * intensity * entry.intensity, 0, 1);
        }
      });

      if (entry.shockwave) {
        const mat = entry.shockwave.material as THREE.SpriteMaterial;
        const waveT = THREE.MathUtils.clamp(t, 0, 1);
        mat.opacity = THREE.MathUtils.lerp(0.9 * entry.intensity, 0, waveT);
        const base = entry.endScale * 0.6;
        entry.shockwave.scale.setScalar(THREE.MathUtils.lerp(base, base * 1.6, waveT));
      }

      if (entry.particle) {
        const pm = entry.particle.material as THREE.PointsMaterial;
        pm.opacity = intensity * 0.8 * entry.intensity;
        pm.size = THREE.MathUtils.lerp(6, 12, intensity);
      }

      if (entry.timeLeft <= 0) {
        if (entry.particle) {
          entry.particle.geometry.dispose();
          (entry.particle.material as THREE.Material).dispose();
        }
        if (entry.shockwave) {
          entry.shockwave.material.dispose();
        }
        this.scene.remove(entry.container);
        this.active.splice(i, 1);
      }
    }
  }

  private load(path: string): Promise<{ scene: THREE.Object3D; animations: THREE.AnimationClip[] }> {
    return new Promise((resolve, reject) => {
      this.loader.load(
        path,
        gltf => resolve({ scene: gltf.scene, animations: gltf.animations ?? [] }),
        undefined,
        error => reject(error)
      );
    });
  }

  setSoundBuffer(buffer: AudioBuffer): void {
    this.soundBuffer = buffer;
  }

  private createParticles(radius: number): THREE.Points {
    const count = 140;
    const positions = new Float32Array(count * 3);
    for (let i = 0; i < count; i += 1) {
      const dir = new THREE.Vector3(
        THREE.MathUtils.randFloatSpread(2),
        THREE.MathUtils.randFloatSpread(2),
        THREE.MathUtils.randFloatSpread(2)
      ).normalize();
      const r = Math.random() * radius;
      positions[i * 3] = dir.x * r;
      positions[i * 3 + 1] = dir.y * r;
      positions[i * 3 + 2] = dir.z * r;
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const material = new THREE.PointsMaterial({
      map: getSparkTexture(),
      color: 0xffe8c0,
      size: 10,
      sizeAttenuation: true,
      transparent: true,
      opacity: 0.9,
      depthWrite: false,
      depthTest: true,
      alphaTest: 0.02,
      blending: THREE.AdditiveBlending
    });
    const points = new THREE.Points(geometry, material);
    points.frustumCulled = false;
    points.renderOrder = 29;
    return points;
  }
}

let cachedShockwave: THREE.Texture | null = null;
function getShockwaveTexture(): THREE.Texture {
  if (cachedShockwave) return cachedShockwave;
  const size = 512;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    const grad = ctx.createRadialGradient(size / 2, size / 2, size * 0.08, size / 2, size / 2, size * 0.5);
    grad.addColorStop(0, 'rgba(255, 240, 220, 0.7)');
    grad.addColorStop(0.3, 'rgba(255, 180, 120, 0.5)');
    grad.addColorStop(1, 'rgba(255, 100, 40, 0)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, size, size);
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.encoding = THREE.sRGBColorSpace;
  tex.generateMipmaps = true;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.needsUpdate = true;
  cachedShockwave = tex;
  return tex;
}

let cachedSpark: THREE.Texture | null = null;
function getSparkTexture(): THREE.Texture {
  if (cachedSpark) return cachedSpark;
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    const grad = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    grad.addColorStop(0, 'rgba(255, 255, 255, 1)');
    grad.addColorStop(0.25, 'rgba(255, 220, 160, 0.8)');
    grad.addColorStop(0.6, 'rgba(255, 120, 60, 0.4)');
    grad.addColorStop(1, 'rgba(255, 120, 60, 0)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, size, size);
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.encoding = THREE.sRGBColorSpace;
  tex.generateMipmaps = true;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.needsUpdate = true;
  cachedSpark = tex;
  return tex;
}
