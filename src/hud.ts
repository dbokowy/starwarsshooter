import { HudElements } from './types.js';
import * as THREE from 'three';

export class Hud {
  private readonly healthBar: HTMLElement | null;
  private readonly speedBar: HTMLElement | null;
  private readonly speedBarRegen: HTMLElement | null;
  private lowHealthBlink = false;
  private lastBlink = 0;

  constructor(elements: HudElements) {
    this.healthBar = elements.healthBar;
    this.speedBar = elements.speedBar;
    this.speedBarRegen = document.getElementById('speed-bar-regen');
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

  updateSpeed(currentSpeed: number, baseSpeed: number, boostMultiplier: number, regenRatio: number = 1): void {
    if (!this.speedBar) return;
    const minSpeed = baseSpeed;
    const maxSpeed = 120; // visual cap: target top speed
    const norm = THREE.MathUtils.clamp((currentSpeed - minSpeed) / Math.max(1e-6, maxSpeed - minSpeed), 0, 1);
    const adjusted = 0.1 + norm * 0.9; // start at 10%, max 100%
    this.speedBar.style.width = `${adjusted * 100}%`;
    const warning = currentSpeed > maxSpeed;
    this.speedBar.classList.toggle('speed-warning-blink', warning);
    this.speedBar.classList.toggle('speed-warning', warning);

    this.speedBar.style.setProperty('--accent', warning ? '#ff3a2a' : 'var(--speed-accent)');
    this.speedBar.style.setProperty('--glow', warning ? 'rgba(255, 58, 42, 0.6)' : 'rgba(255, 123, 84, 0.4)');

    if (this.speedBarRegen) {
      const clamped = THREE.MathUtils.clamp(regenRatio, 0, 1);
      this.speedBarRegen.style.width = `${clamped * 100}%`;
      this.speedBarRegen.classList.toggle('regen-active', clamped < 1);
    }
  }
}
