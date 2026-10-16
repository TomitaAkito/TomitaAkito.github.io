/**
 * Real-time Person Segmentation Engine
 * Uses TensorFlow.js + BodyPix with clean, practical effects:
 * - Background Blur (Virtual Background)
 * - Background Grayscale
 * - Color Mask Highlight
 */
class SegmentationEngine {
  constructor() {
    this.model = null;
    this.isLoading = false;
    this.isLoaded = false;
    this.effect = 'blur'; // 'blur' | 'grayscale' | 'mask'
    this.blurAmount = 12;
    this.maskColor = '#1e6fd9';
    this.maskOpacity = 0.45;
    this.isSegmenting = false;
    this.segmentInterval = 90;
    this.lastSegmentTime = 0;
    this.lastSegmentation = null;

    this.maskCanvas = document.createElement('canvas');
    this.maskCtx = this.maskCanvas.getContext('2d');
    this.blurCanvas = document.createElement('canvas');
    this.blurCtx = this.blurCanvas.getContext('2d');
  }

  async loadModel(onProgress) {
    if (this.isLoaded || this.isLoading) return;
    this.isLoading = true;

    try {
      if (typeof bodyPix === 'undefined') {
        throw new Error('bodyPix script not loaded');
      }

      this.model = await bodyPix.load({
        architecture: 'MobileNetV1',
        outputStride: 16,
        multiplier: 0.75,
        quantBytes: 2
      });

      this.isLoaded = true;
      if (onProgress) onProgress(100);
    } catch (err) {
      console.error('Failed to load BodyPix model:', err);
      throw err;
    } finally {
      this.isLoading = false;
    }
  }

  async process(ctx, video, canvasWidth, canvasHeight, isMirrored = false) {
    if (this.maskCanvas.width !== canvasWidth || this.maskCanvas.height !== canvasHeight) {
      this.maskCanvas.width = canvasWidth;
      this.maskCanvas.height = canvasHeight;
      this.blurCanvas.width = canvasWidth;
      this.blurCanvas.height = canvasHeight;
    }

    const now = performance.now();
    if (this.isLoaded && this.model && !this.isSegmenting && now - this.lastSegmentTime > this.segmentInterval) {
      this.isSegmenting = true;
      this.lastSegmentTime = now;

      this.model.segmentPerson(video, {
        internalResolution: 'medium',
        segmentationThreshold: 0.7,
        maxDetections: 1
      }).then((segmentation) => {
        this.lastSegmentation = segmentation;
        this.isSegmenting = false;
        this.updateMaskCanvas(segmentation, canvasWidth, canvasHeight, isMirrored);
      }).catch((err) => {
        console.warn('BodyPix segmentation error:', err);
        this.isSegmenting = false;
      });
    }

    if (!this.lastSegmentation) {
      ctx.save();
      if (isMirrored) {
        ctx.translate(canvasWidth, 0);
        ctx.scale(-1, 1);
      }
      ctx.drawImage(video, 0, 0, canvasWidth, canvasHeight);
      ctx.restore();
      return;
    }

    switch (this.effect) {
      case 'blur':
        this.renderBackgroundBlur(ctx, video, canvasWidth, canvasHeight, isMirrored);
        break;
      case 'grayscale':
        this.renderBackgroundGrayscale(ctx, video, canvasWidth, canvasHeight, isMirrored);
        break;
      case 'mask':
      default:
        this.renderColorMask(ctx, video, canvasWidth, canvasHeight, isMirrored);
        break;
    }
  }

  updateMaskCanvas(segmentation, w, h, isMirrored) {
    const sw = segmentation.width;
    const sh = segmentation.height;
    const segData = segmentation.data;

    if (!this.rawMaskCanvas) {
      this.rawMaskCanvas = document.createElement('canvas');
      this.rawMaskCtx = this.rawMaskCanvas.getContext('2d');
    }
    this.rawMaskCanvas.width = sw;
    this.rawMaskCanvas.height = sh;

    const maskImgData = this.rawMaskCtx.createImageData(sw, sh);
    const data = maskImgData.data;

    for (let i = 0; i < segData.length; i++) {
      const isPerson = segData[i] === 1;
      const px = i * 4;
      data[px] = 255;
      data[px + 1] = 255;
      data[px + 2] = 255;
      data[px + 3] = isPerson ? 255 : 0;
    }
    this.rawMaskCtx.putImageData(maskImgData, 0, 0);

    // Scale to maskCanvas with mirror
    this.maskCtx.clearRect(0, 0, w, h);
    this.maskCtx.save();
    if (isMirrored) {
      this.maskCtx.translate(w, 0);
      this.maskCtx.scale(-1, 1);
    }
    this.maskCtx.drawImage(this.rawMaskCanvas, 0, 0, w, h);
    this.maskCtx.restore();
  }

  renderBackgroundBlur(ctx, video, w, h, isMirrored) {
    // 1. Blurred background
    ctx.save();
    if (isMirrored) {
      ctx.translate(w, 0);
      ctx.scale(-1, 1);
    }
    ctx.filter = `blur(${this.blurAmount}px)`;
    ctx.drawImage(video, 0, 0, w, h);
    ctx.restore();

    // 2. Cutout sharp person
    this.blurCtx.clearRect(0, 0, w, h);
    this.blurCtx.drawImage(this.maskCanvas, 0, 0, w, h);
    this.blurCtx.globalCompositeOperation = 'source-in';
    this.blurCtx.save();
    if (isMirrored) {
      this.blurCtx.translate(w, 0);
      this.blurCtx.scale(-1, 1);
    }
    this.blurCtx.drawImage(video, 0, 0, w, h);
    this.blurCtx.restore();
    this.blurCtx.globalCompositeOperation = 'source-over';

    ctx.drawImage(this.blurCanvas, 0, 0, w, h);
  }

  renderBackgroundGrayscale(ctx, video, w, h, isMirrored) {
    // 1. Grayscale background
    ctx.save();
    if (isMirrored) {
      ctx.translate(w, 0);
      ctx.scale(-1, 1);
    }
    ctx.filter = 'grayscale(100%)';
    ctx.drawImage(video, 0, 0, w, h);
    ctx.restore();

    // 2. Cutout color person
    this.blurCtx.clearRect(0, 0, w, h);
    this.blurCtx.drawImage(this.maskCanvas, 0, 0, w, h);
    this.blurCtx.globalCompositeOperation = 'source-in';
    this.blurCtx.save();
    if (isMirrored) {
      this.blurCtx.translate(w, 0);
      this.blurCtx.scale(-1, 1);
    }
    this.blurCtx.drawImage(video, 0, 0, w, h);
    this.blurCtx.restore();
    this.blurCtx.globalCompositeOperation = 'source-over';

    ctx.drawImage(this.blurCanvas, 0, 0, w, h);
  }

  renderColorMask(ctx, video, w, h, isMirrored) {
    ctx.save();
    if (isMirrored) {
      ctx.translate(w, 0);
      ctx.scale(-1, 1);
    }
    ctx.drawImage(video, 0, 0, w, h);
    ctx.restore();

    ctx.save();
    ctx.globalAlpha = this.maskOpacity;

    this.blurCtx.clearRect(0, 0, w, h);
    this.blurCtx.drawImage(this.maskCanvas, 0, 0, w, h);
    this.blurCtx.globalCompositeOperation = 'source-in';
    this.blurCtx.fillStyle = this.maskColor;
    this.blurCtx.fillRect(0, 0, w, h);
    this.blurCtx.globalCompositeOperation = 'source-over';

    ctx.drawImage(this.blurCanvas, 0, 0, w, h);
    ctx.restore();
  }
}

window.SegmentationEngine = SegmentationEngine;
