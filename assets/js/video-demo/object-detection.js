/**
 * Object Detection Engine
 * MediaPipe Tasks Vision (EfficientDet-Lite0 / Lite2, COCO 80 classes) running on CPU (WASM).
 * Falls back to TensorFlow.js COCO-SSD if MediaPipe cannot be loaded.
 */

/* ---------- Shared helpers (also used by segmentation.js) ---------- */

const MP_VISION_VERSION = '0.10.14';
const MP_VISION_BASE = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${MP_VISION_VERSION}`;

let _mpVisionPromise = null;
/**
 * Loads MediaPipe Tasks Vision module + WASM fileset once and shares it.
 * @returns {Promise<{module: any, fileset: any}>}
 */
window.loadMediaPipeVision = function () {
  if (!_mpVisionPromise) {
    _mpVisionPromise = (async () => {
      const module = await import(`${MP_VISION_BASE}/vision_bundle.mjs`);
      const fileset = await module.FilesetResolver.forVisionTasks(`${MP_VISION_BASE}/wasm`);
      return { module, fileset };
    })().catch(err => {
      _mpVisionPromise = null;
      throw err;
    });
  }
  return _mpVisionPromise;
};

/**
 * COCO class list (same order as YOLO) and the Ultralytics color palette.
 */
window.VisionPalette = (() => {
  const classes = [
    'person', 'bicycle', 'car', 'motorcycle', 'airplane', 'bus', 'train', 'truck', 'boat', 'traffic light',
    'fire hydrant', 'stop sign', 'parking meter', 'bench', 'bird', 'cat', 'dog', 'horse', 'sheep', 'cow',
    'elephant', 'bear', 'zebra', 'giraffe', 'backpack', 'umbrella', 'handbag', 'tie', 'suitcase', 'frisbee',
    'skis', 'snowboard', 'sports ball', 'kite', 'baseball bat', 'baseball glove', 'skateboard', 'surfboard', 'tennis racket', 'bottle',
    'wine glass', 'cup', 'fork', 'knife', 'spoon', 'bowl', 'banana', 'apple', 'sandwich', 'orange',
    'broccoli', 'carrot', 'hot dog', 'pizza', 'donut', 'cake', 'chair', 'couch', 'potted plant', 'bed',
    'dining table', 'toilet', 'tv', 'laptop', 'mouse', 'remote', 'keyboard', 'cell phone', 'microwave', 'oven',
    'toaster', 'sink', 'refrigerator', 'book', 'clock', 'vase', 'scissors', 'teddy bear', 'hair drier', 'toothbrush'
  ];
  const hex = [
    'FF3838', 'FF9D97', 'FF701F', 'FFB21D', 'CFD231', '48F90A', '92CC17', '3DDB86', '1A9334', '00D4BB',
    '2C99A8', '00C2FF', '344593', '6473FF', '0018EC', '8438FF', '520085', 'CB38FF', 'FF95C8', 'FF37C7'
  ];
  const rgbList = hex.map(h => [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)]);
  const alias = { motorbike: 'motorcycle', aeroplane: 'airplane', sofa: 'couch', tvmonitor: 'tv', diningtable: 'dining table', pottedplant: 'potted plant' };
  const classSet = new Set(classes);

  function indexOf(name) {
    const n = alias[name] || name;
    let idx = classes.indexOf(n);
    if (idx < 0) {
      let hash = 0;
      for (let i = 0; i < n.length; i++) hash = (hash * 31 + n.charCodeAt(i)) | 0;
      idx = Math.abs(hash);
    }
    return idx;
  }

  return {
    classes,
    isThing: (name) => classSet.has(alias[name] || name),
    rgb: (name) => rgbList[indexOf(name) % rgbList.length],
    color: (name) => '#' + hex[indexOf(name) % hex.length]
  };
})();

/**
 * Draws a YOLO-style label badge ("class 0.85") at the top-left of a box.
 */
window.drawYoloLabel = function (ctx, x, y, text, color, canvasW) {
  ctx.save();
  ctx.font = '600 13px "Segoe UI", Roboto, Arial, sans-serif';
  ctx.textBaseline = 'middle';
  const tw = ctx.measureText(text).width;
  const bw = tw + 10;
  const bh = 20;
  let bx = Math.max(0, Math.min(x, canvasW - bw));
  let by = y - bh >= 0 ? y - bh : y;
  ctx.fillStyle = color;
  ctx.fillRect(bx, by, bw, bh);
  ctx.fillStyle = '#ffffff';
  ctx.fillText(text, bx + 5, by + bh / 2 + 1);
  ctx.restore();
};

/* ---------- Detection engine ---------- */

class ObjectDetectionEngine {
  constructor() {
    this.detector = null;      // MediaPipe ObjectDetector
    this.cocoModel = null;     // COCO-SSD fallback
    this.backend = null;       // 'mediapipe' | 'cocossd'
    this.variant = 'lite0';    // 'lite0' (fast) | 'lite2' (accurate)
    this.isLoaded = false;
    this.isLoading = false;
    this._loadPromise = null;

    this.minScore = 0.5;
    this.maxResults = 10;
    this.lastPredictions = [];
    this.isDetecting = false;
    this.detectInterval = 80;
    this.lastDetectTime = 0;
    this.displayMode = 'boxes'; // 'boxes' | 'yolo_seg'
  }

  get modelUrl() {
    return 'https://storage.googleapis.com/mediapipe-models/object_detector/efficientdet_lite0/float16/1/efficientdet_lite0.tflite';
  }

  get modelName() {
    return this.backend === 'cocossd' ? 'COCO-SSD' : 'EfficientDet-Lite0';
  }

  loadModel(onProgress) {
    if (this.isLoaded) return Promise.resolve();
    if (this._loadPromise) return this._loadPromise;
    this.isLoading = true;

    this._loadPromise = (async () => {
      try {
        if (onProgress) onProgress(20);
        await this._createMediaPipeDetector();
        this.backend = 'mediapipe';
      } catch (err) {
        console.warn('MediaPipe ObjectDetector failed, falling back to COCO-SSD:', err);
        if (typeof cocoSsd === 'undefined') throw err;
        this.cocoModel = await cocoSsd.load({ base: 'lite_mobilenet_v2' });
        this.backend = 'cocossd';
      }
      this.isLoaded = true;
      if (onProgress) onProgress(100);
    })().finally(() => {
      this.isLoading = false;
      this._loadPromise = null;
    });

    return this._loadPromise;
  }

  async _createMediaPipeDetector() {
    const { module, fileset } = await window.loadMediaPipeVision();
    const detector = await module.ObjectDetector.createFromOptions(fileset, {
      baseOptions: { modelAssetPath: this.modelUrl, delegate: 'CPU' },
      runningMode: 'IMAGE',
      scoreThreshold: 0.25,
      maxResults: this.maxResults
    });
    if (this.detector) {
      try { this.detector.close(); } catch (e) { /* ignore */ }
    }
    this.detector = detector;
  }

  /**
   * Runs one detection on the given frame.
   * @returns {Promise<Array<{bbox:number[], class:string, score:number}>>} video-pixel coordinates
   */
  async detect(video) {
    if (this.backend === 'mediapipe' && this.detector) {
      const res = this.detector.detect(video);
      return (res.detections || [])
        .map(d => {
          const c = d.categories && d.categories[0];
          const b = d.boundingBox;
          return {
            bbox: [b.originX, b.originY, b.width, b.height],
            class: c ? (c.categoryName || c.displayName || 'object') : 'object',
            score: c ? c.score : 0
          };
        })
        .filter(p => p.score >= this.minScore);
    }
    if (this.backend === 'cocossd' && this.cocoModel) {
      return this.cocoModel.detect(video, this.maxResults, this.minScore);
    }
    return [];
  }

  /**
   * Throttled detection; keeps lastPredictions fresh.
   */
  tick(video, onDetectedListUpdate) {
    if (!this.isLoaded || this.isDetecting) return;
    const now = performance.now();
    if (now - this.lastDetectTime < this.detectInterval) return;
    if (!video.videoWidth) return;

    this.isDetecting = true;
    this.lastDetectTime = now;

    this.detect(video).then(predictions => {
      this.lastPredictions = predictions;
      if (onDetectedListUpdate) {
        onDetectedListUpdate(predictions.map(p => ({ class: p.class, score: Math.round(p.score * 100) })));
      }
    }).catch(err => {
      console.warn('Detection error:', err);
    }).finally(() => {
      this.isDetecting = false;
    });
  }

  process(ctx, video, canvasWidth, canvasHeight, onDetectedListUpdate, isMirrored = false) {
    ctx.save();
    if (isMirrored) {
      ctx.translate(canvasWidth, 0);
      ctx.scale(-1, 1);
    }
    ctx.drawImage(video, 0, 0, canvasWidth, canvasHeight);
    ctx.restore();

    this.tick(video, onDetectedListUpdate);
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

      const [rawX, rawY, rawW, rawH] = p.bbox;
      const w = rawW * scaleX;
      const h = rawH * scaleY;
      let x = rawX * scaleX;
      const y = rawY * scaleY;
      if (isMirrored) x = canvasW - x - w;

      const color = window.VisionPalette.color(p.class);
      ctx.strokeStyle = color;
      ctx.lineWidth = 2.5;
      ctx.strokeRect(x, y, w, h);

      window.drawYoloLabel(ctx, x - 1.25, y, `${p.class} ${p.score.toFixed(2)}`, color, canvasW);
    }
    ctx.restore();
  }
}

window.ObjectDetectionEngine = ObjectDetectionEngine;
