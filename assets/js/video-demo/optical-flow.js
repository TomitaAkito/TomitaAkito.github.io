/**
 * Optical Flow Module (Lucas-Kanade Block Method)
 * Real-time gradient-based optical flow computation.
 */
class OpticalFlowEngine {
  constructor() {
    this.prevGray = null;
    this.width = 0;
    this.height = 0;
    this.step = 16;
    this.winSize = 7;
    this.threshold = 1.2;
    this.scale = 3.5;
    this.mode = 'arrows'; // 'arrows' | 'heatmap' | 'combined'
    this.historyAlpha = 0.85;
    this.motionMap = null;
  }

  init(width, height) {
    this.width = width;
    this.height = height;
    this.prevGray = new Uint8Array(width * height);
    this.motionMap = new Float32Array(width * height);
  }

  reset() {
    this.prevGray = null;
    if (this.motionMap) {
      this.motionMap.fill(0);
    }
  }

  toGrayscale(data, outGray) {
    const len = this.width * this.height;
    for (let i = 0, j = 0; i < len; i++, j += 4) {
      outGray[i] = (data[j] * 77 + data[j + 1] * 150 + data[j + 2] * 29) >> 8;
    }
  }

  process(ctx, video, canvasWidth, canvasHeight, isMirrored = false) {
    if (this.width !== canvasWidth || this.height !== canvasHeight) {
      this.init(canvasWidth, canvasHeight);
    }

    // Draw video to read frame
    ctx.save();
    if (isMirrored) {
      ctx.translate(canvasWidth, 0);
      ctx.scale(-1, 1);
    }
    ctx.drawImage(video, 0, 0, this.width, this.height);
    ctx.restore();

    const imgData = ctx.getImageData(0, 0, this.width, this.height);
    const currGray = new Uint8Array(this.width * this.height);
    this.toGrayscale(imgData.data, currGray);

    if (!this.prevGray) {
      this.prevGray = currGray;
      return;
    }

    const vectors = [];
    const step = this.step;
    const w = this.width;
    const h = this.height;
    const r = this.winSize;

    // Decay motion map
    for (let i = 0; i < this.motionMap.length; i++) {
      this.motionMap[i] *= this.historyAlpha;
    }

    // Lucas-Kanade optical flow
    for (let y = r + 1; y < h - r - 1; y += step) {
      for (let x = r + 1; x < w - r - 1; x += step) {
        let sumIx2 = 0;
        let sumIy2 = 0;
        let sumIxIy = 0;
        let sumIxIt = 0;
        let sumIyIt = 0;

        for (let wy = -r; wy <= r; wy += 2) {
          const rowOffset = (y + wy) * w;
          for (let wx = -r; wx <= r; wx += 2) {
            const idx = rowOffset + (x + wx);

            const ix = (currGray[idx + 1] - currGray[idx - 1]) * 0.5;
            const iy = (currGray[idx + w] - currGray[idx - w]) * 0.5;
            const it = currGray[idx] - this.prevGray[idx];

            sumIx2 += ix * ix;
            sumIy2 += iy * iy;
            sumIxIy += ix * iy;
            sumIxIt += ix * it;
            sumIyIt += iy * it;
          }
        }

        const det = sumIx2 * sumIy2 - sumIxIy * sumIxIy;

        if (det > 1e-4) {
          const u = (-sumIy2 * sumIxIt + sumIxIy * sumIyIt) / det;
          const v = (sumIxIy * sumIxIt - sumIx2 * sumIyIt) / det;
          const mag = Math.sqrt(u * u + v * v);

          if (mag >= this.threshold && mag < 35) {
            vectors.push({ x, y, u, v, mag });
            const mapIdx = y * w + x;
            this.motionMap[mapIdx] = Math.min(1.0, this.motionMap[mapIdx] + mag * 0.15);
          }
        }
      }
    }

    if (this.mode === 'heatmap' || this.mode === 'combined') {
      this.renderHeatmap(ctx);
    }

    if (this.mode === 'arrows' || this.mode === 'combined') {
      this.renderArrows(ctx, vectors);
    }

    this.prevGray = currGray;
  }

  renderArrows(ctx, vectors) {
    ctx.lineWidth = 2.0;

    for (let i = 0; i < vectors.length; i++) {
      const { x, y, u, v, mag } = vectors[i];
      const targetX = x + u * this.scale;
      const targetY = y + v * this.scale;

      const angle = Math.atan2(v, u);
      const hue = Math.floor(((angle + Math.PI) / (2 * Math.PI)) * 360);

      ctx.strokeStyle = `hsl(${hue}, 85%, 45%)`;
      ctx.fillStyle = `hsl(${hue}, 85%, 45%)`;

      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(targetX, targetY);
      ctx.stroke();

      const headLen = Math.min(5 + mag, 9);
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
  }

  renderHeatmap(ctx) {
    const heatData = ctx.getImageData(0, 0, this.width, this.height);
    const data = heatData.data;
    const map = this.motionMap;
    const len = this.width * this.height;

    for (let i = 0; i < len; i++) {
      const heat = map[i];
      if (heat > 0.05) {
        const px = i * 4;
        data[px] = Math.min(255, data[px] + heat * 180);
        data[px + 1] = Math.min(255, data[px + 1] + heat * 90);
        data[px + 2] = Math.min(255, data[px + 2] + heat * 40);
      }
    }
    ctx.putImageData(heatData, 0, 0);
  }
}

window.OpticalFlowEngine = OpticalFlowEngine;
