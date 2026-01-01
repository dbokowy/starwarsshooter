import { HudElements } from './types.js';
import * as THREE from 'three';

export class Hud {
  private readonly healthBar: HTMLElement | null;
  private readonly speedBar: HTMLElement | null;
  private lowHealthBlink = false;
  private lastBlink = 0;

  constructor(elements: HudElements) {
    this.healthBar = elements.healthBar;
    this.speedBar = elements.speedBar;
  }

  updateHealth(current: number, max: number): void {
    if (!this.healthBar) return;
    const pct = Math.max(0, current) / max;
    this.healthBar.style.width = `${pct * 100}%`;

    const shouldBlink = pct < 0.3;
    if (shouldBlink) {
      // keep class applied; CSS handles animation
      this.healthBar.classList.add('blink');
    } else {
      this.healthBar.classList.remove('blink');
    }
  }

  updateSpeed(currentSpeed: number, baseSpeed: number, boostMultiplier: number): void {
    if (!this.speedBar) return;
    const minSpeed = baseSpeed;
    const maxSpeed = baseSpeed * boostMultiplier;
    const norm = THREE.MathUtils.clamp((currentSpeed - minSpeed) / (maxSpeed - minSpeed), 0, 1);
    const adjusted = 0.1 + norm * 0.9; // start at 10%, max 100%
    this.speedBar.style.width = `${adjusted * 100}%`;

    const isOverboost = norm >= 0.8;
    this.speedBar.style.setProperty('--accent', isOverboost ? '#ff513a' : 'var(--speed-accent)');
    this.speedBar.style.setProperty('--glow', isOverboost ? 'rgba(255, 81, 58, 0.55)' : 'rgba(255, 123, 84, 0.4)');
  }
}
