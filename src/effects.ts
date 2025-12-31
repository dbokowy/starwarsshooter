import * as THREE from 'three';

export class EngineFlames {
  private readonly flames: THREE.Group[] = [];
  private readonly coreMaterial: THREE.MeshBasicMaterial;
  private readonly glowMaterial: THREE.MeshBasicMaterial;
  private readonly coreGeometry: THREE.ConeGeometry;
  private readonly glowGeometry: THREE.ConeGeometry;

  constructor(private readonly parent: THREE.Object3D, private readonly offsets: THREE.Vector3[]) {
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

    this.coreGeometry = new THREE.ConeGeometry(0.38, 2.6, 18, 1, true);
    this.glowGeometry = new THREE.ConeGeometry(0.75, 4.2, 18, 1, true);
  }

  attach(): void {
    this.offsets.forEach(offset => {
      const flame = new THREE.Group();
      flame.rotation.x = -Math.PI / 2;
      flame.userData.offset = offset.clone();
      flame.userData.baseRadius = 0.55;
      flame.userData.baseLength = 1;

      const core = new THREE.Mesh(this.coreGeometry, this.coreMaterial.clone());
      const glow = new THREE.Mesh(this.glowGeometry, this.glowMaterial.clone());
      glow.position.y = 0.15; // trail glow slightly behind core

      flame.add(glow);
      flame.add(core);

      this.parent.add(flame);
      this.flames.push(flame);
    });
  }

  update(currentSpeed: number, baseSpeed: number, boostMultiplier: number, time: number): void {
    if (!this.flames.length) return;

    const boostNorm = THREE.MathUtils.clamp((currentSpeed - baseSpeed) / (baseSpeed * (boostMultiplier - 1)), 0, 1);
    const flare = 0.25 + boostNorm * 0.95;

    this.flames.forEach((flame, idx) => {
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
        if (child instanceof THREE.Mesh && child.material && 'opacity' in child.material) {
          const material = child.material as THREE.Material & { opacity: number };
          material.opacity = THREE.MathUtils.lerp(material.opacity, targetOpacity, 0.2);
        }
      });
    });
  }
}
