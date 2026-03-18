import { CameraManager } from './camera.js';
import { AudioManager } from './audio.js';
import { VisualizerEngine } from './visualizer.js';
import { FaceTracker } from './face.js';
import { SegmentTracker } from './segment.js';
import { WarpRenderer } from './warp.js';

// ─── DOM refs ────────────────────────────────────────────────────────────────
const videoEl     = document.getElementById('camera-feed');
const canvasEl    = document.getElementById('viz-canvas');
const audioEl     = document.getElementById('audio-player');
const tapOverlay  = document.getElementById('tap-to-begin');
const btnMic      = document.getElementById('btn-mic');
const btnFlip     = document.getElementById('btn-flip');
const fileInput   = document.getElementById('file-input');

// ─── Managers ────────────────────────────────────────────────────────────────
const camera     = new CameraManager(videoEl);
const audio      = new AudioManager(audioEl);
const visualizer = new VisualizerEngine(canvasEl);
const faceTracker    = new FaceTracker();
const segmentTracker = new SegmentTracker();
const warpRenderer   = new WarpRenderer(canvasEl, videoEl);

// ─── State ───────────────────────────────────────────────────────────────────
let state = 'idle'; // idle | camera-starting | running
let rafId = null;
let micActive = false;

// ─── RAF loop ─────────────────────────────────────────────────────────────────
function loop() {
  rafId = requestAnimationFrame(loop);

  if (faceTracker.ready || segmentTracker.ready) {
    const faceResult = faceTracker.ready    ? faceTracker.detect(videoEl)    : null;
    const segResult  = segmentTracker.ready ? segmentTracker.detect(videoEl) : null;
    warpRenderer.render(faceResult, segResult);
  }

  const bands    = audio.getBands();
  const freqData = audio.getFrequencyData();
  const timeData = audio.getTimeDomainData();
  visualizer.render(bands, freqData, timeData);
}

function startLoop() {
  if (rafId !== null) return;
  loop();
}

function stopLoop() {
  if (rafId !== null) {
    cancelAnimationFrame(rafId);
    rafId = null;
  }
}

// ─── Initialization (runs after first tap) ───────────────────────────────────
async function beginExperience() {
  if (state !== 'idle') return;
  state = 'running';

  // AudioContext must be created inside a user gesture
  audio.init();

  // Initial canvas size + hide overlay immediately so the UI feels responsive
  visualizer.resize();
  tapOverlay.classList.add('hidden');
  startLoop();

  // Camera starts in the background — permission prompt may delay it
  try {
    await camera.start('user');
  } catch (err) {
    console.warn('Camera unavailable:', err);
  }

  // Load face tracker after camera is up (downloads WASM + model in background)
  // Both trackers init in parallel — hide CSS video once either is ready
  let trackersActivated = false;
  const onTrackerReady = () => {
    if (trackersActivated) return;
    trackersActivated = true;
    visualizer.autoClear = false;
    videoEl.style.opacity = '0';
  };

  faceTracker.init().then(onTrackerReady).catch(err => console.warn('Face tracking unavailable:', err));
  segmentTracker.init().then(onTrackerReady).catch(err => console.warn('Segmentation unavailable:', err));
}

// ─── Tap to begin ─────────────────────────────────────────────────────────────
tapOverlay.addEventListener('click', beginExperience, { once: true });
tapOverlay.addEventListener('touchend', (e) => {
  e.preventDefault();
  beginExperience();
}, { once: true, passive: false });

// ─── Mic button ───────────────────────────────────────────────────────────────
btnMic.addEventListener('click', async () => {
  if (state !== 'running') return;

  if (micActive) {
    // Toggle off: just stop mic stream
    if (audio.micStream) {
      audio.micStream.getTracks().forEach(t => t.stop());
      audio.micStream = null;
    }
    micActive = false;
    btnMic.classList.remove('active');
    return;
  }

  try {
    await audio.context?.resume();
    await audio.startMic();
    micActive = true;
    btnMic.classList.add('active');
  } catch (err) {
    console.error('Mic error:', err);
  }
});

// ─── File upload ──────────────────────────────────────────────────────────────
fileInput.addEventListener('change', async (e) => {
  const file = e.target.files?.[0];
  if (!file) return;
  if (state !== 'running') return;

  // Must call play() directly in this handler for iOS autoplay policy
  audio.loadFile(file);
  try {
    await audio.context?.resume();
    await audioEl.play();
    micActive = false;
    btnMic.classList.remove('active');
  } catch (err) {
    console.error('Audio play error:', err);
  }

  // Reset file input so same file can be re-selected
  fileInput.value = '';
});

// ─── Flip button ──────────────────────────────────────────────────────────────
btnFlip.addEventListener('click', async () => {
  if (state !== 'running') return;
  try {
    await camera.flip();
  } catch (err) {
    console.error('Camera flip error:', err);
  }
});

// ─── Resize / orientation ────────────────────────────────────────────────────
function onResize() {
  visualizer.resize();
}

window.addEventListener('resize', onResize);
screen.orientation?.addEventListener('change', onResize);

// ─── Visibility change ────────────────────────────────────────────────────────
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') {
    stopLoop();
  } else {
    audio.context?.resume().catch(() => {});
    if (state === 'running') startLoop();
  }
});

// ─── Service Worker registration ─────────────────────────────────────────────
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(err => {
      console.warn('SW registration failed:', err);
    });
  });
}
