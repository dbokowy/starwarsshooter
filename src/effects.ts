import * as THREE from 'three';

export class EngineFlames {
  private parent: THREE.Object3D;
  private readonly flames: THREE.Group[] = [];
  private readonly coreMaterial: THREE.MeshBasicMaterial;
  private readonly glowMaterial: THREE.MeshBasicMaterial;
  private readonly coreGeometry: THREE.ConeGeometry;
  private readonly glowGeometry: THREE.ConeGeometry;

  constructor(parent: THREE.Object3D, private readonly offsets: THREE.Vector3[]) {
    this.parent = parent;
    this.coreMaterial = new THREE.MeshBasicMaterial({
      color: 0xfff2cc,
      transparent: true,
      opacity: 0.92,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide
    });

    this.glowMaterial = new THREE.MeshBasicMaterial({
      color: 0xff7547,
      transparent: true,
      opacity: 0.34,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide
    });

    const coreHeight = 2.6;
    const glowHeight = 4.2;
    this.coreGeometry = new THREE.ConeGeometry(0.38, coreHeight, 18, 1, true);
    this.glowGeometry = new THREE.ConeGeometry(0.75, glowHeight, 18, 1, true);
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
      flame.userData.baseRadius = 0.22; // doubled base radius for wider exhaust
      flame.userData.baseLength = 0.2;

      const coreMaterial = this.coreMaterial.clone();
      const glowMaterial = this.glowMaterial.clone();
      const core = new THREE.Mesh(this.coreGeometry, coreMaterial);
      const glow = new THREE.Mesh(this.glowGeometry, glowMaterial);
      glow.position.y = 0.15; // trail glow slightly behind core

      core.userData.baseColor = coreMaterial.color.clone();
      glow.userData.baseColor = glowMaterial.color.clone();

      flame.add(glow);
      flame.add(core);

      this.parent.add(flame);
      this.flames.push(flame);
    });
  }

  update(currentSpeed: number, baseSpeed: number, boostMultiplier: number, time: number, rollBend: number = 0): void {
    if (!this.flames.length) return;

    const boostNorm = THREE.MathUtils.clamp((currentSpeed - baseSpeed) / (baseSpeed * (boostMultiplier - 1)), 0, 1);
    const flare = 0.25 + boostNorm * 0.95;

    this.flames.forEach((flame, idx) => {
      const flicker = 1 + Math.sin(time * 1.8 + idx * 0.7) * 0.06 + Math.random() * 0.04;
      const lengthScale = THREE.MathUtils.lerp(1.1, 6.8, flare) * flicker; // 2x previous max length at full throttle
      const radiusScale = THREE.MathUtils.lerp(0.65, 1.6, flare) * flicker; // keep current max diameter
      flame.scale.set(
        flame.userData.baseRadius * radiusScale,
        flame.userData.baseLength * lengthScale,
        flame.userData.baseRadius * radiusScale
      );

      // keep origin at nozzle; with base-translated geometry, scaling now extends only backward
      flame.position.copy(flame.userData.offset);
      flame.rotation.z = rollBend; // bend exhaust opposite roll

      const targetOpacity = THREE.MathUtils.lerp(0.18, 0.85, flare);
      flame.children.forEach(child => {
        if (child instanceof THREE.Mesh && child.material && 'opacity' in child.material) {
          const material = child.material as THREE.Material & { opacity: number };
          material.opacity = THREE.MathUtils.lerp(material.opacity, targetOpacity, 0.2);

          const boostHeat = THREE.MathUtils.clamp((boostNorm - 0.8) / 0.2, 0, 1);
          const baseColor = (child.userData.baseColor as THREE.Color) ?? material.color.clone();
          const hotColor = child === flame.children[0] ? new THREE.Color(0xff5a3c) : new THREE.Color(0xff2a1a);
          material.color.lerpColors(baseColor, hotColor, boostHeat);
        }
      });
    });
  }

  setVisible(visible: boolean): void {
    this.flames.forEach(flame => {
      flame.visible = visible;
    });
  }
}
