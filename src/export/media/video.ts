// Video export through WebCodecs (browser only). Frames are pushed one by one (never a live recording): each rendered
// RGBA frame becomes a VideoFrame with an exact timestamp i / fps, the encoder output goes straight into the muxer.
// MP4 = H.264 (avc1); WebM = VP9. If H.264 encoding is not available in this browser, "mp4" falls back to WebM/VP9
// and says so (the caller names the file by the returned container).
import { ArrayBufferTarget as Mp4Target, Muxer as Mp4Muxer } from 'mp4-muxer';
import { ArrayBufferTarget as WebmTarget, Muxer as WebmMuxer } from 'webm-muxer';

export type VideoContainer = 'mp4' | 'webm';
export type VideoPlan = { container: VideoContainer; codec: string; muxCodec: 'avc' | 'vp9'; note: string | null };

const H264_CANDIDATES = ['avc1.640034', 'avc1.64002a', 'avc1.640028', 'avc1.4d0034', 'avc1.42e01f'];
const VP9_CANDIDATES = ['vp09.00.51.08', 'vp09.00.41.08', 'vp09.00.31.08', 'vp09.00.10.08'];

function bitrateFor(width: number, height: number, fps: number): number {
  return Math.round(Math.min(40_000_000, Math.max(2_000_000, width * height * fps * 0.25)));
}

/** Finds a codec configuration this browser can encode, or null. */
async function pick(candidates: string[], width: number, height: number, fps: number, extra: Partial<VideoEncoderConfig> = {}): Promise<string | null> {
  if (typeof VideoEncoder === 'undefined') return null;
  for (const codec of candidates) {
    try {
      const r = await VideoEncoder.isConfigSupported({ codec, width, height, bitrate: bitrateFor(width, height, fps), framerate: fps, ...extra });
      if (r.supported) return codec;
    } catch { /* try the next one */ }
  }
  return null;
}

/** Which container/codec `want` will really produce here (mp4 falls back to webm when H.264 cannot be encoded). */
export async function planVideo(want: VideoContainer, width: number, height: number, fps: number): Promise<VideoPlan | { error: string }> {
  if (typeof VideoEncoder === 'undefined' || typeof VideoFrame === 'undefined') return { error: 'This browser has no WebCodecs video encoder (VideoEncoder); use GIF or a PNG sequence instead.' };
  if (want === 'mp4') {
    const h264 = await pick(H264_CANDIDATES, width, height, fps, { avc: { format: 'avc' } });
    if (h264) return { container: 'mp4', codec: h264, muxCodec: 'avc', note: null };
  }
  const vp9 = await pick(VP9_CANDIDATES, width, height, fps);
  if (vp9) return { container: 'webm', codec: vp9, muxCodec: 'vp9', note: want === 'mp4' ? 'H.264 encoding is not available in this browser, so the video is WebM (VP9) instead of MP4.' : null };
  return { error: 'No video codec (H.264 or VP9) can encode this size in this browser; try a smaller size, or GIF / PNG sequence.' };
}

export type VideoSession = { addFrame(rgba: Uint8ClampedArray, index: number): Promise<void>; finish(): Promise<Uint8Array>; abort(): void };

/** Starts an encode; frames must be added in order. Opaque RGBA8 only (video has no alpha here). */
export function startVideo(plan: VideoPlan, width: number, height: number, fps: number): VideoSession {
  const target = plan.container === 'mp4' ? new Mp4Target() : new WebmTarget();
  const muxer = plan.container === 'mp4'
    ? new Mp4Muxer({ target: target as Mp4Target, video: { codec: 'avc', width, height, frameRate: fps }, fastStart: 'in-memory' })
    : new WebmMuxer({ target: target as WebmTarget, video: { codec: 'V_VP9', width, height, frameRate: fps } });
  let failure: Error | null = null;
  const encoder = new VideoEncoder({
    output: (chunk, meta) => { try { (muxer as Mp4Muxer<Mp4Target>).addVideoChunk(chunk, meta); } catch (e) { failure = e instanceof Error ? e : new Error(String(e)); } },
    error: e => { failure = e; },
  });
  encoder.configure({ codec: plan.codec, width, height, bitrate: bitrateFor(width, height, fps), framerate: fps, latencyMode: 'quality', ...(plan.muxCodec === 'avc' ? { avc: { format: 'avc' as const } } : {}) });
  const keyEvery = Math.max(1, Math.round(fps * 2));
  return {
    async addFrame(rgba, index) {
      if (failure) throw failure;
      // Backpressure: a software encoder can fall far behind a fast renderer.
      while (encoder.encodeQueueSize > 8) await new Promise(r => setTimeout(r, 4));
      const frame = new VideoFrame(rgba, { format: 'RGBA', codedWidth: width, codedHeight: height, timestamp: Math.round((index * 1e6) / fps), duration: Math.round(1e6 / fps), colorSpace: { primaries: 'bt709', transfer: 'iec61966-2-1', matrix: 'bt709', fullRange: false } });
      try { encoder.encode(frame, { keyFrame: index % keyEvery === 0 }); } finally { frame.close(); }
    },
    async finish() {
      await encoder.flush();
      if (failure) throw failure;
      encoder.close();
      muxer.finalize();
      return new Uint8Array((target as Mp4Target).buffer);
    },
    abort() { try { encoder.close(); } catch { /* already closed */ } },
  };
}
