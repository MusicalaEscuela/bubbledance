'use strict';

/**
 * game.js — Lógica del minijuego BubbleDance
 *
 * Depende de: tracker.js (clase PoseTracker)
 *
 * FLUJO:
 *  const game = new BubbleGame(canvasEl, trackerInstance);
 *  game.startGame(choreoIndex);
 *  // El canvas escucha: 'gameover' → { score, maxCombo, hits, total, choreoName }
 */

// ─────────────────────────────────────────────────────────────────────────────
// COREOGRAFÍAS PREGRABADAS
// ─────────────────────────────────────────────────────────────────────────────

const CHOREOGRAPHIES = [
  {
    name:  'Principiante',
    emoji: '🌱',
    bpm:   72,
    steps: [
      'right','left','right','left',
      'up','down','right','left',
      'up','right','left','down'
    ]
  },
  {
    name:  'Calentando',
    emoji: '🔥',
    bpm:   100,
    steps: [
      'right','right','left','up',
      'right','left','left','down',
      'up','right','down','left',
      'up','up','right','left'
    ]
  },
  {
    name:  'Explosión',
    emoji: '⚡',
    bpm:   128,
    steps: [
      'right','left','up','down',
      'right','right','left','up',
      'left','down','right','up',
      'left','right','down','up',
      'right','left','down','right'
    ]
  }
];

// ─────────────────────────────────────────────────────────────────────────────
// ZONAS (normalizadas 0–1, esquinas de la pantalla)
// ─────────────────────────────────────────────────────────────────────────────

const ZONES = {
  left:  { x: 0.01, y: 0.28, w: 0.21, h: 0.44 },
  right: { x: 0.78, y: 0.28, w: 0.21, h: 0.44 },
  up:    { x: 0.28, y: 0.01, w: 0.44, h: 0.20 },
  down:  { x: 0.28, y: 0.79, w: 0.44, h: 0.20 }
};

const ARROWS = { left: '←', right: '→', up: '↑', down: '↓' };

const COLORS = {
  left:   '#ff4fa3',   // rosa neón
  right:  '#00f5d4',   // cyan
  up:     '#ffe45e',   // amarillo
  down:   '#a78bfa'    // violeta
};

// ─────────────────────────────────────────────────────────────────────────────
// UTILIDADES
// ─────────────────────────────────────────────────────────────────────────────

const lerp    = (a, b, t)  => a + (b - a) * t;
const easeOut = t          => 1 - Math.pow(1 - t, 3);
const clamp   = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

// ─────────────────────────────────────────────────────────────────────────────
// PARTÍCULA
// ─────────────────────────────────────────────────────────────────────────────

class Particle {
  constructor(x, y, color) {
    this.x     = x;
    this.y     = y;
    this.color = color;

    const angle = Math.random() * Math.PI * 2;
    const speed = 90 + Math.random() * 240;
    this.vx      = Math.cos(angle) * speed;
    this.vy      = Math.sin(angle) * speed - 70;
    this.gravity = 320;
    this.life    = 1;
    this.decay   = 0.7 + Math.random() * 0.6;
    this.size    = 3 + Math.random() * 8;
    this.diamond = Math.random() < 0.4;  // mezcla de círculos y rombos
  }

  update(dt) {
    this.vy  += this.gravity * dt;
    this.x   += this.vx * dt;
    this.y   += this.vy * dt;
    this.life -= this.decay * dt;
  }

  draw(ctx) {
    if (this.life <= 0) return;
    const a = clamp(this.life, 0, 1);
    const s = this.size * a;
    ctx.save();
    ctx.globalAlpha = a;
    ctx.fillStyle   = this.color;
    if (this.diamond) {
      ctx.beginPath();
      ctx.moveTo(this.x,       this.y - s);
      ctx.lineTo(this.x + s * 0.55, this.y);
      ctx.lineTo(this.x,       this.y + s);
      ctx.lineTo(this.x - s * 0.55, this.y);
      ctx.closePath();
      ctx.fill();
    } else {
      ctx.beginPath();
      ctx.arc(this.x, this.y, s, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// ETIQUETA DE FEEDBACK (¡PERFECTO!, MISS, etc.)
// ─────────────────────────────────────────────────────────────────────────────

class FeedbackLabel {
  constructor(text, x, y, color, fontSize = 28) {
    this.text     = text;
    this.x        = x;
    this.y        = y;
    this.color    = color;
    this.life     = 1;
    this.vy       = -90;
    this.fontSize = fontSize;
  }

  update(dt) {
    this.y    += this.vy * dt;
    this.life -= 1.6 * dt;
  }

  draw(ctx) {
    if (this.life <= 0) return;
    const alpha = clamp(this.life * 2.2, 0, 1);
    ctx.save();
    ctx.globalAlpha    = alpha;
    ctx.font           = `bold ${this.fontSize}px 'Orbitron', 'Courier New', monospace`;
    ctx.fillStyle      = this.color;
    ctx.textAlign      = 'center';
    ctx.textBaseline   = 'middle';
    ctx.shadowColor    = this.color;
    ctx.shadowBlur     = 14;
    ctx.fillText(this.text, this.x, this.y);
    ctx.restore();
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// BURBUJA
// ─────────────────────────────────────────────────────────────────────────────

class Bubble {
  constructor(direction, cw, ch) {
    this.direction = direction;
    this.color     = COLORS[direction];

    const zone    = ZONES[direction];
    this.originX  = (zone.x + zone.w / 2) * cw;
    this.originY  = (zone.y + zone.h / 2) * ch;
    this.x        = this.originX;
    this.y        = this.originY;
    this.destX    = cw / 2;
    this.destY    = ch / 2;

    this.radius   = Math.min(cw, ch) * 0.065;
    this.progress = 0;      // 0 = zona de origen → 1 = centro (miss)
    this.popping  = false;  // animación de explosión
    this.popT     = 0;      // progreso de la animación pop (0→1)
    this.alive    = true;
  }

  update(dt, stepDurMs) {
    if (this.popping) {
      this.popT += dt * 3.5;
      if (this.popT >= 1) this.alive = false;
      return;
    }

    this.progress = Math.min(1, this.progress + dt / (stepDurMs / 1000));
    const t  = easeOut(this.progress);
    this.x   = lerp(this.originX, this.destX, t);
    this.y   = lerp(this.originY, this.destY, t);

    if (this.progress >= 1) this.alive = false;  // miss si llega al centro
  }

  pop() {
    if (this.popping) return;
    this.popping = true;
    this.popT    = 0;
  }

  isMissed() {
    return !this.popping && this.progress >= 1;
  }

  /** Colisión directa con la muñeca (círculo sobre círculo) */
  hitTest(wx, wy) {
    if (this.popping) return false;
    return Math.hypot(this.x - wx, this.y - wy) < this.radius + 30;
  }

  /** Colisión con zona de origen (permite explotar antes de que la burbuja salga) */
  zoneHitTest(wx, wy, cw, ch) {
    if (this.popping) return false;
    const z  = ZONES[this.direction];
    const zx = z.x * cw, zy = z.y * ch;
    const zw = z.w * cw, zh = z.h * ch;
    return wx >= zx && wx <= zx + zw && wy >= zy && wy <= zy + zh;
  }

  draw(ctx) {
    if (!this.alive) return;

    ctx.save();

    if (this.popping) {
      // Escala hacia afuera y se desvanece
      const scale = 1 + this.popT * 2;
      const alpha = clamp(1 - this.popT, 0, 1);
      ctx.globalAlpha = alpha;
      ctx.translate(this.x, this.y);
      ctx.scale(scale, scale);
      ctx.translate(-this.x, -this.y);
    }

    const pulse = 1 + 0.07 * Math.sin(Date.now() / 130);
    const r     = this.radius;

    // Halo exterior
    const halo = ctx.createRadialGradient(this.x, this.y, 0, this.x, this.y, r * 2.3);
    halo.addColorStop(0, this.color + '44');
    halo.addColorStop(1, this.color + '00');
    ctx.fillStyle = halo;
    ctx.beginPath();
    ctx.arc(this.x, this.y, r * 2.3 * pulse, 0, Math.PI * 2);
    ctx.fill();

    // Cuerpo de la burbuja
    const body = ctx.createRadialGradient(
      this.x - r * 0.3, this.y - r * 0.35, r * 0.05,
      this.x,            this.y,             r * pulse
    );
    body.addColorStop(0, '#ffffff99');
    body.addColorStop(0.4, this.color + 'bb');
    body.addColorStop(1,   this.color + 'ee');
    ctx.beginPath();
    ctx.arc(this.x, this.y, r * pulse, 0, Math.PI * 2);
    ctx.fillStyle   = body;
    ctx.fill();
    ctx.strokeStyle = this.color;
    ctx.lineWidth   = 2.5;
    ctx.stroke();

    // Anillo de cuenta regresiva
    const remaining = 1 - this.progress;
    ctx.beginPath();
    ctx.arc(this.x, this.y, r * pulse + 11,
      -Math.PI / 2,
      -Math.PI / 2 + Math.PI * 2 * remaining
    );
    ctx.strokeStyle = this.color;
    ctx.lineWidth   = 4;
    ctx.lineCap     = 'round';
    ctx.stroke();

    // Flecha interior
    ctx.font           = `bold ${r * 0.88}px monospace`;
    ctx.fillStyle      = '#ffffff';
    ctx.textAlign      = 'center';
    ctx.textBaseline   = 'middle';
    ctx.shadowColor    = this.color;
    ctx.shadowBlur     = 10;
    ctx.fillText(ARROWS[this.direction], this.x, this.y + 1);

    ctx.restore();
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// BUBBLEGAME — clase principal
// ─────────────────────────────────────────────────────────────────────────────

class BubbleGame {

  constructor(canvas, tracker) {
    this.canvas  = canvas;
    this.ctx     = canvas.getContext('2d');
    this.tracker = tracker;

    // Estado del juego
    this.state        = 'idle';   // idle | countdown | playing | results
    this.choreo       = null;
    this.stepIndex    = 0;
    this.score        = 0;
    this.combo        = 0;
    this.maxCombo     = 0;
    this.stepResults  = [];       // 'hit' | 'miss' por paso

    // Burbuja activa
    this.bubble             = null;
    this.stepDurationMs     = 2000;
    this.nextBubbleCooldown = 0;  // ms de espera antes de la siguiente burbuja

    // Efectos visuales
    this.particles = [];
    this.feedbacks = [];

    // Cuenta regresiva
    this.countdownVal   = 3;
    this.countdownTimer = 1000;   // ms hasta cambiar número

    // Loop RAF
    this._rafId    = null;
    this._lastTime = null;
    this._tick     = this._tick.bind(this);
  }

  // ─── API Pública ────────────────────────────────────────────────────────────

  /**
   * Arranca el juego con la coreografía indicada.
   * @param {number} choreoIndex - índice en CHOREOGRAPHIES[]
   */
  startGame(choreoIndex) {
    this.choreo       = CHOREOGRAPHIES[choreoIndex];
    this.stepIndex    = 0;
    this.score        = 0;
    this.combo        = 0;
    this.maxCombo     = 0;
    this.stepResults  = [];
    this.bubble       = null;
    this.particles    = [];
    this.feedbacks    = [];
    this.nextBubbleCooldown = 0;

    // stepDuration = 2 tiempos a la BPM dada
    this.stepDurationMs = Math.round((60 / this.choreo.bpm) * 2 * 1000);

    this.state          = 'countdown';
    this.countdownVal   = 3;
    this.countdownTimer = 1100;

    if (this._rafId) cancelAnimationFrame(this._rafId);
    this._lastTime = null;
    this._rafId    = requestAnimationFrame(this._tick);
  }

  stop() {
    if (this._rafId) cancelAnimationFrame(this._rafId);
    this._rafId = null;
    this.state  = 'idle';
  }

  // ─── Loop principal ─────────────────────────────────────────────────────────

  _tick(ts) {
    if (!this._lastTime) this._lastTime = ts;
    const dt = Math.min((ts - this._lastTime) / 1000, 0.08);  // cap a 80ms
    this._lastTime = ts;

    this._update(dt);
    this._draw();

    if (this.state !== 'idle') {
      this._rafId = requestAnimationFrame(this._tick);
    }
  }

  // ─── Update ─────────────────────────────────────────────────────────────────

  _update(dt) {
    // ── Cuenta regresiva ──
    if (this.state === 'countdown') {
      this.countdownTimer -= dt * 1000;
      if (this.countdownTimer <= 0) {
        this.countdownVal--;
        this.countdownTimer = 1000;
        if (this.countdownVal <= 0) {
          this.state = 'playing';
          this._spawnBubble();
        }
      }
      return;
    }

    if (this.state !== 'playing') return;

    // ── Cooldown entre burbujas ──
    if (this.nextBubbleCooldown > 0) {
      this.nextBubbleCooldown -= dt * 1000;
      if (this.nextBubbleCooldown <= 0 && !this.bubble) {
        this._spawnBubble();
      }
    }

    // ── Efectos visuales ──
    this.particles = this.particles.filter(p => p.life > 0);
    this.particles.forEach(p => p.update(dt));
    this.feedbacks = this.feedbacks.filter(f => f.life > 0);
    this.feedbacks.forEach(f => f.update(dt));

    if (!this.bubble) return;

    // ── Actualizar burbuja ──
    this.bubble.update(dt, this.stepDurationMs);

    // ── Miss si llega al centro ──
    if (this.bubble.isMissed()) {
      this._registerResult('miss');
      return;
    }

    // ── Detección de colisión con muñecas ──
    const { left, right } = this.tracker.getWrists();
    const cw = this.canvas.width, ch = this.canvas.height;

    for (const w of [left, right]) {
      if (!w) continue;
      const isHit = this.bubble.hitTest(w.x, w.y) ||
                    this.bubble.zoneHitTest(w.x, w.y, cw, ch);
      if (isHit) {
        this._registerResult('hit', w.x, w.y);
        return;
      }
    }
  }

  // ─── Burbujas ────────────────────────────────────────────────────────────────

  _spawnBubble() {
    if (this.stepIndex >= this.choreo.steps.length) {
      this.state = 'results';
      this._emitGameOver();
      return;
    }
    const dir  = this.choreo.steps[this.stepIndex];
    this.bubble = new Bubble(dir, this.canvas.width, this.canvas.height);
  }

  _registerResult(result, hitX, hitY) {
    const b        = this.bubble;
    const progress = b.progress;

    let points = 0, label = '', labelColor = '#fff';

    if (result === 'hit') {
      b.pop();

      const timing = 1 - progress;   // qué tan temprano fue el golpe
      if      (timing > 0.55) { points = 300; label = '¡PERFECTO!'; labelColor = '#ffe45e'; }
      else if (timing > 0.25) { points = 200; label = '¡BIEN!';     labelColor = '#00f5d4'; }
      else                    { points = 100; label = 'OK';          labelColor = '#a78bfa'; }

      this.combo++;
      this.maxCombo = Math.max(this.maxCombo, this.combo);

      // Multiplicador de combo: +0.5 por cada 3 golpes consecutivos
      const mult = 1 + Math.floor((this.combo - 1) / 3) * 0.5;
      points      = Math.round(points * mult);

      // Partículas
      const bx = hitX ?? b.x, by = hitY ?? b.y;
      for (let i = 0; i < 24; i++) this.particles.push(new Particle(bx, by, b.color));

      this.feedbacks.push(new FeedbackLabel(label, bx, by - 55, labelColor));
      if (this.combo >= 2) {
        this.feedbacks.push(new FeedbackLabel(`×${this.combo}`, bx + 65, by - 30, '#fff', 20));
      }

    } else {
      // Miss
      this.combo = 0;
      for (let i = 0; i < 7; i++) this.particles.push(new Particle(b.x, b.y, '#ff2255'));
      this.feedbacks.push(new FeedbackLabel('MISS', b.x, b.y - 45, '#ff3366'));
    }

    this.score += points;
    this.stepResults.push(result);
    this.stepIndex++;
    this.bubble             = null;
    this.nextBubbleCooldown = result === 'hit' ? 300 : 480;
  }

  _emitGameOver() {
    const hits = this.stepResults.filter(r => r === 'hit').length;
    this.canvas.dispatchEvent(new CustomEvent('gameover', {
      detail: {
        score:      this.score,
        maxCombo:   this.maxCombo,
        hits,
        total:      this.stepResults.length,
        choreoName: this.choreo.name
      }
    }));
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // DIBUJO
  // ─────────────────────────────────────────────────────────────────────────────

  _draw() {
    const { ctx } = this;
    const W = this.canvas.width;
    const H = this.canvas.height;
    ctx.clearRect(0, 0, W, H);

    switch (this.state) {
      case 'countdown': this._drawCountdown(W, H); return;
      case 'results':   this._drawResults(W, H);   return;
    }

    this._drawZones(W, H);
    this._drawSequenceBar(W, H);
    this.particles.forEach(p => p.draw(ctx));
    this.bubble?.draw(ctx);
    this.feedbacks.forEach(f => f.draw(ctx));
    this._drawWrists(W, H);
    this._drawHUD(W, H);
  }

  // ── Zonas ──────────────────────────────────────────────────────────────────

  _drawZones(W, H) {
    const { ctx } = this;
    const now     = Date.now();

    for (const [dir, zone] of Object.entries(ZONES)) {
      const x = zone.x * W, y = zone.y * H;
      const w = zone.w * W, h = zone.h * H;
      const color    = COLORS[dir];
      const isActive = this.bubble?.direction === dir;
      const pulse    = isActive ? 0.5 + 0.28 * Math.sin(now / 180) : 0;

      ctx.save();

      // Fondo de la zona
      ctx.globalAlpha = 0.06 + pulse * 0.18;
      ctx.fillStyle   = color;
      ctx.beginPath();
      if (ctx.roundRect) ctx.roundRect(x, y, w, h, 14);
      else                ctx.rect(x, y, w, h);
      ctx.fill();

      // Borde
      ctx.globalAlpha = 0.22 + pulse * 0.55;
      ctx.strokeStyle = color;
      ctx.lineWidth   = isActive ? 2.5 : 1;
      ctx.setLineDash(isActive ? [] : [7, 5]);
      ctx.stroke();
      ctx.setLineDash([]);

      // Flecha central de la zona
      ctx.globalAlpha  = 0.28 + pulse * 0.52;
      ctx.font         = `bold ${Math.min(w, h) * 0.52}px monospace`;
      ctx.fillStyle    = color;
      ctx.textAlign    = 'center';
      ctx.textBaseline = 'middle';
      ctx.shadowColor  = color;
      ctx.shadowBlur   = isActive ? 20 : 4;
      ctx.fillText(ARROWS[dir], x + w / 2, y + h / 2);

      ctx.restore();
    }
  }

  // ── Barra de secuencia próxima ──────────────────────────────────────────────

  _drawSequenceBar(W, H) {
    const { ctx }    = this;
    const upcoming   = this.choreo.steps.slice(this.stepIndex, this.stepIndex + 7);
    if (!upcoming.length) return;

    const slotW  = 38;
    const totalW = upcoming.length * slotW;
    const startX = W / 2 - totalW / 2 + slotW / 2;
    const y      = H - 38;

    upcoming.forEach((dir, i) => {
      const x     = startX + i * slotW;
      const alpha = i === 0 ? 1 : Math.max(0.1, 0.55 - i * 0.09);
      ctx.save();
      ctx.globalAlpha  = alpha;
      ctx.font         = `bold ${i === 0 ? 30 : 22}px monospace`;
      ctx.fillStyle    = COLORS[dir];
      ctx.textAlign    = 'center';
      ctx.textBaseline = 'middle';
      ctx.shadowColor  = COLORS[dir];
      ctx.shadowBlur   = i === 0 ? 14 : 0;
      ctx.fillText(ARROWS[dir], x, y);
      ctx.restore();
    });

    // Línea separadora sutil
    ctx.save();
    ctx.globalAlpha = 0.2;
    ctx.strokeStyle = '#fff';
    ctx.lineWidth   = 1;
    ctx.beginPath();
    ctx.moveTo(W / 2 - totalW / 2 - 8, H - 58);
    ctx.lineTo(W / 2 + totalW / 2 + 8, H - 58);
    ctx.stroke();
    ctx.restore();
  }

  // ── Indicadores de muñecas ─────────────────────────────────────────────────

  _drawWrists(W, H) {
    const { ctx } = this;
    const { left, right } = this.tracker.getWrists();
    const wristColor = { left: '#ff4fa3', right: '#00f5d4' };

    for (const [side, w] of [['left', left], ['right', right]]) {
      if (!w) continue;
      const color = wristColor[side];

      // Halo
      const grad = ctx.createRadialGradient(w.x, w.y, 0, w.x, w.y, 38);
      grad.addColorStop(0, color + 'bb');
      grad.addColorStop(1, color + '00');
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(w.x, w.y, 38, 0, Math.PI * 2);
      ctx.fill();

      // Punto central
      ctx.beginPath();
      ctx.arc(w.x, w.y, 10, 0, Math.PI * 2);
      ctx.fillStyle   = color;
      ctx.shadowColor = color;
      ctx.shadowBlur  = 10;
      ctx.fill();
      ctx.strokeStyle = '#fff';
      ctx.lineWidth   = 2;
      ctx.shadowBlur  = 0;
      ctx.stroke();
    }
  }

  // ── HUD (score, combo, paso) ───────────────────────────────────────────────

  _drawHUD(W, H) {
    const { ctx } = this;

    // Puntuación
    ctx.save();
    ctx.font           = `bold 30px 'Courier New', monospace`;
    ctx.fillStyle      = '#ffffff';
    ctx.textAlign      = 'right';
    ctx.textBaseline   = 'top';
    ctx.shadowColor    = '#ffffff';
    ctx.shadowBlur     = 6;
    ctx.fillText(this.score.toLocaleString(), W - 18, 14);

    ctx.font           = `14px 'Courier New', monospace`;
    ctx.fillStyle      = '#ffffff55';
    ctx.shadowBlur     = 0;
    ctx.fillText(`${this.stepIndex} / ${this.choreo.steps.length}`, W - 18, 50);
    ctx.restore();

    // Combo
    if (this.combo >= 2) {
      ctx.save();
      const size = 22 + Math.min(this.combo, 12) * 2;
      ctx.font           = `bold ${size}px 'Courier New', monospace`;
      ctx.fillStyle      = '#ffe45e';
      ctx.textAlign      = 'left';
      ctx.textBaseline   = 'top';
      ctx.shadowColor    = '#ffe45e';
      ctx.shadowBlur     = 16;
      ctx.fillText(`COMBO ×${this.combo}`, 18, 14);
      ctx.restore();
    }
  }

  // ── Cuenta regresiva ───────────────────────────────────────────────────────

  _drawCountdown(W, H) {
    const { ctx } = this;
    const pct     = 1 - clamp(this.countdownTimer / 1000, 0, 1);

    ctx.save();
    ctx.textAlign    = 'center';
    ctx.textBaseline = 'middle';

    // Nombre de la coreografía
    ctx.font         = `bold 20px 'Courier New', monospace`;
    ctx.fillStyle    = '#ffffff88';
    ctx.fillText(`${this.choreo.emoji}  ${this.choreo.name.toUpperCase()}`, W / 2, H / 2 - 90);
    ctx.fillText(`${this.choreo.bpm} BPM · ${this.choreo.steps.length} PASOS`, W / 2, H / 2 - 62);

    // Número grande
    ctx.globalAlpha = 1 - pct * 0.25;
    ctx.font        = `bold ${H * 0.26}px 'Courier New', monospace`;
    ctx.fillStyle   = '#ffffff';
    ctx.shadowColor = '#ffffff';
    ctx.shadowBlur  = 28 * (1 - pct);
    ctx.save();
    ctx.translate(W / 2, H / 2 + 20);
    ctx.scale(1 + pct * 0.3, 1 + pct * 0.3);
    ctx.fillText(this.countdownVal > 0 ? String(this.countdownVal) : '¡YA!', 0, 0);
    ctx.restore();

    ctx.restore();
  }

  // ── Resultados ─────────────────────────────────────────────────────────────

  _drawResults(W, H) {
    const { ctx } = this;
    const hits  = this.stepResults.filter(r => r === 'hit').length;
    const total = this.stepResults.length;
    const pct   = Math.round((hits / total) * 100);
    const rating = pct >= 90 ? 'S  ★★★' : pct >= 75 ? 'A  ★★☆' : pct >= 50 ? 'B  ★☆☆' : 'C  ☆☆☆';

    // Panel central
    const pw = Math.min(W * 0.72, 480);
    const ph = Math.min(H * 0.66, 420);
    const px = (W - pw) / 2;
    const py = (H - ph) / 2;

    ctx.save();
    ctx.fillStyle   = 'rgba(4, 4, 18, 0.93)';
    ctx.shadowColor = '#00f5d4';
    ctx.shadowBlur  = 30;
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(px, py, pw, ph, 24);
    else                ctx.rect(px, py, pw, ph);
    ctx.fill();
    ctx.strokeStyle = '#ffffff18';
    ctx.lineWidth   = 1;
    ctx.shadowBlur  = 0;
    ctx.stroke();
    ctx.restore();

    ctx.save();
    ctx.textAlign = 'center';

    // Título
    ctx.font         = `bold 32px 'Courier New', monospace`;
    ctx.fillStyle    = '#ffe45e';
    ctx.shadowColor  = '#ffe45e';
    ctx.shadowBlur   = 18;
    ctx.fillText('RESULTADO', W / 2, py + 52);

    // Puntuación
    ctx.font         = `bold 52px 'Courier New', monospace`;
    ctx.fillStyle    = '#ffffff';
    ctx.shadowColor  = '#ffffff';
    ctx.shadowBlur   = 10;
    ctx.fillText(this.score.toLocaleString(), W / 2, py + 120);

    // Stats
    const statY = py + ph * 0.56;
    const stats = [
      { label: 'ACIERTOS',  value: `${hits}/${total}`, color: '#00f5d4' },
      { label: 'PRECISIÓN', value: `${pct}%`,           color: '#a78bfa' },
      { label: 'MAX COMBO', value: `×${this.maxCombo}`, color: '#ff4fa3' }
    ];
    stats.forEach((s, i) => {
      const sx = W / 2 + (i - 1) * (pw / 3);

      ctx.font         = `12px 'Courier New', monospace`;
      ctx.fillStyle    = '#ffffff66';
      ctx.shadowBlur   = 0;
      ctx.fillText(s.label, sx, statY);

      ctx.font         = `bold 28px 'Courier New', monospace`;
      ctx.fillStyle    = s.color;
      ctx.shadowColor  = s.color;
      ctx.shadowBlur   = 10;
      ctx.fillText(s.value, sx, statY + 36);
    });

    // Rating
    ctx.font         = `bold 42px 'Courier New', monospace`;
    ctx.fillStyle    = '#ffe45e';
    ctx.shadowColor  = '#ffe45e';
    ctx.shadowBlur   = 22;
    ctx.fillText(rating, W / 2, py + ph - 44);

    ctx.restore();
  }

}
