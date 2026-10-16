/**
 * Vision Demo - Main Controller
 * Coordinates webcam, task engines, clean UI controls, and performance meters.
 */
document.addEventListener('DOMContentLoaded', () => {
  const video = document.getElementById('vs-video-raw');
  const mainCanvas = document.getElementById('vs-canvas-main');
  const mainCtx = mainCanvas.getContext('2d');

  const splitContainer = document.getElementById('vs-split-container');
  const splitOriginalCanvas = document.getElementById('vs-split-orig');
  const splitOrigCtx = splitOriginalCanvas.getContext('2d');
  const splitProcessedCanvas = document.getElementById('vs-split-proc');
  const splitProcCtx = splitProcessedCanvas.getContext('2d');

  const startCamBtn = document.getElementById('vs-btn-start');
  const stopCamBtn = document.getElementById('vs-btn-stop');
  const mirrorToggleBtn = document.getElementById('vs-btn-mirror');
  const snapshotBtn = document.getElementById('vs-btn-snapshot');
  const resolutionSelect = document.getElementById('vs-select-res');
  const viewModeSelect = document.getElementById('vs-select-view');

  const placeholderOverlay = document.getElementById('vs-placeholder');
  const loadingOverlay = document.getElementById('vs-loading-overlay');
  const loadingText = document.getElementById('vs-loading-text');
  const loadingProgressFill = document.getElementById('vs-loading-progress-fill');

  const statFps = document.getElementById('vs-stat-fps');
  const statLatency = document.getElementById('vs-stat-latency');
  const statRes = document.getElementById('vs-stat-res');
  const statModeBadge = document.getElementById('vs-stat-mode-badge');

  const tabButtons = document.querySelectorAll('.demo-tab-btn');
  const controlPanels = document.querySelectorAll('.demo-task-panel');

  // State
  let stream = null;
  let isRunning = false;
  let currentTask = 'guide';
  let isMirrored = true; // Natural mirror view by default
  let viewMode = 'single';

  // FPS tracking
  let frameCount = 0;
  let lastFpsUpdateTime = performance.now();

  // Engine Instances
  const engines = {
    object: new window.ObjectDetectionEngine(),
    face: new window.FaceExpressionEngine(),
    depth: new window.DepthEstimationEngine(),
    saliency: new window.SaliencyEngine(),
    flow: new window.OpticalFlowEngine(),
    segmentation: new window.SegmentationEngine()
  };

  // Lightweight person silhouette (BodyPix) used only as a prior for the saliency map
  const saliencyPerson = {
    model: null,
    loading: null,
    busy: false,
    lastTime: 0,
    last: null,
    load() {
      if (this.model || this.loading || typeof bodyPix === 'undefined') return;
      this.loading = bodyPix.load({ architecture: 'MobileNetV1', outputStride: 16, multiplier: 0.5, quantBytes: 2 })
        .then(m => { this.model = m; })
        .catch(err => console.warn('BodyPix load failed:', err))
        .finally(() => { this.loading = null; });
    },
    tick(video) {
      if (!this.model || this.busy || performance.now() - this.lastTime < 200) return;
      this.busy = true;
      this.lastTime = performance.now();
      this.model.segmentPerson(video, { internalResolution: 'low', segmentationThreshold: 0.65, maxDetections: 1 })
        .then(seg => { this.last = seg; })
        .catch(() => {})
        .finally(() => { this.busy = false; });
    }
  };

  function showLoading(msg, progress = 0) {
    if (loadingText) loadingText.textContent = msg;
    if (loadingProgressFill) loadingProgressFill.style.width = `${progress}%`;
    if (loadingOverlay) loadingOverlay.classList.remove('hidden');
  }

  function hideLoading() {
    if (loadingOverlay) loadingOverlay.classList.add('hidden');
  }

  async function startCamera() {
    showLoading('カメラを初期化中...');
    const [w, h] = resolutionSelect.value.split('x').map(Number);

    try {
      if (stream) {
        stream.getTracks().forEach(track => track.stop());
      }

      stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: {
          width: { ideal: w },
          height: { ideal: h },
          facingMode: 'user'
        }
      });

      video.srcObject = stream;
      await video.play();

      const actualW = video.videoWidth || w;
      const actualH = video.videoHeight || h;

      mainCanvas.width = actualW;
      mainCanvas.height = actualH;
      splitOriginalCanvas.width = actualW;
      splitOriginalCanvas.height = actualH;
      splitProcessedCanvas.width = actualW;
      splitProcessedCanvas.height = actualH;

      if (statRes) statRes.textContent = `${actualW}x${actualH}`;

      if (placeholderOverlay) placeholderOverlay.classList.add('hidden');
      if (startCamBtn) startCamBtn.style.display = 'none';
      if (stopCamBtn) stopCamBtn.style.display = 'inline-flex';
      if (snapshotBtn) snapshotBtn.disabled = false;

      isRunning = true;
      hideLoading();

      await prepareActiveTask(currentTask);
      requestAnimationFrame(renderLoop);
    } catch (err) {
      console.error('Camera access error:', err);
      hideLoading();
      alert(`カメラの起動に失敗しました: ${err.name} - ${err.message}\nカメラの利用許可を確認してください。`);
    }
  }

  function stopCamera() {
    isRunning = false;
    if (stream) {
      stream.getTracks().forEach(track => track.stop());
      stream = null;
    }
    video.srcObject = null;
    if (placeholderOverlay) placeholderOverlay.classList.remove('hidden');
    if (startCamBtn) startCamBtn.style.display = 'inline-flex';
    if (stopCamBtn) stopCamBtn.style.display = 'none';
    if (snapshotBtn) snapshotBtn.disabled = true;
    if (statFps) statFps.textContent = '0';
    if (statLatency) statLatency.textContent = '0ms';
  }

  async function prepareActiveTask(taskKey) {
    if (taskKey === 'object') {
      const needSeg = engines.object.displayMode !== 'boxes' && !engines.segmentation.isLoaded;
      if (!engines.object.isLoaded || needSeg) {
        showLoading('物体検出モデル読込中...', 20);
        try {
          await engines.object.loadModel((pct) => showLoading('物体検出モデル読込中...', pct));
          if (needSeg) {
            await engines.segmentation.loadModel((pct) => showLoading('セグメンテーションモデル読込中...', pct));
          }
        } catch (err) {
          console.error(err);
          alert('モデルの読込に失敗しました。');
        } finally {
          hideLoading();
        }
      }
    } else if (taskKey === 'face' && !engines.face.isLoaded) {
    } else if (taskKey === 'depth' && !engines.depth.aiLoaded) {
      showLoading('深度推定AI (Depth Anything) モデルを準備中...', 15);
      try {
        await engines.depth.loadAIModel((pct) => showLoading(`深度推定モデル読込中 (${pct}%)...`, pct));
        const statusEl = document.getElementById('demo-depth-status');
        if (statusEl && engines.depth.aiLoaded) {
          statusEl.textContent = '高精度AI (Depth Anything) 稼働中';
          statusEl.style.background = '#e6f9f0';
          statusEl.style.borderColor = '#b7edd2';
          statusEl.style.color = '#0e9f6e';
        }
      } catch (err) {
        console.warn('Depth Anything load error, running enhanced gradient:', err);
      } finally {
        hideLoading();
      }
    } else if (taskKey === 'saliency') {
      // Background load BodyPix for region contour prior
      saliencyPerson.load();
    }
  }

  async function switchTask(taskKey) {
    currentTask = taskKey;

    tabButtons.forEach(btn => {
      btn.classList.toggle('active', btn.dataset.task === taskKey);
    });

    controlPanels.forEach(panel => {
      panel.style.display = panel.id === `demo-panel-${taskKey}` ? 'flex' : 'none';
    });

    const taskNames = {
      guide: '使い方',
      object: '物体検出 (Object Detection)',
      face: '表情検出 (Facial Expression)',
      depth: '深度推定 (Depth Estimation)',
      saliency: '顕著性 (Saliency Map)',
      flow: 'オプティカルフロー (Optical Flow)'
    };
    if (statModeBadge) {
      statModeBadge.textContent = taskKey === 'guide' ? '機能を選択してください' : (taskNames[taskKey] || taskKey);
    }

    // Only preload models for actual processing tasks
    if (taskKey !== 'guide') {
      prepareActiveTask(taskKey);
    }
  }

  function renderLoop() {
    if (!isRunning) return;

    const startPerf = performance.now();
    let targetCtx = mainCtx;
    let targetCanvas = mainCanvas;

    if (viewMode === 'split') {
      targetCtx = splitProcCtx;
      targetCanvas = splitProcessedCanvas;
      // Original frame on left
      splitOrigCtx.save();
      if (isMirrored) {
        splitOrigCtx.translate(splitOriginalCanvas.width, 0);
        splitOrigCtx.scale(-1, 1);
      }
      splitOrigCtx.drawImage(video, 0, 0, splitOriginalCanvas.width, splitOriginalCanvas.height);
      splitOrigCtx.restore();
    }

    const cw = targetCanvas.width;
    const ch = targetCanvas.height;

    try {
      if (currentTask === 'guide') {
        // Draw raw camera feed directly
        targetCtx.save();
        if (isMirrored) {
          targetCtx.translate(cw, 0);
          targetCtx.scale(-1, 1);
        }
        targetCtx.drawImage(video, 0, 0, cw, ch);
        targetCtx.restore();
      } else if (currentTask === 'object') {
        if (engines.object.displayMode === 'boxes') {
          engines.object.process(targetCtx, video, cw, ch, updateDetectedList, isMirrored);
        } else {
          engines.object.tick(video, updateDetectedList);
          engines.segmentation.process(targetCtx, video, cw, ch, isMirrored, {
            objects: engines.object.lastPredictions,
            effect: engines.object.displayMode
          });
        }
      } else if (currentTask === 'face') {
        engines.face.process(targetCtx, video, cw, ch, updateEmotionsMeter, isMirrored);
      } else if (currentTask === 'depth') {
        engines.depth.process(targetCtx, video, cw, ch, isMirrored);
      } else if (currentTask === 'saliency') {
        // Run lightweight face tracking in background if loaded
        if (engines.face.isLoaded && !engines.face.isDetecting && performance.now() - engines.face.lastDetectTime > 250) {
          engines.face.lastDetectTime = performance.now();
          engines.face.isDetecting = true;
          faceapi.detectAllFaces(video, new faceapi.TinyFaceDetectorOptions({ inputSize: 160, scoreThreshold: 0.45 }))
            .then(dets => { engines.face.lastDetections = dets; engines.face.isDetecting = false; })
            .catch(() => { engines.face.isDetecting = false; });
        }

        // Run lightweight person segmentation update for subject region contour
        saliencyPerson.tick(video);

        engines.saliency.process(targetCtx, video, cw, ch, isMirrored, {
          faces: engines.face.lastDetections,
          objects: engines.object.lastPredictions,
          segmentation: saliencyPerson.last
        });
      } else if (currentTask === 'flow') {
        engines.flow.process(targetCtx, video, cw, ch, isMirrored);
      }
    } catch (err) {
      console.warn('Render loop engine error:', err);
    }

    const endPerf = performance.now();
    const latency = Math.round(endPerf - startPerf);
    if (statLatency) statLatency.textContent = `${latency}ms`;

    frameCount++;
    if (endPerf - lastFpsUpdateTime >= 1000) {
      const fps = Math.round((frameCount * 1000) / (endPerf - lastFpsUpdateTime));
      if (statFps) statFps.textContent = fps.toString();
      frameCount = 0;
      lastFpsUpdateTime = endPerf;
    }

    requestAnimationFrame(renderLoop);
  }

  const detectedListContainer = document.getElementById('demo-detected-tags');
  function updateDetectedList(predictions) {
    if (!detectedListContainer) return;
    if (!predictions || predictions.length === 0) {
      detectedListContainer.innerHTML = '<span style="color:var(--color-text-sub);font-size:0.8rem;">検出なし</span>';
      return;
    }
    detectedListContainer.innerHTML = predictions.map(p => `
      <span class="demo-detected-tag">
        ${p.class} <small>(${p.score}%)</small>
      </span>
    `).join('');
  }

  function updateEmotionsMeter(expressions) {
    const emotionKeys = ['happy', 'surprised', 'neutral', 'sad', 'angry', 'fearful', 'disgusted'];
    emotionKeys.forEach(key => {
      const fillEl = document.getElementById(`demo-emo-fill-${key}`);
      const scoreEl = document.getElementById(`demo-emo-score-${key}`);
      if (fillEl && scoreEl) {
        if (expressions && expressions[key] !== undefined) {
          const pct = Math.round(expressions[key] * 100);
          fillEl.style.width = `${pct}%`;
          scoreEl.textContent = `${pct}%`;
        } else {
          fillEl.style.width = '0%';
          scoreEl.textContent = '0%';
        }
      }
    });
  }

  function takeSnapshot() {
    const canvasToExport = viewMode === 'split' ? splitProcessedCanvas : mainCanvas;
    const dataUrl = canvasToExport.toDataURL('image/png');
    const link = document.createElement('a');
    link.download = `video-demo-${currentTask}-${Date.now()}.png`;
    link.href = dataUrl;
    link.click();
  }

  // Event Listeners
  startCamBtn.addEventListener('click', startCamera);
  stopCamBtn.addEventListener('click', stopCamera);
  snapshotBtn.addEventListener('click', takeSnapshot);

  if (mirrorToggleBtn) {
    mirrorToggleBtn.addEventListener('click', () => {
      isMirrored = !isMirrored;
      mirrorToggleBtn.classList.toggle('demo-btn-primary', isMirrored);
      mirrorToggleBtn.classList.toggle('demo-btn-outline', !isMirrored);
    });
  }

  resolutionSelect.addEventListener('change', () => {
    if (isRunning) startCamera();
  });

  viewModeSelect.addEventListener('change', (e) => {
    viewMode = e.target.value;
    if (viewMode === 'split') {
      mainCanvas.style.display = 'none';
      splitContainer.style.display = 'grid';
    } else {
      mainCanvas.style.display = 'block';
      splitContainer.style.display = 'none';
    }
  });

  tabButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      switchTask(btn.dataset.task);
    });
  });

  // Sliders & controls
  const objModeSelect = document.getElementById('demo-obj-mode');
  const objOpacityGroup = document.getElementById('demo-obj-opacity-group');
  const objOpacitySlider = document.getElementById('demo-obj-opacity');
  const objOpacityVal = document.getElementById('demo-obj-opacity-val');

  if (objModeSelect) {
    objModeSelect.addEventListener('change', (e) => {
      const mode = e.target.value;
      engines.object.displayMode = mode;
      const isSeg = mode !== 'boxes';
      if (objOpacityGroup) {
        objOpacityGroup.style.display = isSeg ? 'flex' : 'none';
      }
      if (isSeg && !engines.segmentation.isLoaded) {
        showLoading('セグメンテーションモデル読込中...', 30);
        engines.segmentation.loadModel((pct) => showLoading('セグメンテーションモデル読込中...', pct))
          .catch(err => { console.error(err); alert('セグメンテーションモデルの読込に失敗しました。'); })
          .finally(() => hideLoading());
      }
    });
  }

  if (objOpacitySlider) {
    objOpacitySlider.addEventListener('input', (e) => {
      const val = parseFloat(e.target.value);
      engines.segmentation.opacity = val;
      if (objOpacityVal) objOpacityVal.textContent = `${Math.round(val * 100)}%`;
    });
  }

  const objScoreSlider = document.getElementById('demo-obj-score');
  const objScoreVal = document.getElementById('demo-obj-score-val');
  if (objScoreSlider) {
    objScoreSlider.addEventListener('input', (e) => {
      const val = parseFloat(e.target.value);
      engines.object.minScore = val;
      objScoreVal.textContent = `${Math.round(val * 100)}%`;
    });
  }

  const faceScoreSlider = document.getElementById('demo-face-score');
  const faceScoreVal = document.getElementById('demo-face-score-val');
  if (faceScoreSlider) {
    faceScoreSlider.addEventListener('input', (e) => {
      const val = parseFloat(e.target.value);
      engines.face.minConfidence = val;
      faceScoreVal.textContent = `${Math.round(val * 100)}%`;
    });
  }

  const depthColormapSelect = document.getElementById('demo-depth-colormap');
  const depthInvertCheck = document.getElementById('demo-depth-invert');
  const depthGammaSlider = document.getElementById('demo-depth-gamma');
  const depthGammaVal = document.getElementById('demo-depth-gamma-val');
  const depthThrottleSelect = document.getElementById('demo-depth-throttle');
  const depthModeSelect = document.getElementById('demo-depth-mode');

  if (depthColormapSelect) {
    depthColormapSelect.addEventListener('change', (e) => {
      engines.depth.colormapName = e.target.value;
    });
  }
  if (depthInvertCheck) {
    depthInvertCheck.addEventListener('change', (e) => {
      engines.depth.invert = e.target.checked;
    });
  }
  if (depthGammaSlider) {
    depthGammaSlider.addEventListener('input', (e) => {
      const val = parseFloat(e.target.value);
      engines.depth.contrastGamma = val;
      if (depthGammaVal) depthGammaVal.textContent = `${val.toFixed(1)}x`;
    });
  }
  if (depthThrottleSelect) {
    depthThrottleSelect.addEventListener('change', (e) => {
      const mode = e.target.value;
      if (mode === 'eco') engines.depth.throttleInterval = 320;
      else if (mode === 'fast') engines.depth.throttleInterval = 80;
      else engines.depth.throttleInterval = 180;
    });
  }
  if (depthModeSelect) {
    depthModeSelect.addEventListener('change', (e) => {
      engines.depth.mode = e.target.value;
      const statusEl = document.getElementById('demo-depth-status');
      if (statusEl) {
        if (e.target.value === 'ultralight') {
          statusEl.textContent = '超軽量ハイブリッド (CPU負荷ゼロ)';
          statusEl.style.background = '#fef3c7';
          statusEl.style.borderColor = '#fde68a';
          statusEl.style.color = '#92400e';
        } else {
          statusEl.textContent = engines.depth.isLoaded ? '高精度AI (Depth Anything) 稼働中' : 'モデル読込中...';
          statusEl.style.background = '#f0f7ff';
          statusEl.style.borderColor = '#cce3ff';
          statusEl.style.color = 'var(--color-main)';
        }
      }
    });
  }

  const salModeSelect = document.getElementById('demo-sal-mode');
  const salOpacitySlider = document.getElementById('demo-sal-opacity');
  const salOpacityVal = document.getElementById('demo-sal-opacity-val');
  const salBoostSlider = document.getElementById('demo-sal-boost');
  const salBoostVal = document.getElementById('demo-sal-boost-val');
  const salContrastSlider = document.getElementById('demo-sal-contrast');
  const salContrastVal = document.getElementById('demo-sal-contrast-val');
  const salReticleCheck = document.getElementById('demo-sal-reticle');

  if (salModeSelect) {
    salModeSelect.addEventListener('change', (e) => {
      engines.saliency.displayMode = e.target.value;
    });
  }
  if (salOpacitySlider) {
    salOpacitySlider.addEventListener('input', (e) => {
      const val = parseFloat(e.target.value);
      engines.saliency.opacity = val;
      if (salOpacityVal) salOpacityVal.textContent = `${Math.round(val * 100)}%`;
    });
  }
  if (salBoostSlider) {
    salBoostSlider.addEventListener('input', (e) => {
      const val = parseFloat(e.target.value);
      engines.saliency.silhouetteBoost = val;
      engines.saliency.samSilhouetteBoost = val;
      if (salBoostVal) salBoostVal.textContent = `${Math.round((val / 1.0) * 100)}%`;
    });
  }
  if (salContrastSlider) {
    salContrastSlider.addEventListener('input', (e) => {
      const val = parseFloat(e.target.value);
      engines.saliency.contrastPower = val;
      if (salContrastVal) salContrastVal.textContent = `${val.toFixed(1)}x`;
    });
  }
  if (salReticleCheck) {
    salReticleCheck.addEventListener('change', (e) => {
      engines.saliency.showReticle = e.target.checked;
    });
  }

  const flowModeSelect = document.getElementById('demo-flow-mode');
  const flowSensSlider = document.getElementById('demo-flow-sens');
  const flowSensVal = document.getElementById('demo-flow-sens-val');
  if (flowModeSelect) {
    flowModeSelect.addEventListener('change', (e) => {
      engines.flow.mode = e.target.value;
    });
  }
  if (flowSensSlider) {
    flowSensSlider.addEventListener('input', (e) => {
      const val = parseFloat(e.target.value);
      engines.flow.scale = val;
      flowSensVal.textContent = `${val.toFixed(1)}x`;
    });
  }

  switchTask('guide');
});
