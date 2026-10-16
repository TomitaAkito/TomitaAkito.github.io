/**
 * Saliency Map Engine
 * Computes human visual attention and contrast-based visual saliency in real time.
 */
class SaliencyEngine {
  constructor() {
    this.width = 0;
    this.height = 0;
    this.lowW = 80;
    this.lowH = 60;
    this.opacity = 0.6;
    this.showReticle = true;
    this.contrastPower = 1.5;
    this.offscreenCanvas = document.createElement('canvas');
    this.offscreenCtx = this.offscreenCanvas.getContext('2d', { willReadFrequently: true });
  }

  init(width, height) {
    this.width = width;
    this.height = height;
    this.offscreenCanvas.width = this.lowW;
    this.offscreenCanvas.height = this.lowH;
  }

  colormap(val) {
    const v = Math.max(0, Math.min(1, val));
    let r = 0, g = 0, b = 0;

    if (v < 0.25) {
      const t = v / 0.25;
      r = 0;
      g = Math.round(t * 220);
      b = 255;
    } else if (v < 0.5) {
      const t = (v - 0.25) / 0.25;
      r = 0;
      g = 255;
      b = Math.round((1 - t) * 255);
    } else if (v < 0.75) {
      const t = (v - 0.5) / 0.25;
      r = Math.round(t * 255);
      g = 255;
      b = 0;
    } else {
      const t = (v - 0.75) / 0.25;
      r = 255;
      g = Math.round((1 - t) * 230);
      b = 0;
    }
    return [r, g, b];
  }

  process(ctx, video, canvasWidth, canvasHeight, isMirrored = false) {
    if (this.width !== canvasWidth || this.height !== canvasHeight) {
      this.init(canvasWidth, canvasHeight);
    }

    // Draw video to main canvas
    ctx.save();
    if (isMirrored) {
      ctx.translate(canvasWidth, 0);
      ctx.scale(-1, 1);
    }
    ctx.drawImage(video, 0, 0, this.width, this.height);
    ctx.restore();

    // Draw to low-res offscreen canvas
    this.offscreenCtx.drawImage(ctx.canvas, 0, 0, this.lowW, this.lowH);
    const imgData = this.offscreenCtx.getImageData(0, 0, this.lowW, this.lowH);
    const data = imgData.data;
    const len = this.lowW * this.lowH;

    let avgR = 0, avgG = 0, avgB = 0;
    for (let i = 0, j = 0; i < len; i++, j += 4) {
      avgR += data[j];
      avgG += data[j + 1];
      avgB += data[j + 2];
    }
    avgR /= len;
    avgG /= len;
    avgB /= len;

    const saliencyValues = new Float32Array(len);
    let maxVal = 0.001;
    let maxIdx = 0;

    for (let y = 1; y < this.lowH - 1; y++) {
      const row = y * this.lowW;
      for (let x = 1; x < this.lowW - 1; x++) {
        const i = row + x;
        const px = i * 4;
        const r = data[px];
        const g = data[px + 1];
        const b = data[px + 2];

        const dR = r - avgR;
        const dG = g - avgG;
        const dB = b - avgB;
        const globalDist = Math.sqrt(dR * dR + dG * dG + dB * dB);

        const left = (row + (x - 1)) * 4;
        const right = (row + (x + 1)) * 4;
        const up = ((y - 1) * this.lowW + x) * 4;
        const down = ((y + 1) * this.lowW + x) * 4;

        const edgeScore =
          Math.abs(r - data[left]) +
          Math.abs(r - data[right]) +
          Math.abs(r - data[up]) +
          Math.abs(r - data[down]) +
          Math.abs(g - data[left + 1]) +
          Math.abs(g - data[right + 1]);

        const cx = (x - this.lowW / 2) / (this.lowW / 2);
        const cy = (y - this.lowH / 2) / (this.lowH / 2);
        const centerPrior = Math.exp(-(cx * cx + cy * cy) * 0.4);

        let score = (globalDist * 0.6 + edgeScore * 0.4) * centerPrior;
        score = Math.pow(score, this.contrastPower);
        saliencyValues[i] = score;

        if (score > maxVal) {
          maxVal = score;
          maxIdx = i;
        }
      }
    }

    for (let i = 0; i < len; i++) {
      const normVal = saliencyValues[i] / maxVal;
      const [cr, cg, cb] = this.colormap(normVal);
      const px = i * 4;
      data[px] = cr;
      data[px + 1] = cg;
      data[px + 2] = cb;
      data[px + 3] = Math.round(normVal * 255);
    }
    this.offscreenCtx.putImageData(imgData, 0, 0);

    // Overlay heatmap
    ctx.save();
    ctx.globalAlpha = this.opacity;
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(this.offscreenCanvas, 0, 0, this.width, this.height);
    ctx.restore();

    // Reticle
    if (this.showReticle && maxVal > 0.05) {
      const peakX = (maxIdx % this.lowW) * (this.width / this.lowW);
      const peakY = Math.floor(maxIdx / this.lowW) * (this.height / this.lowH);
      this.drawGazeReticle(ctx, peakX, peakY);
    }
  }

  drawGazeReticle(ctx, x, y) {
    ctx.save();
    const radius = 22;

    ctx.strokeStyle = '#ff7a30'; // Accent orange
    ctx.lineWidth = 2;

    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.stroke();

    const arm = 8;
    ctx.beginPath();
    ctx.moveTo(x - radius - arm, y);
    ctx.lineTo(x - radius + 2, y);
    ctx.moveTo(x + radius - 2, y);
    ctx.lineTo(x + radius + arm, y);
    ctx.moveTo(x, y - radius - arm);
    ctx.lineTo(x, y - radius + 2);
    ctx.moveTo(x, y + radius - 2);
    ctx.lineTo(x, y + radius + arm);
    ctx.stroke();

    ctx.fillStyle = '#ff7a30';
    ctx.beginPath();
    ctx.arc(x, y, 3, 0, Math.PI * 2);
    ctx.fill();

    // Clean label
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(x + radius + 6, y - 11, 75, 20);
    ctx.strokeStyle = '#ff7a30';
    ctx.strokeRect(x + radius + 6, y - 11, 75, 20);

    ctx.fillStyle = '#ff7a30';
    ctx.font = '600 11px sans-serif';
    ctx.fillText('注視エリア', x + radius + 11, y + 4);

    ctx.restore();
  }
}

window.SaliencyEngine = SaliencyEngine;
