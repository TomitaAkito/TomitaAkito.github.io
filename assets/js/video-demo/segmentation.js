/**
 * Real-time Instance Segmentation Engine
 *
 * Uses MediaPipe InteractiveSegmenter (Magic Touch) on object crops detected by
 * EfficientDet, anchored at each object's center.
 * Produces crisp, shape-conforming masks with round-robin cached evaluation
 * to maintain high FPS on CPU and mobile devices.
 */
class SegmentationEngine {
  constructor() {
    this.segmenter = null;
    this.isLoaded = false;
    this.isLoading = false;
    this._loadPromise = null;

    this.effect = 'yolo_seg'; // 'yolo_seg' | 'mask_only' | 'contour'
    this.opacity = 0.5;

    this.instances = [];
    this._lastDetsRef = null;
    this.segInterval = 40;     // ms between segmentation calls
    this.lastSegTime = 0;
    this.maxCrop = 256;        // crop long side fed to the segmenter
    this.maxInstances = 8;
    this.lastSegCost = 0;

    this.cropCanvas = document.createElement('canvas');
    this.cropCtx = this.cropCanvas.getContext('2d');
    this.compCanvas = document.createElement('canvas');
    this.compCtx = this.compCanvas.getContext('2d');
  }

  loadModel(onProgress) {
    if (this.isLoaded) return Promise.resolve();
    if (this._loadPromise) return this._loadPromise;
    this.isLoading = true;

    this._loadPromise = (async () => {
      if (onProgress) onProgress(20);
      const { module, fileset } = await window.loadMediaPipeVision();
      if (onProgress) onProgress(50);
      this.segmenter = await module.InteractiveSegmenter.createFromOptions(fileset, {
        baseOptions: {
          modelAssetPath: 'https://storage.googleapis.com/mediapipe-models/interactive_segmenter/magic_touch/float32/1/magic_touch.tflite',
          delegate: 'CPU'
        },
        outputCategoryMask: true,
        outputConfidenceMasks: false
      });
      this.isLoaded = true;
      if (onProgress) onProgress(100);
    })().finally(() => {
      this.isLoading = false;
      this._loadPromise = null;
    });

    return this._loadPromise;
  }

  static iou(a, b) {
    const x1 = Math.max(a[0], b[0]);
    const y1 = Math.max(a[1], b[1]);
    const x2 = Math.min(a[0] + a[2], b[0] + b[2]);
    const y2 = Math.min(a[1] + a[3], b[1] + b[3]);
    const inter = Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
    const uni = a[2] * a[3] + b[2] * b[3] - inter;
    return uni > 0 ? inter / uni : 0;
  }

  /**
   * Match new detections to tracked instances so cached masks survive between frames.
   */
  syncInstances(dets) {
    if (dets === this._lastDetsRef) return;
    this._lastDetsRef = dets;

    const sorted = [...(dets || [])].sort((a, b) => b.score - a.score).slice(0, this.maxInstances);
    const used = new Set();
    const next = [];

    for (const d of sorted) {
      let best = null;
      let bestIou = 0.25;
      for (const inst of this.instances) {
        if (used.has(inst) || inst.class !== d.class) continue;
        const v = SegmentationEngine.iou(inst.bbox, d.bbox);
        if (v > bestIou) { best = inst; bestIou = v; }
      }
      if (best) {
        used.add(best);
        best.bbox = d.bbox.slice();
        best.score = d.score;
        next.push(best);
      } else {
        next.push({ class: d.class, score: d.score, bbox: d.bbox.slice(), mask: null, maskTime: 0 });
      }
    }
    this.instances = next;
  }

  /**
   * Run interactive segmenter on one object crop and cache the colored mask.
   */
  segmentInstance(video, inst) {
    const vw = video.videoWidth;
    const vh = video.videoHeight;
    const [bx, by, bw, bh] = inst.bbox;
    if (bw < 10 || bh < 10) return;

    const pad = 0.1;
    const cx0 = Math.max(0, bx - bw * pad);
    const cy0 = Math.max(0, by - bh * pad);
    const cx1 = Math.min(vw, bx + bw * (1 + pad));
    const cy1 = Math.min(vh, by + bh * (1 + pad));
    const cw = cx1 - cx0;
    const ch = cy1 - cy0;
    if (cw < 10 || ch < 10) return;

    const s = Math.min(1, this.maxCrop / Math.max(cw, ch));
    const tw = Math.max(16, Math.round(cw * s));
    const th = Math.max(16, Math.round(ch * s));
    if (this.cropCanvas.width !== tw || this.cropCanvas.height !== th) {
      this.cropCanvas.width = tw;
      this.cropCanvas.height = th;
    }
    this.cropCtx.drawImage(video, cx0, cy0, cw, ch, 0, 0, tw, th);

    // Keypoint: object center (persons: higher on torso)
    const kyRatio = inst.class === 'person' ? 0.42 : 0.5;
    const kx = Math.min(0.98, Math.max(0.02, (bx + bw * 0.5 - cx0) / cw));
    const ky = Math.min(0.98, Math.max(0.02, (by + bh * kyRatio - cy0) / ch));

    let data = null;
    let mw = 0;
    let mh = 0;
    this.segmenter.segment(this.cropCanvas, { keypoint: { x: kx, y: ky } }, (result) => {
      const m = result && result.categoryMask;
      if (!m) return;
      mw = m.width;
      mh = m.height;
      data = m.getAsUint8Array().slice();
    });
    if (!data || !mw || !mh) return;

    // Limit to detection box (+ small margin)
    const toMx = mw / cw;
    const toMy = mh / ch;
    const margin = 0.04;
    const lim = {
      x0: Math.max(0, Math.floor((bx - bw * margin - cx0) * toMx)),
      y0: Math.max(0, Math.floor((by - bh * margin - cy0) * toMy)),
      x1: Math.min(mw - 1, Math.ceil((bx + bw * (1 + margin) - cx0) * toMx)),
      y1: Math.min(mh - 1, Math.ceil((by + bh * (1 + margin) - cy0) * toMy))
    };

    const mask = this.extractObjectMask(data, mw, mh, Math.round(kx * (mw - 1)), Math.round(ky * (mh - 1)), lim);
    if (!mask) return;

    const built = this.buildMaskCanvases(mask, mw, mh, window.VisionPalette.rgb(inst.class), inst.mask);
    inst.mask = {
      canvas: built.canvas,
      outline: built.outline,
      crop: { x: cx0, y: cy0, w: cw, h: ch },
      refBbox: inst.bbox.slice()
    };
    inst.maskTime = performance.now();
  }

  extractObjectMask(data, w, h, kx, ky, lim) {
    const counts = new Map();
    for (let dy = -2; dy <= 2; dy++) {
      for (let dx = -2; dx <= 2; dx++) {
        const x = Math.min(w - 1, Math.max(0, kx + dx));
        const y = Math.min(h - 1, Math.max(0, ky + dy));
        const v = data[y * w + x];
        counts.set(v, (counts.get(v) || 0) + 1);
      }
    }
    let fg = data[ky * w + kx];
    let bestCount = -1;
    counts.forEach((c, v) => { if (c > bestCount) { bestCount = c; fg = v; } });

    const limArea = (lim.x1 - lim.x0 + 1) * (lim.y1 - lim.y0 + 1);
    const out = new Uint8Array(w * h);

    let seed = -1;
    if (data[ky * w + kx] === fg) {
      seed = ky * w + kx;
    } else {
      for (let r = 1; r < 8 && seed < 0; r++) {
        for (let dy = -r; dy <= r && seed < 0; dy++) {
          for (let dx = -r; dx <= r; dx++) {
            const x = kx + dx;
            const y = ky + dy;
            if (x < lim.x0 || y < lim.y0 || x > lim.x1 || y > lim.y1) continue;
            if (data[y * w + x] === fg) { seed = y * w + x; break; }
          }
        }
      }
    }
    if (seed < 0) return null;

    const stack = new Int32Array(w * h);
    let sp = 0;
    let area = 0;
    stack[sp++] = seed;
    out[seed] = 1;
    while (sp > 0) {
      const p = stack[--sp];
      area++;
      const x = p % w;
      const y = (p - x) / w;
      if (x > lim.x0) { const q = p - 1; if (!out[q] && data[q] === fg) { out[q] = 1; stack[sp++] = q; } }
      if (x < lim.x1) { const q = p + 1; if (!out[q] && data[q] === fg) { out[q] = 1; stack[sp++] = q; } }
      if (y > lim.y0) { const q = p - w; if (!out[q] && data[q] === fg) { out[q] = 1; stack[sp++] = q; } }
      if (y < lim.y1) { const q = p + w; if (!out[q] && data[q] === fg) { out[q] = 1; stack[sp++] = q; } }
    }

    if (area < limArea * 0.02 || area > limArea * 0.97) return null;
    return out;
  }

  buildMaskCanvases(mask, w, h, rgb, prev) {
    const canvas = (prev && prev.canvas) || document.createElement('canvas');
    const outline = (prev && prev.outline) || document.createElement('canvas');
    canvas.width = w; canvas.height = h;
    outline.width = w; outline.height = h;

    const fctx = canvas.getContext('2d');
    const octx = outline.getContext('2d');
    const fill = fctx.createImageData(w, h);
    const edge = octx.createImageData(w, h);
    const fd = fill.data;
    const ed = edge.data;
    const [r, g, b] = rgb;

    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        if (!mask[i]) continue;
        const p = i * 4;
        fd[p] = r; fd[p + 1] = g; fd[p + 2] = b; fd[p + 3] = 255;
        const isEdge = x === 0 || y === 0 || x === w - 1 || y === h - 1 ||
          !mask[i - 1] || !mask[i + 1] || !mask[i - w] || !mask[i + w];
        if (isEdge) {
          ed[p] = r; ed[p + 1] = g; ed[p + 2] = b; ed[p + 3] = 255;
        }
      }
    }
    fctx.putImageData(fill, 0, 0);
    octx.putImageData(edge, 0, 0);
    return { canvas, outline };
  }

  updateMasks(video) {
    if (!this.isLoaded || !this.segmenter || this.instances.length === 0) return;
    const now = performance.now();
    if (now - this.lastSegTime < this.segInterval) return;
    this.lastSegTime = now;

    const queue = [...this.instances].sort((a, b) => a.maskTime - b.maskTime);
    const budget = 28; // ms per frame
    const start = performance.now();
    for (const inst of queue) {
      try {
        this.segmentInstance(video, inst);
      } catch (err) {
        console.warn('Segmentation error:', err);
        break;
      }
      if (performance.now() - start > budget) break;
    }
    this.lastSegCost = performance.now() - start;
  }

  liveItems() {
    return this.instances.map(inst => {
      let maskRect = null;
      if (inst.mask) {
        const r = inst.mask.refBbox;
        const b = inst.bbox;
        const sx = b[2] / r[2];
        const sy = b[3] / r[3];
        const c = inst.mask.crop;
        maskRect = {
          x: b[0] + (c.x - r[0]) * sx,
          y: b[1] + (c.y - r[1]) * sy,
          w: c.w * sx,
          h: c.h * sy
        };
      }
      return {
        class: inst.class,
        score: inst.score,
        box: inst.bbox,
        mask: inst.mask ? inst.mask.canvas : null,
        outline: inst.mask ? inst.mask.outline : null,
        maskRect
      };
    });
  }

  process(ctx, video, canvasWidth, canvasHeight, isMirrored = false, contextData = {}) {
    const effect = contextData.effect || this.effect;

    this.syncInstances(contextData.objects || []);
    this.updateMasks(video);

    const vw = video.videoWidth || canvasWidth;
    const vh = video.videoHeight || canvasHeight;
    this.renderItems(ctx, this.liveItems(), {
      W: canvasWidth,
      H: canvasHeight,
      sx: canvasWidth / vw,
      sy: canvasHeight / vh,
      mirrored: isMirrored,
      effect,
      drawBackground: (c) => {
        c.save();
        if (isMirrored) { c.translate(canvasWidth, 0); c.scale(-1, 1); }
        c.drawImage(video, 0, 0, canvasWidth, canvasHeight);
        c.restore();
      }
    });
  }

  drawMapped(ctx, img, rect, o) {
    const dx = rect.x * o.sx;
    const dy = rect.y * o.sy;
    const dw = rect.w * o.sx;
    const dh = rect.h * o.sy;
    if (o.mirrored) {
      ctx.save();
      ctx.translate(o.W, 0);
      ctx.scale(-1, 1);
      ctx.drawImage(img, dx, dy, dw, dh);
      ctx.restore();
    } else {
      ctx.drawImage(img, dx, dy, dw, dh);
    }
  }

  displayBox(box, o) {
    const w = box[2] * o.sx;
    const h = box[3] * o.sy;
    const x = o.mirrored ? o.W - (box[0] + box[2]) * o.sx : box[0] * o.sx;
    const y = box[1] * o.sy;
    return { x, y, w, h };
  }

  labelText(item) {
    return item.score != null ? `${item.class} ${item.score.toFixed(2)}` : item.class;
  }

  renderItems(ctx, items, o) {
    const effect = o.effect;

    o.drawBackground(ctx);
    ctx.save();
    ctx.imageSmoothingEnabled = true;

    // Fill
    if (effect === 'yolo_seg' || effect === 'mask_only') {
      ctx.globalAlpha = this.opacity;
      for (const it of items) {
        if (it.mask) this.drawMapped(ctx, it.mask, it.maskRect, o);
      }
    }

    // Outline
    ctx.globalAlpha = effect === 'contour' ? 1.0 : 0.9;
    for (const it of items) {
      if (!it.outline) continue;
      this.drawMapped(ctx, it.outline, it.maskRect, o);
      if (effect === 'contour') {
        const r = it.maskRect;
        this.drawMapped(ctx, it.outline, { x: r.x + 0.8 / o.sx, y: r.y + 0.8 / o.sy, w: r.w, h: r.h }, o);
      }
    }
    ctx.restore();

    // Boxes & labels (omit boxes if mask_only or contour)
    for (const it of items) {
      const color = window.VisionPalette.color(it.class);
      const d = this.displayBox(it.box, o);
      if (effect === 'yolo_seg') {
        ctx.save();
        ctx.strokeStyle = color;
        ctx.lineWidth = 2.2;
        ctx.strokeRect(d.x, d.y, d.w, d.h);
        ctx.restore();
      }
      window.drawYoloLabel(ctx, d.x - 1.1, d.y, this.labelText(it), color, o.W);
    }
  }
}

window.SegmentationEngine = SegmentationEngine;
