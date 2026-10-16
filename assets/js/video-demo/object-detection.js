/**
 * Object Detection Engine
 * Uses TensorFlow.js + COCO-SSD for real-time 80-class object detection.
 * Rendered with clean, modern bounding boxes matching academic/professional standards.
 */
class ObjectDetectionEngine {
  constructor() {
    this.model = null;
    this.isLoading = false;
    this.isLoaded = false;
    this.minScore = 0.5;
    this.showLabels = true;
    this.showScores = true;
    this.lastPredictions = [];
    this.isDetecting = false;
    this.detectInterval = 100;
    this.lastDetectTime = 0;
  }

  async loadModel(onProgress) {
    if (this.isLoaded || this.isLoading) return;
    this.isLoading = true;

    try {
      if (typeof cocoSsd === 'undefined') {
        throw new Error('coco-ssd script not loaded');
      }
      this.model = await cocoSsd.load({ base: 'lite_mobilenet_v2' });
      this.isLoaded = true;
      if (onProgress) onProgress(100);
    } catch (err) {
      console.error('Failed to load COCO-SSD model:', err);
      throw err;
    } finally {
      this.isLoading = false;
    }
  }

  async process(ctx, video, canvasWidth, canvasHeight, onDetectedListUpdate, isMirrored = false) {
    // 1. Draw camera video (with optional mirror flip)
    ctx.save();
    if (isMirrored) {
      ctx.translate(canvasWidth, 0);
      ctx.scale(-1, 1);
    }
    ctx.drawImage(video, 0, 0, canvasWidth, canvasHeight);
    ctx.restore();

    // 2. Perform object detection periodically
    const now = performance.now();
    if (this.isLoaded && this.model && !this.isDetecting && now - this.lastDetectTime > this.detectInterval) {
      this.isDetecting = true;
      this.lastDetectTime = now;

      this.model.detect(video, 8, this.minScore).then((predictions) => {
        this.lastPredictions = predictions;
        this.isDetecting = false;

        if (onDetectedListUpdate) {
          const list = predictions.map(p => ({
            class: p.class,
            score: Math.round(p.score * 100)
          }));
          onDetectedListUpdate(list);
        }
      }).catch(err => {
        console.warn('Detection error:', err);
        this.isDetecting = false;
      });
    }

    // 3. Render clean bounding boxes
    this.renderBoxes(ctx, this.lastPredictions, canvasWidth, canvasHeight, video.videoWidth, video.videoHeight, isMirrored);
  }

  renderBoxes(ctx, predictions, canvasW, canvasH, videoW, videoH, isMirrored) {
    if (!predictions || predictions.length === 0) return;

    const scaleX = canvasW / (videoW || canvasW);
    const scaleY = canvasH / (videoH || canvasH);

    ctx.save();

    for (let i = 0; i < predictions.length; i++) {
      const p = predictions[i];
      if (p.score < this.minScore) continue;

      let [rawX, rawY, rawW, rawH] = p.bbox;
      let x = rawX * scaleX;
      const y = rawY * scaleY;
      const w = rawW * scaleX;
      const h = rawH * scaleY;

      if (isMirrored) {
        x = canvasW - x - w;
      }

      // Clean, academic color palette
      const strokeColor = '#1e6fd9'; // Main blue
      const fillColor = 'rgba(30, 111, 217, 0.08)';

      // Bounding box fill & outline
      ctx.fillStyle = fillColor;
      ctx.fillRect(x, y, w, h);

      ctx.strokeStyle = strokeColor;
      ctx.lineWidth = 2.5;
      ctx.strokeRect(x, y, w, h);

      // Render Label Tag
      if (this.showLabels) {
        const scorePercent = Math.round(p.score * 100);
        const labelText = this.showScores
          ? `${p.class} (${scorePercent}%)`
          : p.class;

        ctx.font = '600 13px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
        const textMetrics = ctx.measureText(labelText);
        const badgeW = textMetrics.width + 14;
        const badgeH = 22;
        const badgeY = y - badgeH >= 0 ? y - badgeH : y;

        // Label background
        ctx.fillStyle = strokeColor;
        ctx.fillRect(x, badgeY, badgeW, badgeH);

        // Label text
        ctx.fillStyle = '#ffffff';
        ctx.fillText(labelText, x + 7, badgeY + 15);
      }
    }

    ctx.restore();
  }
}

window.ObjectDetectionEngine = ObjectDetectionEngine;
