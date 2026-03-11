/*  =============================================
    People Tracker — Core Application Logic
    =============================================
    Uses TensorFlow.js COCO-SSD to detect & count
    people in a live camera feed, entirely on-device.
    ============================================= */

import * as cocoSsd from '@tensorflow-models/coco-ssd';
import '@tensorflow/tfjs';

// ── DOM References ──────────────────────────────
const loadingScreen   = document.getElementById('loading-screen');
const loaderText      = document.getElementById('loader-text');
const progressBar     = document.getElementById('progress-bar');
const mainApp         = document.getElementById('main-app');
const video           = document.getElementById('video');
const overlayCanvas   = document.getElementById('overlay-canvas');
const countNumber     = document.getElementById('count-number');
const statusBadge     = document.getElementById('status-badge');
const statusText      = document.getElementById('status-text');
const statCurrent     = document.getElementById('stat-current');
const statMax         = document.getElementById('stat-max');
const statFps         = document.getElementById('stat-fps');
const statConfidence  = document.getElementById('stat-confidence');
const confidenceSlider = document.getElementById('confidence-slider');
const confidenceValue = document.getElementById('confidence-value');
const toggleBoxes     = document.getElementById('toggle-boxes');
const cameraSwitchBtn = document.getElementById('camera-switch-btn');
const noCameraEl      = document.getElementById('no-camera');
const retryCameraBtn  = document.getElementById('retry-camera-btn');

const ctx = overlayCanvas.getContext('2d');

// ── State ───────────────────────────────────────
let model          = null;
let currentStream  = null;
let useFrontCamera = true;
let isDetecting    = false;
let peakCount      = 0;
let lastCount      = -1;
let frameCount     = 0;
let fpsTimestamp    = performance.now();
let minConfidence   = 0.5;
let showBoxes       = true;
let animFrameId     = null;
let currentFps      = 0;
let currentAvgConf  = 0;

// ── WebSocket to Dashboard Server ───────────────
let ws = null;
function connectWebSocket() {
  // Connect via same-origin /ws path (Vite proxies this to the dashboard server)
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  ws = new WebSocket(`${proto}://${location.host}/ws?role=camera`);
  ws.onopen = () => console.log('📡 Connected to dashboard server');
  ws.onclose = () => {
    console.log('📡 Disconnected, reconnecting in 3s…');
    setTimeout(connectWebSocket, 3000);
  };
  ws.onerror = () => ws.close();
}
connectWebSocket();

function sendStats(count, peak, fps, avgConf) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({
      count,
      peak,
      fps,
      avgConfidence: avgConf,
    }));
  }
}

// ── Initialization ──────────────────────────────
async function init() {
  try {
    updateProgress(10, 'Loading TensorFlow.js…');
    await new Promise(r => setTimeout(r, 300));

    updateProgress(30, 'Downloading COCO-SSD model…');
    model = await cocoSsd.load({ base: 'lite_mobilenet_v2' });

    updateProgress(70, 'Starting camera…');
    await startCamera();

    updateProgress(100, 'Ready!');
    await new Promise(r => setTimeout(r, 400));

    // Transition from loading to main
    loadingScreen.classList.add('fade-out');
    mainApp.classList.remove('hidden');

    setTimeout(() => {
      loadingScreen.style.display = 'none';
    }, 600);

    setStatus('active', 'Detecting');
    startDetection();
  } catch (err) {
    console.error('Initialization error:', err);
    updateProgress(100, 'Error — check console');
  }
}

function updateProgress(percent, text) {
  progressBar.style.width = `${percent}%`;
  if (text) loaderText.textContent = text;
}

// ── Camera ──────────────────────────────────────
async function startCamera() {
  if (currentStream) {
    currentStream.getTracks().forEach(t => t.stop());
  }

  const constraints = {
    video: {
      facingMode: useFrontCamera ? 'user' : 'environment',
      width: { ideal: 640 },
      height: { ideal: 480 },
    },
    audio: false,
  };

  try {
    const stream = await navigator.mediaDevices.getUserMedia(constraints);
    currentStream = stream;
    video.srcObject = stream;
    noCameraEl.style.display = 'none';
    video.style.display = 'block';

    // mirror only for the front camera
    video.style.transform = useFrontCamera ? 'scaleX(-1)' : 'scaleX(1)';
    overlayCanvas.style.transform = useFrontCamera ? 'scaleX(-1)' : 'scaleX(1)';

    await new Promise(resolve => {
      video.onloadedmetadata = () => {
        video.play();
        // Sync canvas dimensions with the video
        overlayCanvas.width = video.videoWidth;
        overlayCanvas.height = video.videoHeight;
        resolve();
      };
    });
  } catch (err) {
    console.warn('Camera access denied:', err);
    video.style.display = 'none';
    noCameraEl.style.display = 'flex';
  }
}

// ── Detection Loop ──────────────────────────────
function startDetection() {
  isDetecting = true;
  detect();
}

async function detect() {
  if (!isDetecting || !model) return;

  if (video.readyState >= 2) {
    const predictions = await model.detect(video);

    // Filter for "person" class only
    const people = predictions.filter(
      p => p.class === 'person' && p.score >= minConfidence
    );

    const count = people.length;

    // Update count with animation
    if (count !== lastCount) {
      countNumber.textContent = count;
      statCurrent.textContent = count;
      countNumber.classList.remove('bump');
      void countNumber.offsetWidth; // reflow to restart animation
      countNumber.classList.add('bump');
      lastCount = count;
    }

    // Peak tracking
    if (count > peakCount) {
      peakCount = count;
      statMax.textContent = peakCount;
    }

    // Average confidence
    if (people.length > 0) {
      const avgConf = people.reduce((sum, p) => sum + p.score, 0) / people.length;
      statConfidence.textContent = `${Math.round(avgConf * 100)}%`;
    } else {
      statConfidence.textContent = '—';
    }

    // Draw bounding boxes
    drawOverlay(people);

    // FPS calculation
    frameCount++;
    const now = performance.now();
    if (now - fpsTimestamp >= 1000) {
      currentFps = frameCount;
      statFps.textContent = currentFps;
      frameCount = 0;
      fpsTimestamp = now;
    }

    // Average confidence for streaming
    if (people.length > 0) {
      currentAvgConf = people.reduce((s, p) => s + p.score, 0) / people.length;
    } else {
      currentAvgConf = 0;
    }

    // Stream stats to dashboard
    sendStats(count, peakCount, currentFps, currentAvgConf);
  }

  animFrameId = requestAnimationFrame(detect);
}

// ── Canvas Overlay ──────────────────────────────
function drawOverlay(people) {
  ctx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);

  if (!showBoxes) return;

  people.forEach(person => {
    const [x, y, w, h] = person.bbox;
    const score = Math.round(person.score * 100);

    // Box
    ctx.strokeStyle = 'rgba(99, 102, 241, 0.85)';
    ctx.lineWidth = 2.5;
    ctx.setLineDash([]);

    // Rounded rectangle
    const r = 6;
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r);
    ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
    ctx.stroke();

    // Semi-transparent fill
    ctx.fillStyle = 'rgba(99, 102, 241, 0.08)';
    ctx.fill();

    // Label background
    const label = `Person ${score}%`;
    ctx.font = '600 13px Inter, sans-serif';
    const textWidth = ctx.measureText(label).width;
    const labelH = 24;
    const labelW = textWidth + 16;

    ctx.fillStyle = 'rgba(99, 102, 241, 0.9)';
    ctx.beginPath();
    ctx.roundRect(x, y - labelH - 4, labelW, labelH, 4);
    ctx.fill();

    // Label text
    ctx.fillStyle = '#ffffff';
    ctx.fillText(label, x + 8, y - 10);
  });
}

// ── Status ──────────────────────────────────────
function setStatus(state, text) {
  statusBadge.className = `status-badge ${state}`;
  statusText.textContent = text;
}

// ── Event Listeners ─────────────────────────────
confidenceSlider.addEventListener('input', () => {
  const val = parseInt(confidenceSlider.value, 10);
  minConfidence = val / 100;
  confidenceValue.textContent = `${val}%`;
});

toggleBoxes.addEventListener('change', () => {
  showBoxes = toggleBoxes.checked;
  if (!showBoxes) {
    ctx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);
  }
});

cameraSwitchBtn.addEventListener('click', async () => {
  useFrontCamera = !useFrontCamera;
  await startCamera();
});

retryCameraBtn.addEventListener('click', async () => {
  await startCamera();
  if (currentStream) {
    setStatus('active', 'Detecting');
    if (!isDetecting) startDetection();
  }
});

// ── Cleanup on page hide ────────────────────────
document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    isDetecting = false;
    if (animFrameId) cancelAnimationFrame(animFrameId);
  } else {
    if (model && currentStream) {
      startDetection();
    }
  }
});

// ── Boot ────────────────────────────────────────
init();
