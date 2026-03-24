'use strict';

/**
 * tracker.js — Módulo de detección de muñecas con TensorFlow.js MoveNet
 *
 * USO:
 *   const tracker = new PoseTracker();
 *   await tracker.init(videoEl, canvasEl);
 *   // Luego en tu loop: tracker.getWrists() → { left, right }
 *
 * REQUISITOS (en index.html, antes de este script):
 *   <script src="https://cdn.jsdelivr.net/npm/@tensorflow/tfjs@4.17.0/dist/tf.min.js"></script>
 *   <script src="https://cdn.jsdelivr.net/npm/@tensorflow-models/pose-detection@2.1.3/dist/pose-detection.min.js"></script>
 */

class PoseTracker extends EventTarget {

  constructor() {
    super();
    this.detector    = null;
    this.video       = null;
    this.canvas      = null;
    this.wrists      = { left: null, right: null };  // coordenadas en píxeles del canvas
    this.isReady     = false;
    this._running    = false;

    // Umbral de confianza mínima para detectar una muñeca (0–1)
    this.CONFIDENCE_THRESHOLD = 0.25;
  }

  // ─── Inicialización ────────────────────────────────────────────────────────

  /**
   * Arranca la cámara y carga MoveNet.
   * @param {HTMLVideoElement} videoEl   - elemento <video> del DOM
   * @param {HTMLCanvasElement} canvasEl - canvas overlay (se sincroniza su tamaño)
   */
  async init(videoEl, canvasEl) {
    this.video  = videoEl;
    this.canvas = canvasEl;

    // ── 1. Cámara ──
    const stream = await navigator.mediaDevices.getUserMedia({
      video: {
        width:       { ideal: 640 },
        height:      { ideal: 480 },
        facingMode:  'user',
        frameRate:   { ideal: 30 }
      }
    });

    this.video.srcObject = stream;
    await new Promise((resolve, reject) => {
      this.video.onloadedmetadata = () => {
        this.video.play().then(resolve).catch(reject);
      };
    });

    // ── 2. Sincronizar canvas con viewport ──
    this._syncCanvasSize();
    window.addEventListener('resize', () => this._syncCanvasSize());

    // ── 3. Cargar MoveNet LIGHTNING (más rápido, ~30 FPS en CPU) ──
    await tf.ready();
    this.detector = await poseDetection.createDetector(
      poseDetection.SupportedModels.MoveNet,
      { modelType: poseDetection.movenet.modelType.SINGLEPOSE_LIGHTNING }
    );

    this.isReady  = true;
    this._running = true;

    this.dispatchEvent(new Event('ready'));
    this._detectLoop();          // arrancar el loop interno
  }

  // ─── Loop de detección (independiente del game loop) ─────────────────────

  async _detectLoop() {
    while (this._running) {
      // Esperar al siguiente frame de animación
      await new Promise(r => requestAnimationFrame(r));

      if (!this.video || this.video.readyState < 2) continue;

      try {
        const poses = await this.detector.estimatePoses(this.video);
        this._extractWrists(poses);
      } catch (_) {
        // Ignorar errores transitorios (frame corrupto, etc.)
      }
    }
  }

  // ─── Extracción de muñecas ─────────────────────────────────────────────────

  _extractWrists(poses) {
    if (!poses || poses.length === 0) {
      this.wrists.left  = null;
      this.wrists.right = null;
      return;
    }

    const kp = poses[0].keypoints;
    const vw = this.video.videoWidth  || 640;
    const vh = this.video.videoHeight || 480;
    const cw = this.canvas.width;
    const ch = this.canvas.height;

    /**
     * Índices MoveNet:  9 = left_wrist  (mano izq. de la persona)
     *                  10 = right_wrist (mano der. de la persona)
     *
     * El vídeo en CSS está volteado con scaleX(-1), así que la mano
     * izquierda aparece visualmente a la DERECHA del canvas, y viceversa.
     * Compensamos espejando la coordenada X:
     *   canvasX = (1 - keypointX / videoW) * canvasW
     */

    const leftKp  = kp[9];   // persona-izq → aparece a la derecha en pantalla
    const rightKp = kp[10];  // persona-der → aparece a la izquierda en pantalla

    this.wrists.left = leftKp.score >= this.CONFIDENCE_THRESHOLD
      ? {
          x:     (1 - leftKp.x / vw) * cw,
          y:     (leftKp.y / vh) * ch,
          score: leftKp.score
        }
      : null;

    this.wrists.right = rightKp.score >= this.CONFIDENCE_THRESHOLD
      ? {
          x:     (1 - rightKp.x / vw) * cw,
          y:     (rightKp.y / vh) * ch,
          score: rightKp.score
        }
      : null;
  }

  // ─── API Pública ──────────────────────────────────────────────────────────

  /**
   * Devuelve las posiciones actuales de las muñecas en coordenadas canvas.
   * @returns {{ left: {x,y,score}|null, right: {x,y,score}|null }}
   */
  getWrists() {
    return this.wrists;
  }

  /** Detiene la cámara y el loop. */
  stop() {
    this._running = false;
    if (this.video?.srcObject) {
      this.video.srcObject.getTracks().forEach(t => t.stop());
    }
  }

  // ─── Utilidades internas ──────────────────────────────────────────────────

  _syncCanvasSize() {
    if (!this.canvas) return;
    this.canvas.width  = this.canvas.offsetWidth  || window.innerWidth;
    this.canvas.height = this.canvas.offsetHeight || window.innerHeight;
  }

}
