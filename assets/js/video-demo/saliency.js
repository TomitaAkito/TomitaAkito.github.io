/**
 * Deep Learning Salient Visual Attention Engine (IS-Net Architecture)
 * 
 * Powered by Deep Learning (RMBG-1.4 / IS-Net via Transformers.js):
 * 1. End-to-End Deep Salient Attention Extraction:
 *    - Deep convolutional & attention layers naturally segment and prioritize
 *      humans (faces, hands, body), documents/books/screens, and foreground objects.
 *    - Absolutely ZERO artificial bounding box stamps or synthetic ID circles.
 * 2. Visual Saliency Post-Processing:
 *    - Continuous Gaussian Spatial Diffusion converts discrete subject activations into
 *      smooth fixation probability densities.
 *    - Center-prior modulation conforming to MIT Saliency Benchmark principles.
 * 3. Decoupled Non-Blocking Async Inference:
 *    - Operates at 160x120 (optimized patch count for rapid inference)
 *    - Throttled inference (180ms) with smooth 60fps EMA temporal interpolation
 */
class SaliencyEngine {
  constructor() {
    this.width = 0;
    this.height = 0;

    // Working inference resolution (160x120)
    this.inferW = 160;
    this.inferH = 120;

    this.displayMode = 'overlay';   // 'overlay' | 'pure_map'
    this.opacity = 0.75;
    this.contrastPower = 1.35;
    this.showReticle = false;

    // Throttle interval (ms) between neural inferences to keep CPU low
    this.throttleInterval = 180;   // 'eco': 300ms, 'balanced': 180ms, 'fast': 90ms

    // Deep Learning Pipeline state
    this.pipeline = null;
    this.RawImage = null;
    this.isLoading = false;
    this.isLoaded = false;
    this.loadProgress = 0;
    this.isInferring = false;
    this.lastInferenceEndTime = 0;

    // Offscreen working canvases
    this.offscreenCanvas = document.createElement('canvas');
    this.offscreenCtx = this.offscreenCanvas.getContext('2d', { willReadFrequently: true });
    this.heatCanvas = document.createElement('canvas');
    this.heatCtx = this.heatCanvas.getContext('2d');

    const total = this.inferW * this.inferH;
    this.rawAIBuffer = new Float32Array(total);
    this.fallbackBuffer = new Float32Array(total);
    this.workingBuffer = new Float32Array(total);
    this.smoothedBuffer = new Float32Array(total);
    this.diffusedBuffer = new Float32Array(total);
    this.blurTemp = new Float32Array(total);

    // Separable Gaussian Kernel (Radius 8, Sigma 3.8)
    // Converts raw deep features into continuous fixation probability densities
    this.kRadius = 8;
    this.kernel = new Float32Array(2 * this.kRadius + 1);
    const sigma = 3.8;
    let kSum = 0;
    for (let i = -this.kRadius; i <= this.kRadius; i++) {
      const v = Math.exp(-(i * i) / (2 * sigma * sigma));
      this.kernel[i + this.kRadius] = v;
      kSum += v;
    }
    for (let i = 0; i < this.kernel.length; i++) this.kernel[i] /= kSum;

    // MIT Saliency Benchmark Border Attenuation & Center Prior
    this.borderWeight = new Float32Array(total);
    for (let y = 0; y < this.inferH; y++) {
      const dy = Math.min(y, this.inferH - 1 - y) / (this.inferH * 0.16);
      const fy = Math.min(1.0, Math.max(0.0, dy));
      const sinY = Math.sin(fy * Math.PI * 0.5);
      const row = y * this.inferW;

      for (let x = 0; x < this.inferW; x++) {
        const dx = Math.min(x, this.inferW - 1 - x) / (this.inferW * 0.16);
        const fx = Math.min(1.0, Math.max(0.0, dx));
        const sinX = Math.sin(fx * Math.PI * 0.5);

        const cx = (x - this.inferW / 2) / (this.inferW / 2);
        const cy = (y - this.inferH / 2) / (this.inferH / 2);
        const centerPrior = Math.exp(-(cx * cx * 0.5 + cy * cy * 0.7));

        this.borderWeight[row + x] = (sinX * sinY) * (0.6 + 0.4 * centerPrior);
      }
    }
  }

  init(width, height) {
    this.width = width;
    this.height = height;
    this.offscreenCanvas.width = this.inferW;
    this.offscreenCanvas.height = this.inferH;
    this.heatCanvas.width = this.inferW;
    this.heatCanvas.height = this.inferH;
  }

  /**
   * Load Deep Salient Object Attention Model via Transformers.js (briaai/RMBG-1.4)
   */
  async loadAIModel(onProgress) {
    if (this.isLoaded || this.isLoading) return;
    this.isLoading = true;

    console.log('[SaliencyEngine] Initializing State-of-the-Art Deep Saliency Model (RMBG-1.4)...');

    try {
      let transformersModule = null;
      try {
        transformersModule = await import('https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.0.0-alpha.19');
      } catch (e) {
        transformersModule = await import('https://cdn.jsdelivr.net/npm/@xenova/transformers@2.17.2');
      }

      const { pipeline, env, RawImage } = transformersModule;
      this.RawImage = RawImage;

      if (env) {
        env.allowLocalModels = false;
        env.useBrowserCache = true;
        if (env.backends && env.backends.onnx) {
          env.backends.onnx.wasm = env.backends.onnx.wasm || {};
          env.backends.onnx.wasm.numThreads = 2;
        }
      }

      const hasWebGPU = typeof navigator !== 'undefined' && 'gpu' in navigator;
      const device = hasWebGPU ? 'webgpu' : 'wasm';
      console.log(`[SaliencyEngine] Target device: ${device}`);

      const modelId = 'briaai/RMBG-1.4';

      try {
        this.pipeline = await pipeline('image-segmentation', modelId, {
          device: device,
          progress_callback: (p) => {
            if (p.status === 'progress' && p.total) {
              const pct = Math.round((p.loaded / p.total) * 100);
              this.loadProgress = pct;
              if (onProgress) onProgress(pct);
            }
          }
        });
      } catch (gpuErr) {
        console.warn(`[SaliencyEngine] ${device} load failed, using wasm:`, gpuErr);
        this.pipeline = await pipeline('image-segmentation', modelId, {
          progress_callback: (p) => {
            if (p.status === 'progress' && p.total) {
              const pct = Math.round((p.loaded / p.total) * 100);
              this.loadProgress = pct;
              if (onProgress) onProgress(pct);
            }
          }
        });
      }

      this.isLoaded = true;
      this.isLoading = false;
      console.log('[SaliencyEngine] Deep Saliency Model ready!');
      if (onProgress) onProgress(100);
    } catch (err) {
      console.error('[SaliencyEngine] Model load error:', err);
      this.isLoading = false;
      throw err;
    }
  }

  /**
   * Non-blocking background neural inference
   */
  dispatchInference(video, isMirrored) {
    if (!this.isLoaded || !this.pipeline || this.isInferring) return;

    const now = performance.now();
    if (now - this.lastInferenceEndTime < this.throttleInterval) {
      return;
    }

    this.isInferring = true;

    this.offscreenCtx.save();
    if (isMirrored) {
      this.offscreenCtx.translate(this.inferW, 0);
      this.offscreenCtx.scale(-1, 1);
    }
    this.offscreenCtx.drawImage(video, 0, 0, this.inferW, this.inferH);
    this.offscreenCtx.restore();

    (async () => {
      try {
        let inputImage = null;
        if (this.RawImage && typeof this.RawImage.fromCanvas === 'function') {
          inputImage = await this.RawImage.fromCanvas(this.offscreenCanvas);
        } else {
          inputImage = this.offscreenCanvas.toDataURL('image/jpeg', 0.85);
        }

        const output = await this.pipeline(inputImage);

        let mask = null;
        if (Array.isArray(output) && output.length > 0) {
          mask = output[0].mask || output[0];
        } else if (output && output.mask) {
          mask = output.mask;
        } else if (output && output.data) {
          mask = output;
        }

        if (mask && mask.data) {
          const mw = mask.width || this.inferW;
          const mh = mask.height || this.inferH;
          const mData = mask.data;

          const w = this.inferW;
          const h = this.inferH;

          // Extract deep continuous attention probability map
          for (let y = 0; y < h; y++) {
            const my = Math.min(mh - 1, Math.floor(y * (mh / h)));
            const mRow = my * mw;
            const row = y * w;
            for (let x = 0; x < w; x++) {
              const mx = Math.min(mw - 1, Math.floor(x * (mw / w)));
              const rawVal = mData[mRow + mx];
              // Normalize 0~255 or 0.0~1.0
              const normVal = rawVal > 1.0 ? rawVal / 255.0 : rawVal;
              this.rawAIBuffer[row + x] = normVal;
            }
          }
        }
      } catch (err) {
        console.warn('[SaliencyEngine] Deep inference error:', err);
      } finally {
        this.isInferring = false;
        this.lastInferenceEndTime = performance.now();
      }
    })();
  }

  /**
   * Fast Separable 1D Gaussian Convolution
   */
  separableGaussianBlur(src, dst, w, h) {
    const R = this.kRadius;
    const K = this.kernel;
    const temp = this.blurTemp;

    // Horizontal pass
    for (let y = 0; y < h; y++) {
      const row = y * w;
      for (let x = 0; x < w; x++) {
        let sum = 0;
        for (let k = -R; k <= R; k++) {
          const cx = Math.max(0, Math.min(w - 1, x + k));
          sum += src[row + cx] * K[k + R];
        }
        temp[row + x] = sum;
      }
    }

    // Vertical pass
    for (let x = 0; x < w; x++) {
      for (let y = 0; y < h; y++) {
        let sum = 0;
        for (let k = -R; k <= R; k++) {
          const cy = Math.max(0, Math.min(h - 1, y + k));
          sum += temp[cy * w + x] * K[k + R];
        }
        dst[y * w + x] = sum;
      }
    }
  }

  /**
   * Physiological fallback while AI is downloading
   */
  computeFallbackAttention(data, w, h) {
    for (let y = 1; y < h - 1; y++) {
      const row = y * w;
      for (let x = 1; x < w - 1; x++) {
        const idx = row + x;
        const px = idx * 4;
        const r = data[px];
        const g = data[px + 1];
        const b = data[px + 2];

        const left = (row + x - 1) * 4;
        const right = (row + x + 1) * 4;
        const up = ((y - 1) * w + x) * 4;
        const down = ((y + 1) * w + x) * 4;

        const dx = Math.abs(data[right] - data[left]);
        const dy = Math.abs(data[down] - data[up]);
        const grad = (dx + dy) / 510.0;

        const isSkin = r > 85 && g > 35 && b > 20 && (r - g) > 12 && r > b;
        this.fallbackBuffer[idx] = grad * 0.6 + (isSkin ? 0.4 : 0);
      }
    }
  }

  /**
   * OpenCV / MATLAB Standard JET Colormap
   */
  getJetColor(v) {
    const val = Math.max(0, Math.min(1, v));
    const r = Math.round(255 * Math.max(0, Math.min(1, 1.5 - Math.abs(4 * val - 3))));
    const g = Math.round(255 * Math.max(0, Math.min(1, 1.5 - Math.abs(4 * val - 2))));
    const b = Math.round(255 * Math.max(0, Math.min(1, 1.5 - Math.abs(4 * val - 1))));
    return [r, g, b];
  }

  /**
   * Main rendering & processing loop
   */
  process(ctx, video, canvasWidth, canvasHeight, isMirrored = false) {
    if (this.width !== canvasWidth || this.height !== canvasHeight) {
      this.init(canvasWidth, canvasHeight);
    }

    const w = this.inferW;
    const h = this.inferH;
    const len = w * h;

    // 1. Dispatch Deep Learning Saliency Inference
    if (this.isLoaded) {
      this.dispatchInference(video, isMirrored);
    } else {
      // Immediate lightweight fallback before AI download completes
      this.offscreenCtx.save();
      if (isMirrored) {
        this.offscreenCtx.translate(w, 0);
        this.offscreenCtx.scale(-1, 1);
      }
      this.offscreenCtx.drawImage(video, 0, 0, w, h);
      this.offscreenCtx.restore();
      const imgData = this.offscreenCtx.getImageData(0, 0, w, h);
      this.computeFallbackAttention(imgData.data, w, h);
    }

    // 2. Select Source Feature Map
    if (this.isLoaded) {
      for (let i = 0; i < len; i++) {
        const v = this.rawAIBuffer[i];
        // Sigmoidal suppression: background drops to cold blue; salient subjects strongly pop
        this.workingBuffer[i] = v > 0.2 ? Math.pow(v, 1.5) : 0.0;
      }
    } else {
      this.workingBuffer.set(this.fallbackBuffer);
    }

    // 3. Apply MIT Saliency Benchmark Border Attenuation & Center Bias
    for (let i = 0; i < len; i++) {
      this.workingBuffer[i] *= this.borderWeight[i];
    }

    // 4. Temporal Exponential Moving Average (EMA) for zero-jitter
    const alpha = 0.32;
    const invAlpha = 1.0 - alpha;
    for (let i = 0; i < len; i++) {
      this.smoothedBuffer[i] = this.smoothedBuffer[i] * invAlpha + this.workingBuffer[i] * alpha;
    }

    // 5. Continuous Fixation Density Diffusion (Exact Separable Gaussian)
    // Converts discrete neural masks into an organic human fixation heat field
    this.separableGaussianBlur(this.smoothedBuffer, this.diffusedBuffer, w, h);

    // 6. Dynamic Min-Max Normalization with Absolute Noise Floor
    let maxVal = 0;
    let minVal = Infinity;
    let peakIdx = 0;

    for (let i = 0; i < len; i++) {
      const v = this.diffusedBuffer[i];
      if (v > maxVal) {
        maxVal = v;
        peakIdx = i;
      }
      if (v < minVal) {
        minVal = v;
      }
    }

    const range = (maxVal - minVal) || 1.0;
    const heatImgData = this.heatCtx.createImageData(w, h);
    const heatData = heatImgData.data;

    for (let i = 0; i < len; i++) {
      let norm = (this.diffusedBuffer[i] - minVal) / range;

      // Soft noise gate
      norm = Math.max(0, (norm - 0.12) / 0.88);
      norm = Math.pow(norm, this.contrastPower);

      const [cr, cg, cb] = this.getJetColor(norm);
      const px = i * 4;
      heatData[px] = cr;
      heatData[px + 1] = cg;
      heatData[px + 2] = cb;
      heatData[px + 3] = 255;
    }

    this.heatCanvas.width = w;
    this.heatCanvas.height = h;
    this.heatCtx.putImageData(heatImgData, 0, 0);

    // 7. Render Output to Target Canvas
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

    // 8. Peak Fixation Target
    if (this.showReticle && maxVal > 0.05) {
      const peakX = (peakIdx % w) * (canvasWidth / w);
      const peakY = Math.floor(peakIdx / w) * (canvasHeight / h);
      this.drawGazeReticle(ctx, peakX, peakY);
    }
  }

  drawGazeReticle(ctx, x, y) {
    ctx.save();
    const radius = 16;

    ctx.strokeStyle = 'rgba(255, 255, 255, 0.9)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.stroke();

    ctx.fillStyle = '#ff7a30';
    ctx.beginPath();
    ctx.arc(x, y, 3.5, 0, Math.PI * 2);
    ctx.fill();

    ctx.font = '500 11px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
    const textW = ctx.measureText('Peak Fixation').width;

    ctx.fillStyle = 'rgba(255, 255, 255, 0.92)';
    ctx.fillRect(x + radius + 6, y - 10, textW + 14, 20);
    ctx.strokeStyle = '#e9ecef';
    ctx.lineWidth = 1;
    ctx.strokeRect(x + radius + 6, y - 10, textW + 14, 20);

    ctx.fillStyle = '#212529';
    ctx.fillText('Peak Fixation', x + radius + 13, y + 4);

    ctx.restore();
  }
}

window.SaliencyEngine = SaliencyEngine;
