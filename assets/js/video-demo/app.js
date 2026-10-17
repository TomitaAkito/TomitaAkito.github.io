/**
 * Vision Demo - Main Controller
 * Coordinates webcam, task engines, clean UI controls, and performance meters.
 */
document.addEventListener('DOMContentLoaded', () => {
  const video = document.getElementById('vs-video-raw');
  const mainCanvas = document.getElementById('vs-canvas-main');
  const mainCanvasWrap = document.getElementById('vs-canvas-wrap') || (mainCanvas ? mainCanvas.parentElement : null);
  const mainCtx = mainCanvas.getContext('2d');

  const splitContainer = document.getElementById('vs-split-container');
  const splitOriginalCanvas = document.getElementById('vs-split-orig');
  const splitOrigCtx = splitOriginalCanvas.getContext('2d');
  const splitProcessedCanvas = document.getElementById('vs-split-proc');
  const splitProcCtx = splitProcessedCanvas.getContext('2d');

  const startCamBtn = document.getElementById('vs-btn-start');
  const stopCamBtn = document.getElementById('vs-btn-stop');
  const flipCamBtn = document.getElementById('vs-btn-flip-cam');
  const mirrorToggleBtn = document.getElementById('vs-btn-mirror');
  const snapshotBtn = document.getElementById('vs-btn-snapshot');
  const resolutionSelect = document.getElementById('vs-select-res');
  const viewModeSelect = document.getElementById('vs-select-view');

  const stageEl = document.getElementById('vs-stage') || document.querySelector('.demo-stage');
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
  let currentFacingMode = 'user'; // 'user' (前面・インカメ) or 'environment' (背面・アウトカメ)
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
    segmentation: new window.SegmentationEngine(),
    edge: new window.EdgeDetectionEngine()
  };

  function updateFlipCamButtonUI() {
    if (!flipCamBtn) return;
    const isBack = currentFacingMode === 'environment';
    const textSpan = flipCamBtn.querySelector('.btn-text');
    if (textSpan) {
      textSpan.textContent = isBack ? '背面' : '前面';
    }
    flipCamBtn.title = isBack ? '前面カメラ（インカメラ）に切り替え' : '背面カメラ（アウトカメラ）に切り替え';
    flipCamBtn.classList.toggle('demo-btn-primary', isBack);
    flipCamBtn.classList.toggle('demo-btn-outline', !isBack);
  }

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

      const constraints = {
        audio: false,
        video: {
          width: { ideal: w },
          height: { ideal: h },
          facingMode: { ideal: currentFacingMode }
        }
      };

      stream = await navigator.mediaDevices.getUserMedia(constraints);

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

      if (stageEl) stageEl.classList.add('is-active');
      if (placeholderOverlay) placeholderOverlay.classList.add('hidden');
      if (startCamBtn) startCamBtn.style.display = 'none';
      if (stopCamBtn) stopCamBtn.style.display = 'inline-flex';
      if (snapshotBtn) snapshotBtn.disabled = false;

      updateFlipCamButtonUI();

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
    if (stageEl) stageEl.classList.remove('is-active');
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
      showLoading('表情検出モデル (Face-API) 読込中...', 30);
      try {
        await engines.face.loadModel((pct) => showLoading('表情検出モデル読込中...', pct));
      } catch (err) {
        console.error('表情検出モデルの読込に失敗しました:', err);
        alert('表情検出モデルの読込に失敗しました。ネットワーク接続を確認してください。');
      } finally {
        hideLoading();
      }
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
      if (!engines.saliency.isLoaded && !engines.saliency.isLoading) {
        showLoading('顕著性AIモデルを初期化中...', 0);
        try {
          await engines.saliency.loadAIModel((pct) => {
            showLoading(`顕著性AIモデルをダウンロード中... ${pct}%`, pct);
          });
          const statusEl = document.getElementById('demo-sal-status');
          if (statusEl && engines.saliency.isLoaded) {
            statusEl.textContent = '深層学習AI (IS-Net Saliency) 稼働中';
            statusEl.style.background = '#e6f9f0';
            statusEl.style.borderColor = '#b7edd2';
            statusEl.style.color = '#0e9f6e';
          }
        } catch (err) {
          console.warn('Saliency AI load error, running enhanced fallback:', err);
          const statusEl = document.getElementById('demo-sal-status');
          if (statusEl) {
            statusEl.textContent = '軽量注意モデル 稼働中';
            statusEl.style.background = '#fef3c7';
            statusEl.style.borderColor = '#fde68a';
            statusEl.style.color = '#92400e';
          }
        } finally {
          hideLoading();
        }
      }
    }
  }

  const TASK_ALIASES = {
    // 顕著性
    'saliency': 'saliency',
    'sal': 'saliency',
    '顕著性': 'saliency',
    '顕著性マップ': 'saliency',
    'けんちょせい': 'saliency',
    // 物体検出
    'object': 'object',
    'obj': 'object',
    'detection': 'object',
    '物体検出': 'object',
    '物体': 'object',
    // 表情検出
    'face': 'face',
    'expression': 'face',
    'emotion': 'face',
    '表情検出': 'face',
    '表情': 'face',
    // 深度推定
    'depth': 'depth',
    '深度推定': 'depth',
    '深度': 'depth',
    // オプティカルフロー
    'flow': 'flow',
    'opticalflow': 'flow',
    'optical-flow': 'flow',
    'オプティカルフロー': 'flow',
    'フロー': 'flow',
    // エッジ検出
    'edge': 'edge',
    'edges': 'edge',
    'canny': 'edge',
    'sobel': 'edge',
    'laplacian': 'edge',
    'エッジ': 'edge',
    'エッジ検出': 'edge',
    '線画': 'edge',
    'スケッチ': 'edge',
    // 使い方・ガイド
    'guide': 'guide',
    '使い方': 'guide',
    'ヘルプ': 'guide'
  };

  function getTaskFromUrl() {
    try {
      const params = new URLSearchParams(window.location.search);
      const queryVal = params.get('task') || params.get('mode') || params.get('fn');
      if (queryVal) {
        const decoded = decodeURIComponent(queryVal).trim().toLowerCase();
        if (TASK_ALIASES[decoded]) return TASK_ALIASES[decoded];
      }

      if (window.location.hash) {
        const hash = decodeURIComponent(window.location.hash.replace(/^#/, '')).trim().toLowerCase();
        if (TASK_ALIASES[hash]) return TASK_ALIASES[hash];
      }
    } catch (e) {
      console.warn('URL parsing error:', e);
    }
    return null;
  }

  function updateUrlForTask(taskKey) {
    try {
      const url = new URL(window.location.href);
      if (taskKey === 'guide') {
        url.searchParams.delete('task');
        url.searchParams.delete('mode');
        url.searchParams.delete('fn');
        url.hash = '';
      } else {
        url.searchParams.set('task', taskKey);
        url.searchParams.delete('mode');
        url.searchParams.delete('fn');
        url.hash = '';
      }
      window.history.replaceState({ task: taskKey }, '', url.toString());
    } catch (e) {
      console.warn('URL update error:', e);
    }
  }

  async function switchTask(taskKey, updateUrl = true) {
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
      flow: 'オプティカルフロー (Optical Flow)',
      edge: 'エッジ検出 (Edge Detection)'
    };
    if (statModeBadge) {
      statModeBadge.textContent = taskKey === 'guide' ? '機能を選択してください' : (taskNames[taskKey] || taskKey);
    }

    if (updateUrl) {
      updateUrlForTask(taskKey);
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
        engines.saliency.process(targetCtx, video, cw, ch, isMirrored);
      } else if (currentTask === 'flow') {
        engines.flow.process(targetCtx, video, cw, ch, isMirrored);
      } else if (currentTask === 'edge') {
        engines.edge.process(targetCtx, video, cw, ch, isMirrored);
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

  if (flipCamBtn) {
    flipCamBtn.addEventListener('click', async () => {
      currentFacingMode = currentFacingMode === 'user' ? 'environment' : 'user';

      // 背面カメラ選択時は通常ミラー（鏡像反転）をOFF、前面カメラ時はON
      if (currentFacingMode === 'environment') {
        isMirrored = false;
        if (mirrorToggleBtn) {
          mirrorToggleBtn.classList.remove('demo-btn-primary');
          mirrorToggleBtn.classList.add('demo-btn-outline');
        }
      } else {
        isMirrored = true;
        if (mirrorToggleBtn) {
          mirrorToggleBtn.classList.add('demo-btn-primary');
          mirrorToggleBtn.classList.remove('demo-btn-outline');
        }
      }

      updateFlipCamButtonUI();

      if (isRunning) {
        await startCamera();
      }
    });
  }

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
      if (mainCanvasWrap) mainCanvasWrap.style.display = 'none';
      mainCanvas.style.display = 'none';
      splitContainer.style.display = 'grid';
    } else {
      if (mainCanvasWrap) mainCanvasWrap.style.display = 'flex';
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

  const salThrottleSelect = document.getElementById('demo-sal-throttle');
  const salModeSelect = document.getElementById('demo-sal-mode');
  const salOpacitySlider = document.getElementById('demo-sal-opacity');
  const salOpacityVal = document.getElementById('demo-sal-opacity-val');
  const salContrastSlider = document.getElementById('demo-sal-contrast');
  const salContrastVal = document.getElementById('demo-sal-contrast-val');
  const salReticleCheck = document.getElementById('demo-sal-reticle');

  if (salThrottleSelect) {
    salThrottleSelect.addEventListener('change', (e) => {
      const mode = e.target.value;
      if (mode === 'eco') engines.saliency.throttleInterval = 300;
      else if (mode === 'fast') engines.saliency.throttleInterval = 90;
      else engines.saliency.throttleInterval = 180;
    });
  }

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

  // Edge Detection Controls
  const edgeAlgoSelect = document.getElementById('demo-edge-algo');
  const edgeStyleSelect = document.getElementById('demo-edge-style');
  const edgeSensSlider = document.getElementById('demo-edge-sens');
  const edgeSensVal = document.getElementById('demo-edge-sens-val');
  const edgeBlurSelect = document.getElementById('demo-edge-blur');
  const edgeInvertCheck = document.getElementById('demo-edge-invert');

  if (edgeAlgoSelect) {
    edgeAlgoSelect.addEventListener('change', (e) => {
      engines.edge.algorithm = e.target.value;
    });
  }
  if (edgeStyleSelect) {
    edgeStyleSelect.addEventListener('change', (e) => {
      engines.edge.style = e.target.value;
    });
  }
  if (edgeSensSlider) {
    edgeSensSlider.addEventListener('input', (e) => {
      const val = parseInt(e.target.value, 10);
      engines.edge.sensitivity = val;
      if (edgeSensVal) edgeSensVal.textContent = `${val}%`;
    });
  }
  if (edgeBlurSelect) {
    edgeBlurSelect.addEventListener('change', (e) => {
      engines.edge.blurLevel = e.target.value;
    });
  }
  if (edgeInvertCheck) {
    edgeInvertCheck.addEventListener('change', (e) => {
      engines.edge.invert = e.target.checked;
    });
  }

  // Initialize task from URL (e.g. ?task=saliency or #物体検出) or default to 'guide'
  const initialTask = getTaskFromUrl() || 'guide';
  switchTask(initialTask, false);

  window.addEventListener('popstate', (e) => {
    const task = (e.state && e.state.task) || getTaskFromUrl() || 'guide';
    switchTask(task, false);
  });

  window.addEventListener('hashchange', () => {
    const task = getTaskFromUrl();
    if (task && task !== currentTask) {
      switchTask(task, false);
    }
  });
});
