/**
 * High-Precision Optical Flow Engine
 * 
 * Multi-Stage Noise Elimination & Motion Accuracy:
 * 1. Pre-filter: Separable 3x3 Gaussian smoothing
 * 2. Noise Gate / Deadzone: Rejects camera sensor fluctuations (|ΔI| < 2.5 levels)
 * 3. Texture / Eigenvalue Conditioning: Discards gradient-deficient regions (prevents noise explosion on walls)
 * 4. Tikhonov-Regularized Lucas-Kanade Matrix Solve
 * 5. Spatial Median Filter: Eliminates salt-and-pepper pixel noise
 * 6. Hard Zero-Clamping & Rapid Motion Decay: Pure black (#000000) when stationary
 */
class OpticalFlowEngine {
  constructor() {
    this.width = 0;
    this.height = 0;

    // Grid resolution (160x120)
    this.gridW = 160;
    this.gridH = 120;

    this.scale = 3.5;       // Sensitivity multiplier
    this.threshold = 0.75;  // Motion cutoff threshold
    this.mode = 'arrows';   // 'arrows' (Default) | 'color' | 'overlay' | 'combined'

    const totalPixels = this.gridW * this.gridH;
    this.prevGray = null;
    this.currSmooth = new Uint8Array(totalPixels);
    this.prevSmooth = new Uint8Array(totalPixels);
    this.tmpBuffer = new Uint8Array(totalPixels);

    // Flow velocity buffers
    this.rawU = new Float32Array(totalPixels);
    this.rawV = new Float32Array(totalPixels);
    this.medianU = new Float32Array(totalPixels);
    this.medianV = new Float32Array(totalPixels);
    this.flowU = new Float32Array(totalPixels);
    this.flowV = new Float32Array(totalPixels);

    // Offscreen render canvas
    this.flowCanvas = document.createElement('canvas');
    this.flowCanvas.width = this.gridW;
    this.flowCanvas.height = this.gridH;
    this.flowCtx = this.flowCanvas.getContext('2d');
    this.flowImgData = this.flowCtx.createImageData(this.gridW, this.gridH);

    // Downsample input canvas
    this.sampleCanvas = document.createElement('canvas');
    this.sampleCanvas.width = this.gridW;
    this.sampleCanvas.height = this.gridH;
    this.sampleCtx = this.sampleCanvas.getContext('2d', { willReadFrequently: true });

    // Directional color wheel legend
    this.colorWheelCanvas = this.createColorWheelCanvas(52);
  }

  init(width, height) {
    this.width = width;
    this.height = height;
    const len = this.gridW * this.gridH;
    this.prevGray = new Uint8Array(len);
    this.currSmooth.fill(0);
    this.prevSmooth.fill(0);
    this.rawU.fill(0);
    this.rawV.fill(0);
    this.flowU.fill(0);
    this.flowV.fill(0);
  }

  reset() {
    this.prevGray = null;
    this.rawU.fill(0);
    this.rawV.fill(0);
    this.flowU.fill(0);
    this.flowV.fill(0);
  }

  /**
   * Fast Separable 3x3 Gaussian Blur [1, 2, 1] / 4
   */
  gaussianBlur(src, dst, tmp, w, h) {
    for (let y = 0; y < h; y++) {
      const row = y * w;
      tmp[row] = src[row];
      for (let x = 1; x < w - 1; x++) {
        const idx = row + x;
        tmp[idx] = (src[idx - 1] + (src[idx] << 1) + src[idx + 1]) >> 2;
      }
      tmp[row + w - 1] = src[row + w - 1];
    }
    for (let x = 0; x < w; x++) {
      dst[x] = tmp[x];
      for (let y = 1; y < h - 1; y++) {
        const idx = y * w + x;
        dst[idx] = (tmp[idx - w] + (tmp[idx] << 1) + tmp[idx + w]) >> 2;
      }
      dst[(h - 1) * w + x] = tmp[(h - 1) * w + x];
    }
  }

  /**
   * Fast HSV to RGB conversion
   */
  hsvToRgb(h, s, v) {
    const c = v * s;
    const hp = h / 60;
    const x = c * (1 - Math.abs((hp % 2) - 1));
    let r = 0, g = 0, b = 0;
    if (hp >= 0 && hp < 1) { r = c; g = x; b = 0; }
    else if (hp >= 1 && hp < 2) { r = x; g = c; b = 0; }
    else if (hp >= 2 && hp < 3) { r = 0; g = c; b = x; }
    else if (hp >= 3 && hp < 4) { r = 0; g = x; b = c; }
    else if (hp >= 4 && hp < 5) { r = x; g = 0; b = c; }
    else if (hp >= 5 && hp < 6) { r = c; g = 0; b = x; }
    const m = v - c;
    return [
      Math.round((r + m) * 255),
      Math.round((g + m) * 255),
      Math.round((b + m) * 255)
    ];
  }

  /**
   * Directional color wheel legend
   */
  createColorWheelCanvas(size = 52) {
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');
    const cx = size / 2;
    const cy = size / 2;
    const radius = size / 2 - 3;
    const imgData = ctx.createImageData(size, size);
    const data = imgData.data;

    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const dx = x - cx;
        const dy = y - cy;
        const dist = Math.sqrt(dx * dx + dy * dy);
        const idx = (y * size + x) * 4;

        if (dist <= radius) {
          const angle = Math.atan2(dy, dx);
          const hue = ((angle + Math.PI) / (2 * Math.PI)) * 360;
          const normDist = Math.min(1.0, dist / radius);
          const [r, g, b] = this.hsvToRgb(hue, 1.0, normDist);
          data[idx] = r;
          data[idx + 1] = g;
          data[idx + 2] = b;
          data[idx + 3] = 230;
        } else {
          data[idx + 3] = 0;
        }
      }
    }
    ctx.putImageData(imgData, 0, 0);

    ctx.strokeStyle = 'rgba(255, 255, 255, 0.45)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, Math.PI * 2);
    ctx.stroke();

    return canvas;
  }

  process(ctx, video, canvasWidth, canvasHeight, isMirrored = false) {
    if (this.width !== canvasWidth || this.height !== canvasHeight) {
      this.init(canvasWidth, canvasHeight);
    }

    const gw = this.gridW;
    const gh = this.gridH;
    const totalPixels = gw * gh;

    // 1. Downsample video frame
    this.sampleCtx.save();
    if (isMirrored) {
      this.sampleCtx.translate(gw, 0);
      this.sampleCtx.scale(-1, 1);
    }
    this.sampleCtx.drawImage(video, 0, 0, gw, gh);
    this.sampleCtx.restore();

    const frameData = this.sampleCtx.getImageData(0, 0, gw, gh).data;
    const currRawGray = new Uint8Array(totalPixels);

    for (let i = 0, j = 0; i < totalPixels; i++, j += 4) {
      currRawGray[i] = (frameData[j] * 77 + frameData[j + 1] * 150 + frameData[j + 2] * 29) >> 8;
    }

    // Gaussian smoothing to suppress camera sensor noise
    this.gaussianBlur(currRawGray, this.currSmooth, this.tmpBuffer, gw, gh);

    if (!this.prevGray) {
      this.prevGray = new Uint8Array(currRawGray);
      this.prevSmooth.set(this.currSmooth);
      if (this.mode === 'color') {
        ctx.fillStyle = '#000000';
        ctx.fillRect(0, 0, canvasWidth, canvasHeight);
      }
      return;
    }

    const I1 = this.prevSmooth;
    const I2 = this.currSmooth;
    const r = 2; // 5x5 window
    const scaleFactor = this.scale;
    const cutoff = this.threshold;
    const eps = 0.08; // Tikhonov regularization
    const noiseFloor = 2.5; // Rejects camera AGC / ambient luminance flutter
    const minTrace = 4.0;   // Minimum texture intensity to attempt optical flow

    // 2. High-precision Lucas-Kanade with noise gate and texture conditioning
    this.rawU.fill(0);
    this.rawV.fill(0);

    for (let y = r; y < gh - r; y++) {
      const row = y * gw;
      for (let x = r; x < gw - r; x++) {
        const idx = row + x;

        let Sxx = 0, Syy = 0, Sxy = 0, Sxt = 0, Syt = 0;
        let totalTemporalDiff = 0;

        for (let wy = -r; wy <= r; wy++) {
          const wRow = (y + wy) * gw;
          for (let wx = -r; wx <= r; wx++) {
            const p = wRow + (x + wx);

            // Temporal diff with noise gate
            const rawIt = I2[p] - I1[p];
            const absIt = Math.abs(rawIt);
            totalTemporalDiff += absIt;

            // Discard noise fluctuations below sensor floor
            const it = absIt < noiseFloor ? 0 : rawIt;

            // 3x3 Sobel spatial gradients
            const ix = ((I2[p + 1] - I2[p - 1]) + (I1[p + 1] - I1[p - 1])) * 0.25;
            const iy = ((I2[p + gw] - I2[p - gw]) + (I1[p + gw] - I1[p - gw])) * 0.25;

            Sxx += ix * ix;
            Syy += iy * iy;
            Sxy += ix * iy;
            Sxt += ix * it;
            Syt += iy * it;
          }
        }

        // Texture gate: If window has no temporal change or no texture, strictly 0
        const trace = Sxx + Syy;
        if (totalTemporalDiff < (r * 2 + 1) * (r * 2 + 1) * noiseFloor || trace < minTrace) {
          this.rawU[idx] = 0;
          this.rawV[idx] = 0;
          continue;
        }

        const det = (Sxx + eps) * (Syy + eps) - Sxy * Sxy;
        let u = 0, v = 0;
        if (det > 0.005) {
          u = (-(Syy + eps) * Sxt + Sxy * Syt) / det;
          v = (Sxy * Sxt - (Sxx + eps) * Syt) / det;
        }

        // Clamp speed spikes
        const rawMag = Math.sqrt(u * u + v * v);
        if (rawMag > 25.0) {
          const ratio = 25.0 / rawMag;
          u *= ratio;
          v *= ratio;
        } else if (rawMag < 0.2) {
          u = 0;
          v = 0;
        }

        this.rawU[idx] = u;
        this.rawV[idx] = v;
      }
    }

    // 3. 3x3 Median / Majority Filter: Strips isolated salt-and-pepper noise
    for (let y = 1; y < gh - 1; y++) {
      const row = y * gw;
      for (let x = 1; x < gw - 1; x++) {
        const idx = row + x;

        // Count moving neighbors in 3x3
        let activeNeighbors = 0;
        let sumU = 0, sumV = 0;

        for (let dy = -1; dy <= 1; dy++) {
          const nRow = (y + dy) * gw;
          for (let dx = -1; dx <= 1; dx++) {
            const nIdx = nRow + (x + dx);
            const nu = this.rawU[nIdx];
            const nv = this.rawV[nIdx];
            if (nu !== 0 || nv !== 0) {
              activeNeighbors++;
              sumU += nu;
              sumV += nv;
            }
          }
        }

        // If isolated point (fewer than 3 active neighbors), suppress to 0
        if (activeNeighbors < 3) {
          this.medianU[idx] = 0;
          this.medianV[idx] = 0;
        } else {
          // Smooth solid clusters
          this.medianU[idx] = sumU / activeNeighbors;
          this.medianV[idx] = sumV / activeNeighbors;
        }
      }
    }

    // 4. Temporal Decay & Clamping: Instant silence on stationary
    const flowData = this.flowImgData.data;
    const vectors = [];

    for (let i = 0; i < totalPixels; i++) {
      const targetU = this.medianU[i];
      const targetV = this.medianV[i];
      const targetMag = Math.sqrt(targetU * targetU + targetV * targetV);

      if (targetMag > 0.1) {
        // Active motion: rapid attack
        this.flowU[i] = this.flowU[i] * 0.45 + targetU * 0.55;
        this.flowV[i] = this.flowV[i] * 0.45 + targetV * 0.55;
      } else {
        // Stationary: rapid decay down to pure zero
        this.flowU[i] *= 0.3;
        this.flowV[i] *= 0.3;
        if (Math.abs(this.flowU[i]) < 0.08) this.flowU[i] = 0;
        if (Math.abs(this.flowV[i]) < 0.08) this.flowV[i] = 0;
      }

      const u = this.flowU[i];
      const v = this.flowV[i];
      const mag = Math.sqrt(u * u + v * v);
      const px = i * 4;

      // Pure black for stationary
      if (mag < cutoff) {
        flowData[px] = 0;
        flowData[px + 1] = 0;
        flowData[px + 2] = 0;
        flowData[px + 3] = (this.mode === 'overlay') ? 0 : 255;
      } else {
        const angle = Math.atan2(v, u);
        const hue = ((angle + Math.PI) / (2 * Math.PI)) * 360;

        const effectiveMag = mag - cutoff;
        const normIntensity = Math.min(1.0, Math.pow(effectiveMag * (scaleFactor / 3.2) * 0.3, 0.85));
        const [cr, cg, cb] = this.hsvToRgb(hue, 1.0, normIntensity);

        flowData[px] = cr;
        flowData[px + 1] = cg;
        flowData[px + 2] = cb;
        flowData[px + 3] = (this.mode === 'overlay') ? Math.round(normIntensity * 230) : 255;

        const x = i % gw;
        const y = Math.floor(i / gw);
        if ((x % 8 === 0) && (y % 8 === 0) && mag >= cutoff * 1.3) {
          vectors.push({
            x: (x / gw) * canvasWidth,
            y: (y / gh) * canvasHeight,
            u: u,
            v: v,
            mag: mag
          });
        }
      }
    }

    this.flowCtx.putImageData(this.flowImgData, 0, 0);
    this.prevSmooth.set(this.currSmooth);

    // 5. Render
    if (this.mode === 'color') {
      ctx.fillStyle = '#000000';
      ctx.fillRect(0, 0, canvasWidth, canvasHeight);

      ctx.save();
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(this.flowCanvas, 0, 0, canvasWidth, canvasHeight);
      ctx.restore();

      this.renderLegend(ctx, canvasWidth, canvasHeight);

    } else if (this.mode === 'overlay') {
      ctx.save();
      if (isMirrored) {
        ctx.translate(canvasWidth, 0);
        ctx.scale(-1, 1);
      }
      ctx.drawImage(video, 0, 0, canvasWidth, canvasHeight);
      ctx.restore();

      ctx.save();
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(this.flowCanvas, 0, 0, canvasWidth, canvasHeight);
      ctx.restore();

    } else if (this.mode === 'arrows') {
      ctx.save();
      if (isMirrored) {
        ctx.translate(canvasWidth, 0);
        ctx.scale(-1, 1);
      }
      ctx.drawImage(video, 0, 0, canvasWidth, canvasHeight);
      ctx.restore();

      this.renderArrows(ctx, vectors);

    } else if (this.mode === 'combined') {
      ctx.fillStyle = '#000000';
      ctx.fillRect(0, 0, canvasWidth, canvasHeight);

      ctx.save();
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(this.flowCanvas, 0, 0, canvasWidth, canvasHeight);
      ctx.restore();

      this.renderArrows(ctx, vectors);
      this.renderLegend(ctx, canvasWidth, canvasHeight);
    }
  }

  renderArrows(ctx, vectors) {
    ctx.save();
    ctx.lineWidth = 1.8;

    for (let i = 0; i < vectors.length; i++) {
      const { x, y, u, v, mag } = vectors[i];
      const targetX = x + u * this.scale * 3.8;
      const targetY = y + v * this.scale * 3.8;

      const angle = Math.atan2(v, u);
      const hue = Math.floor(((angle + Math.PI) / (2 * Math.PI)) * 360);

      ctx.strokeStyle = `hsl(${hue}, 95%, 60%)`;
      ctx.fillStyle = `hsl(${hue}, 95%, 60%)`;

      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(targetX, targetY);
      ctx.stroke();

      const headLen = Math.min(4 + mag * 1.2, 8);
      const arrowAngle = Math.PI / 6;
      ctx.beginPath();
      ctx.moveTo(targetX, targetY);
      ctx.lineTo(
        targetX - headLen * Math.cos(angle - arrowAngle),
        targetY - headLen * Math.sin(angle - arrowAngle)
      );
      ctx.lineTo(
        targetX - headLen * Math.cos(angle + arrowAngle),
        targetY - headLen * Math.sin(angle + arrowAngle)
      );
      ctx.closePath();
      ctx.fill();
    }

    ctx.restore();
  }

  renderLegend(ctx, canvasW, canvasH) {
    ctx.save();
    const size = 52;
    const padding = 16;
    const x = canvasW - size - padding;
    const y = canvasH - size - padding;

    ctx.fillStyle = 'rgba(0, 0, 0, 0.65)';
    ctx.beginPath();
    ctx.arc(x + size / 2, y + size / 2, size / 2 + 6, 0, Math.PI * 2);
    ctx.fill();

    ctx.drawImage(this.colorWheelCanvas, x, y);

    ctx.font = '500 9px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
    ctx.fillStyle = 'rgba(255, 255, 255, 0.8)';
    ctx.textAlign = 'center';
    ctx.fillText('Direction', x + size / 2, y + size + 14);

    ctx.restore();
  }
}

window.OpticalFlowEngine = OpticalFlowEngine;
