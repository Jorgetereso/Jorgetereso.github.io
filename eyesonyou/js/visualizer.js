const TAU = Math.PI * 2;

export class VisualizerEngine {
  constructor(canvas) {
    this.canvas    = canvas;
    this.ctx       = canvas.getContext('2d');
    this.dpr       = window.devicePixelRatio || 1;
    this.autoClear = true; // set false when WarpRenderer owns the clear

    // Particles
    this.PARTICLE_COUNT = 120;
    this.particles = [];

    // Beat detection state
    this.lastBeatTime = 0;
    this.smoothedBass = 0;
    this.beatRings = []; // { radius, maxRadius, alpha }

    // Offscreen canvas for scan lines
    this.scanCanvas = null;
    this.scanCtx = null;

    this._initParticles();
    this._buildScanLines();
  }

  resize() {
    const dpr = window.devicePixelRatio || 1;
    this.dpr = dpr;
    this.canvas.width = window.innerWidth * dpr;
    this.canvas.height = window.innerHeight * dpr;
    this.ctx.scale(dpr, dpr);
    this._initParticles();
    this._buildScanLines();
  }

  _initParticles() {
    const W = window.innerWidth;
    const H = window.innerHeight;
    this.particles = Array.from({ length: this.PARTICLE_COUNT }, (_, i) => ({
      homeX: Math.random() * W,
      homeY: Math.random() * H,
      x: Math.random() * W,
      y: Math.random() * H,
      vx: 0,
      vy: 0,
      freqBin: Math.floor(Math.random() * 512),
      size: 1 + Math.random() * 2,
    }));
  }

  _buildScanLines() {
    const W = window.innerWidth;
    const H = window.innerHeight;
    const sc = document.createElement('canvas');
    sc.width = W;
    sc.height = H;
    const sCtx = sc.getContext('2d');
    sCtx.fillStyle = 'rgba(255,255,255,1)';
    for (let y = 0; y < H; y += 4) {
      sCtx.fillRect(0, y, W, 1);
    }
    this.scanCanvas = sc;
    this.scanCtx = sCtx;
  }

  render(bands, freqData, timeData) {
    const ctx = this.ctx;
    const W = window.innerWidth;
    const H = window.innerHeight;

    // Clear (skipped when WarpRenderer has already drawn the frame)
    if (this.autoClear) ctx.clearRect(0, 0, W, H);

    this._drawParticles(ctx, W, H, bands, freqData);
    this._drawRings(ctx, W, H, bands);
    this._drawVignette(ctx, W, H, bands);
    this._drawScanLines(ctx, W, H, bands);
  }

  // ─── Effect 1: Particle field ───────────────────────────────────────────────
  _drawParticles(ctx, W, H, bands, freqData) {
    const energy = bands.bass * 0.5 + bands.mid * 0.3 + bands.treble * 0.2;

    for (const p of this.particles) {
      const bin = Math.min(p.freqBin, (freqData?.length ?? 512) - 1);
      const binEnergy = freqData ? freqData[bin] / 255 : 0;

      // Spring force toward home
      const dx = p.homeX - p.x;
      const dy = p.homeY - p.y;
      const spring = 0.04;
      p.vx += dx * spring;
      p.vy += dy * spring;

      // Scatter on audio energy
      if (energy > 0.05) {
        const scatter = binEnergy * energy * 8;
        p.vx += (Math.random() - 0.5) * scatter;
        p.vy += (Math.random() - 0.5) * scatter;
      }

      // Damping
      p.vx *= 0.82;
      p.vy *= 0.82;

      p.x += p.vx;
      p.y += p.vy;

      const opacity = 0.15 + binEnergy * 0.75;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size * (1 + binEnergy), 0, TAU);
      ctx.fillStyle = `rgba(255,255,255,${opacity.toFixed(3)})`;
      ctx.fill();
    }
  }

  // ─── Effect 2: Waveform line ─────────────────────────────────────────────────
  _drawWaveform(ctx, W, H, timeData) {
    if (!timeData) return;
    const len = timeData.length;
    const midY = H / 2;
    const amp = H * 0.25;

    ctx.save();
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = 'rgba(255,255,255,0.75)';
    ctx.shadowBlur = 4;
    ctx.shadowColor = 'rgba(255,255,255,0.4)';
    ctx.beginPath();

    for (let i = 0; i < len; i++) {
      const x = (i / (len - 1)) * W;
      const v = (timeData[i] / 128.0 - 1) * amp;
      if (i === 0) ctx.moveTo(x, midY + v);
      else ctx.lineTo(x, midY + v);
    }
    ctx.stroke();
    ctx.restore();
  }

  // ─── Effect 3: Concentric rings ──────────────────────────────────────────────
  _drawRings(ctx, W, H, bands) {
    const cx = W / 2;
    const cy = H / 2;
    const maxR = Math.min(W, H) * 0.5;
    const now = performance.now();

    // Static pulsing rings
    const staticRadii = [0.25, 0.40, 0.55];
    for (const frac of staticRadii) {
      const r = maxR * frac * (1 + bands.mid * 0.08);
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, TAU);
      ctx.strokeStyle = `rgba(255,255,255,${(0.06 + bands.mid * 0.12).toFixed(3)})`;
      ctx.lineWidth = 1;
      ctx.stroke();
    }

    // Beat detection: spawn ring on bass spike
    const BEAT_THRESHOLD = 1.4;
    const BEAT_COOLDOWN = 300; // ms
    this.smoothedBass = this.smoothedBass * 0.9 + bands.bass * 0.1;

    if (
      bands.bass > this.smoothedBass * BEAT_THRESHOLD &&
      bands.bass > 0.15 &&
      now - this.lastBeatTime > BEAT_COOLDOWN
    ) {
      this.lastBeatTime = now;
      this.beatRings.push({ startTime: now, maxRadius: maxR * 0.85 });
    }

    // Draw & update beat rings
    this.beatRings = this.beatRings.filter(ring => {
      const age = (now - ring.startTime) / 1000; // seconds
      const duration = 0.8;
      if (age >= duration) return false;

      const t = age / duration;
      const eased = 1 - Math.pow(1 - t, 3); // ease-out cubic
      const r = ring.maxRadius * eased;
      const alpha = (1 - t) * 0.6;

      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, TAU);
      ctx.strokeStyle = `rgba(255,255,255,${alpha.toFixed(3)})`;
      ctx.lineWidth = 1.5;
      ctx.stroke();
      return true;
    });
  }

  // ─── Effect 4: Edge vignette ─────────────────────────────────────────────────
  _drawVignette(ctx, W, H, bands) {
    const bassSquared = bands.bass * bands.bass;
    const alpha = bassSquared * 0.35;
    if (alpha < 0.005) return;

    const cx = W / 2;
    const cy = H / 2;
    const r = Math.sqrt(cx * cx + cy * cy);

    const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
    grad.addColorStop(0, 'rgba(255,255,255,0)');
    grad.addColorStop(1, `rgba(255,255,255,${alpha.toFixed(4)})`);

    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, W, H);
  }

  // ─── Effect 5: Scan lines ─────────────────────────────────────────────────────
  _drawScanLines(ctx, W, H, bands) {
    if (bands.treble < 0.05) return;
    if (!this.scanCanvas) return;

    const alpha = bands.treble * 0.12;
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.drawImage(this.scanCanvas, 0, 0, W, H);
    ctx.restore();
  }
}
