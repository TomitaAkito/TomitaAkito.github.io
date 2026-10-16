/**
 * Region-Aware Saliency Engine (Visual Attention Estimation)
 * 
 * Computes visual saliency by fusing:
 * 1. Silhouette & Region Prior: Highlights foreground subjects with smooth boundary falloff
 * 2. Contrast & Motion Cues: Local luminance, color contrast, and temporal changes
 * 3. Standard OpenCV / MATLAB JET Colormap (Deep Blue -> Cyan -> Green -> Yellow -> Red)
 */
class SaliencyEngine {
  constructor() {
    this.width = 0;
    this.height = 0;
    this.lowW = 96;
    this.lowH = 72;

    this.displayMode = 'overlay';   // 'overlay' | 'pure_map'
    this.opacity = 0.75;
    this.showReticle = false;
    this.silhouetteBoost = 1.0;
    this.contrastPower = 1.6;

    this.prevGray = null;

    // Working canvases
    this.offscreenCanvas = document.createElement('canvas');
    this.offscreenCtx = this.offscreenCanvas.getContext('2d', { willReadFrequently: true });
    this.heatCanvas = document.createElement('canvas');
    this.heatCtx = this.heatCanvas.getContext('2d');

    // Buffers
    this.saliencyBuffer = new Float32Array(this.lowW * this.lowH);
    this.blurBuffer = new Float32Array(this.lowW * this.lowH);
    this.silhouetteMask = new Float32Array(this.lowW * this.lowH);
  }

  init(width, height) {
    this.width = width;
    this.height = height;
    this.offscreenCanvas.width = this.lowW;
    this.offscreenCanvas.height = this.lowH;
    this.heatCanvas.width = this.lowW;
    this.heatCanvas.height = this.lowH;
    this.saliencyBuffer = new Float32Array(this.lowW * this.lowH);
    this.blurBuffer = new Float32Array(this.lowW * this.lowH);
    this.silhouetteMask = new Float32Array(this.lowW * this.lowH);
    this.prevGray = new Uint8Array(this.lowW * this.lowH);
  }

  /**
   * Standard OpenCV / MATLAB JET Colormap
   */
  getJetColor(v) {
    const val = Math.max(0, Math.min(1, v));
    const r = Math.round(255 * Math.max(0, Math.min(1, 1.5 - Math.abs(4 * val - 3))));
    const g = Math.round(255 * Math.max(0, Math.min(1, 1.5 - Math.abs(4 * val - 2))));
    const b = Math.round(255 * Math.max(0, Math.min(1, 1.5 - Math.abs(4 * val - 1))));
    return [r, g, b];
  }

  /**
   * Fast 3x3 Gaussian smoothing
   */
  smoothSaliency(src, dst, w, h) {
    for (let y = 1; y < h - 1; y++) {
      const row = y * w;
      for (let x = 1; x < w - 1; x++) {
        const idx = row + x;
        dst[idx] =
          src[idx] * 0.36 +
          (src[idx - 1] + src[idx + 1] + src[idx - w] + src[idx + w]) * 0.12 +
          (src[idx - w - 1] + src[idx - w + 1] + src[idx + w - 1] + src[idx + w + 1]) * 0.04;
      }
    }
  }

  /**
   * Inject 2D Gaussian heat blob into saliency map
   */
  injectGaussianHeat(map, cx, cy, sigmaX, sigmaY, intensity, w, h) {
    const radiusX = Math.round(sigmaX * 2.5);
    const radiusY = Math.round(sigmaY * 2.5);
    const startX = Math.max(0, Math.floor(cx - radiusX));
    const endX = Math.min(w - 1, Math.ceil(cx + radiusX));
    const startY = Math.max(0, Math.floor(cy - radiusY));
    const endY = Math.min(h - 1, Math.ceil(cy + radiusY));

    const inv2SigmaX2 = 1 / (2 * sigmaX * sigmaX);
    const inv2SigmaY2 = 1 / (2 * sigmaY * sigmaY);

    for (let y = startY; y <= endY; y++) {
      const dy = y - cy;
      const row = y * w;
      const termY = dy * dy * inv2SigmaY2;

      for (let x = startX; x <= endX; x++) {
        const dx = x - cx;
        const dist = dx * dx * inv2SigmaX2 + termY;
        if (dist < 4.0) {
          map[row + x] += Math.exp(-dist) * intensity;
        }
      }
    }
  }

  process(ctx, video, canvasWidth, canvasHeight, isMirrored = false, contextData = {}) {
    if (this.width !== canvasWidth || this.height !== canvasHeight) {
      this.init(canvasWidth, canvasHeight);
    }

    const w = this.lowW;
    const h = this.lowH;
    const len = w * h;

    // 1. Draw video frame into low-res canvas
    this.offscreenCtx.save();
    if (isMirrored) {
      this.offscreenCtx.translate(w, 0);
      this.offscreenCtx.scale(-1, 1);
    }
    this.offscreenCtx.drawImage(video, 0, 0, w, h);
    this.offscreenCtx.restore();

    const imgData = this.offscreenCtx.getImageData(0, 0, w, h);
    const data = imgData.data;

    // 2. Global statistics
    let avgR = 0, avgG = 0, avgB = 0;
    const currGray = new Uint8Array(len);
    for (let i = 0, j = 0; i < len; i++, j += 4) {
      const r = data[j];
      const g = data[j + 1];
      const b = data[j + 2];
      avgR += r;
      avgG += g;
      avgB += b;
      currGray[i] = (r * 77 + g * 150 + b * 29) >> 8;
    }
    avgR /= len;
    avgG /= len;
    avgB /= len;

    // 3. Foreground silhouette mask extraction
    // If BodyPix segmentation mask is available, sample it to low-res grid
    let hasBodyPixMask = false;
    this.silhouetteMask.fill(0);

    if (contextData.segmentation && contextData.segmentation.data) {
      const seg = contextData.segmentation;
      const segData = seg.data;
      const segW = seg.width;
      const segH = seg.height;
      hasBodyPixMask = true;

      for (let y = 0; y < h; y++) {
        const sy = Math.floor(y * (segH / h));
        const segRow = sy * segW;
        const row = y * w;
        for (let x = 0; x < w; x++) {
          let sx = Math.floor(x * (segW / w));
          if (isMirrored) sx = segW - 1 - sx;
          this.silhouetteMask[row + x] = segData[segRow + sx] === 1 ? 1.0 : 0.0;
        }
      }
    }

    // 4. Compute physical features (color uniqueness + edge + skin + motion)
    for (let y = 1; y < h - 1; y++) {
      const row = y * w;
      for (let x = 1; x < w - 1; x++) {
        const idx = row + x;
        const px = idx * 4;
        const r = data[px];
        const g = data[px + 1];
        const b = data[px + 2];

        // Global color uniqueness (FT Saliency principle)
        const dR = r - avgR;
        const dG = g - avgG;
        const dB = b - avgB;
        const colorContrast = Math.sqrt(dR * dR + dG * dG + dB * dB);

        // Edge gradient
        const left = (row + (x - 1)) * 4;
        const right = (row + (x + 1)) * 4;
        const up = ((y - 1) * w + x) * 4;
        const down = ((y + 1) * w + x) * 4;
        const edge = Math.abs(r - data[left]) + Math.abs(r - data[right]) + Math.abs(r - data[up]) + Math.abs(r - data[down]);

        // Skin tone (face & hands)
        const isSkin = r > 85 && g > 35 && b > 20 && (r - g) > 12 && r > b;
        const skinBonus = isSkin ? 35.0 : 0.0;

        // Dynamic motion (gesture)
        let motion = 0;
        if (this.prevGray) {
          motion = Math.abs(currGray[idx] - this.prevGray[idx]);
        }

        // Center visual prior
        const cx = (x - w / 2) / (w / 2);
        const cy = (y - h / 2) / (h / 2);
        const centerPrior = Math.exp(-(cx * cx + cy * cy) * 0.4);

        let score = (colorContrast * 0.35 + edge * 0.25 + skinBonus * 0.4 + motion * 0.8) * centerPrior;

        // If no neural mask yet, use adaptive skin/color silhouette heuristic
        if (!hasBodyPixMask) {
          const isForeground = isSkin || colorContrast > 30.0 || motion > 12;
          this.silhouetteMask[idx] = isForeground ? 0.75 : 0.1;
        }

        this.saliencyBuffer[idx] = score;
      }
    }
    this.prevGray = currGray;

    // 5. INJECT TOP-DOWN ATTENTION PRIORS (Human Faces & Objects)
    let activeSemanticLabel = null;

    // 5A. Face & Eyes Attention
    if (contextData.faces && contextData.faces.length > 0) {
      for (let i = 0; i < contextData.faces.length; i++) {
        const f = contextData.faces[i];
        const box = f.detection ? f.detection.box : f.box;
        if (box) {
          let fcx = (box.x + box.width * 0.5) * (w / (video.videoWidth || canvasWidth));
          let fcy = (box.y + box.height * 0.4) * (h / (video.videoHeight || canvasHeight));
          if (isMirrored) fcx = w - fcx;

          const fSigmaX = Math.max(3.5, (box.width * 0.35) * (w / (video.videoWidth || canvasWidth)));
          const fSigmaY = Math.max(4.5, (box.height * 0.4) * (h / (video.videoHeight || canvasHeight)));

          this.injectGaussianHeat(this.saliencyBuffer, fcx, fcy, fSigmaX, fSigmaY, 140.0, w, h);
          activeSemanticLabel = '人物の顔・目元 (Face)';
        }
      }
    }

    // 5B. Detected Objects Attention (phone, cup, etc.)
    if (contextData.objects && contextData.objects.length > 0) {
      for (let i = 0; i < contextData.objects.length; i++) {
        const obj = contextData.objects[i];
        if (obj.class !== 'person') {
          const [ox, oy, ow, oh] = obj.bbox;
          let ocx = (ox + ow * 0.5) * (w / (video.videoWidth || canvasWidth));
          let ocy = (oy + oh * 0.5) * (h / (video.videoHeight || canvasHeight));
          if (isMirrored) ocx = w - ocx;

          const oSigmaX = Math.max(3.5, (ow * 0.35) * (w / (video.videoWidth || canvasWidth)));
          const oSigmaY = Math.max(3.5, (oh * 0.35) * (h / (video.videoHeight || canvasHeight)));

          this.injectGaussianHeat(this.saliencyBuffer, ocx, ocy, oSigmaX, oSigmaY, 90.0, w, h);
          if (!activeSemanticLabel) activeSemanticLabel = `物体 (${obj.class})`;
        }
      }
    }

    // 6. Silhouette prior & inner contour modulation
    // Multiply by silhouette mask so energy conforms cleanly to foreground subject boundaries
    const boost = this.silhouetteBoost !== undefined ? this.silhouetteBoost : (this.samSilhouetteBoost || 1.0);
    for (let i = 0; i < len; i++) {
      const maskVal = this.silhouetteMask[i]; // 0.0 ~ 1.0
      const baseScore = this.saliencyBuffer[i];
      const shapedScore = baseScore * (0.15 + 0.85 * Math.pow(maskVal, 0.7));
      this.saliencyBuffer[i] = shapedScore * boost;
    }

    // 7. Smooth for organic heat diffusion
    this.smoothSaliency(this.saliencyBuffer, this.blurBuffer, w, h);

    // 8. Min-Max Normalization -> JET Color mapping
    let minVal = Infinity;
    let maxVal = -Infinity;
    let peakIdx = 0;

    for (let i = 0; i < len; i++) {
      const val = this.blurBuffer[i];
      if (val < minVal) minVal = val;
      if (val > maxVal) {
        maxVal = val;
        peakIdx = i;
      }
    }

    const range = maxVal - minVal || 1.0;
    const heatImgData = this.heatCtx.createImageData(w, h);
    const heatData = heatImgData.data;

    for (let i = 0; i < len; i++) {
      let norm = (this.blurBuffer[i] - minVal) / range;
      norm = Math.pow(norm, this.contrastPower);

      const [cr, cg, cb] = this.getJetColor(norm);
      const px = i * 4;
      heatData[px] = cr;
      heatData[px + 1] = cg;
      heatData[px + 2] = cb;
      heatData[px + 3] = 255;
    }

    this.heatCtx.putImageData(heatImgData, 0, 0);

    // 9. Render to main canvas
    if (this.displayMode === 'pure_map') {
      ctx.save();
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(this.heatCanvas, 0, 0, canvasWidth, canvasHeight);
      ctx.restore();
    } else {
      ctx.save();
      if (isMirrored) {
        ctx.translate(canvasWidth, 0);
        ctx.scale(-1, 1);
      }
      ctx.drawImage(video, 0, 0, canvasWidth, canvasHeight);
      ctx.restore();

      ctx.save();
      ctx.globalAlpha = this.opacity;
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(this.heatCanvas, 0, 0, canvasWidth, canvasHeight);
      ctx.restore();
    }

    // 10. Gaze Target Reticle
    if (this.showReticle && maxVal > 0.05) {
      const peakX = (peakIdx % w) * (canvasWidth / w);
      const peakY = Math.floor(peakIdx / w) * (canvasHeight / h);
      this.drawGazeReticle(ctx, peakX, peakY, activeSemanticLabel);
    }
  }

  drawGazeReticle(ctx, x, y, label) {
    ctx.save();
    const radius = 16;

    // Subtle outer ring
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.85)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.stroke();

    // Center focal point
    ctx.fillStyle = '#1e6fd9';
    ctx.beginPath();
    ctx.arc(x, y, 3, 0, Math.PI * 2);
    ctx.fill();

    // Minimal text tag if labeled
    if (label) {
      const tagText = label;
      ctx.font = '500 11px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
      const textW = ctx.measureText(tagText).width;

      ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';
      ctx.fillRect(x + radius + 6, y - 10, textW + 12, 20);
      ctx.strokeStyle = '#e9ecef';
      ctx.lineWidth = 1;
      ctx.strokeRect(x + radius + 6, y - 10, textW + 12, 20);

      ctx.fillStyle = '#212529';
      ctx.fillText(tagText, x + radius + 12, y + 4);
    }

    ctx.restore();
  }
}

window.SaliencyEngine = SaliencyEngine;
