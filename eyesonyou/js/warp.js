const STRIP_H    = 3;    // face warp strip height in CSS px
const MAX_SNAPS  = 8;    // max accumulated snapshots
const BG_SPEED   = 2.0;  // px per frame for background scroll
const SNAP_RATIO = 0.25; // snapshots drift at 25% of bg speed
const BG_SCALE   = 0.15; // downscale factor for blurred bg (cheap blur via upscale)

export class WarpRenderer {
  constructor(canvas, videoEl) {
    this.canvas  = canvas;
    this.ctx     = canvas.getContext('2d');
    this.videoEl = videoEl;

    // Raw flipped video
    this.off    = this._mkCanvas();
    this.offCtx = this.off.getContext('2d');

    // Warped + masked person
    this.personOff = this._mkCanvas();
    this.personCtx = this.personOff.getContext('2d');

    // Tiny canvas for cheap blurred background
    this.bgTiny    = document.createElement('canvas');
    this.bgTinyCtx = this.bgTiny.getContext('2d');

    // Segmentation mask
    this.maskOff = document.createElement('canvas');
    this.maskCtx = this.maskOff.getContext('2d');

    this.smooth = {};

    this.bgScroll     = 0;
    this.lastSnapTime = 0;
    this.snapshots    = []; // { canvas, capturedScroll }
  }

  render(faceResult, segResult) {
    const W = window.innerWidth;
    const H = window.innerHeight;
    const ctx = this.ctx;

    this._syncSize(W, H);
    this._drawFlippedVideo(W, H);
    this._updateSmooth(faceResult);

    ctx.clearRect(0, 0, W, H);

    const landmarks = faceResult?.faceLandmarks?.[0] ?? null;
    const face = landmarks ? this._faceBounds(landmarks, W, H) : null;

    if (segResult) {
      // ── Full pipeline ──────────────────────────────────────────────────────
      this._buildPersonCanvas(face, segResult, W, H);
      this._handleSnapTimer(W, H);
      this.bgScroll += BG_SPEED;

      // Layer 1 – scrolling background (blurred + darkened)
      this._drawScrollingBg(ctx, W, H);
      // Layer 2 – past person snapshots drifting slowly
      this._drawSnapshots(ctx, W, H);
      // Layer 3 – live warped person
      ctx.drawImage(this.personOff, 0, 0, W, H);

    } else {
      // ── Fallback (segmentation not loaded yet) ────────────────────────────
      ctx.drawImage(this.off, 0, 0, W, H);
      if (face) this._drawWarpedStrips(ctx, face, W, H);
    }
  }

  // ── Internals ──────────────────────────────────────────────────────────────

  _mkCanvas() {
    return document.createElement('canvas');
  }

  _syncSize(W, H) {
    for (const c of [this.off, this.personOff]) {
      if (c.width !== W || c.height !== H) { c.width = W; c.height = H; }
    }
    const bW = Math.ceil(W * BG_SCALE);
    const bH = Math.ceil(H * BG_SCALE);
    if (this.bgTiny.width !== bW || this.bgTiny.height !== bH) {
      this.bgTiny.width = bW; this.bgTiny.height = bH;
    }
  }

  _drawFlippedVideo(W, H) {
    const oc = this.offCtx;
    oc.save();
    oc.translate(W, 0);
    oc.scale(-1, 1);
    oc.drawImage(this.videoEl, 0, 0, W, H);
    oc.restore();
  }

  _updateSmooth(faceResult) {
    const cats = faceResult?.faceBlendshapes?.[0]?.categories;
    if (!cats) return;
    const raw = Object.fromEntries(cats.map(c => [c.categoryName, c.score]));
    const keys = [
      'jawOpen', 'mouthSmileLeft', 'mouthSmileRight',
      'browInnerUp', 'browOuterUpLeft', 'browOuterUpRight',
      'eyeWideLeft', 'eyeWideRight', 'mouthFunnel',
    ];
    for (const k of keys) {
      const v = raw[k] ?? 0;
      this.smooth[k] = (this.smooth[k] ?? v) * 0.5 + v * 0.5;
    }
  }

  _faceBounds(landmarks, W, H) {
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (const lm of landmarks) {
      const x = (1 - lm.x) * W, y = lm.y * H;
      if (x < x0) x0 = x; if (x > x1) x1 = x;
      if (y < y0) y0 = y; if (y > y1) y1 = y;
    }
    return { y: y0, w: x1 - x0, h: y1 - y0, cx: (x0 + x1) / 2 };
  }

  // ── Person canvas (warped + masked) ────────────────────────────────────────

  _buildPersonCanvas(face, segResult, W, H) {
    const pCtx = this.personCtx;
    pCtx.clearRect(0, 0, W, H);
    pCtx.drawImage(this.off, 0, 0, W, H);
    if (face) this._drawWarpedStrips(pCtx, face, W, H);
    this._applySegMask(pCtx, segResult, W, H);
  }

  _applySegMask(pCtx, segResult, W, H) {
    const mask = segResult?.confidenceMasks?.[0];
    if (!mask) return;

    const mW = mask.width, mH = mask.height;
    if (this.maskOff.width !== mW || this.maskOff.height !== mH) {
      this.maskOff.width = mW; this.maskOff.height = mH;
    }

    const floatData = mask.getAsFloat32Array();
    const imgData   = this.maskCtx.createImageData(mW, mH);
    const d         = imgData.data;
    for (let i = 0; i < floatData.length; i++) {
      d[i * 4]     = 255;
      d[i * 4 + 1] = 255;
      d[i * 4 + 2] = 255;
      d[i * 4 + 3] = Math.min(255, floatData[i] * 320); // slight edge boost
    }
    this.maskCtx.putImageData(imgData, 0, 0);

    // Flip mask horizontally to match the flipped video on personCtx
    pCtx.save();
    pCtx.translate(W, 0);
    pCtx.scale(-1, 1);
    pCtx.globalCompositeOperation = 'destination-in';
    pCtx.drawImage(this.maskOff, 0, 0, mW, mH, 0, 0, W, H);
    pCtx.globalCompositeOperation = 'source-over';
    pCtx.restore();
  }

  // ── Scrolling background ───────────────────────────────────────────────────

  _drawScrollingBg(ctx, W, H) {
    // Downscale to bgTiny first → upscale back = cheap heavy blur
    this.bgTinyCtx.drawImage(this.off, 0, 0, this.bgTiny.width, this.bgTiny.height);

    const x = -(this.bgScroll % W);
    ctx.save();
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'low';
    ctx.filter = 'brightness(0.4)';
    // Tile two copies to seamlessly fill when x is negative
    ctx.drawImage(this.bgTiny, 0, 0, this.bgTiny.width, this.bgTiny.height, x,     0, W, H);
    ctx.drawImage(this.bgTiny, 0, 0, this.bgTiny.width, this.bgTiny.height, x + W, 0, W, H);
    ctx.restore();
  }

  // ── Snapshots ──────────────────────────────────────────────────────────────

  _handleSnapTimer(W, H) {
    const now = performance.now();
    if (this.lastSnapTime === 0) { this.lastSnapTime = now; return; }
    if (now - this.lastSnapTime < 2000) return;

    this.lastSnapTime = now;
    const snap = this._mkCanvas();
    snap.width  = W;
    snap.height = H;
    snap.getContext('2d').drawImage(this.personOff, 0, 0, W, H);
    this.snapshots.push({ canvas: snap, capturedScroll: this.bgScroll });
    if (this.snapshots.length > MAX_SNAPS) this.snapshots.shift();
  }

  _drawSnapshots(ctx, W, H) {
    for (const s of this.snapshots) {
      const drift = (this.bgScroll - s.capturedScroll) * SNAP_RATIO;
      ctx.save();
      ctx.translate(-drift, 0);
      ctx.drawImage(s.canvas, 0, 0, W, H);
      ctx.restore();
    }
  }

  // ── Face warp strips ───────────────────────────────────────────────────────

  _drawWarpedStrips(ctx, face, W, H) {
    const { y: fy, w: fw, h: fh, cx } = face;
    const bs  = this.smooth;
    const off = this.off;

    const jawOpen = bs['jawOpen'] ?? 0;
    const smile   = ((bs['mouthSmileLeft'] ?? 0) + (bs['mouthSmileRight'] ?? 0)) / 2;
    const browUp  = Math.max(
      bs['browOuterUpLeft'] ?? 0,
      bs['browOuterUpRight'] ?? 0,
      (bs['browInnerUp'] ?? 0) * 0.8,
    );
    const eyeWide = Math.max(bs['eyeWideLeft'] ?? 0, bs['eyeWideRight'] ?? 0);
    const funnel  = bs['mouthFunnel'] ?? 0;

    let dstY = fy;
    for (let srcY = fy; srcY < fy + fh; srcY += STRIP_H) {
      const t    = (srcY - fy) / fh;
      const srcH = Math.min(STRIP_H, fy + fh - srcY);

      let scaleX = 1;
      if (t > 0.55)              scaleX += jawOpen * ((t - 0.55) / 0.45) * 1.8;
      if (t > 0.52 && t < 0.88) scaleX += smile   * Math.max(0, 1 - Math.abs(t - 0.70) / 0.18) * 1.4;
      if (t > 0.18 && t < 0.42) scaleX += browUp  * Math.max(0, 1 - Math.abs(t - 0.30) / 0.12) * 0.9;
      if (t > 0.30 && t < 0.56) scaleX += eyeWide * Math.max(0, 1 - Math.abs(t - 0.43) / 0.13) * 1.1;
      if (t > 0.58 && t < 0.84) scaleX -= funnel  * Math.max(0, 1 - Math.abs(t - 0.71) / 0.13) * 0.7;
      scaleX = Math.max(0.3, scaleX);

      let scaleY = 1;
      if (t > 0.68) scaleY += jawOpen * ((t - 0.68) / 0.32) * 2.2;
      if (t < 0.28) scaleY += browUp  * (1 - t / 0.28) * 1.6;

      const dstH = srcH * scaleY;
      ctx.drawImage(off, cx - fw / (2 * scaleX), srcY, fw / scaleX, srcH,
                        cx - fw / 2,              dstY, fw,           dstH);
      dstY += dstH;
    }
  }
}
