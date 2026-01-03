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
  private baseModelPosition = new THREE.Vector3();
  private readonly startPosition = new THREE.Vector3(0, 0, 40);
  private readonly tmpForward = new THREE.Vector3();
  private readonly tmpRight = new THREE.Vector3();
  private readonly tmpUp = new THREE.Vector3();
  private readonly tmpMove = new THREE.Vector3();
  private readonly tmpDir = new THREE.Vector3();
  private lastShot = 0;
  private readonly engineFlames: EngineFlames;
  private fireBuffer: AudioBuffer | null = null;
  private overboostBudgetMs = 8000; // active boost duration budget in ms
  private overboostCooldownMs = 10000; // 10s cooldown before refill
  private overboostRemainingMs = 8000;
  private overboostLockedUntil = 0;
  private destroyed = false;
  private rolling = false;
  private rollTime = 0;
  private readonly rollDuration = 0.55;
  private rollDir = 1;
  private rollLatch = false;
  private readonly rollCooldownMs = 0;
  private lastRollTimestamp = -Infinity;
  private hitFlash?: THREE.Mesh;
  private hitFlashTimer = 0;
  private readonly hitFlashDuration = 0.35;
  private hitSoundBuffer: AudioBuffer | null = null;
  private wingTrails: THREE.Mesh[] = [];
  private readonly trailsEnabled = true;
  private trailsVisible = true;
  private turnLean = 0;
  private verticalLean = 0;
  private readonly trailJitterFreq = 3.2;
  private readonly trailJitterAmp = 0.08;
  private readonly trailVisibilityThreshold = 0.5; // fraction of top speed
  private readonly trailMinLength = 0.6;
  private readonly trailMaxLength = 1.6;
  private readonly trailMaxOpacity = 0.6;

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
    this.root.position.copy(this.startPosition);
    this.scene.add(this.root);
  }

  setFireSound(buffer: AudioBuffer): void {
    this.fireBuffer = buffer;
  }

  setHitSound(buffer: AudioBuffer): void {
    this.hitSoundBuffer = buffer;
  }

  fullyHeal(): void {
    this.health = this.config.maxHealth;
    this.hitFlashTimer = 0;
  }

  async loadModel(path: string, rotation: THREE.Euler, scale: number, positionOffset: THREE.Vector3 = new THREE.Vector3(0, 0, 0)): Promise<void> {
    const model = await this.load(path);
    this.model = model;
    model.scale.setScalar(scale);
    model.rotation.copy(rotation);
    model.userData.baseRotation = model.rotation.clone();
    model.position.copy(positionOffset);
    this.baseModelPosition.copy(model.position);
    this.root.add(model);
    this.engineFlames.attach(); // keep previous relative offsets (parented to root)
    this.addHitFlash();
    this.addWingTrails();
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
    this.engineFlames.update(
      this.currentSpeed,
      this.config.baseSpeed,
      this.config.boostMultiplier,
      time,
      this.getRollBend(),
      this.turnLean,
      this.verticalLean
    );
    this.updateWingTrails();
  }

  updateModelSway(time: number): void {
    if (!this.model || !this.model.userData.baseRotation) return;
    this.model.rotation.copy(this.model.userData.baseRotation);
    this.updateHitFlash();
  }

  shoot(now: number): void {
    if (!this.model || this.destroyed) return;
    if (now - this.lastShot < 160) return;
    this.lastShot = now;

    const coreGeometry = new THREE.BoxGeometry(0.1, 0.1, 5.2);
    const glowGeometry = new THREE.BoxGeometry(0.42, 0.42, 5.8);
    const coreMaterial = new THREE.MeshBasicMaterial({
      color: 0xffe7d9, // hot white-red core
      transparent: true,
      opacity: 0.95,
      blending: THREE.AdditiveBlending,
      depthWrite: false
    });
    const glowMaterial = new THREE.MeshBasicMaterial({
      color: 0xff1a00, // saturated red glow
      transparent: true,
      opacity: 0.82,
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
        laserSound.setVolume(0.3); // 50% quieter
        laserSound.play();
      }
    });
  }

  takeDamage(amount: number): boolean {
    if (this.destroyed) return false;
    this.health = Math.max(0, this.health - amount);
    this.hitFlashTimer = this.hitFlashDuration;
    if (this.hitSoundBuffer) {
      const hitSound = new THREE.Audio(this.listener);
      hitSound.setBuffer(this.hitSoundBuffer);
      hitSound.setVolume(0.55);
      hitSound.play();
    }
    if (this.health === 0) {
      this.destroy();
      return true;
    }
    return false;
  }

  getBoostRegenRatio(): number {
    return THREE.MathUtils.clamp(this.overboostRemainingMs / this.overboostBudgetMs, 0, 1);
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.health = 0;
    this.currentSpeed = 0;
    this.setShipVisible(false);
  }

  reset(): void {
    this.destroyed = false;
    this.health = this.config.maxHealth;
    this.currentSpeed = this.config.baseSpeed;
    this.turnLean = 0;
    this.verticalLean = 0;
    this.root.position.copy(this.startPosition);
    this.root.rotation.set(0, 0, 0);
    this.setShipVisible(true);
    this.rolling = false;
    this.rollTime = 0;
    this.rollLatch = false;
    this.hitFlashTimer = 0;
    if (this.model && this.model.userData.baseRotation) {
      this.model.rotation.copy(this.model.userData.baseRotation);
    }
    // clear player bullets
    for (let i = this.bullets.length - 1; i >= 0; i -= 1) {
      this.scene.remove(this.bullets[i].mesh);
    }
    this.bullets.length = 0;
  }

  setShipVisible(visible: boolean): void {
    if (this.model) {
      this.model.visible = visible;
    }
    this.engineFlames.setVisible(visible);
    this.setTrailVisibility(visible);
  }

  isDestroyed(): boolean {
    return this.destroyed;
  }

  isRolling(): boolean {
    return this.rolling;
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
      this.startRoll(input.rollLeft ? 1 : -1); // swap to match intended Q/E directions
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

  private addHitFlash(): void {
    const material = new THREE.SpriteMaterial({
      map: this.getHitFlashTexture(),
      color: 0x66caff,
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      depthTest: true,
      fog: false
    });
    const flash = new THREE.Sprite(material);
    const size = 5.1; // 50% larger hit flash
    flash.scale.set(size, size, 1);
    flash.name = 'hit-flash';
    flash.renderOrder = 50;
    this.root.add(flash);
    this.hitFlash = flash;
  }

  private updateHitFlash(): void {
    if (!this.hitFlash) return;
    if (this.hitFlashTimer <= 0) {
      this.hitFlash.visible = false;
      return;
    }
    this.hitFlashTimer = Math.max(0, this.hitFlashTimer - 1 / 60);
    const t = 1 - this.hitFlashTimer / this.hitFlashDuration;
    const material = this.hitFlash.material as THREE.SpriteMaterial;
    const opacity = THREE.MathUtils.lerp(0.7, 0, t);
    material.opacity = opacity;
    this.hitFlash.visible = opacity > 0;

    this.tmpDir.set(0, 0, 1).applyQuaternion(this.root.quaternion);
    this.hitFlash.position.copy(this.tmpDir).multiplyScalar(2.2);
    this.hitFlash.lookAt(this.hitFlash.position.clone().add(this.tmpDir));
  }

  private getHitFlashTexture(): THREE.Texture {
    if (this.hitFlashTexture) return this.hitFlashTexture;
    const size = 64;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');
    if (ctx) {
      const gradient = ctx.createRadialGradient(size / 2, size / 2, size * 0.1, size / 2, size / 2, size * 0.5);
      gradient.addColorStop(0, 'rgba(255,255,255,0.9)');
      gradient.addColorStop(0.35, 'rgba(102,202,255,0.45)');
      gradient.addColorStop(1, 'rgba(102,202,255,0)');
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, size, size);
    }
    this.hitFlashTexture = new THREE.CanvasTexture(canvas);
    this.hitFlashTexture.minFilter = THREE.LinearFilter;
    this.hitFlashTexture.magFilter = THREE.LinearFilter;
    this.hitFlashTexture.wrapS = this.hitFlashTexture.wrapT = THREE.ClampToEdgeWrapping;
    return this.hitFlashTexture;
  }

  private addWingTrails(): void {
    if (!this.trailsEnabled) return;
    const trailGeometry = new THREE.CylinderGeometry(0.0087, 0.0043, 4.2, 8, 1, true); // slim trails as before
    const trailMaterial = new THREE.MeshBasicMaterial({
      color: 0x63d8ff,
      transparent: true,
      opacity: 0.0,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide
    });

    const offsets = [
      new THREE.Vector3(7.4, -0.25, 4.8), // right lower
      new THREE.Vector3(-5.3, 2.7, 4.8), // left upper
      new THREE.Vector3(7.4, 2, 4.8), // right upper
      new THREE.Vector3(-5.6, -0.45, 4.8) // left lower
    ];

    offsets.forEach(offset => {
      const trail = new THREE.Mesh(trailGeometry, trailMaterial.clone());
      trail.rotation.x = -Math.PI / 2; // flip 180 deg so tip faces forward, base at thruster
      trail.position.copy(offset);
      trail.renderOrder = 12;
      this.root.add(trail);
      this.wingTrails.push(trail);
    });
  }

  private setTrailVisibility(visible: boolean): void {
    this.trailsVisible = visible;
    this.wingTrails.forEach(trail => {
      trail.visible = visible;
      const mat = trail.material as THREE.MeshBasicMaterial;
      if (!visible) mat.opacity = 0;
    });
  }

  private updateWingTrails(): void {
    if (!this.trailsEnabled) return;
    if (!this.trailsVisible) return;
    if (!this.wingTrails.length) return;
    const speedRatio = THREE.MathUtils.clamp(
      (this.currentSpeed - this.config.baseSpeed * 0.5) / (this.config.baseSpeed * this.config.boostMultiplier - this.config.baseSpeed * 0.5),
      0,
      1
    );
    const ramp = THREE.MathUtils.clamp((speedRatio - this.trailVisibilityThreshold) / (1 - this.trailVisibilityThreshold), 0, 1); // start showing >50% speed
    const opacity = THREE.MathUtils.lerp(0, this.trailMaxOpacity, ramp);
    const baseLength = THREE.MathUtils.lerp(this.trailMinLength, this.trailMaxLength, ramp);
    const t = performance.now() * 0.001;

    this.wingTrails.forEach((trail, idx) => {
      const mat = trail.material as THREE.MeshBasicMaterial;
      mat.opacity = opacity;
      trail.scale.setScalar(1);
      const jitter = 1 + this.trailJitterAmp * Math.sin(t * this.trailJitterFreq + idx * 1.4); // subtle dynamic length change
      trail.scale.z = baseLength * jitter;
      trail.visible = mat.opacity > 0.02;
    });
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
    const maxBoost = this.config.boostMultiplier; // ~10x at 70%, ~20x after ramp
    const regularBoost = 2; // baseline boost gives ~2x speed

    let boostFactor = 1;
    const lockActive = now < this.overboostLockedUntil;
    const canUseOverboost = this.overboostRemainingMs > 0 && !lockActive;

    if (input.boost && canUseOverboost) {
      boostFactor = maxBoost;
      this.overboostRemainingMs = Math.max(0, this.overboostRemainingMs - delta * 1000);
      if (this.overboostRemainingMs === 0) {
        this.overboostLockedUntil = now + this.overboostCooldownMs;
      }
    } else if (input.boost && !canUseOverboost) {
      // during cooldown or empty reserve: cap at 70% of max
      boostFactor = Math.max(regularBoost, maxBoost * 0.7);
    } else if (!input.boost && !lockActive && this.overboostRemainingMs < this.overboostBudgetMs) {
      // regen only when not boosting and cooldown finished
      this.overboostRemainingMs = Math.min(this.overboostBudgetMs, this.overboostRemainingMs + delta * 1000);
    }

    boostFactor = this.applyLateBoostRamp(boostFactor, maxBoost);

    const targetSpeed = this.config.baseSpeed * boostFactor;
    const accelRate = 0.75;
    const baseSmoothing = 1 - Math.exp(-accelRate * delta);
    const easeOut = 1 - Math.pow(1 - baseSmoothing, 2.2);
    this.currentSpeed = THREE.MathUtils.lerp(this.currentSpeed, targetSpeed, easeOut);
  }

  private applyLateBoostRamp(boostFactor: number, maxBoost: number): number {
    if (boostFactor <= 1) return boostFactor;
    const threshold = 0.7; // start ramping after 70% to keep mid-boost stable
    const maxRamp = 20 / maxBoost; // target final top speed: 20x base
    const boostFraction = (boostFactor - 1) / Math.max(1e-6, maxBoost - 1);
    if (boostFraction <= threshold) return boostFactor;
    const t = (boostFraction - threshold) / (1 - threshold);
    const ramp = THREE.MathUtils.lerp(1, maxRamp, t);
    return boostFactor * ramp;
  }

  private updateTransform(delta: number, input: InputState): void {
    this.tmpForward.set(0, 0, -1).applyQuaternion(this.root.quaternion).normalize();
    this.tmpRight.set(1, 0, 0).applyQuaternion(this.root.quaternion).normalize();
    this.tmpUp.set(0, 1, 0).applyQuaternion(this.root.quaternion).normalize();

    this.tmpMove.set(0, 0, 0);
    this.tmpMove.addScaledVector(this.tmpForward, this.currentSpeed);
    this.tmpMove.addScaledVector(this.tmpRight, this.config.strafeSpeed * ((input.right ? 1 : 0) - (input.left ? 1 : 0)));
    this.tmpMove.addScaledVector(this.tmpUp, this.config.strafeSpeed * ((input.up ? 1 : 0) - (input.down ? 1 : 0)));

    this.root.position.addScaledVector(this.tmpMove, delta);

    const yawIntent = (input.right ? 1 : 0) - (input.left ? 1 : 0);
    const pitchIntent = (input.pitchUp ? 1 : 0) - (input.pitchDown ? 1 : 0);
    const verticalIntent = THREE.MathUtils.clamp(
      (input.up ? 1 : 0) - (input.down ? 1 : 0) + pitchIntent * 0.5, // include pitch so climb/dive still affect exhaust
      -1,
      1
    );

    const yawTarget = this.root.rotation.y + yawIntent * -delta * 1.85; // more responsive yaw
    const pitchTargetUnclamped = this.root.rotation.x + pitchIntent * delta * 1.5;
    const maxPitch = Math.PI / 3 + THREE.MathUtils.degToRad(15); // allow an extra 15 deg up/down
    const pitchTarget = THREE.MathUtils.clamp(pitchTargetUnclamped, -maxPitch, maxPitch);

    const yawSmooth = 1 - Math.exp(-14 * delta); // faster blend toward target yaw
    const pitchSmooth = 1 - Math.exp(-8 * delta);
    this.root.rotation.y = THREE.MathUtils.lerp(this.root.rotation.y, yawTarget, yawSmooth);
    this.root.rotation.x = THREE.MathUtils.lerp(this.root.rotation.x, pitchTarget, pitchSmooth);

    const targetRoll = THREE.MathUtils.clamp(
      ((input.left ? 1 : 0) - (input.right ? 1 : 0)) * 1,
      -Math.PI / 3,
      Math.PI / 3
    ); // allow up to ~60 deg bank

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
      const rollSmooth = 1 - Math.exp(-8 * delta);
      this.root.rotation.z = THREE.MathUtils.lerp(this.root.rotation.z, targetRoll, rollSmooth); // slower roll easing for smoother banking
    }

    const rollLean = this.rolling ? -this.rollDir : 0; // right roll -> positive lean
    const desiredLean = THREE.MathUtils.clamp(yawIntent * 0.8 + rollLean * 0.7, -1, 1);
    const leanSmooth = 1 - Math.exp(-4 * delta);
    this.turnLean = THREE.MathUtils.lerp(this.turnLean, desiredLean, leanSmooth);

    const verticalSmooth = 1 - Math.exp(-10 * delta);
    this.verticalLean = THREE.MathUtils.lerp(this.verticalLean, verticalIntent, verticalSmooth);
  }

  private clampToPlayArea(): void {
    this.root.position.z = Math.max(this.playArea.minZ, Math.min(this.playArea.maxZ, this.root.position.z));
    this.root.position.x = Math.max(this.playArea.minX, Math.min(this.playArea.maxX, this.root.position.x));
    this.root.position.y = Math.max(this.playArea.minY, Math.min(this.playArea.maxY, this.root.position.y));
  }
}


