import * as THREE from 'three';

export class EngineFlames {
  private parent: THREE.Object3D;
  private readonly flames: THREE.Group[] = [];
  private readonly coreMaterial: THREE.MeshBasicMaterial;
  private readonly glowMaterial: THREE.MeshBasicMaterial;
  private readonly coreGeometry: THREE.ConeGeometry;
  private readonly glowGeometry: THREE.ConeGeometry;
  private readonly sparksPerFlame = 12;

  constructor(parent: THREE.Object3D, private readonly offsets: THREE.Vector3[]) {
    this.parent = parent;
    this.coreMaterial = new THREE.MeshBasicMaterial({
      color: 0xe6f7ff, // brighter light blue inner core
      transparent: true,
      opacity: 0.6,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide
    });

    this.glowMaterial = new THREE.MeshBasicMaterial({
      color: 0xff4a1f,
      transparent: true,
      opacity: 0.12,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide
    });

    const coreHeight = 2.6;
    const glowHeight = 4.2;
    this.coreGeometry = new THREE.ConeGeometry(0.38, coreHeight, 24, 1, true);
    this.glowGeometry = new THREE.ConeGeometry(0.75, glowHeight, 24, 1, true);
    // Move origin to the base so scaling only extends backward.
    this.coreGeometry.translate(0, coreHeight / 2, 0);
    this.glowGeometry.translate(0, glowHeight / 2, 0);
  }

  attach(parent?: THREE.Object3D): void {
    if (parent) {
      this.parent = parent;
    }
    this.offsets.forEach(offset => {
      const flame = new THREE.Group();
      flame.rotation.x = Math.PI / 2; // point exhaust backward (-Z in ship space)
      flame.userData.offset = offset.clone();
      flame.userData.baseRadius = 0.22; // restored original base radius
      flame.userData.baseLength = 0.2;

      const coreMaterial = this.coreMaterial.clone();
      const glowMaterial = this.glowMaterial.clone();
      const core = new THREE.Mesh(this.coreGeometry, coreMaterial);
      const glow = new THREE.Mesh(this.glowGeometry, glowMaterial);
      glow.position.y = 0.15; // trail glow slightly behind core

      core.userData.baseColor = coreMaterial.color.clone();
      glow.userData.baseColor = glowMaterial.color.clone();

      const sparks = this.createSparks();
      flame.userData.sparks = sparks;

      glow.renderOrder = 10;
      core.renderOrder = 11;

      flame.add(glow);
      flame.add(core);
      flame.add(sparks);

      this.parent.add(flame);
      this.flames.push(flame);
    });
  }

  update(
    currentSpeed: number,
    baseSpeed: number,
    boostMultiplier: number,
    time: number,
    rollBend: number = 0,
    turnLean: number = 0,
    verticalLean: number = 0
  ): void {
    if (!this.flames.length) return;

    const boostNorm = THREE.MathUtils.clamp((currentSpeed - baseSpeed) / (baseSpeed * (boostMultiplier - 1)), 0, 1);
    const flare = 0.25 + boostNorm * 0.95;
    const leanStrength = THREE.MathUtils.clamp(turnLean, -1, 1);
    const vertStrength = THREE.MathUtils.clamp(verticalLean, -1, 1); // up>0, down<0 from raw controls
    const rollStrength = Math.abs(rollBend);

    this.flames.forEach((flame, idx) => {
      const offset = flame.userData.offset as THREE.Vector3;
      const sideSign = offset.x < 0 ? -1 : 1; // left negative, right positive
      const flicker = 1 + Math.sin(time * 1.8 + idx * 0.7) * 0.06 + Math.random() * 0.04;
      const leanScale = 1 + -sideSign * leanStrength * 0.3; // right turn -> left engines longer, right shorter
      const verticalInfluence = (offset.y >= 0 ? -1 : 1) * vertStrength; // up -> top shrink, bottom grow
      const verticalScale = THREE.MathUtils.clamp(1 + verticalInfluence * 0.9, 0.7, 1.85); // softer top shrink, still visible bottom effect
      const rollScale = 1 + rollStrength * 0.8;
      const lengthScale = THREE.MathUtils.lerp(0.2646, 6.8, flare) * flicker * leanScale * verticalScale * rollScale; // further ~30% shorter at idle
      const radiusScaleBias = THREE.MathUtils.clamp(1 + verticalInfluence * 0.45 + rollStrength * 0.25, 0.85, 1.45);
      const radiusScale = THREE.MathUtils.lerp(0.1568, 1.6, flare) * flicker; // thinner at idle
      flame.scale.set(
        flame.userData.baseRadius * radiusScale * radiusScaleBias,
        flame.userData.baseLength * lengthScale,
        flame.userData.baseRadius * radiusScale * radiusScaleBias
      );

      // keep origin at nozzle; with base-translated geometry, scaling now extends only backward
      flame.position.copy(flame.userData.offset);
      flame.rotation.z = rollBend; // bend exhaust opposite roll

      const targetOpacity = THREE.MathUtils.lerp(0.18, 0.85, flare);
      flame.children.forEach(child => {
        if (child instanceof THREE.Mesh && child.material && 'opacity' in child.material) {
          const material = child.material as THREE.Material & { opacity: number };
          const isGlow = child === flame.children[0];
          const isCore = child === flame.children[1];
          const boostedOpacity = isCore ? targetOpacity * 1.4 : targetOpacity;
          material.opacity = THREE.MathUtils.lerp(material.opacity, Math.min(1, boostedOpacity), 0.2);

          const boostHeat = THREE.MathUtils.clamp((boostNorm - 0.8) / 0.2, 0, 1);
          const baseColor = (child.userData.baseColor as THREE.Color) ?? material.color.clone();
          const hotColor = isCore ? new THREE.Color(0x0bc2ff) : new THREE.Color(0xff1500);
          material.color.lerpColors(baseColor, hotColor, boostHeat);
        }
      });

      const sparks = flame.userData.sparks as THREE.Points | undefined;
      if (sparks) {
        const attr = sparks.geometry.getAttribute('position') as THREE.BufferAttribute;
        for (let i = 0; i < attr.count; i += 1) {
          const t = Math.random();
          const radial = Math.random() * 0.35;
          const angle = Math.random() * Math.PI * 2;
          const x = Math.cos(angle) * radial;
          const z = Math.sin(angle) * radial;
          const y = Math.random() * 1.2 + t * 0.4; // keep near nozzle, slight upward jitter
          attr.setXYZ(i, x, y, z);
        }
        attr.needsUpdate = true;
        const sm = sparks.material as THREE.PointsMaterial;
        const sparkOpacity = THREE.MathUtils.clamp(THREE.MathUtils.lerp(0.18, 0.48, flare) * (1 + Math.sin(time * 9 + idx)), 0, 0.8);
        sm.opacity = sparkOpacity;
        sm.size = THREE.MathUtils.lerp(0.2, 0.42, flare);
        sparks.scale.setScalar(1 + Math.abs(leanStrength) * 0.1);
        sparks.scale.z *= 1 + (-sideSign * leanStrength) * 0.12;
      }

    });
  }

  setVisible(visible: boolean): void {
    this.flames.forEach(flame => {
      flame.visible = visible;
    });
  }

  private createSparks(): THREE.Points {
    const positions = new Float32Array(this.sparksPerFlame * 3);
    for (let i = 0; i < this.sparksPerFlame; i += 1) {
      positions[i * 3] = 0;
      positions[i * 3 + 1] = 0;
      positions[i * 3 + 2] = 0;
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const material = new THREE.PointsMaterial({
      map: getFlameParticleTexture(),
      color: 0xbbe5ff,
      size: 0.28,
      sizeAttenuation: true,
      transparent: true,
      opacity: 0.25,
      depthWrite: false,
      depthTest: true,
      blending: THREE.AdditiveBlending
    });
    const sparks = new THREE.Points(geometry, material);
    sparks.frustumCulled = false;
    sparks.renderOrder = 12;
    sparks.position.y = 0.12;
    return sparks;
  }
}

let cachedFlameParticle: THREE.Texture | null = null;
function getFlameParticleTexture(): THREE.Texture {
  if (cachedFlameParticle) return cachedFlameParticle;
  const size = 64;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    const grad = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    grad.addColorStop(0, 'rgba(255, 255, 255, 1)');
    grad.addColorStop(0.25, 'rgba(150, 220, 255, 0.9)');
    grad.addColorStop(0.6, 'rgba(90, 180, 255, 0.38)');
    grad.addColorStop(1, 'rgba(40, 120, 220, 0)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, size, size);
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.encoding = THREE.sRGBColorSpace;
  tex.generateMipmaps = true;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.needsUpdate = true;
  cachedFlameParticle = tex;
  return tex;
}
