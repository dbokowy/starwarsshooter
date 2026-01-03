import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { clone } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { Bullet } from './types.js';
import { PlayerController } from './player.js';
import { ExplosionManager } from './explosions.js';

type EnemyShip = {
  type: EnemyType;
  archetype: EnemyArchetype;
  root: THREE.Object3D;
  velocity: THREE.Vector3;
  orbitAngle: number;
  radiusOffset: number;
  wanderPhase: number;
  wanderSpeed: number;
  formationOffset: THREE.Vector3;
  approachProgress: number;
  approachStart: THREE.Vector3;
  approachTarget: THREE.Vector3;
  health: number;
  lastShot: number;
  fireDelay: number;
  healthBar: { group: THREE.Object3D; fill: THREE.Mesh };
  boundingRadius: number;
  hitFlash?: THREE.Sprite;
  hitFlashTimer: number;
};

export type Obstacle = {
  position: THREE.Vector3;
  radius: number;
};

type LoadedModel = {
  scene: THREE.Object3D;
  animations: THREE.AnimationClip[];
  size: THREE.Vector3;
};

export enum EnemyType {
  Fighter = 'fighter',
  Interceptor = 'interceptor'
}

type EnemyArchetype = {
  modelPath: string;
  muzzleOffsets: THREE.Vector3[];
  bulletSpeed: number;
  bulletLife: number;
  fireDelayRange: [number, number];
  health: number;
  speedTarget: number;
  maxSpeed: number;
  maxAccel: number;
  aimSpread: number;
  wanderSpeedRange: [number, number];
  collisionFailChance: number;
  sizeTarget: number;
};

export class EnemySquadron {
  private readonly enemies: EnemyShip[] = [];
  private readonly bullets: Bullet[] = [];
  private prefabs: Partial<Record<EnemyType, LoadedModel>> = {};
  private readonly archetypes: Record<EnemyType, EnemyArchetype> = {
    [EnemyType.Fighter]: {
      modelPath: 'star_wars_tieln_fighter/scene.gltf',
      muzzleOffsets: [new THREE.Vector3(1.8, -0.2, -2.6), new THREE.Vector3(-1.8, -0.2, -2.6)],
      bulletSpeed: 260,
      bulletLife: 4,
      fireDelayRange: [800, 1350],
      health: 3,
      speedTarget: 170,
      maxSpeed: 230,
      maxAccel: 130,
      aimSpread: 0.18,
      wanderSpeedRange: [0.6, 1.4],
      collisionFailChance: 0.08,
      sizeTarget: 12
    },
    [EnemyType.Interceptor]: {
      modelPath: 'star_wars_tiein_interceptor/scene.gltf',
      muzzleOffsets: [
        new THREE.Vector3(1.6, 0.2, -2.4),
        new THREE.Vector3(-1.6, 0.2, -2.4),
        new THREE.Vector3(1.6, -0.3, -2.4),
        new THREE.Vector3(-1.6, -0.3, -2.4)
      ],
      bulletSpeed: 270,
      bulletLife: 4,
      fireDelayRange: [700, 1200],
      health: 3,
      speedTarget: 170 * 1.2,
      maxSpeed: 230 * 1.2,
      maxAccel: 130 * 1.2,
      aimSpread: 0.14,
      wanderSpeedRange: [0.9, 1.6],
      collisionFailChance: 0.04,
      sizeTarget: 12
    }
  };
  private fireEnabled = true;
  private readonly avoidanceRadius = 22;
  private readonly obstacleBuffer = 30;
  private readonly healthBarWidth = 7.2; // 50% longer than before
  private readonly hitboxMultiplier: number; // extra radius: 60% mobile, 30% desktop
  private enemyHitFlashTexture?: THREE.Texture;
  private readonly approachDuration = 3; // seconds to fly in from destroyer
  private active = false;
  private enemyFireSound?: AudioBuffer;
  private listener?: THREE.AudioListener;

  constructor(
    private readonly loader: GLTFLoader,
    private readonly scene: THREE.Scene,
    private readonly assetsPath: string,
    private readonly explosions: ExplosionManager,
    isMobile: boolean
  ) {
    this.hitboxMultiplier = isMobile ? 0.6 : 0.3;
  }

  setAudio(listener: THREE.AudioListener, fireSound: AudioBuffer): void {
    this.listener = listener;
    this.enemyFireSound = fireSound;
  }

  async init(count: number, player: PlayerController, formationOrigin?: THREE.Vector3, interceptors: number = 0): Promise<void> {
    await this.ensurePrefabs();
    const spawnTypes = this.buildSpawnList(count, interceptors);
    const total = spawnTypes.length;

    const spawnDistance = this.archetypes[EnemyType.Fighter].speedTarget * this.approachDuration; // distance to cover in approach window
    const origin = formationOrigin
      ? (() => {
          const dir = player.root.position.clone().sub(formationOrigin).normalize();
          return player.root.position.clone().add(dir.multiplyScalar(spawnDistance));
        })()
      : player.root.position.clone().add(new THREE.Vector3(0, 0, spawnDistance)); // straight ahead, ~3s out
    const formationOffsets = [
      new THREE.Vector3(0, 0, 0),
      new THREE.Vector3(14, 2, -12),
      new THREE.Vector3(-14, 2, -12),
      new THREE.Vector3(22, 0, -22),
      new THREE.Vector3(-22, 0, -22)
    ];

    for (let i = 0; i < total; i += 1) {
      const type = spawnTypes[i] ?? EnemyType.Fighter;
      const archetype = this.archetypes[type];
      const prefab = this.prefabs[type]!;
      const baseRadius = Math.max(prefab.size.x, prefab.size.y, prefab.size.z) * 0.6;

      const root = new THREE.Object3D();
      const model = clone(prefab.scene);
      model.rotateY(Math.PI); // face forward along -Z like fighters
      root.add(model);
      const hitFlash = this.createHitFlash();
      root.add(hitFlash);

      const angle = (i / Math.max(1, total)) * Math.PI * 2;
      const radius = 130 + Math.random() * 50;
      const formationOffset = formationOffsets[i % formationOffsets.length].clone();

      const targetPos = player.root.position
        .clone()
        .add(
          new THREE.Vector3(Math.cos(angle), Math.sin(angle * 1.4) * 0.35, Math.sin(angle))
            .normalize()
            .multiplyScalar(radius)
        )
        .add(formationOffset);

      const startPos = origin.clone().add(formationOffset);
      root.position.copy(startPos);

      const healthBar = this.createHealthBar(baseRadius);
      root.add(healthBar.group);

      this.scene.add(root);
      this.enemies.push({
        type,
        archetype,
        root,
        velocity: new THREE.Vector3(),
        orbitAngle: angle,
        radiusOffset: THREE.MathUtils.randFloatSpread(24),
        wanderPhase: Math.random() * Math.PI * 2,
        wanderSpeed: THREE.MathUtils.randFloat(archetype.wanderSpeedRange[0], archetype.wanderSpeedRange[1]),
        formationOffset,
        approachProgress: 0,
        approachStart: startPos,
        approachTarget: targetPos,
        health: archetype.health,
        lastShot: performance.now() - Math.random() * 600,
        fireDelay: THREE.MathUtils.randFloat(archetype.fireDelayRange[0], archetype.fireDelayRange[1]),
        healthBar,
        boundingRadius: baseRadius,
        hitFlash,
        hitFlashTimer: 0
      });
    }
  }

  async reset(count: number, player: PlayerController, formationOrigin?: THREE.Vector3, interceptors: number = 0): Promise<void> {
    // remove existing enemies
    this.enemies.forEach(e => {
      this.scene.remove(e.root);
    });
    this.enemies.length = 0;
    // remove enemy bullets
    for (let i = this.bullets.length - 1; i >= 0; i -= 1) {
      this.scene.remove(this.bullets[i].mesh);
    }
    this.bullets.length = 0;
    this.active = false;
    await this.init(count, player, formationOrigin, interceptors);
  }

  update(
    delta: number,
    player: PlayerController,
    camera: THREE.Camera,
    obstacles: Obstacle[],
    now: number,
    onPlayerHit: () => void,
    onEnemyDestroyed: (type: EnemyType) => void
  ): void {
    if (!this.active) return;
    const playerPos = player.root.position;

    for (let i = this.enemies.length - 1; i >= 0; i -= 1) {
      const enemy = this.enemies[i];
      this.updateMovement(enemy, delta, playerPos, obstacles);
      this.updateOrientation(enemy, playerPos);
      this.updateHealthBar(enemy, camera, playerPos);
      this.updateHitFlash(enemy, delta, camera);
      this.tryShoot(enemy, playerPos, now);
    }

    this.updateBullets(delta);
    this.handleEnemyHitsPlayer(player, onPlayerHit);
    this.handlePlayerHitsEnemies(player, onEnemyDestroyed);
  }

  private updateMovement(enemy: EnemyShip, delta: number, playerPos: THREE.Vector3, obstacles: Obstacle[]): void {
    const orbitRadius = 110;
    enemy.orbitAngle += delta * 0.55;
    enemy.wanderPhase += delta * enemy.wanderSpeed;

    const wander = new THREE.Vector3(
      Math.sin(enemy.wanderPhase * 1.3) * 26,
      Math.cos(enemy.wanderPhase * 0.9) * 18,
      Math.cos(enemy.wanderPhase * 1.1) * 26
    );

    const baseTarget = playerPos
      .clone()
      .add(
        new THREE.Vector3(Math.cos(enemy.orbitAngle), Math.sin(enemy.orbitAngle * 1.4) * 0.35, Math.sin(enemy.orbitAngle))
          .normalize()
          .multiplyScalar(orbitRadius + enemy.radiusOffset)
      )
      .add(enemy.formationOffset);

    // Approach phase from origin to baseTarget over approachDuration
    if (enemy.approachProgress < 1) {
      enemy.approachTarget.copy(baseTarget);
      enemy.approachProgress = Math.min(1, enemy.approachProgress + delta / this.approachDuration);
      const eased = THREE.MathUtils.smootherstep(enemy.approachProgress, 0, 1);
      enemy.root.position.lerpVectors(enemy.approachStart, enemy.approachTarget, eased);
      enemy.velocity.set(0, 0, 0);
      return;
    }

    const desiredPos = baseTarget.add(wander);

    const desiredVel = desiredPos.sub(enemy.root.position).normalize().multiplyScalar(enemy.archetype.speedTarget);

    const avoidance = new THREE.Vector3();
    let asteroidPush = 0;
    this.enemies.forEach(other => {
      if (other === enemy) return;
      const offset = enemy.root.position.clone().sub(other.root.position);
      const dist = offset.length();
      if (dist < this.avoidanceRadius && dist > 0.0001) {
        avoidance.add(offset.normalize().multiplyScalar((this.avoidanceRadius - dist) * 2));
      }
    });

    obstacles.forEach(obstacle => {
      const offset = enemy.root.position.clone().sub(obstacle.position);
      const dist = offset.length();
      const safeDist = obstacle.radius + this.obstacleBuffer;
      if (dist < safeDist && dist > 0.001) {
        const strength = (safeDist - dist) * 2.2; // softer push so sometimes they fail to dodge
        avoidance.add(offset.normalize().multiplyScalar(strength));
        asteroidPush += 1;
      }
    });

    if (asteroidPush > 0 && Math.random() < enemy.archetype.collisionFailChance) {
      avoidance.multiplyScalar(0.35); // occasional intentional failure to dodge
    }

    const steer = desiredVel.add(avoidance).sub(enemy.velocity);
    steer.clampLength(0, enemy.archetype.maxAccel * delta);
    enemy.velocity.add(steer);
    enemy.velocity.clampLength(0, enemy.archetype.maxSpeed);

    enemy.root.position.addScaledVector(enemy.velocity, delta);
  }

  private updateOrientation(enemy: EnemyShip, playerPos: THREE.Vector3): void {
    const forward = enemy.velocity.lengthSq() > 1e-4 ? enemy.velocity.clone().normalize() : playerPos.clone().sub(enemy.root.position).normalize();
    const lookDir = forward.clone().multiplyScalar(0.7).add(playerPos.clone().sub(enemy.root.position).normalize().multiplyScalar(0.3)).normalize();
    const targetQuat = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, -1), lookDir);
    enemy.root.quaternion.slerp(targetQuat, 0.12);
  }

  private tryShoot(enemy: EnemyShip, playerPos: THREE.Vector3, now: number): void {
    if (!this.fireEnabled) return;
    if (enemy.approachProgress < 1) return; // don't fire until in position
    const timeSinceLast = now - enemy.lastShot;
    if (timeSinceLast < enemy.fireDelay) return;

    const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(enemy.root.quaternion);
    const toPlayer = playerPos.clone().sub(enemy.root.position).normalize();
    const aimDot = forward.dot(toPlayer);
    if (aimDot < 0.78) return; // only fire when mostly facing the player

    enemy.lastShot = now;
    enemy.fireDelay = THREE.MathUtils.randFloat(enemy.archetype.fireDelayRange[0], enemy.archetype.fireDelayRange[1]);
    this.spawnLaser(enemy, forward, playerPos);
  }

  setFireEnabled(enabled: boolean): void {
    this.fireEnabled = enabled;
  }

  setActive(active: boolean): void {
    this.active = active;
  }

  debugExplodeOne(): EnemyType | null {
    if (!this.enemies.length) return null;
    const enemy = this.enemies[0];
    this.destroyEnemy(enemy);
    this.enemies.splice(0, 1);
    return enemy.type;
  }

  private spawnLaser(enemy: EnemyShip, forward: THREE.Vector3, playerPos: THREE.Vector3): void {
    const coreGeometry = new THREE.BoxGeometry(0.12, 0.12, 4.6);
    const glowGeometry = new THREE.BoxGeometry(0.28, 0.28, 5);
    const coreMaterial = new THREE.MeshBasicMaterial({
      color: 0x6dff4a, // brighter green core
      transparent: true,
      opacity: 1,
      blending: THREE.AdditiveBlending,
      depthWrite: false
    });
    const glowMaterial = new THREE.MeshBasicMaterial({
      color: 0x4aff2e, // vivid green glow
      transparent: true,
      opacity: 0.65,
      blending: THREE.AdditiveBlending,
      depthWrite: false
    });

    enemy.archetype.muzzleOffsets.forEach(offset => {
      const laser = new THREE.Group();
      const core = new THREE.Mesh(coreGeometry, coreMaterial);
      const glow = new THREE.Mesh(glowGeometry, glowMaterial);
      laser.add(core);
      laser.add(glow);

      const worldOffset = offset.clone().applyQuaternion(enemy.root.quaternion);
      laser.position.copy(enemy.root.position).add(worldOffset);
      laser.position.add(forward.clone().multiplyScalar(1.4));

      const missShot = Math.random() < 0.5; // 50% of shots are deliberate near-misses
      const targetPos = playerPos.clone();
      if (missShot) {
        const missRadius = 10 + Math.random() * 12;
        const offsetDir = new THREE.Vector3().randomDirection();
        targetPos.add(offsetDir.multiplyScalar(missRadius));
      } else {
        // slight aim jitter so shots feel less perfect even when intended to hit
        targetPos.add(
          new THREE.Vector3(
            THREE.MathUtils.randFloatSpread(enemy.archetype.aimSpread),
            THREE.MathUtils.randFloatSpread(enemy.archetype.aimSpread),
            THREE.MathUtils.randFloatSpread(enemy.archetype.aimSpread)
          )
        );
      }

      const aimDir = targetPos.sub(laser.position).normalize();
      laser.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, -1), aimDir); // align beam to travel direction
      const velocity = aimDir.multiplyScalar(enemy.archetype.bulletSpeed);

      this.bullets.push({ mesh: laser, velocity, life: enemy.archetype.bulletLife });
      this.scene.add(laser);

      if (this.enemyFireSound && this.listener) {
        const snd = new THREE.Audio(this.listener);
        snd.setBuffer(this.enemyFireSound);
        const distance = enemy.root.position.distanceTo(targetPos);
        const volume = THREE.MathUtils.clamp(0.7 - distance / 500, 0.08, 0.7);
        snd.setVolume(volume);
        snd.setPlaybackRate(0.9 + Math.random() * 0.2);
        snd.play();
      }
    });
  }

  private updateBullets(delta: number): void {
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

  private handleEnemyHitsPlayer(player: PlayerController, onPlayerHit: () => void): void {
    for (let i = this.bullets.length - 1; i >= 0; i -= 1) {
      const bullet = this.bullets[i];
      const hitRadius = player.collisionRadius + 2.0;
      if (bullet.mesh.position.distanceTo(player.root.position) <= hitRadius) {
        this.scene.remove(bullet.mesh);
        this.bullets.splice(i, 1);
        onPlayerHit();
      }
    }
  }

  private handlePlayerHitsEnemies(player: PlayerController, onEnemyDestroyed: (type: EnemyType) => void): void {
    for (let i = this.enemies.length - 1; i >= 0; i -= 1) {
      const enemy = this.enemies[i];
      for (let j = player.bullets.length - 1; j >= 0; j -= 1) {
        const bullet = player.bullets[j];
        const distSq = bullet.mesh.position.distanceToSquared(enemy.root.position);
        const hitRadius = enemy.boundingRadius * (1 + this.hitboxMultiplier);
        const hitRadiusSq = hitRadius * hitRadius;
        if (distSq <= hitRadiusSq) {
          this.scene.remove(bullet.mesh);
          player.bullets.splice(j, 1);
          enemy.health -= 1;
          this.updateHealthFill(enemy);
          enemy.hitFlashTimer = 0.4;
          if (enemy.health <= 0) {
            this.destroyEnemy(enemy);
            this.enemies.splice(i, 1);
            onEnemyDestroyed(enemy.type);
          }
          break;
        }
      }
    }
  }

  private destroyEnemy(enemy: EnemyShip): void {
    const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(enemy.root.quaternion);
    this.explosions.trigger(enemy.root.position, enemy.boundingRadius * 1.6, forward);
    this.scene.remove(enemy.root);
  }

  private updateHealthBar(enemy: EnemyShip, camera: THREE.Camera, target: THREE.Vector3): void {
    enemy.healthBar.group.position.setY(enemy.boundingRadius * 0.8 + 2.2);
    enemy.healthBar.group.lookAt(target);
    this.updateHealthFill(enemy);
  }

  private updateHealthFill(enemy: EnemyShip): void {
    const pct = THREE.MathUtils.clamp(enemy.health / enemy.archetype.health, 0, 1);
    enemy.healthBar.fill.scale.x = pct;
    enemy.healthBar.fill.position.x = -((1 - pct) * this.healthBarWidth) / 2;
  }

  private updateHitFlash(enemy: EnemyShip, delta: number, camera: THREE.Camera): void {
    if (!enemy.hitFlash) return;
    if (enemy.hitFlashTimer <= 0) {
      enemy.hitFlash.visible = false;
      return;
    }
    enemy.hitFlashTimer = Math.max(0, enemy.hitFlashTimer - delta * 2.5);
    const t = 1 - enemy.hitFlashTimer / 0.4;
    const opacity = THREE.MathUtils.lerp(0.85, 0, t);
    const scale = THREE.MathUtils.lerp(9.75, 12.75, t);
    const material = enemy.hitFlash.material as THREE.SpriteMaterial;
    material.opacity = opacity;
    enemy.hitFlash.scale.set(scale, scale, 1);
    enemy.hitFlash.visible = opacity > 0.01;

    const dir = camera.position.clone().sub(enemy.root.position).normalize();
    enemy.hitFlash.position.copy(dir.multiplyScalar(3.5));
    enemy.hitFlash.lookAt(camera.position);
  }

  private createHealthBar(radius: number): { group: THREE.Object3D; fill: THREE.Mesh } {
    const barGroup = new THREE.Group();
    const bgGeom = new THREE.PlaneGeometry(this.healthBarWidth + 1.2, 1.0); // thicker backdrop
    const fillGeom = new THREE.PlaneGeometry(this.healthBarWidth, 0.68); // double thickness, longer fill

    const bgMat = new THREE.MeshBasicMaterial({ color: 0x0a1b2c, transparent: true, opacity: 0.75, depthWrite: false });
    const fillMat = new THREE.MeshBasicMaterial({ color: 0xff4a4a, transparent: true, opacity: 0.95, depthWrite: false });

    const bg = new THREE.Mesh(bgGeom, bgMat);
    const fill = new THREE.Mesh(fillGeom, fillMat);
    fill.position.z = 0.01;

    barGroup.add(bg);
    barGroup.add(fill);
    barGroup.position.set(0, radius * 0.8 + 4.4, 0);
    barGroup.renderOrder = 10;

    return { group: barGroup, fill };
  }

  private createHitFlash(): THREE.Sprite {
    const material = new THREE.SpriteMaterial({
      map: this.getHitFlashTexture(),
      color: 0xff3a3a,
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      fog: false
    });
    const sprite = new THREE.Sprite(material);
    sprite.scale.set(19.5, 19.5, 1); // 2x larger shield flash
    sprite.renderOrder = 40;
    return sprite;
  }

  private getHitFlashTexture(): THREE.Texture {
    if (this.enemyHitFlashTexture) return this.enemyHitFlashTexture;
    const size = 64;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');
    if (ctx) {
      const gradient = ctx.createRadialGradient(size / 2, size / 2, size * 0.1, size / 2, size / 2, size * 0.5);
      gradient.addColorStop(0, 'rgba(255,255,255,0.95)');
      gradient.addColorStop(0.3, 'rgba(255,70,70,0.55)');
      gradient.addColorStop(1, 'rgba(255,70,70,0)');
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, size, size);
    }
    this.enemyHitFlashTexture = new THREE.CanvasTexture(canvas);
    this.enemyHitFlashTexture.minFilter = THREE.LinearFilter;
    this.enemyHitFlashTexture.magFilter = THREE.LinearFilter;
    this.enemyHitFlashTexture.wrapS = this.enemyHitFlashTexture.wrapT = THREE.ClampToEdgeWrapping;
    return this.enemyHitFlashTexture;
  }

  private async ensurePrefabs(): Promise<void> {
    await Promise.all(
      (Object.values(EnemyType) as EnemyType[]).map(async type => {
        if (!this.prefabs[type]) {
          this.prefabs[type] = await this.loadPrefabForType(type);
        }
      })
    );
  }

  private buildSpawnList(fighters: number, interceptors: number): EnemyType[] {
    const list: EnemyType[] = [];
    for (let i = 0; i < fighters; i += 1) list.push(EnemyType.Fighter);
    for (let i = 0; i < interceptors; i += 1) list.push(EnemyType.Interceptor);
    return list;
  }

  private async loadPrefabForType(type: EnemyType): Promise<LoadedModel> {
    const archetype = this.archetypes[type];
    const model = await this.loadModel(`${this.assetsPath}/${archetype.modelPath}`);
    const size = new THREE.Vector3();
    new THREE.Box3().setFromObject(model.scene).getSize(size);

    const maxDim = Math.max(size.x, size.y, size.z);
    const scale = maxDim > 0 ? archetype.sizeTarget / maxDim : 1;
    model.scene.scale.setScalar(scale);
    this.brightenModel(model.scene, type);

    const scaledSize = size.multiplyScalar(scale);
    return { scene: model.scene, animations: model.animations, size: scaledSize };
  }

  private brightenModel(root: THREE.Object3D, type: EnemyType): void {
    root.traverse(obj => {
      if ('material' in obj && obj.material) {
        const materials = Array.isArray(obj.material) ? obj.material : [obj.material];
        materials.forEach(mat => {
          if (type === EnemyType.Interceptor) {
            if ('color' in mat && mat.color) {
              mat.color.setRGB(0.38, 0.38, 0.38); // lighter dark grey
            }
            if ('emissive' in mat) {
              mat.emissive?.setHex(0x222222);
              mat.emissiveIntensity = 0.22;
            }
          } else {
            if ('color' in mat && mat.color) {
              mat.color.multiplyScalar(0.7); // darken enemy hulls ~30%
            }
            if ('emissive' in mat) {
              mat.emissive?.copy((mat.color ?? new THREE.Color(0xffffff)).clone().multiplyScalar(0.6));
              mat.emissiveIntensity = 0.6;
            }
          }
          if ('needsUpdate' in mat) {
            (mat as THREE.Material).needsUpdate = true;
          }
        });
      }
    });
  }

  private loadModel(path: string): Promise<{ scene: THREE.Object3D; animations: THREE.AnimationClip[] }> {
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
          resolve({ scene: gltf.scene, animations: gltf.animations ?? [] });
        },
        undefined,
        error => reject(error)
      );
    });
  }

  getCount(): number {
    return this.enemies.length;
  }

  getEnemyRoots(): THREE.Object3D[] {
    return this.enemies.map(e => e.root);
  }

  getEnemyTypes(): EnemyType[] {
    return this.enemies.map(e => e.type);
  }

  destroyEnemyByRoot(root: THREE.Object3D): EnemyType | null {
    const idx = this.enemies.findIndex(e => e.root === root);
    if (idx === -1) return null;
    const enemy = this.enemies[idx];
    this.destroyEnemy(enemy);
    this.enemies.splice(idx, 1);
    return enemy.type;
  }
}
