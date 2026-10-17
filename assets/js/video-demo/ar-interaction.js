/**
 * AR / MR Spatial Interaction Engine
 * 
 * Mixed Reality engine blending physical webcam feeds with virtual interactive entities:
 * 1. Modes:
 *    - 'aquarium' (MR Aquarium): Interactive Boids school of fish (Clownfish, Neon Tetra, Angelfish)
 *                 reacting gracefully to real-time physical hand motions and screen touches with tranquil swimming speeds.
 *    - 'air_draw' (Air Drawing / 3D Space Paint): Draw vibrant neon light ribbons and glowing sparks in mid-air
 *                 using physical hand gestures or direct touchscreen/mouse strokes.
 *    - 'tabletop_ar' (Tabletop AR & Physical Objects): Virtual 3D objects (Cubes, Spheres, Crystals) placed
 *                 on desk surface with real-time rigid-body physics (gravity, bounce, friction).
 *                 Users can push, kick, roll, grab and toss objects with their bare hands!
 * 2. Interaction Mechanisms:
 *    - Temporal optical difference & motion centroid tracking with velocity vector calculation.
 *    - Multi-touch and pointer dragging / grabbing physics.
 */
class ARInteractionEngine {
  constructor() {
    this.mode = 'aquarium';       // 'aquarium' | 'air_draw' | 'tabletop_ar'
    this.density = 'medium';      // 'low' | 'medium' | 'high'
    this.waterRipples = true;
    this.fishSpeedMultiplier = 1.6; // High speed multiplier (1.0x - 2.5x)

    // Interaction targets (motion centroid, touch pointer, or MediaPipe hand)
    this.pointerX = -1000;
    this.pointerY = -1000;
    this.prevPointerX = -1000;
    this.prevPointerY = -1000;
    this.pointerVx = 0;
    this.pointerVy = 0;
    this.isPointerActive = false;
    this.isDirectTouch = false;
    this.lastMotionTime = 0;

    // MediaPipe HandLandmarker state
    this.handLandmarker = null;
    this.isHandModelLoaded = false;
    this.isHandModelLoading = false;
    this._handLoadPromise = null;
    this.detectedHands = [];
    this.lastHandDetectTime = 0;
    this.handDetectInterval = 25; // ~40 fps hand tracking
    this.isHandPinching = false;
    this.primaryHand = null;

    // Motion detection fallback buffers
    this.motionW = 120;
    this.motionH = 90;
    this.prevMotionFrame = null;
    this.motionCanvas = document.createElement('canvas');
    this.motionCanvas.width = this.motionW;
    this.motionCanvas.height = this.motionH;
    this.motionCtx = this.motionCanvas.getContext('2d', { willReadFrequently: true });

    // Entities
    this.fishes = [];
    this.bubbles = [];
    this.ripples = [];

    // Air Draw state
    this.drawStrokes = [];      // Array of { points: [{x, y, t}], color, width }
    this.currentStroke = null;
    this.drawColor = 'neon_cyan'; // 'neon_cyan' | 'neon_pink' | 'cyber_gold' | 'rainbow'
    this.drawWidth = 8;
    this.drawFade = 'fade';       // 'fade' | 'persist'
    this.drawSparks = [];         // Floating sparkle particles from pen tip

    // Tabletop AR state
    this.tabletopObjects = [];
    this.tabletopType = 'mixed';  // 'cube' | 'ball' | 'crystal' | 'mixed'
    this.gravityLevel = 'normal'; // 'light' | 'normal' | 'heavy'
    this.grabbedObject = null;
    this.grabTimer = 0;

    this.time = 0;
    this.initEntities();
  }

  async loadHandModel(onProgress) {
    if (this.isHandModelLoaded) return Promise.resolve();
    if (this._handLoadPromise) return this._handLoadPromise;
    this.isHandModelLoading = true;

    this._handLoadPromise = (async () => {
      if (onProgress) onProgress(20);
      const { module, fileset } = await window.loadMediaPipeVision();
      if (onProgress) onProgress(50);

      const modelUrl = 'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task';

      try {
        this.handLandmarker = await module.HandLandmarker.createFromOptions(fileset, {
          baseOptions: {
            modelAssetPath: modelUrl,
            delegate: 'GPU'
          },
          runningMode: 'VIDEO',
          numHands: 2,
          minHandDetectionConfidence: 0.45,
          minHandPresenceConfidence: 0.45,
          minTrackingConfidence: 0.45
        });
      } catch (err) {
        console.warn('GPU delegate failed for HandLandmarker, falling back to CPU:', err);
        this.handLandmarker = await module.HandLandmarker.createFromOptions(fileset, {
          baseOptions: {
            modelAssetPath: modelUrl,
            delegate: 'CPU'
          },
          runningMode: 'VIDEO',
          numHands: 2,
          minHandDetectionConfidence: 0.45,
          minHandPresenceConfidence: 0.45,
          minTrackingConfidence: 0.45
        });
      }

      this.isHandModelLoaded = true;
      if (onProgress) onProgress(100);
    })().catch(err => {
      console.error('Failed to load MediaPipe HandLandmarker:', err);
      throw err;
    }).finally(() => {
      this.isHandModelLoading = false;
      this._handLoadPromise = null;
    });

    return this._handLoadPromise;
  }

  initEntities() {
    // 1. Initialize Aquarium Fish & Bubbles (Super Fast & Dynamic Swimming)
    let fishCount = 18;
    if (this.density === 'low') fishCount = 8;
    else if (this.density === 'high') fishCount = 30;

    const spdMult = this.fishSpeedMultiplier || 1.6;
    this.fishes = [];
    const speciesList = ['clownfish', 'neon_tetra', 'angelfish', 'goldfish'];
    for (let i = 0; i < fishCount; i++) {
      this.fishes.push({
        x: Math.random() * 640,
        y: Math.random() * 480,
        vx: (Math.random() - 0.5) * 5.5 * spdMult,
        vy: (Math.random() - 0.5) * 3.8 * spdMult,
        size: 16 + Math.random() * 14,
        species: speciesList[i % speciesList.length],
        finPhase: Math.random() * Math.PI * 2,
        finSpeed: (9.0 + Math.random() * 6.0) * spdMult, // Rapid tail flutter
        frightened: 0,
        depthLayer: Math.random()
      });
    }

    this.bubbles = [];
    for (let i = 0; i < 24; i++) {
      this.bubbles.push({
        x: Math.random() * 640,
        y: Math.random() * 480 + 480,
        r: 2 + Math.random() * 4.5,
        vy: 1.4 + Math.random() * 2.0,
        swaySpeed: 1.5 + Math.random() * 2.0,
        swayWidth: 9 + Math.random() * 14,
        baseX: Math.random() * 640
      });
    }

    // 2. Initialize Tabletop Objects
    this.initTabletopObjects(640, 480);
  }

  initTabletopObjects(w = 640, h = 480) {
    this.tabletopObjects = [];
    const groundY = h * 0.80; // Default desk surface height

    const types = ['cube', 'ball', 'crystal'];
    const colors = ['#00f5d4', '#f72585', '#ffbe0b', '#7b2cbf'];
    const count = 3;

    for (let i = 0; i < count; i++) {
      const type = (this.tabletopType === 'mixed') ? types[i % types.length] : this.tabletopType;
      const x = w * (0.28 + i * 0.22);
      this.tabletopObjects.push({
        id: i + 1,
        type: type,
        x: x,
        y: groundY - 40 - Math.random() * 120, // Drop from air
        groundY: groundY,
        vx: (Math.random() - 0.5) * 1.5,
        vy: 0,
        radius: 34 + Math.random() * 8,
        angle: Math.random() * Math.PI * 2,
        vAngle: (Math.random() - 0.5) * 0.05,
        color: colors[i % colors.length],
        bounce: 0.68,
        friction: 0.96,
        isGrabbed: false,
        pulse: 0
      });
    }
  }

  clearDrawing() {
    this.drawStrokes = [];
    this.currentStroke = null;
    this.drawSparks = [];
  }

  setPointer(x, y, active = true, isDirectTouch = false) {
    if (active) {
      if (this.pointerX > -500) {
        this.pointerVx = (x - this.pointerX) * 0.7 + this.pointerVx * 0.3;
        this.pointerVy = (y - this.pointerY) * 0.7 + this.pointerVy * 0.3;
      } else {
        this.pointerVx = 0;
        this.pointerVy = 0;
      }
      this.prevPointerX = this.pointerX;
      this.prevPointerY = this.pointerY;
      this.pointerX = x;
      this.pointerY = y;
      this.isPointerActive = true;
      this.isDirectTouch = isDirectTouch;
      this.lastMotionTime = performance.now();
    } else {
      this.isPointerActive = false;
      this.isDirectTouch = false;
      this.pointerX = -1000;
      this.pointerY = -1000;
      this.pointerVx = 0;
      this.pointerVy = 0;
      if (this.currentStroke) {
        this.currentStroke = null;
      }
      if (this.grabbedObject) {
        this.grabbedObject.isGrabbed = false;
        this.grabbedObject.vx = Math.min(Math.max(this.pointerVx, -18), 18);
        this.grabbedObject.vy = Math.min(Math.max(this.pointerVy, -18), 18);
        this.grabbedObject = null;
      }
    }
  }

  detectMotion(video, targetW, targetH) {
    if (!video || video.readyState < 2) return null;

    const mw = this.motionW;
    const mh = this.motionH;
    const mctx = this.motionCtx;

    mctx.drawImage(video, 0, 0, mw, mh);
    const curr = mctx.getImageData(0, 0, mw, mh).data;
    const totalPixels = mw * mh;

    if (!this.prevMotionFrame) {
      this.prevMotionFrame = new Uint8Array(totalPixels);
      for (let i = 0, p = 0; i < totalPixels; i++, p += 4) {
        this.prevMotionFrame[i] = (curr[p] * 77 + curr[p + 1] * 150 + curr[p + 2] * 29) >> 8;
      }
      return null;
    }

    let motionCount = 0;
    let sumX = 0;
    let sumY = 0;
    const prev = this.prevMotionFrame;

    for (let y = 0; y < mh; y++) {
      const row = y * mw;
      for (let x = 0; x < mw; x++) {
        const idx = row + x;
        const p = idx * 4;
        const g = (curr[p] * 77 + curr[p + 1] * 150 + curr[p + 2] * 29) >> 8;
        const diff = Math.abs(g - prev[idx]);

        // Background update with low-pass filter
        prev[idx] = (prev[idx] * 6 + g * 2) >> 3;

        // Substantial motion threshold to eliminate sensor noise / flicker
        if (diff > 36) {
          sumX += x;
          sumY += y;
          motionCount++;
        }
      }
    }

    // Require substantial cluster of motion (at least ~2.5% of screen moving)
    // Ignore global lighting flash (auto-exposure) where > 45% of frame changes
    if (motionCount >= 260 && motionCount < (totalPixels * 0.45)) {
      const rawX = (sumX / motionCount) * (targetW / mw);
      const rawY = (sumY / motionCount) * (targetH / mh);

      if (this.smoothX === undefined) {
        this.smoothX = rawX;
        this.smoothY = rawY;
      } else {
        this.smoothX = this.smoothX * 0.65 + rawX * 0.35;
        this.smoothY = this.smoothY * 0.65 + rawY * 0.35;
      }

      return { x: this.smoothX, y: this.smoothY, energy: motionCount };
    }

    return null;
  }

  detectHands(video, w, h, isMirrored) {
    if (!this.handLandmarker || !video || video.readyState < 2) return [];

    const now = performance.now();
    if (now - this.lastHandDetectTime < this.handDetectInterval) {
      return this.detectedHands;
    }
    this.lastHandDetectTime = now;

    try {
      const results = this.handLandmarker.detectForVideo(video, Math.round(now));
      if (!results || !results.landmarks || results.landmarks.length === 0) {
        this.detectedHands = [];
        return [];
      }

      const hands = [];
      for (let handIdx = 0; handIdx < results.landmarks.length; handIdx++) {
        const rawLms = results.landmarks[handIdx];

        // Convert normalized landmarks to pixel canvas coordinates
        const landmarks = rawLms.map(pt => ({
          x: isMirrored ? (1.0 - pt.x) * w : pt.x * w,
          y: pt.y * h,
          z: pt.z
        }));

        const wrist = landmarks[0];
        const thumbTip = landmarks[4];
        const indexTip = landmarks[8];
        const middleTip = landmarks[12];
        const pinkyTip = landmarks[20];
        const middleBase = landmarks[9];

        // Palm center (midpoint of wrist and middle finger knuckle)
        const palmCenter = {
          x: (wrist.x + middleBase.x) * 0.5,
          y: (wrist.y + middleBase.y) * 0.5
        };

        // Pinch detection: thumb tip and index tip distance
        const pinchDist = Math.hypot(thumbTip.x - indexTip.x, thumbTip.y - indexTip.y);
        const isPinching = pinchDist < (w * 0.085); // Distance threshold for pinching
        const pinchCenter = {
          x: (thumbTip.x + indexTip.x) * 0.5,
          y: (thumbTip.y + indexTip.y) * 0.5
        };

        // Open Palm detection (all/most fingers fully extended and not pinching)
        const isFingerExt = (tipIdx, mcpIdx) => {
          const dTip = Math.hypot(landmarks[tipIdx].x - wrist.x, landmarks[tipIdx].y - wrist.y);
          const dMcp = Math.hypot(landmarks[mcpIdx].x - wrist.x, landmarks[mcpIdx].y - wrist.y);
          return dTip > (dMcp * 1.25);
        };
        const idxExt = isFingerExt(8, 5);
        const midExt = isFingerExt(12, 9);
        const rngExt = isFingerExt(16, 13);
        const pnkExt = isFingerExt(20, 17);
        const thbExt = Math.hypot(thumbTip.x - wrist.x, thumbTip.y - wrist.y) > Math.hypot(landmarks[2].x - wrist.x, landmarks[2].y - wrist.y) * 1.15;
        const extCount = (idxExt ? 1 : 0) + (midExt ? 1 : 0) + (rngExt ? 1 : 0) + (pnkExt ? 1 : 0) + (thbExt ? 1 : 0);
        const isOpenPalm = (extCount >= 4) && !isPinching;

        hands.push({
          landmarks,
          wrist,
          thumbTip,
          indexTip,
          middleTip,
          pinkyTip,
          palmCenter,
          pinchDist,
          isPinching,
          pinchCenter,
          isOpenPalm,
          extCount
        });
      }

      this.detectedHands = hands;
      return hands;
    } catch (err) {
      return [];
    }
  }

  renderHandSkeleton(ctx, hand) {
    if (!hand || !hand.landmarks) return;
    const lms = hand.landmarks;
    ctx.save();

    // Hand skeleton bone connectivity (21 landmarks)
    const connections = [
      [0, 1], [1, 2], [2, 3], [3, 4],        // Thumb
      [0, 5], [5, 6], [6, 7], [7, 8],        // Index
      [9, 10], [10, 11], [11, 12],           // Middle
      [13, 14], [14, 15], [15, 16],          // Ring
      [0, 17], [17, 18], [18, 19], [19, 20], // Pinky
      [5, 9], [9, 13], [13, 17]              // Palm base
    ];

    // Glowing futuristic bone lines
    ctx.strokeStyle = 'rgba(0, 245, 212, 0.45)';
    ctx.lineWidth = 2;
    ctx.shadowColor = '#00f5d4';
    ctx.shadowBlur = 8;

    for (const [a, b] of connections) {
      ctx.beginPath();
      ctx.moveTo(lms[a].x, lms[a].y);
      ctx.lineTo(lms[b].x, lms[b].y);
      ctx.stroke();
    }

    // Joint nodes
    for (let i = 0; i < lms.length; i++) {
      const pt = lms[i];
      const isTip = (i === 4 || i === 8 || i === 12 || i === 16 || i === 20);
      ctx.fillStyle = isTip ? '#ffffff' : 'rgba(0, 245, 212, 0.8)';
      ctx.beginPath();
      ctx.arc(pt.x, pt.y, isTip ? 4 : 2.5, 0, Math.PI * 2);
      ctx.fill();
    }

    // Air Pen reticle on Index Finger Tip
    const tip = hand.indexTip;
    ctx.strokeStyle = '#00f5d4';
    ctx.lineWidth = 1.8;
    ctx.beginPath();
    ctx.arc(tip.x, tip.y, 8 + Math.sin(this.time * 6) * 2, 0, Math.PI * 2);
    ctx.stroke();

    // Visual Feedback per Mode & Gesture
    if (this.mode === 'aquarium') {
      if (hand.isOpenPalm) {
        // Open Palm Feeding Ring
        ctx.save();
        ctx.strokeStyle = '#ffbe0b';
        ctx.lineWidth = 2;
        ctx.shadowColor = '#ffbe0b';
        ctx.shadowBlur = 8;
        ctx.beginPath();
        ctx.arc(hand.palmCenter.x, hand.palmCenter.y, 22 + Math.sin(this.time * 8) * 3, 0, Math.PI * 2);
        ctx.stroke();

        ctx.font = '700 10px monospace';
        ctx.fillStyle = '#ffbe0b';
        ctx.textAlign = 'center';
        ctx.fillText('FEEDING', hand.palmCenter.x, hand.palmCenter.y - 28);
        ctx.restore();
      }
    } else {
      // Pinch Visual Feedback for Air Draw / Tabletop AR
      if (hand.isPinching) {
        ctx.strokeStyle = '#ffbe0b';
        ctx.lineWidth = 2;
        ctx.shadowColor = '#ffbe0b';
        ctx.shadowBlur = 8;
        ctx.beginPath();
        ctx.arc(hand.pinchCenter.x, hand.pinchCenter.y, 12, 0, Math.PI * 2);
        ctx.stroke();

        ctx.font = '700 10px monospace';
        ctx.fillStyle = '#ffbe0b';
        const pinchLabel = (this.mode === 'air_draw') ? 'DRAW' : 'GRAB';
        ctx.fillText(pinchLabel, hand.pinchCenter.x + 16, hand.pinchCenter.y + 4);
      }
    }

    ctx.restore();
  }

  process(ctx, video, canvasWidth, canvasHeight, isMirrored = false, contextData = {}) {
    if (!video || video.readyState < 2) return;

    this.time += 0.025;
    const w = canvasWidth;
    const h = canvasHeight;

    // 1. Draw raw camera stream
    ctx.save();
    if (isMirrored) {
      ctx.translate(w, 0);
      ctx.scale(-1, 1);
    }
    ctx.drawImage(video, 0, 0, w, h);
    ctx.restore();

    // 2. High-precision MediaPipe Hand Detection with Motion Fallback
    const activeMode = (this.mode === 'particles') ? 'air_draw' : (this.mode === 'face_ar') ? 'tabletop_ar' : this.mode;

    let hands = [];
    if (this.isHandModelLoaded) {
      hands = this.detectHands(video, w, h, isMirrored);
    }

    if (hands.length > 0 && !this.isDirectTouch) {
      const primaryHand = hands[0];
      this.primaryHand = primaryHand;
      this.isHandPinching = primaryHand.isPinching;
      this.isOpenPalm = primaryHand.isOpenPalm;

      if (activeMode === 'air_draw') {
        // 線描画はピンチ操作をした際にそこから線を描き始める
        if (primaryHand.isPinching) {
          this.setPointer(primaryHand.pinchCenter.x, primaryHand.pinchCenter.y, true, false);
          this.isAirDrawing = true;
        } else {
          // 指を開いている時はペンを離した移動状態
          this.setPointer(primaryHand.indexTip.x, primaryHand.indexTip.y, false, false);
          this.isAirDrawing = false;
          if (this.currentStroke) {
            this.currentStroke = null;
          }
        }
      } else if (activeMode === 'tabletop_ar') {
        // Tabletop AR: Pinch center when pinching, otherwise palm center for pushing
        if (primaryHand.isPinching) {
          this.setPointer(primaryHand.pinchCenter.x, primaryHand.pinchCenter.y, true, false);
        } else {
          this.setPointer(primaryHand.palmCenter.x, primaryHand.palmCenter.y, true, false);
        }
      } else {
        // Aquarium: 手の平を検出した場合のみ餌を表示させ、それ以外はボイドアルゴリズムを貫く
        if (primaryHand.isOpenPalm) {
          this.setPointer(primaryHand.palmCenter.x, primaryHand.palmCenter.y, true, false);
          if (this.waterRipples && Math.random() < 0.15) {
            this.ripples.push({ x: primaryHand.palmCenter.x, y: primaryHand.palmCenter.y, r: 6, maxR: 45, opacity: 0.5 });
          }
        } else {
          // 手の平でない場合は餌を出さず、魚を引き寄せない（純粋なボイドアルゴリズムを貫く）
          this.setPointer(-1000, -1000, false, false);
        }
      }
    } else if (!this.isDirectTouch) {
      // Fallback to temporal optical motion detection when no hand landmarks detected
      this.isHandPinching = false;
      this.isOpenPalm = false;
      this.primaryHand = null;

      const motion = this.detectMotion(video, w, h);
      if (motion) {
        const mx = isMirrored ? (w - motion.x) : motion.x;
        // In aquarium mode, motion does NOT produce food (only open palm does!)
        if (activeMode !== 'aquarium') {
          this.setPointer(mx, motion.y, true, false);
          this.isAirDrawing = true;
        } else {
          // Pure Boids in aquarium mode when no open palm
          this.setPointer(-1000, -1000, false, false);
        }
      } else if (performance.now() - this.lastMotionTime > 400) {
        this.isPointerActive = false;
        this.isAirDrawing = false;
        this.isOpenPalm = false;
        this.smoothX = undefined;
        this.smoothY = undefined;
        if (this.currentStroke) this.currentStroke = null;
        if (this.grabbedObject) {
          this.grabbedObject.isGrabbed = false;
          this.grabbedObject = null;
        }
      }
    }

    // 3. Render Active Mode Entities
    try {
      if (activeMode === 'aquarium') {
        this.renderAquarium(ctx, w, h);
      } else if (activeMode === 'air_draw') {
        this.renderAirDraw(ctx, w, h);
      } else if (activeMode === 'tabletop_ar') {
        this.renderTabletopAR(ctx, w, h);
      }
    } catch (err) {
      console.warn('AR render error:', err);
    }

    // 4. Render Cyber Hand Skeletons over detected hands
    if (hands.length > 0) {
      for (const hand of hands) {
        this.renderHandSkeleton(ctx, hand);
      }
    }

    // 5. Subtle Hand / Pointer Feedback Indicator
    if (this.isPointerActive && hands.length === 0) {
      this.renderInteractionFeedback(ctx, activeMode);
    }
  }

  // -------------------------------------------------------------
  // Mode 1: MR Aquarium (Calm, Elegant Swimming Boids)
  // -------------------------------------------------------------
  renderAquarium(ctx, w, h) {
    ctx.save();
    // Ambient aquatic tint
    ctx.fillStyle = 'rgba(0, 115, 230, 0.08)';
    ctx.fillRect(0, 0, w, h);

    // Subtle caustic light rays at top
    const rayAlpha = 0.04 + Math.sin(this.time * 2) * 0.02;
    const grad = ctx.createLinearGradient(0, 0, 0, h * 0.45);
    grad.addColorStop(0, `rgba(255, 255, 255, ${rayAlpha * 1.5})`);
    grad.addColorStop(1, 'rgba(255, 255, 255, 0)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, h * 0.45);

    // Update & Draw Bubbles
    ctx.fillStyle = 'rgba(255, 255, 255, 0.45)';
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.7)';
    ctx.lineWidth = 1;
    for (const b of this.bubbles) {
      b.y -= b.vy;
      b.x = b.baseX + Math.sin(this.time * b.swaySpeed) * b.swayWidth;
      if (b.y < -10) {
        b.y = h + 10;
        b.baseX = Math.random() * w;
      }
      ctx.beginPath();
      ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }

    // Update & Draw Ripples
    for (let i = this.ripples.length - 1; i >= 0; i--) {
      const rp = this.ripples[i];
      rp.r += 1.2;
      rp.opacity -= 0.02;
      if (rp.opacity <= 0 || rp.r >= rp.maxR) {
        this.ripples.splice(i, 1);
        continue;
      }
      ctx.strokeStyle = `rgba(180, 230, 255, ${rp.opacity})`;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(rp.x, rp.y, rp.r, 0, Math.PI * 2);
      ctx.stroke();
    }

    // 手の平（Open Palm）を検出した場合のみ餌を表示させ、それ以外はボイドアルゴリズムを貫く
    const isFeeding = !!(this.isOpenPalm && this.primaryHand && this.isPointerActive && this.pointerX > -500);
    const foodX = isFeeding ? this.pointerX : -1000;
    const foodY = isFeeding ? this.pointerY : -1000;

    // 手の平検出時のみ餌ペレットを描画
    if (isFeeding) {
      this.renderFoodPellets(ctx, foodX, foodY);
    }

    // ボイドアルゴリズム (Boids Schooling Simulation)
    const fishes = this.fishes;
    const spdMult = this.fishSpeedMultiplier || 1.6;

    for (let i = 0; i < fishes.length; i++) {
      const f = fishes[i];

      // Boids 3原則
      // 1. Separation (近接回避): 衝突を回避する反発力
      // 2. Alignment (整列 / 同調): 近隣魚の平均進行方向に合わせる力
      // 3. Cohesion (結合 / 群れ): 近隣魚の群れの中心（重心）に向かう力
      let sepX = 0, sepY = 0;
      let alignVx = 0, alignVy = 0;
      let cohX = 0, cohY = 0;
      let neighborCount = 0;

      for (let j = 0; j < fishes.length; j++) {
        if (i === j) continue;
        const o = fishes[j];
        const dx = o.x - f.x;
        const dy = o.y - f.y;
        const dist = Math.hypot(dx, dy);

        // 1. Separation (距離 < 45px)
        if (dist > 0 && dist < 45) {
          const factor = (45 - dist) / 45;
          sepX -= (dx / dist) * factor * 2.2;
          sepY -= (dy / dist) * factor * 2.2;
        }

        // 2. Alignment & 3. Cohesion (距離 < 140px)
        if (dist > 0 && dist < 140) {
          cohX += o.x;
          cohY += o.y;
          alignVx += o.vx;
          alignVy += o.vy;
          neighborCount++;
        }
      }

      if (neighborCount > 0) {
        // Cohesion: 重心への引力
        cohX = (cohX / neighborCount - f.x) * 0.0055 * spdMult;
        cohY = (cohY / neighborCount - f.y) * 0.0055 * spdMult;

        // Alignment: 近隣の平均速度への同調
        alignVx = ((alignVx / neighborCount) - f.vx) * 0.045 * spdMult;
        alignVy = ((alignVy / neighborCount) - f.vy) * 0.045 * spdMult;
      }

      // 餌との相互作用: 手の平を検出した場合のみ餌への引力、それ以外はゼロ（ボイドアルゴリズムを貫徹）
      let foodForceX = 0, foodForceY = 0;
      if (isFeeding) {
        const pdx = foodX - f.x;
        const pdy = foodY - f.y;
        const pDist = Math.hypot(pdx, pdy);

        if (pDist > 25) {
          // 餌へ勢いよく向かう引力
          const pull = Math.min(3.8, 380 / (pDist + 35)) * spdMult;
          foodForceX = (pdx / pDist) * pull;
          foodForceY = (pdy / pDist) * pull;
        } else {
          // 餌の直前でついばむ微動 & 波紋
          foodForceX = (Math.random() - 0.5) * 1.6 * spdMult;
          foodForceY = (Math.random() - 0.5) * 1.6 * spdMult;
          if (Math.random() < 0.06 && this.waterRipples) {
            this.ripples.push({ x: f.x, y: f.y, r: 2, maxR: 22, opacity: 0.45 });
          }
        }
      }

      // 水槽端の回避（境界判定）
      let marginX = 0, marginY = 0;
      const pad = 45;
      if (f.x < pad) marginX = 2.8 * spdMult;
      if (f.x > w - pad) marginX = -2.8 * spdMult;
      if (f.y < pad) marginY = 2.4 * spdMult;
      if (f.y > h - pad) marginY = -2.4 * spdMult;

      // 速度の更新 (Separation + Cohesion + Alignment + 餌 + 水槽端)
      f.vx += sepX * 1.4 + cohX + alignVx + foodForceX + marginX;
      f.vy += sepY * 1.4 + cohY + alignVy + foodForceY + marginY;

      // わずかな巡航揺らぎ (Wander)
      f.vx += (Math.random() - 0.5) * 0.2 * spdMult;
      f.vy += (Math.random() - 0.5) * 0.2 * spdMult;

      // 速度制限（高速かつ軽快な遊泳）
      const speed = Math.hypot(f.vx, f.vy);
      const maxSpd = 7.0 * spdMult;
      const minSpd = 2.4 * spdMult;
      if (speed > maxSpd) {
        f.vx = (f.vx / speed) * maxSpd;
        f.vy = (f.vy / speed) * maxSpd;
      } else if (speed < minSpd) {
        f.vx = (f.vx / (speed || 1)) * minSpd;
        f.vy = (f.vy / (speed || 1)) * minSpd;
      }

      f.x += f.vx;
      f.y += f.vy;

      // 個々の魚を描画
      this.drawFish(ctx, f);
    }

    // 水族館モードのステータスバッジ (HUD)
    this.renderAquariumHUD(ctx, w, h, isFeeding);

    ctx.restore();
  }

  renderAquariumHUD(ctx, w, h, isFeeding) {
    ctx.save();
    const bx = 16, by = 20;

    if (isFeeding) {
      ctx.fillStyle = 'rgba(20, 20, 25, 0.7)';
      ctx.strokeStyle = '#ffbe0b';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.roundRect(bx, by, 120, 26, 4);
      ctx.fill();
      ctx.stroke();

      ctx.fillStyle = '#ffbe0b';
      ctx.beginPath();
      ctx.arc(bx + 14, by + 13, 3.5, 0, Math.PI * 2);
      ctx.fill();

      ctx.font = '600 11px sans-serif';
      ctx.textAlign = 'left';
      ctx.fillText('Feeding (給餌中)', bx + 24, by + 17);
    } else {
      ctx.fillStyle = 'rgba(15, 23, 42, 0.6)';
      ctx.strokeStyle = 'rgba(0, 245, 212, 0.35)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.roundRect(bx, by, 130, 26, 4);
      ctx.fill();
      ctx.stroke();

      ctx.fillStyle = '#00f5d4';
      ctx.beginPath();
      ctx.arc(bx + 14, by + 13, 3.5, 0, Math.PI * 2);
      ctx.fill();

      ctx.font = '600 11px sans-serif';
      ctx.textAlign = 'left';
      ctx.fillText('Boids (自律群泳)', bx + 24, by + 17);
    }

    ctx.restore();
  }

  renderFoodPellets(ctx, x, y) {
    ctx.save();

    // 1. 餌の光輪
    const pulse = Math.sin(this.time * 6);
    const auraR = 26 + pulse * 4;
    const auraGrad = ctx.createRadialGradient(x, y, 4, x, y, auraR);
    auraGrad.addColorStop(0, 'rgba(255, 190, 11, 0.4)');
    auraGrad.addColorStop(0.5, 'rgba(251, 133, 0, 0.18)');
    auraGrad.addColorStop(1, 'rgba(255, 190, 11, 0)');
    ctx.fillStyle = auraGrad;
    ctx.beginPath();
    ctx.arc(x, y, auraR, 0, Math.PI * 2);
    ctx.fill();

    // 2. 餌ペレット
    const pelletOffsets = [
      { ox: 0, oy: 0, r: 3.5, color: '#ffd166', phase: 0 },
      { ox: -11, oy: 6, r: 2.7, color: '#ffb703', phase: 1.2 },
      { ox: 13, oy: -7, r: 3.0, color: '#fb8500', phase: 2.4 },
      { ox: -7, oy: -12, r: 2.4, color: '#ffe494', phase: 3.6 },
      { ox: 10, oy: 11, r: 2.8, color: '#ffd166', phase: 4.8 }
    ];

    for (const p of pelletOffsets) {
      const px = x + p.ox + Math.sin(this.time * 4 + p.phase) * 3;
      const py = y + p.oy + Math.cos(this.time * 3 + p.phase) * 3;

      ctx.shadowColor = '#ffd166';
      ctx.shadowBlur = 6;
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(px, py, p.r, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.arc(px - p.r * 0.3, py - p.r * 0.3, p.r * 0.35, 0, Math.PI * 2);
      ctx.fill();
    }

    // 3. 微粒子
    ctx.fillStyle = 'rgba(255, 255, 255, 0.85)';
    for (let k = 0; k < 4; k++) {
      const angle = this.time * 2.2 + (k * Math.PI / 2);
      const dist = 16 + Math.sin(this.time * 5 + k) * 5;
      const sx = x + Math.cos(angle) * dist;
      const sy = y + Math.sin(angle) * dist;
      ctx.beginPath();
      ctx.arc(sx, sy, 1.2, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.restore();
  }

  drawFish(ctx, f) {
    ctx.save();
    ctx.translate(f.x, f.y);

    const angle = Math.atan2(f.vy, f.vx);
    ctx.rotate(angle);

    const s = f.size;
    const wag = Math.sin(this.time * f.finSpeed + f.finPhase) * (s * 0.22);

    if (f.species === 'clownfish') {
      // Clownfish
      ctx.fillStyle = '#ff6b35';
      ctx.beginPath();
      ctx.ellipse(0, 0, s * 0.9, s * 0.45, 0, 0, Math.PI * 2);
      ctx.fill();

      // White Stripes
      ctx.fillStyle = '#ffffff';
      ctx.strokeStyle = '#222222';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.ellipse(-s * 0.1, 0, s * 0.14, s * 0.42, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();

      // Tail
      ctx.fillStyle = '#ff6b35';
      ctx.beginPath();
      ctx.moveTo(-s * 0.7, 0);
      ctx.lineTo(-s * 1.3, -s * 0.35 + wag);
      ctx.lineTo(-s * 1.1, wag);
      ctx.lineTo(-s * 1.3, s * 0.35 + wag);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();

      // Eye
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.arc(s * 0.5, -s * 0.12, s * 0.1, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#000000';
      ctx.beginPath();
      ctx.arc(s * 0.54, -s * 0.12, s * 0.05, 0, Math.PI * 2);
      ctx.fill();

    } else if (f.species === 'neon_tetra') {
      // Neon Tetra
      ctx.beginPath();
      ctx.ellipse(0, 0, s * 1.0, s * 0.3, 0, 0, Math.PI * 2);
      ctx.fillStyle = '#00f5d4';
      ctx.fill();

      ctx.beginPath();
      ctx.moveTo(-s * 0.2, 0);
      ctx.lineTo(s * 0.7, 0);
      ctx.lineTo(s * 0.1, s * 0.3);
      ctx.lineTo(-s * 0.8, s * 0.15);
      ctx.closePath();
      ctx.fillStyle = '#e63946';
      ctx.fill();

      ctx.fillStyle = 'rgba(255, 255, 255, 0.65)';
      ctx.beginPath();
      ctx.moveTo(-s * 0.8, 0);
      ctx.lineTo(-s * 1.4, -s * 0.3 + wag);
      ctx.lineTo(-s * 1.4, s * 0.3 + wag);
      ctx.closePath();
      ctx.fill();

    } else if (f.species === 'angelfish') {
      // Angelfish
      ctx.fillStyle = '#f3c68f';
      ctx.strokeStyle = '#b08968';
      ctx.lineWidth = 1;

      ctx.beginPath();
      ctx.moveTo(s * 0.8, 0);
      ctx.lineTo(-s * 0.5, -s * 0.8);
      ctx.lineTo(-s * 0.5, s * 0.8);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();

      ctx.beginPath();
      ctx.moveTo(0, -s * 0.4);
      ctx.quadraticCurveTo(-s * 0.4, -s * 1.4, -s * 0.9, -s * 1.6 + wag * 0.5);
      ctx.lineTo(-s * 0.5, -s * 0.6);
      ctx.fillStyle = 'rgba(255, 220, 180, 0.85)';
      ctx.fill();

      ctx.beginPath();
      ctx.moveTo(-s * 0.5, 0);
      ctx.lineTo(-s * 1.3, -s * 0.4 + wag);
      ctx.lineTo(-s * 1.3, s * 0.4 + wag);
      ctx.closePath();
      ctx.fill();

    } else {
      // Golden Fish
      ctx.fillStyle = '#ffb703';
      ctx.beginPath();
      ctx.ellipse(0, 0, s * 0.8, s * 0.4, 0, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = '#fb8500';
      ctx.beginPath();
      ctx.moveTo(-s * 0.6, 0);
      ctx.quadraticCurveTo(-s * 1.2, -s * 0.5 + wag, -s * 1.4, wag);
      ctx.quadraticCurveTo(-s * 1.2, s * 0.5 + wag, -s * 0.6, 0);
      ctx.fill();
    }

    ctx.restore();
  }

  // -------------------------------------------------------------
  // Mode 2: Air Drawing (Spatial Neon Paint with Hands / Touch)
  // -------------------------------------------------------------
  renderAirDraw(ctx, w, h) {
    const now = performance.now();

    // 1. Manage Active Stroke (only when pinching with hand or touching screen)
    const canDraw = this.isAirDrawing || (this.isDirectTouch && this.isPointerActive);
    if (canDraw && this.pointerX > -500) {
      if (!this.currentStroke) {
        this.currentStroke = {
          points: [{ x: this.pointerX, y: this.pointerY, t: now }],
          color: this.drawColor,
          width: this.drawWidth,
          isRainbow: this.drawColor === 'rainbow',
          createdAt: now
        };
        this.drawStrokes.push(this.currentStroke);
      } else {
        const lastPt = this.currentStroke.points[this.currentStroke.points.length - 1];
        const dist = Math.hypot(this.pointerX - lastPt.x, this.pointerY - lastPt.y);
        if (dist > 3) {
          this.currentStroke.points.push({ x: this.pointerX, y: this.pointerY, t: now });

          // Emit glowing sparkle particles from drawing tip
          if (Math.random() < 0.6) {
            this.drawSparks.push({
              x: this.pointerX + (Math.random() - 0.5) * 8,
              y: this.pointerY + (Math.random() - 0.5) * 8,
              vx: (Math.random() - 0.5) * 2,
              vy: (Math.random() - 0.5) * 2,
              life: 0,
              maxLife: 25 + Math.random() * 20,
              color: this.getStrokeColorValue(this.drawColor, this.time * 80),
              size: 2 + Math.random() * 2.5
            });
          }
        }
      }
    } else {
      this.currentStroke = null;
    }

    // 2. Render Existing Strokes
    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    const fadeDuration = 7000; // 7 seconds fade-out in fade mode

    for (let sIdx = this.drawStrokes.length - 1; sIdx >= 0; sIdx--) {
      const stroke = this.drawStrokes[sIdx];
      const pts = stroke.points;
      if (pts.length < 2) continue;

      let opacity = 1.0;
      if (this.drawFade === 'fade') {
        const age = now - stroke.createdAt;
        opacity = Math.max(0, 1.0 - (age / fadeDuration));
        if (opacity <= 0) {
          this.drawStrokes.splice(sIdx, 1);
          continue;
        }
      }

      const strokeColor = this.getStrokeColorValue(stroke.color, sIdx * 45);

      // Pass 1: Outer Glowing Blur
      ctx.save();
      ctx.globalAlpha = opacity * 0.45;
      ctx.shadowColor = strokeColor;
      ctx.shadowBlur = 14;
      ctx.strokeStyle = strokeColor;
      ctx.lineWidth = stroke.width * 1.8;
      this.drawSmoothPath(ctx, pts);
      ctx.stroke();
      ctx.restore();

      // Pass 2: Sharp Neon Core
      ctx.save();
      ctx.globalAlpha = opacity;
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = Math.max(2, stroke.width * 0.55);
      this.drawSmoothPath(ctx, pts);
      ctx.stroke();

      ctx.strokeStyle = strokeColor;
      ctx.lineWidth = stroke.width;
      this.drawSmoothPath(ctx, pts);
      ctx.stroke();
      ctx.restore();
    }

    // 3. Render Sparks
    for (let i = this.drawSparks.length - 1; i >= 0; i--) {
      const sp = this.drawSparks[i];
      sp.x += sp.vx;
      sp.y += sp.vy;
      sp.life++;
      if (sp.life >= sp.maxLife) {
        this.drawSparks.splice(i, 1);
        continue;
      }
      const alpha = 1.0 - (sp.life / sp.maxLife);
      ctx.fillStyle = sp.color;
      ctx.globalAlpha = alpha;
      ctx.beginPath();
      ctx.arc(sp.x, sp.y, sp.size, 0, Math.PI * 2);
      ctx.fill();
    }

    // 4. Mode HUD Prompt
    ctx.save();
    ctx.font = '600 12px sans-serif';
    ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';
    ctx.textAlign = 'center';
    ctx.shadowColor = 'rgba(0,0,0,0.85)';
    ctx.shadowBlur = 4;
    const airPrompt = this.isHandModelLoaded
      ? 'ピンチ操作（指先をつまむ）で描画'
      : 'ドラッグまたはタッチで描画';
    ctx.fillText(airPrompt, w / 2, h - 22);
    ctx.restore();

    ctx.restore();
  }

  drawSmoothPath(ctx, pts) {
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length - 1; i++) {
      const xc = (pts[i].x + pts[i + 1].x) / 2;
      const yc = (pts[i].y + pts[i + 1].y) / 2;
      ctx.quadraticCurveTo(pts[i].x, pts[i].y, xc, yc);
    }
    if (pts.length > 1) {
      ctx.lineTo(pts[pts.length - 1].x, pts[pts.length - 1].y);
    }
  }

  getStrokeColorValue(colorKey, offset = 0) {
    if (colorKey === 'neon_pink') return '#f72585';
    if (colorKey === 'cyber_gold') return '#ffbe0b';
    if (colorKey === 'rainbow') {
      const hue = ((this.time * 60) + offset) % 360;
      return `hsl(${hue}, 100%, 60%)`;
    }
    return '#00f5d4'; // neon_cyan default
  }

  // -------------------------------------------------------------
  // Mode 3: Tabletop AR (Physical Virtual Objects on Desk)
  // -------------------------------------------------------------
  renderTabletopAR(ctx, w, h) {
    const groundY = h * 0.82; // Virtual desk plane
    let gravity = 0.45;
    if (this.gravityLevel === 'light') gravity = 0.22;
    if (this.gravityLevel === 'heavy') gravity = 0.75;

    // 1. Draw Virtual Ground Grid (Perspective Desk Surface)
    ctx.save();
    this.drawDeskGrid(ctx, w, h, groundY);

    const px = this.pointerX;
    const py = this.pointerY;
    const pActive = this.isPointerActive && px > -500;
    const pVx = this.pointerVx;
    const pVy = this.pointerVy;

    // 2. Physics & Hand Interaction for each object
    for (const obj of this.tabletopObjects) {
      obj.groundY = groundY;

      // Handle Grabbing / Pushing
      if (pActive) {
        const dx = px - obj.x;
        const dy = py - obj.y;
        const dist = Math.hypot(dx, dy);

        // Check Grab: MediaPipe Pinch OR direct touch / slow proximity
        const isPinchNear = this.isHandPinching && (dist < obj.radius + 38);
        if (isPinchNear || (this.isDirectTouch && dist < obj.radius + 18) || (!this.primaryHand && Math.hypot(pVx, pVy) < 3.5 && dist < obj.radius + 15 && !this.grabbedObject)) {
          if (!this.grabbedObject || this.grabbedObject === obj) {
            this.grabbedObject = obj;
            obj.isGrabbed = true;
          }
        }

        // Check Release / Toss if hand opened from pinch
        if (obj.isGrabbed && this.primaryHand && !this.isHandPinching && !this.isDirectTouch) {
          obj.isGrabbed = false;
          obj.vx = Math.min(Math.max(pVx * 0.75, -20), 20);
          obj.vy = Math.min(Math.max(pVy * 0.75, -20), 20);
          this.grabbedObject = null;
        }

        // Check Push / Kick if not grabbed
        if (!obj.isGrabbed && dist < obj.radius + 35) {
          const pushForce = Math.hypot(pVx, pVy);
          if (pushForce > 1.0) {
            // Apply impulse from hand velocity
            obj.vx += pVx * 0.5;
            obj.vy += pVy * 0.5;
            obj.vAngle += (pVx * 0.025);
            obj.pulse = 15;
          } else if (dist > 0) {
            // Repulsive boundary so hand pushes object out of the way
            const pen = (obj.radius + 35) - dist;
            obj.vx -= (dx / dist) * pen * 0.18;
            obj.vy -= (dy / dist) * pen * 0.18;
          }
        }
      }

      // Physics update
      if (obj.isGrabbed && pActive) {
        // Follow hand smoothly
        obj.vx = (px - obj.x) * 0.6;
        obj.vy = (py - obj.y) * 0.6;
        obj.x += obj.vx;
        obj.y += obj.vy;
        obj.vAngle = obj.vx * 0.035;
        obj.angle += obj.vAngle;
      } else {
        if (obj.isGrabbed) {
          obj.isGrabbed = false;
          this.grabbedObject = null;
        }

        // Apply gravity & air resistance
        obj.vy += gravity;
        obj.vx *= obj.friction;
        obj.vAngle *= 0.98;

        obj.x += obj.vx;
        obj.y += obj.vy;
        obj.angle += obj.vAngle;

        // Ground Collision (Bounce on desk)
        if (obj.y + obj.radius >= groundY) {
          obj.y = groundY - obj.radius;
          if (Math.abs(obj.vy) > 0.8) {
            obj.vy = -obj.vy * obj.bounce;
            obj.vAngle += obj.vx * 0.04;
          } else {
            obj.vy = 0;
            obj.vx *= 0.92; // Table surface friction
          }
        }

        // Wall Collision (Left & Right boundaries)
        if (obj.x - obj.radius < 20) {
          obj.x = 20 + obj.radius;
          obj.vx = -obj.vx * 0.7;
        } else if (obj.x + obj.radius > w - 20) {
          obj.x = w - 20 - obj.radius;
          obj.vx = -obj.vx * 0.7;
        }
      }

      if (obj.pulse > 0) obj.pulse--;

      // 3. Render Shadow on Desk Surface
      this.drawObjectShadow(ctx, obj, groundY);

      // 4. Render 3D Object Body
      this.drawTabletopObject(ctx, obj);
    }

    // 5. Desk AR Mode Prompt
    ctx.font = '600 12px sans-serif';
    ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';
    ctx.textAlign = 'center';
    ctx.shadowColor = 'rgba(0,0,0,0.85)';
    ctx.shadowBlur = 5;
    const promptMsg = this.isHandModelLoaded
      ? '手の平でプッシュ / ピンチで把持・投擲'
      : 'ドラッグで移動・投擲';
    ctx.fillText(promptMsg, w / 2, h - 22);

    ctx.restore();
  }

  drawDeskGrid(ctx, w, h, groundY) {
    ctx.save();
    // Perspective grid line along virtual table plane
    ctx.strokeStyle = 'rgba(0, 245, 212, 0.22)';
    ctx.lineWidth = 1.2;

    // Table horizon line
    ctx.beginPath();
    ctx.moveTo(0, groundY);
    ctx.lineTo(w, groundY);
    ctx.stroke();

    // Perspective depth lines
    for (let x = 0; x <= w; x += 60) {
      ctx.beginPath();
      ctx.moveTo(x, groundY);
      ctx.lineTo(x + (x - w / 2) * 0.5, h);
      ctx.stroke();
    }

    // Horizontal depth slats
    for (let y = groundY; y < h; y += 22) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(w, y);
      ctx.stroke();
    }
    ctx.restore();
  }

  drawObjectShadow(ctx, obj, groundY) {
    ctx.save();
    const heightAboveGround = Math.max(0, groundY - (obj.y + obj.radius));
    const shadowScale = Math.max(0.3, 1 - heightAboveGround / 250);
    const shadowAlpha = Math.max(0.1, 0.45 * (1 - heightAboveGround / 220));

    ctx.fillStyle = `rgba(0, 0, 0, ${shadowAlpha})`;
    ctx.beginPath();
    ctx.ellipse(obj.x, groundY + 4, obj.radius * shadowScale, obj.radius * 0.35 * shadowScale, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  drawTabletopObject(ctx, obj) {
    ctx.save();
    ctx.translate(obj.x, obj.y);

    const r = obj.radius;
    const color = obj.color;

    // Grab or impact ring
    if (obj.isGrabbed || obj.pulse > 0) {
      ctx.save();
      ctx.strokeStyle = obj.isGrabbed ? '#ffbe0b' : '#ffffff';
      ctx.lineWidth = 2.5;
      ctx.shadowColor = obj.isGrabbed ? '#ffbe0b' : color;
      ctx.shadowBlur = 12;
      ctx.beginPath();
      ctx.arc(0, 0, r + 12 + Math.sin(this.time * 8) * 3, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }

    if (obj.type === 'cube') {
      // 3D Isometric Rotating Cyber Cube
      ctx.rotate(obj.angle);
      const side = r * 1.35;

      // Outer glow & wireframe fill
      ctx.shadowColor = color;
      ctx.shadowBlur = 10;
      ctx.fillStyle = 'rgba(20, 20, 35, 0.85)';
      ctx.strokeStyle = color;
      ctx.lineWidth = 2.5;

      ctx.beginPath();
      ctx.roundRect(-side / 2, -side / 2, side, side, 8);
      ctx.fill();
      ctx.stroke();

      // Inner isometric facets
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.7)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(-side / 2, -side / 2);
      ctx.lineTo(side / 2, side / 2);
      ctx.moveTo(side / 2, -side / 2);
      ctx.lineTo(-side / 2, side / 2);
      ctx.stroke();

      // Center glowing core
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(0, 0, side * 0.22, 0, Math.PI * 2);
      ctx.fill();

    } else if (obj.type === 'ball') {
      // Glowing Hologram Energy Sphere
      ctx.rotate(obj.angle);

      // Radial shaded sphere
      const grad = ctx.createRadialGradient(-r * 0.35, -r * 0.35, r * 0.1, 0, 0, r);
      grad.addColorStop(0, '#ffffff');
      grad.addColorStop(0.3, color);
      grad.addColorStop(1, '#0b091a');

      ctx.shadowColor = color;
      ctx.shadowBlur = 14;
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(0, 0, r, 0, Math.PI * 2);
      ctx.fill();

      // Latitude / Longitude lines
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.4)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.ellipse(0, 0, r * 0.95, r * 0.38, obj.angle, 0, Math.PI * 2);
      ctx.stroke();

    } else {
      // Hologram Cyber Crystal (Gemstone)
      ctx.rotate(obj.angle);

      ctx.shadowColor = color;
      ctx.shadowBlur = 12;
      ctx.fillStyle = 'rgba(255, 255, 255, 0.2)';
      ctx.strokeStyle = color;
      ctx.lineWidth = 2;

      // Hexagonal Crystal Facets
      const sides = 6;
      ctx.beginPath();
      for (let s = 0; s < sides; s++) {
        const a = (s / sides) * Math.PI * 2;
        const px = Math.cos(a) * r;
        const py = Math.sin(a) * (r * 1.15);
        if (s === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.closePath();
      ctx.fill();
      ctx.stroke();

      // Inner gemstone apex lines
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.85)';
      ctx.beginPath();
      for (let s = 0; s < sides; s += 2) {
        const a = (s / sides) * Math.PI * 2;
        ctx.moveTo(0, 0);
        ctx.lineTo(Math.cos(a) * r, Math.sin(a) * (r * 1.15));
      }
      ctx.stroke();
    }

    ctx.restore();
  }

  // -------------------------------------------------------------
  // Pointer & Touch Visual Feedback
  // -------------------------------------------------------------
  renderInteractionFeedback(ctx, activeMode) {
    ctx.save();
    const r = 16 + Math.sin(this.time * 6) * 3;
    const grad = ctx.createRadialGradient(this.pointerX, this.pointerY, 2, this.pointerX, this.pointerY, r);

    const glowColor = (activeMode === 'air_draw') ? this.getStrokeColorValue(this.drawColor) : '#00f5d4';
    grad.addColorStop(0, 'rgba(255, 255, 255, 0.9)');
    grad.addColorStop(0.5, glowColor);
    grad.addColorStop(1, 'rgba(0, 0, 0, 0)');

    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(this.pointerX, this.pointerY, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
}

window.ARInteractionEngine = ARInteractionEngine;

