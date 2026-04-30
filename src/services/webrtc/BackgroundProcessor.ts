import {
  FilesetResolver,
  ImageSegmenter,
  type ImageSegmenterResult,
} from '@mediapipe/tasks-vision';

/**
 * Visual effect applied to the local camera track before it is sent to the
 * remote peer. `'none'` means the raw camera feed is sent.
 */
export type VideoEffect = 'none' | 'blur';

/**
 * Semver for `@mediapipe/tasks-vision` — must match `package.json` and the
 * WASM bundle loaded from the CDN. Vite injects `__MEDIAPIPE_TASKS_VISION_VERSION__`
 * at build/dev time from package.json (see vite.config.ts).
 */
export const MEDIAPIPE_TASKS_VISION_VERSION: string =
  __MEDIAPIPE_TASKS_VISION_VERSION__;

const VISION_WASM_URL = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${MEDIAPIPE_TASKS_VISION_VERSION}/wasm`;

/**
 * Selfie segmenter weights from Google Storage (`latest` tracks the current
 * recommended checkpoint for this model family; WASM above is locked to the
 * npm package semver).
 */
const SEGMENTER_MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_segmenter/float16/latest/selfie_segmenter.tflite';

/**
 * Strength of the background blur (CSS canvas filter). Larger values are
 * more "private" but use more CPU when composited.
 */
const BACKGROUND_BLUR_PX = 14;

/**
 * Produces a processed copy of an input camera MediaStream with a Microsoft
 * Teams-style segmentation effect applied (currently: background blur).
 *
 * The processor:
 *   1. Pipes the input camera track into a hidden <video> element.
 *   2. Each animation frame, runs MediaPipe's selfie segmenter on that video
 *      to get a per-pixel "is this the user" mask.
 *   3. Draws a blurred copy of the frame to a canvas, then draws the un-blurred
 *      person on top using the mask, so the person stays sharp while the
 *      background is blurred.
 *   4. Exposes the canvas via `captureStream()`. The caller swaps the resulting
 *      track into the peer connection with `RTCRtpSender.replaceTrack`.
 *
 * Lifecycle:
 *   - `await processor.ready()` waits for MediaPipe to load (~1–2s first time).
 *   - `processor.outputStream` is the processed MediaStream.
 *   - `processor.setEffect('blur' | 'none')` swaps effects on the fly.
 *   - `processor.destroy()` stops the loop, closes the segmenter, and stops
 *     the canvas tracks.
 */
export class BackgroundProcessor {
  private segmenter: ImageSegmenter | null = null;
  private readonly inputVideo: HTMLVideoElement;
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly _outputStream: MediaStream;
  private effect: VideoEffect = 'blur';
  private rafHandle: number | null = null;
  private destroyed = false;
  private readonly readyPromise: Promise<void>;
  private readyError: Error | null = null;
  /** Reused offscreen buffer for sharp + mask pass (avoids per-frame canvas alloc). */
  private sharpCanvas: HTMLCanvasElement | null = null;
  private sharpCtx: CanvasRenderingContext2D | null = null;
  private sharpBufferW = 0;
  private sharpBufferH = 0;

  constructor(inputStream: MediaStream) {
    const videoTrack = inputStream.getVideoTracks()[0];
    if (!videoTrack) {
      throw new Error('BackgroundProcessor: input stream has no video track');
    }

    const settings = videoTrack.getSettings();
    const width = settings.width ?? 640;
    const height = settings.height ?? 480;

    this.inputVideo = document.createElement('video');
    this.inputVideo.srcObject = new MediaStream([videoTrack]);
    this.inputVideo.muted = true;
    this.inputVideo.playsInline = true;
    this.inputVideo.autoplay = true;
    // Detached element — keep it out of the DOM so layout doesn't see it.
    this.inputVideo.style.position = 'fixed';
    this.inputVideo.style.left = '-9999px';
    this.inputVideo.style.top = '-9999px';

    this.canvas = document.createElement('canvas');
    this.canvas.width = width;
    this.canvas.height = height;
    const ctx = this.canvas.getContext('2d', { willReadFrequently: false });
    if (!ctx) {
      throw new Error('BackgroundProcessor: 2D canvas context unavailable');
    }
    this.ctx = ctx;

    // Best-effort frame rate match with the source camera.
    const fps = settings.frameRate ?? 30;
    this._outputStream = this.canvas.captureStream(fps);

    this.readyPromise = this.initialize().catch((err) => {
      this.readyError = err instanceof Error ? err : new Error(String(err));
      throw this.readyError;
    });
  }

  /** Resolves when MediaPipe is loaded and the processing loop has started. */
  ready(): Promise<void> {
    return this.readyPromise;
  }

  /** The processed MediaStream — swap this track into the peer connection. */
  get outputStream(): MediaStream {
    return this._outputStream;
  }

  /** Swap the effect on the fly without rebuilding the pipeline. */
  setEffect(effect: VideoEffect): void {
    this.effect = effect;
  }

  /** Stop processing and release MediaPipe / canvas / video resources. */
  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    if (this.rafHandle !== null) {
      cancelAnimationFrame(this.rafHandle);
      this.rafHandle = null;
    }
    try {
      this.inputVideo.pause();
      this.inputVideo.srcObject = null;
    } catch {
      /* element may already be detached */
    }
    for (const track of this._outputStream.getTracks()) {
      track.stop();
    }
    try {
      this.segmenter?.close();
    } catch {
      /* segmenter may already be closed */
    }
    this.segmenter = null;
    this.sharpCanvas = null;
    this.sharpCtx = null;
    this.sharpBufferW = 0;
    this.sharpBufferH = 0;
  }

  // ── Private ───────────────────────────────────────────────

  /**
   * Lazily allocates / resizes the offscreen sharp layer used in compositeBlur.
   * Canvas resize clears the backing store; always re-fetch 2D context after resize.
   */
  private ensureSharpLayer(
    w: number,
    h: number,
  ): CanvasRenderingContext2D | null {
    if (!this.sharpCanvas) {
      this.sharpCanvas = document.createElement('canvas');
      this.sharpCtx = this.sharpCanvas.getContext('2d', {
        willReadFrequently: true,
      });
    }
    if (!this.sharpCanvas) return null;
    if (this.sharpBufferW !== w || this.sharpBufferH !== h) {
      this.sharpCanvas.width = w;
      this.sharpCanvas.height = h;
      this.sharpBufferW = w;
      this.sharpBufferH = h;
      this.sharpCtx = this.sharpCanvas.getContext('2d', {
        willReadFrequently: true,
      });
    }
    if (!this.sharpCtx && this.sharpCanvas) {
      this.sharpCtx = this.sharpCanvas.getContext('2d', {
        willReadFrequently: true,
      });
    }
    return this.sharpCtx;
  }

  private async initialize(): Promise<void> {
    try {
      await this.inputVideo.play();
    } catch {
      // Some browsers reject play() until the element is in the DOM, but the
      // detached element will still produce frames once it has data — fall
      // through and the loop's readiness check will wait for that.
    }

    const filesetResolver = await FilesetResolver.forVisionTasks(VISION_WASM_URL);
    if (this.destroyed) return;

    this.segmenter = await ImageSegmenter.createFromOptions(filesetResolver, {
      baseOptions: {
        modelAssetPath: SEGMENTER_MODEL_URL,
        delegate: 'GPU',
      },
      runningMode: 'VIDEO',
      outputCategoryMask: true,
      outputConfidenceMasks: false,
    });
    if (this.destroyed) {
      this.segmenter.close();
      this.segmenter = null;
      return;
    }

    this.scheduleNextFrame();
  }

  private scheduleNextFrame(): void {
    if (this.destroyed) return;
    this.rafHandle = requestAnimationFrame(() => {
      this.rafHandle = null;
      this.processFrame();
      this.scheduleNextFrame();
    });
  }

  private processFrame(): void {
    if (this.destroyed || !this.segmenter) return;
    const video = this.inputVideo;
    if (
      video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA ||
      video.videoWidth === 0 ||
      video.videoHeight === 0
    ) {
      return;
    }

    if (this.canvas.width !== video.videoWidth) {
      this.canvas.width = video.videoWidth;
    }
    if (this.canvas.height !== video.videoHeight) {
      this.canvas.height = video.videoHeight;
    }

    if (this.effect === 'none') {
      // Pass-through: still composite via canvas so the captureStream output
      // has continuous frames even when the effect is toggled off.
      this.ctx.filter = 'none';
      this.ctx.drawImage(video, 0, 0, this.canvas.width, this.canvas.height);
      return;
    }

    try {
      this.segmenter.segmentForVideo(
        video,
        performance.now(),
        (result: ImageSegmenterResult) => {
          this.compositeBlur(result);
          result.close();
        },
      );
    } catch {
      // Segmentation can throw transiently while a track resizes; fall back
      // to the un-blurred frame so the call doesn't freeze.
      this.ctx.filter = 'none';
      this.ctx.drawImage(video, 0, 0, this.canvas.width, this.canvas.height);
    }
  }

  /**
   * Composite a blurred frame as background and the original (sharp) frame
   * on top, using the segmentation mask to keep only the user's pixels.
   */
  private compositeBlur(result: ImageSegmenterResult): void {
    const { ctx, canvas, inputVideo } = this;
    const w = canvas.width;
    const h = canvas.height;

    // 1. Draw the blurred background.
    ctx.save();
    ctx.filter = `blur(${BACKGROUND_BLUR_PX}px)`;
    ctx.drawImage(inputVideo, 0, 0, w, h);
    ctx.restore();

    const mask = result.categoryMask;
    if (!mask) return;

    // 2. Render the un-blurred frame onto an offscreen buffer, then punch out
    //    background pixels using the mask. The remaining pixels are just the
    //    user, which we stamp on top of the blurred backdrop.
    const sharpCtx = this.ensureSharpLayer(w, h);
    if (!sharpCtx) return;
    sharpCtx.drawImage(inputVideo, 0, 0, w, h);

    const maskData = mask.getAsUint8Array();
    const sharpImage = sharpCtx.getImageData(0, 0, w, h);

    // The selfie segmenter encodes person = 0, background = 255 in the
    // category mask. (The semantics differ between models, so flip the
    // comparison if you swap to a different segmenter.)
    if (maskData.length === sharpImage.data.length / 4) {
      const data = sharpImage.data;
      for (let i = 0; i < maskData.length; i += 1) {
        if (maskData[i] !== 0) {
          // Background pixel — make it transparent so the blurred backdrop
          // shows through when we drawImage this layer.
          data[i * 4 + 3] = 0;
        }
      }
      sharpCtx.putImageData(sharpImage, 0, 0);
      ctx.filter = 'none';
      if (this.sharpCanvas) {
        ctx.drawImage(this.sharpCanvas, 0, 0);
      }
    }
  }
}

/** True when the browser has the APIs we need to run BackgroundProcessor. */
export function isBackgroundEffectSupported(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof HTMLCanvasElement !== 'undefined' &&
    typeof (HTMLCanvasElement.prototype as HTMLCanvasElement).captureStream ===
      'function'
  );
}
