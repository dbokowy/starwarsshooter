import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { Bullet, InputState, PlayArea, PlayerConfig } from './types.js';
import { EngineFlames } from './effects.js';

export type PlayerState = {
  root: THREE.Object3D;
  model?: THREE.Object3D;
  currentSpeed: number;
  health: number;
  bullets: Bullet[];
};

export class PlayerController {
  readonly root: THREE.Object3D = new THREE.Object3D();
  model?: THREE.Object3D;
  currentSpeed: number;
  health: number;
  readonly bullets: Bullet[] = [];
  readonly collisionRadius = 6.5;
  private lastShot = 0;
  private readonly engineFlames: EngineFlames;
  private fireBuffer: AudioBuffer | null = null;
  private overboostBudgetMs = 8000; // time budget for the top 20% boost
  private overboostCooldownMs = 60000;
  private overboostRemainingMs = 8000;
  private overboostLockedUntil = 0;
  private destroyed = false;
  private rolling = false;
  private rollTime = 0;
  private readonly rollDuration = 0.78;
  private rollDir = 1;
  private rollLatch = false;
  private readonly rollCooldownMs = 2000;
  private lastRollTimestamp = -Infinity;

  constructor(
    private readonly loader: GLTFLoader,
    private readonly scene: THREE.Scene,
    private readonly config: PlayerConfig,
    private readonly playArea: PlayArea,
    private readonly listener: THREE.AudioListener
  ) {
    this.currentSpeed = config.baseSpeed;
    this.health = config.maxHealth;
    this.engineFlames = new EngineFlames(this.root, config.flameOffsets);
    this.root.position.set(0, 0, 40);
    this.scene.add(this.root);
  }

  setFireSound(buffer: AudioBuffer): void {
    this.fireBuffer = buffer;
  }

  async loadModel(path: string, rotation: THREE.Euler, scale: number, positionOffset: THREE.Vector3 = new THREE.Vector3(0, 0, 0)): Promise<void> {
    const model = await this.load(path);
    this.model = model;
    model.scale.setScalar(scale);
    model.rotation.copy(rotation);
    model.userData.baseRotation = model.rotation.clone();
    model.position.copy(positionOffset);
    this.root.add(model);
    this.engineFlames.attach(); // keep previous relative offsets (parented to root)
  }

  update(delta: number, input: InputState): void {
    if (!this.model || this.destroyed) return;

    this.updateSpeed(delta, input);
    this.handleRollInput(input);
    this.updateTransform(delta, input);
    this.clampToPlayArea();
  }

  updateBullets(delta: number): void {
    for (let i = this.bullets.length - 1; i >= 0; i -= 1) {
      const bullet = this.bullets[i];
      bullet.mesh.position.addScaledVector(bullet.velocity, delta);
      bullet.life -= delta;

      if (bullet.life <= 0) {
        this.scene.remove(bullet.mesh);
        this.bullets.splice(i, 1);
      }
    }
  }

  updateFlames(time: number): void {
    if (this.destroyed) return;
    this.engineFlames.update(this.currentSpeed, this.config.baseSpeed, this.config.boostMultiplier, time, this.getRollBend());
  }

  updateModelSway(time: number): void {
    if (!this.model || !this.model.userData.baseRotation) return;
    this.model.rotation.copy(this.model.userData.baseRotation);
  }

  shoot(now: number): void {
    if (!this.model || this.destroyed) return;
    if (now - this.lastShot < 160) return;
    this.lastShot = now;

    const coreGeometry = new THREE.BoxGeometry(0.12, 0.12, 4.8);
    const glowGeometry = new THREE.BoxGeometry(0.28, 0.28, 5.2);
    const coreMaterial = new THREE.MeshBasicMaterial({
      color: 0xff6a6a,
      transparent: true,
      opacity: 1,
      blending: THREE.AdditiveBlending,
      depthWrite: false
    });
    const glowMaterial = new THREE.MeshBasicMaterial({
      color: 0xe81607,
      transparent: true,
      opacity: 0.65,
      blending: THREE.AdditiveBlending,
      depthWrite: false
    });

    this.config.muzzleOffsets.forEach(offset => {
      const core = new THREE.Mesh(coreGeometry, coreMaterial);
      const glow = new THREE.Mesh(glowGeometry, glowMaterial);
      const laser = new THREE.Group();
      laser.add(core);
      laser.add(glow);

      const worldOffset = offset.clone().applyQuaternion(this.root.quaternion);
      laser.position.copy(this.root.position).add(worldOffset);
      laser.quaternion.copy(this.root.quaternion);
      laser.position.add(new THREE.Vector3(0, 0, -1).applyQuaternion(this.root.quaternion));

      const velocity = new THREE.Vector3(0, 0, -1).applyQuaternion(this.root.quaternion).multiplyScalar(320);

      this.bullets.push({ mesh: laser, velocity, life: 2 });
      this.scene.add(laser);

      if (this.fireBuffer) {
        const laserSound = new THREE.Audio(this.listener);
        laserSound.setBuffer(this.fireBuffer);
        laserSound.setVolume(0.6);
        laserSound.play();
      }
    });
  }

  takeDamage(amount: number): boolean {
    if (this.destroyed) return false;
    this.health = Math.max(0, this.health - amount);
    if (this.health === 0) {
      this.destroy();
      return true;
    }
    return false;
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.health = 0;
    this.currentSpeed = 0;
    this.setShipVisible(false);
  }

  setShipVisible(visible: boolean): void {
    if (this.model) {
      this.model.visible = visible;
    }
    this.engineFlames.setVisible(visible);
  }

  isDestroyed(): boolean {
    return this.destroyed;
  }

  private handleRollInput(input: InputState): void {
    const rollHeld = input.rollLeft || input.rollRight;
    if (!rollHeld) {
      this.rollLatch = false; // allow next roll after releasing keys
    }
    if (this.rolling || this.rollLatch) return;
    const now = performance.now();
    if (now - this.lastRollTimestamp < this.rollCooldownMs) return;
    if (rollHeld) {
      this.startRoll(input.rollLeft ? -1 : 1);
      this.rollLatch = true;
      this.lastRollTimestamp = now;
    }
  }

  private startRoll(direction: number): void {
    this.rolling = true;
    this.rollDir = direction;
    this.rollTime = 0;
    document.body.classList.add('roll-blur');
  }

  private getRollBend(): number {
    if (!this.rolling) return 0;
    const t = Math.min(1, this.rollTime / this.rollDuration);
    return -this.rollDir * 0.5 * Math.sin(t * Math.PI);
  }

  private async load(path: string): Promise<THREE.Object3D> {
    return new Promise((resolve, reject) => {
      this.loader.load(
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

  private updateSpeed(delta: number, input: InputState): void {
    const now = performance.now();
    const maxBoost = this.config.boostMultiplier;
    const regularBoost = 1 + (maxBoost - 1) * 0.8; // bottom 80% of boost is unlimited

    let boostFactor = 1;
    if (input.boost) {
      const lockActive = now < this.overboostLockedUntil;

      if (!lockActive && this.overboostRemainingMs > 0) {
        boostFactor = maxBoost; // allow top 20% while budget lasts
        this.overboostRemainingMs = Math.max(0, this.overboostRemainingMs - delta * 1000);
        if (this.overboostRemainingMs === 0) {
          this.overboostLockedUntil = now + this.overboostCooldownMs;
        }
      } else {
        boostFactor = regularBoost; // stay below top 20%
      }
    } else {
      const lockExpired = now >= this.overboostLockedUntil;
      if (lockExpired && this.overboostRemainingMs === 0) {
        this.overboostRemainingMs = this.overboostBudgetMs; // recharge after cooldown
      }
    }

    const targetSpeed = this.config.baseSpeed * boostFactor;
    const accelRate = 0.75;
    const baseSmoothing = 1 - Math.exp(-accelRate * delta);
    const easeOut = 1 - Math.pow(1 - baseSmoothing, 2.2);
    this.currentSpeed = THREE.MathUtils.lerp(this.currentSpeed, targetSpeed, easeOut);
  }

  private updateTransform(delta: number, input: InputState): void {
    const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(this.root.quaternion).normalize();
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(this.root.quaternion).normalize();
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(this.root.quaternion).normalize();

    const move = new THREE.Vector3();
    move.addScaledVector(forward, this.currentSpeed);
    move.addScaledVector(right, this.config.strafeSpeed * ((input.right ? 1 : 0) - (input.left ? 1 : 0)));
    move.addScaledVector(up, this.config.strafeSpeed * ((input.up ? 1 : 0) - (input.down ? 1 : 0)));

    this.root.position.addScaledVector(move, delta);

    const yawChange = ((input.left ? 1 : 0) - (input.right ? 1 : 0)) * delta * 1.3;
    const pitchChange = ((input.pitchUp ? 1 : 0) - (input.pitchDown ? 1 : 0)) * delta * 1.3;

    this.root.rotation.y += yawChange;
    this.root.rotation.x = THREE.MathUtils.clamp(this.root.rotation.x + pitchChange, -Math.PI / 3, Math.PI / 3);

    const targetRoll = THREE.MathUtils.clamp(((input.left ? 1 : 0) - (input.right ? 1 : 0)) * 0.4, -0.6, 0.6);

    if (this.rolling) {
      this.rollTime += delta;
      const t = Math.min(1, this.rollTime / this.rollDuration);
      const rollExtra = this.rollDir * Math.PI * 2 * t; // exact 360 deg
      this.root.rotation.z = targetRoll + rollExtra;
      if (t >= 1) {
        this.rolling = false;
        this.rollTime = 0;
        this.root.rotation.z = targetRoll; // end exactly at baseline
        document.body.classList.remove('roll-blur');
      }
    } else {
      this.root.rotation.z = THREE.MathUtils.lerp(this.root.rotation.z, targetRoll, 0.12);
    }
  }

  private clampToPlayArea(): void {
    this.root.position.z = Math.max(this.playArea.minZ, Math.min(this.playArea.maxZ, this.root.position.z));
    this.root.position.x = Math.max(this.playArea.minX, Math.min(this.playArea.maxX, this.root.position.x));
    this.root.position.y = Math.max(this.playArea.minY, Math.min(this.playArea.maxY, this.root.position.y));
  }
}












