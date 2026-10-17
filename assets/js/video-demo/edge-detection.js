/**
 * Edge Detection & Real-time Line Art Engine
 * 
 * High-performance, zero-latency Canvas pixel processing engine implementing:
 * 1. Classic & Advanced Edge Algorithms:
 *    - Sobel Filter (gradient magnitude & orientation)
 *    - Canny Edge Detection (Gaussian blur, Non-Maximum Suppression, Hysteresis thresholding)
 *    - Discrete 2nd-order Laplacian
 * 2. Creative Rendering Styles:
 *    - Cyber Neon: Glowing cyan/magenta emission on dark futuristic background
 *    - Pencil Sketch: Graphite pencil strokes on fine paper texture
 *    - Blueprint: Technical CAD drawing on deep blueprint navy
 *    - Directional HSV: Hue wheel corresponding to edge normal orientation
 *    - Comic Toon Overlay: Bold ink strokes composited over original camera stream
 *    - Classic B&W: Monochromatic intensity edges
 */
class EdgeDetectionEngine {
  constructor() {
    this.algorithm = 'canny';      // 'canny' | 'sobel' | 'laplacian'
    this.style = 'classic';        // 'classic' (学会・学術標準) | 'overlay_red' | 'color_dir' | 'neon' | 'sketch' | 'blueprint' | 'comic_overlay'
    this.sensitivity = 50;         // 1 - 100
    this.blurLevel = 'weak';       // 'none' | 'weak' | 'strong'
    this.invert = false;           // invert background / stroke colors

    // Internal working buffers
    this.workW = 0;
    this.workH = 0;
    this.offscreenCanvas = document.createElement('canvas');
    this.offscreenCtx = this.offscreenCanvas.getContext('2d', { willReadFrequently: true });

    this.grayBuf = null;
    this.blurBuf = null;
    this.gradX = null;
    this.gradY = null;
    this.magBuf = null;
    this.dirBuf = null;
    this.nmsBuf = null;
    this.edgeBuf = null;

    // Precomputed Color Palettes for 60fps rendering
    this.paletteNeon = this.createNeonPalette();
    this.paletteHsv = this.createHsvPalette();
  }

  createNeonPalette() {
    // 256 colors cycling from deep blue -> electric cyan -> neon magenta -> pink
    const pal = new Uint32Array(256);
    for (let i = 0; i < 256; i++) {
      const t = i / 255;
      let r, g, b;
      if (t < 0.5) {
        const u = t * 2;
        // Cyan (#00f5d4) to Purple (#7209b7)
        r = Math.floor(0 * (1 - u) + 114 * u);
        g = Math.floor(245 * (1 - u) + 9 * u);
        b = Math.floor(212 * (1 - u) + 183 * u);
      } else {
        const u = (t - 0.5) * 2;
        // Purple (#7209b7) to Neon Pink (#f72585)
        r = Math.floor(114 * (1 - u) + 247 * u);
        g = Math.floor(9 * (1 - u) + 37 * u);
        b = Math.floor(183 * (1 - u) + 133 * u);
      }
      // ABGR format for Little Endian Uint32Array
      pal[i] = (255 << 24) | (b << 16) | (g << 8) | r;
    }
    return pal;
  }

  createHsvPalette() {
    // 360 degree color wheel for gradient orientations
    const pal = new Uint32Array(360);
    for (let deg = 0; deg < 360; deg++) {
      const h = deg / 60;
      const c = 255;
      const x = Math.floor(c * (1 - Math.abs((h % 2) - 1)));
      let r = 0, g = 0, b = 0;
      if (h < 1) { r = c; g = x; }
      else if (h < 2) { r = x; g = c; }
      else if (h < 3) { g = c; b = x; }
      else if (h < 4) { g = x; b = c; }
      else if (h < 5) { r = x; b = c; }
      else { r = c; b = x; }
      pal[deg] = (255 << 24) | (b << 16) | (g << 8) | r;
    }
    return pal;
  }

  ensureBuffers(w, h) {
    if (this.workW === w && this.workH === h && this.grayBuf) return;
    this.workW = w;
    this.workH = h;
    this.offscreenCanvas.width = w;
    this.offscreenCanvas.height = h;

    const size = w * h;
    this.grayBuf = new Uint8Array(size);
    this.blurBuf = new Uint8Array(size);
    this.gradX = new Int16Array(size);
    this.gradY = new Int16Array(size);
    this.magBuf = new Float32Array(size);
    this.dirBuf = new Uint8Array(size); // 0: 0 deg, 1: 45 deg, 2: 90 deg, 3: 135 deg
    this.nmsBuf = new Float32Array(size);
    this.edgeBuf = new Uint8Array(size);
  }

  process(ctx, video, canvasWidth, canvasHeight, isMirrored = false) {
    if (!video || video.readyState < 2) return;

    // Downscale target processing resolution if camera is very high resolution to preserve 60fps
    let targetW = canvasWidth;
    let targetH = canvasHeight;
    const maxSide = 640;
    if (targetW > maxSide || targetH > maxSide) {
      const scale = maxSide / Math.max(targetW, targetH);
      targetW = Math.round(targetW * scale);
      targetH = Math.round(targetH * scale);
    }

    this.ensureBuffers(targetW, targetH);

    // 1. Draw raw video onto offscreen canvas (mirrored if needed)
    const octx = this.offscreenCtx;
    octx.save();
    if (isMirrored) {
      octx.translate(targetW, 0);
      octx.scale(-1, 1);
    }
    octx.drawImage(video, 0, 0, targetW, targetH);
    octx.restore();

    const imgData = octx.getImageData(0, 0, targetW, targetH);
    const pixels = imgData.data;
    const w = targetW;
    const h = targetH;
    const size = w * h;

    // 2. Grayscale Conversion (Integer fixed-point)
    const gray = this.grayBuf;
    for (let i = 0, p = 0; i < size; i++, p += 4) {
      gray[i] = (pixels[p] * 77 + pixels[p + 1] * 150 + pixels[p + 2] * 29) >> 8;
    }

    // 3. Gaussian Smoothing
    let srcBuf = gray;
    if (this.blurLevel === 'weak') {
      this.applyGaussianBlur3x3(gray, this.blurBuf, w, h);
      srcBuf = this.blurBuf;
    } else if (this.blurLevel === 'strong') {
      this.applyGaussianBlur5x5(gray, this.blurBuf, w, h);
      srcBuf = this.blurBuf;
    }

    // 4. Compute Edges based on selected algorithm
    if (this.algorithm === 'canny') {
      this.computeCanny(srcBuf, w, h);
    } else if (this.algorithm === 'laplacian') {
      this.computeLaplacian(srcBuf, w, h);
    } else {
      this.computeSobel(srcBuf, w, h);
    }

    // 5. Render to image buffer according to creative style
    this.renderStyle(imgData, w, h);

    // 6. Draw processed output to screen canvas
    if (targetW === canvasWidth && targetH === canvasHeight) {
      ctx.putImageData(imgData, 0, 0);
    } else {
      octx.putImageData(imgData, 0, 0);
      ctx.drawImage(this.offscreenCanvas, 0, 0, canvasWidth, canvasHeight);
    }
  }

  applyGaussianBlur3x3(src, dst, w, h) {
    // 3x3 separable Gaussian [1, 2, 1] / 4
    const temp = new Uint8Array(w * h);

    // Horizontal
    for (let y = 0; y < h; y++) {
      const row = y * w;
      temp[row] = src[row];
      for (let x = 1; x < w - 1; x++) {
        temp[row + x] = (src[row + x - 1] + (src[row + x] << 1) + src[row + x + 1]) >> 2;
      }
      temp[row + w - 1] = src[row + w - 1];
    }

    // Vertical
    for (let x = 0; x < w; x++) {
      dst[x] = temp[x];
      for (let y = 1; y < h - 1; y++) {
        dst[y * w + x] = (temp[(y - 1) * w + x] + (temp[y * w + x] << 1) + temp[(y + 1) * w + x]) >> 2;
      }
      dst[(h - 1) * w + x] = temp[(h - 1) * w + x];
    }
  }

  applyGaussianBlur5x5(src, dst, w, h) {
    // 5x5 separable Gaussian [1, 4, 6, 4, 1] / 16
    const temp = new Uint8Array(w * h);

    // Horizontal
    for (let y = 0; y < h; y++) {
      const row = y * w;
      for (let x = 2; x < w - 2; x++) {
        temp[row + x] = (
          src[row + x - 2] +
          (src[row + x - 1] << 2) +
          (src[row + x] * 6) +
          (src[row + x + 1] << 2) +
          src[row + x + 2]
        ) >> 4;
      }
    }

    // Vertical
    for (let x = 2; x < w - 2; x++) {
      for (let y = 2; y < h - 2; y++) {
        dst[y * w + x] = (
          temp[(y - 2) * w + x] +
          (temp[(y - 1) * w + x] << 2) +
          (temp[y * w + x] * 6) +
          (temp[(y + 1) * w + x] << 2) +
          temp[(y + 2) * w + x]
        ) >> 4;
      }
    }
  }

  computeSobel(src, w, h) {
    const gx = this.gradX;
    const gy = this.gradY;
    const mag = this.magBuf;
    const edge = this.edgeBuf;

    // Sensitivity factor (1 - 100) -> threshold
    const sensNorm = this.sensitivity / 100;
    const threshold = Math.max(8, (1.0 - sensNorm) * 160 + 15);
    const gain = 1.0 + sensNorm * 1.5;

    for (let y = 1; y < h - 1; y++) {
      const r0 = (y - 1) * w;
      const r1 = y * w;
      const r2 = (y + 1) * w;

      for (let x = 1; x < w - 1; x++) {
        const idx = r1 + x;

        // Sobel kernels
        const valX = (
          -src[r0 + x - 1] + src[r0 + x + 1]
          - 2 * src[r1 + x - 1] + 2 * src[r1 + x + 1]
          - src[r2 + x - 1] + src[r2 + x + 1]
        );

        const valY = (
          -src[r0 + x - 1] - 2 * src[r0 + x] - src[r0 + x + 1]
          + src[r2 + x - 1] + 2 * src[r2 + x] + src[r2 + x + 1]
        );

        gx[idx] = valX;
        gy[idx] = valY;

        // Approximate magnitude for speed: |gx| + |gy|
        const m = (Math.abs(valX) + Math.abs(valY)) * gain;
        mag[idx] = m;
        edge[idx] = m >= threshold ? Math.min(255, Math.floor(m)) : 0;
      }
    }
  }

  computeCanny(src, w, h) {
    const gx = this.gradX;
    const gy = this.gradY;
    const mag = this.magBuf;
    const dir = this.dirBuf;
    const nms = this.nmsBuf;
    const edge = this.edgeBuf;

    // 1. Sobel Gradient and Direction Classification
    for (let y = 1; y < h - 1; y++) {
      const r0 = (y - 1) * w;
      const r1 = y * w;
      const r2 = (y + 1) * w;

      for (let x = 1; x < w - 1; x++) {
        const idx = r1 + x;

        const valX = (
          -src[r0 + x - 1] + src[r0 + x + 1]
          - 2 * src[r1 + x - 1] + 2 * src[r1 + x + 1]
          - src[r2 + x - 1] + src[r2 + x + 1]
        );

        const valY = (
          -src[r0 + x - 1] - 2 * src[r0 + x] - src[r0 + x + 1]
          + src[r2 + x - 1] + 2 * src[r2 + x] + src[r2 + x + 1]
        );

        gx[idx] = valX;
        gy[idx] = valY;
        const m = Math.hypot(valX, valY);
        mag[idx] = m;

        // Angle quantization into 4 directions: 0 (horiz), 1 (diag 45), 2 (vert), 3 (diag 135)
        let angle = Math.atan2(valY, valX) * (180 / Math.PI);
        if (angle < 0) angle += 180;

        if ((angle >= 0 && angle < 22.5) || (angle >= 157.5 && angle <= 180)) {
          dir[idx] = 0; // Horizontal
        } else if (angle >= 22.5 && angle < 67.5) {
          dir[idx] = 1; // 45 degree
        } else if (angle >= 67.5 && angle < 112.5) {
          dir[idx] = 2; // Vertical
        } else {
          dir[idx] = 3; // 135 degree
        }
      }
    }

    // 2. Non-Maximum Suppression (NMS)
    for (let y = 1; y < h - 1; y++) {
      const row = y * w;
      for (let x = 1; x < w - 1; x++) {
        const idx = row + x;
        const m = mag[idx];
        const d = dir[idx];

        let m1 = 0, m2 = 0;
        if (d === 0) {
          m1 = mag[idx - 1];
          m2 = mag[idx + 1];
        } else if (d === 1) {
          m1 = mag[idx - w + 1];
          m2 = mag[idx + w - 1];
        } else if (d === 2) {
          m1 = mag[idx - w];
          m2 = mag[idx + w];
        } else {
          m1 = mag[idx - w - 1];
          m2 = mag[idx + w + 1];
        }

        nms[idx] = (m >= m1 && m >= m2) ? m : 0;
      }
    }

    // 3. Double Thresholding and Hysteresis Tracking
    const sensNorm = this.sensitivity / 100;
    const highThreshold = Math.max(16, (1.0 - sensNorm) * 140 + 20);
    const lowThreshold = highThreshold * 0.45;

    edge.fill(0);

    for (let y = 1; y < h - 1; y++) {
      const row = y * w;
      for (let x = 1; x < w - 1; x++) {
        const idx = row + x;
        const val = nms[idx];

        if (val >= highThreshold) {
          edge[idx] = 255; // Strong edge
        } else if (val >= lowThreshold) {
          // Weak edge: check 8-connected neighborhood for strong edges
          if (
            nms[idx - 1] >= highThreshold ||
            nms[idx + 1] >= highThreshold ||
            nms[idx - w] >= highThreshold ||
            nms[idx + w] >= highThreshold ||
            nms[idx - w - 1] >= highThreshold ||
            nms[idx - w + 1] >= highThreshold ||
            nms[idx + w - 1] >= highThreshold ||
            nms[idx + w + 1] >= highThreshold
          ) {
            edge[idx] = 255;
          }
        }
      }
    }
  }

  computeLaplacian(src, w, h) {
    const mag = this.magBuf;
    const edge = this.edgeBuf;
    const sensNorm = this.sensitivity / 100;
    const threshold = Math.max(6, (1.0 - sensNorm) * 80 + 10);
    const gain = 1.0 + sensNorm * 1.8;

    for (let y = 1; y < h - 1; y++) {
      const r0 = (y - 1) * w;
      const r1 = y * w;
      const r2 = (y + 1) * w;

      for (let x = 1; x < w - 1; x++) {
        const idx = r1 + x;

        // 8-neighbor Laplacian kernel
        const val = (
          src[r0 + x - 1] + src[r0 + x] + src[r0 + x + 1] +
          src[r1 + x - 1] - 8 * src[r1 + x] + src[r1 + x + 1] +
          src[r2 + x - 1] + src[r2 + x] + src[r2 + x + 1]
        );

        const m = Math.abs(val) * gain;
        mag[idx] = m;
        edge[idx] = m >= threshold ? Math.min(255, Math.floor(m * 1.5)) : 0;
      }
    }
  }

  renderStyle(imgData, w, h) {
    const edge = this.edgeBuf;
    const gx = this.gradX;
    const gy = this.gradY;
    const pixels = imgData.data;
    const u32 = new Uint32Array(imgData.data.buffer);
    const size = w * h;

    const isInv = this.invert;

    switch (this.style) {
      case 'classic': {
        // Academic Standard: Classic Edge Map (White edges on black, or black on white if inverted)
        const bg = isInv ? 255 : 0;
        const bgVal = (255 << 24) | (bg << 16) | (bg << 8) | bg;

        for (let i = 0; i < size; i++) {
          const e = edge[i];
          if (e > 0) {
            const v = isInv ? (255 - e) : e;
            u32[i] = (255 << 24) | (v << 16) | (v << 8) | v;
          } else {
            u32[i] = bgVal;
          }
        }
        break;
      }

      case 'overlay_red': {
        // Academic Outline Overlay: Bright red edge contours superimposed on raw video feed
        for (let i = 0, p = 0; i < size; i++, p += 4) {
          if (edge[i] > 0) {
            pixels[p] = 255;
            pixels[p + 1] = 30;
            pixels[p + 2] = 30;
          }
        }
        break;
      }

      case 'neon': {
        // Futuristic Cyber Neon on dark navy/black background
        const bgVal = isInv ? 0xfffcfbfa : 0xff16110e; // Light vs Dark Navy
        const pal = this.paletteNeon;

        for (let i = 0; i < size; i++) {
          const e = edge[i];
          if (e > 0) {
            u32[i] = pal[e];
          } else {
            u32[i] = bgVal;
          }
        }
        break;
      }

      case 'sketch': {
        // Pencil Sketch on off-white textured fine art paper
        // Background: warm paper (#f6f5f0), Strokes: graphite dark gray (#2b2b2b)
        const bg = isInv ? 0xff1e1e1e : 0xfff0f5f6;
        const strokeColor = isInv ? 240 : 35;

        for (let i = 0; i < size; i++) {
          const e = edge[i];
          if (e > 0) {
            const alpha = e / 255;
            const v = Math.floor((1 - alpha) * 230 + strokeColor * alpha);
            // Shade graphite
            u32[i] = (255 << 24) | (v << 16) | (v << 8) | v;
          } else {
            u32[i] = bg;
          }
        }
        break;
      }

      case 'blueprint': {
        // Technical Blueprint: deep architectural navy (#0d1b2a) + cyan/white ink (#e0fbfc / #00b4d8)
        const bgNavy = isInv ? 0xfff0f7ff : 0xff2a1b0d; // little-endian ABGR
        const cyanInk = (255 << 24) | (251 << 16) | (224 << 8) | 0;

        for (let i = 0; i < size; i++) {
          const e = edge[i];
          if (e > 0) {
            u32[i] = cyanInk;
          } else {
            // Subtle CAD grid pattern (every 32 pixels)
            const x = i % w;
            const y = (i / w) | 0;
            if (x % 32 === 0 || y % 32 === 0) {
              u32[i] = isInv ? 0xffdce6f0 : 0xff3b2716;
            } else {
              u32[i] = bgNavy;
            }
          }
        }
        break;
      }

      case 'color_dir': {
        // Scientific Directional Color: HSV Hue determined by edge angle (atan2(gy, gx))
        const pal = this.paletteHsv;
        const bg = isInv ? 0xffffffff : 0xff000000;

        for (let i = 0; i < size; i++) {
          if (edge[i] > 0) {
            let deg = Math.floor(Math.atan2(gy[i], gx[i]) * (180 / Math.PI));
            if (deg < 0) deg += 360;
            if (deg >= 360) deg = 359;
            u32[i] = pal[deg];
          } else {
            u32[i] = bg;
          }
        }
        break;
      }

      case 'comic_overlay': {
        // Comic Ink Overlay: Keeps raw video pixels and superimposes thick dark ink edges
        const inkR = isInv ? 255 : 20;
        const inkG = isInv ? 255 : 20;
        const inkB = isInv ? 255 : 20;

        for (let i = 0, p = 0; i < size; i++, p += 4) {
          const e = edge[i];
          if (e > 0) {
            const alpha = Math.min(1.0, (e / 255) * 1.4);
            pixels[p] = Math.floor(pixels[p] * (1 - alpha) + inkR * alpha);
            pixels[p + 1] = Math.floor(pixels[p + 1] * (1 - alpha) + inkG * alpha);
            pixels[p + 2] = Math.floor(pixels[p + 2] * (1 - alpha) + inkB * alpha);
          }
        }
        break;
      }

      default: {
        break;
      }
    }
  }
}

window.EdgeDetectionEngine = EdgeDetectionEngine;
