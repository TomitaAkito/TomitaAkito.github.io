/**
 * Face Expression & Emotion Detection Engine
 * Uses face-api.js with clean academic styling.
 */
class FaceExpressionEngine {
  constructor() {
    this.isLoaded = false;
    this.isLoading = false;
    this.minConfidence = 0.5;
    this.lastDetections = [];
    this.isDetecting = false;
    this.detectInterval = 120;
    this.lastDetectTime = 0;
    this.modelsUrl = 'https://vladmandic.github.io/face-api/model/';
    this.emotionsMeta = {
      happy: { label: '幸福 (Happy)', color: '#10b981' },
      surprised: { label: '驚き (Surprise)', color: '#f59e0b' },
      neutral: { label: '平常 (Neutral)', color: '#1e6fd9' },
      sad: { label: '悲哀 (Sad)', color: '#6366f1' },
      angry: { label: '怒り (Angry)', color: '#ef4444' },
      fearful: { label: '恐怖 (Fear)', color: '#8b5cf6' },
      disgusted: { label: '嫌悪 (Disgust)', color: '#ea580c' }
    };
  }

  async loadModel(onProgress) {
    if (this.isLoaded || this.isLoading) return;
    this.isLoading = true;

    try {
      if (typeof faceapi === 'undefined') {
        throw new Error('face-api script not loaded');
      }
      await faceapi.nets.tinyFaceDetector.loadFromUri(this.modelsUrl);
      if (onProgress) onProgress(50);
      await faceapi.nets.faceExpressionNet.loadFromUri(this.modelsUrl);
      if (onProgress) onProgress(100);
      this.isLoaded = true;
    } catch (err) {
      console.error('Failed to load Face Expression models:', err);
      throw err;
    } finally {
      this.isLoading = false;
    }
  }

  tick(video) {
    if (!this.isLoaded || this.isDetecting || !video || video.readyState < 2) return;
    const now = performance.now();
    if (now - this.lastDetectTime < this.detectInterval) return;

    this.isDetecting = true;
    this.lastDetectTime = now;

    try {
      const options = new faceapi.TinyFaceDetectorOptions({ inputSize: 224, scoreThreshold: this.minConfidence });
      faceapi.detectAllFaces(video, options)
        .then((detections) => {
          this.lastDetections = detections || [];
          this.isDetecting = false;
        })
        .catch((err) => {
          console.warn('Face detection tick error:', err);
          this.isDetecting = false;
        });
    } catch (err) {
      this.isDetecting = false;
    }
  }

  async process(ctx, video, canvasWidth, canvasHeight, onEmotionsUpdate, isMirrored = false) {
    // 1. Draw raw video
    ctx.save();
    if (isMirrored) {
      ctx.translate(canvasWidth, 0);
      ctx.scale(-1, 1);
    }
    ctx.drawImage(video, 0, 0, canvasWidth, canvasHeight);
    ctx.restore();

    // 2. Run detection asynchronously
    const now = performance.now();
    if (this.isLoaded && !this.isDetecting && now - this.lastDetectTime > this.detectInterval) {
      this.isDetecting = true;
      this.lastDetectTime = now;

      const options = new faceapi.TinyFaceDetectorOptions({ inputSize: 224, scoreThreshold: this.minConfidence });

      faceapi.detectAllFaces(video, options)
        .withFaceExpressions()
        .then((detections) => {
          this.lastDetections = detections;
          this.isDetecting = false;

          if (detections && detections.length > 0 && onEmotionsUpdate) {
            onEmotionsUpdate(detections[0].expressions);
          } else if (onEmotionsUpdate) {
            onEmotionsUpdate(null);
          }
        })
        .catch((err) => {
          console.warn('Face detection error:', err);
          this.isDetecting = false;
        });
    }

    // 3. Render clean face boxes
    this.renderBoxes(ctx, this.lastDetections, canvasWidth, canvasHeight, video.videoWidth, video.videoHeight, isMirrored);
  }

  renderBoxes(ctx, detections, canvasW, canvasH, videoW, videoH, isMirrored) {
    if (!detections || detections.length === 0) return;

    const scaleX = canvasW / (videoW || canvasW);
    const scaleY = canvasH / (videoH || canvasH);

    ctx.save();

    for (let i = 0; i < detections.length; i++) {
      const d = detections[i];
      const box = d.detection.box;
      let x = box.x * scaleX;
      const y = box.y * scaleY;
      const w = box.width * scaleX;
      const h = box.height * scaleY;

      if (isMirrored) {
        x = canvasW - x - w;
      }

      // Find top dominant emotion
      let topEmotion = 'neutral';
      let maxScore = 0;
      if (d.expressions) {
        for (const [emo, score] of Object.entries(d.expressions)) {
          if (score > maxScore) {
            maxScore = score;
            topEmotion = emo;
          }
        }
      }

      const meta = this.emotionsMeta[topEmotion] || this.emotionsMeta.neutral;
      const color = meta.color;

      // Clean face rectangle
      ctx.strokeStyle = color;
      ctx.lineWidth = 2.5;
      ctx.strokeRect(x, y, w, h);

      // Emotion Badge Header above face
      const badgeH = 26;
      const badgeY = y - badgeH - 4 >= 0 ? y - badgeH - 4 : y + 4;
      const scorePct = Math.round(maxScore * 100);
      const labelText = `${meta.label} ${scorePct}%`;

      ctx.font = '600 13px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
      const textW = ctx.measureText(labelText).width + 16;

      // Badge background (white pill with colored border)
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(x, badgeY, textW, badgeH);

      ctx.strokeStyle = color;
      ctx.lineWidth = 1.5;
      ctx.strokeRect(x, badgeY, textW, badgeH);

      // Badge text
      ctx.fillStyle = color;
      ctx.fillText(labelText, x + 8, badgeY + 18);
    }

    ctx.restore();
  }
}

window.FaceExpressionEngine = FaceExpressionEngine;
