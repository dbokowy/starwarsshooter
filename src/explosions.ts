import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { clone } from 'three/examples/jsm/utils/SkeletonUtils.js';

type ExplosionInstance = {
  object: THREE.Object3D;
  container: THREE.Group;
  mixer?: THREE.AnimationMixer;
  timeLeft: number;
  totalTime: number;
  startScale: number;
  peakScale: number;
  endScale: number;
  materials: { mat: THREE.Material & { opacity?: number }; baseOpacity: number }[];
  particle?: THREE.Points;
};

export class ExplosionManager {
  private base: THREE.Object3D | null = null;
  private animations: THREE.AnimationClip[] = [];
  private readonly active: ExplosionInstance[] = [];
  private soundBuffer: AudioBuffer | null = null;

  constructor(
    private readonly loader: GLTFLoader,
    private readonly scene: THREE.Scene,
    private readonly assetsPath: string,
    private readonly listener: THREE.AudioListener
  ) {}

  async init(): Promise<void> {
    const gltf = await this.load(`${this.assetsPath}/sparksexplosion/scene.gltf`);
    this.base = gltf.scene;
    this.animations = gltf.animations ?? [];
  }

  trigger(position: THREE.Vector3, scale: number = 16): void {
    if (!this.base) return;
    const explosion = clone(this.base);
    const container = new THREE.Group();
    container.position.copy(position);
    const startScale = scale * 0.08; // start tiny for flash bloom
    container.scale.setScalar(startScale);

    explosion.traverse(obj => {
      obj.frustumCulled = false;
      const material = (obj as THREE.Mesh).material as THREE.Material | THREE.Material[] | undefined;
      const ensure = (mat: THREE.Material) => {
        if ('transparent' in mat) mat.transparent = true;
        if ('depthWrite' in mat) mat.depthWrite = false;
        if ('fog' in mat) (mat as THREE.Material & { fog?: boolean }).fog = false;
        if ('blending' in mat) mat.blending = THREE.AdditiveBlending;
        if ('alphaTest' in mat) (mat as THREE.Material & { alphaTest?: number }).alphaTest = 0.08;
        if ('side' in mat) mat.side = THREE.DoubleSide;
        const typed = mat as THREE.Material & { map?: THREE.Texture; emissiveMap?: THREE.Texture };
        const updateTex = (tex?: THREE.Texture) => {
          if (!tex) return;
          tex.minFilter = THREE.LinearMipmapLinearFilter;
          tex.magFilter = THREE.LinearFilter;
          tex.anisotropy = 8;
        };
        updateTex(typed.map);
        updateTex(typed.emissiveMap);
      };
      if (Array.isArray(material)) material.forEach(ensure);
      else if (material) ensure(material);
    });
    explosion.renderOrder = 30; // draw on top of debris
    container.add(explosion);

    const materials: { mat: THREE.Material & { opacity?: number }; baseOpacity: number }[] = [];
    explosion.traverse(obj => {
      if ('material' in obj && obj.material) {
        const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
        mats.forEach(mat => {
          const m = mat as THREE.Material & { opacity?: number };
          if (typeof m.opacity === 'number') {
            if (m.opacity === 0) m.opacity = 1;
            materials.push({ mat: m, baseOpacity: m.opacity });
          }
        });
      }
    });

    const particle = this.createParticles(scale * 0.12);
    container.add(particle);

    let mixer: THREE.AnimationMixer | undefined;
    if (this.animations.length) {
      mixer = new THREE.AnimationMixer(explosion);
      mixer.time = 0;
      this.animations.forEach(clip => {
        const action = mixer!.clipAction(clip.clone(), explosion);
        action.reset();
        action.setLoop(THREE.LoopOnce, 1);
        action.clampWhenFinished = true;
        action.play();
      });
      mixer.update(0); // ensure first frame is applied
    }

    this.scene.add(container);
    this.active.push({
      object: explosion,
      container,
      mixer,
      timeLeft: 3,
      totalTime: 3,
      startScale,
      peakScale: scale * 1.4,
      endScale: scale * 0.12,
      materials,
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

      const scale = this.getScaleAt(t, entry.startScale, entry.peakScale, entry.endScale);
      entry.container.scale.setScalar(scale);

      const intensity = this.getIntensityAt(t);
      entry.materials.forEach(({ mat, baseOpacity }) => {
        if (typeof mat.opacity === 'number') {
          mat.opacity = THREE.MathUtils.clamp(baseOpacity * intensity, 0, 1);
        }
      });
      if (entry.particle?.material && 'opacity' in entry.particle.material) {
        const pm = entry.particle.material as THREE.PointsMaterial;
        pm.opacity = THREE.MathUtils.clamp(intensity, 0, 1);
        pm.size = 6 + 18 * intensity;
      }

      if (entry.timeLeft <= 0) {
        if (entry.particle) {
          entry.particle.geometry.dispose();
          (entry.particle.material as THREE.Material).dispose();
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
    const count = 120;
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
      color: 0xffe5a0,
      size: 8,
      sizeAttenuation: true,
      transparent: true,
      opacity: 1,
      depthWrite: false,
      blending: THREE.AdditiveBlending
    });

    const points = new THREE.Points(geometry, material);
    points.frustumCulled = false;
    return points;
  }

  private getScaleAt(t: number, start: number, peak: number, end: number): number {
    if (t < 0.2) {
      const k = t / 0.2;
      return THREE.MathUtils.lerp(start, peak, k * k * (3 - 2 * k));
    }
    if (t < 0.6) {
      const k = (t - 0.2) / 0.4;
      return THREE.MathUtils.lerp(peak, peak * 0.9, k);
    }
    const k = (t - 0.6) / 0.4;
    return THREE.MathUtils.lerp(peak * 0.9, end, k);
  }

  private getIntensityAt(t: number): number {
    if (t < 0.18) return THREE.MathUtils.lerp(0.15, 2.4, t / 0.18);
    if (t < 0.5) return THREE.MathUtils.lerp(2.4, 1, (t - 0.18) / 0.32);
    return THREE.MathUtils.lerp(1, 0, (t - 0.5) / 0.5);
  }
}
