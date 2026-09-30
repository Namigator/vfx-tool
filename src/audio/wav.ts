// Canonical PCM16 stereo RIFF/WAVE encoder (plan11 "WAV export"). Pure; returns bytes only.
import { MIX_SAMPLE_RATE } from './mix.ts';

export const WAV_CHANNELS = 2;
export const WAV_BITS_PER_SAMPLE = 16;
export const WAV_BLOCK_ALIGN = WAV_CHANNELS * (WAV_BITS_PER_SAMPLE / 8); // 4
export const WAV_HEADER_BYTES = 44;
/** RIFF size fields are uint32; cap so the data chunk and RIFF length both fit. */
export const MAX_WAV_FRAMES = Math.floor((0xffffffff - 36) / WAV_BLOCK_ALIGN);

/** Deterministic symmetric clipping: clamp to [-1,1], scale by 32767, round half away from zero. */
export function floatToPcm16(x: number): number {
  if (!Number.isFinite(x)) throw new RangeError('sample must be finite.');
  const c = x > 1 ? 1 : x < -1 ? -1 : x;
  const v = c * 32767;
  return v < 0 ? -Math.round(-v) : Math.round(v);
}

function writeAscii(view: DataView, offset: number, text: string): void {
  for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i));
}

export function encodeWavPcm16Stereo(left: Float32Array, right: Float32Array, sampleRate = MIX_SAMPLE_RATE): Uint8Array {
  if (!(left instanceof Float32Array) || !(right instanceof Float32Array)) throw new TypeError('channels must be Float32Array.');
  if (left.length !== right.length) throw new RangeError('channel lengths differ.');
  if (!Number.isInteger(sampleRate) || sampleRate < 1 || sampleRate > 384000) throw new RangeError('sampleRate is invalid.');
  const frames = left.length;
  if (frames > MAX_WAV_FRAMES) throw new RangeError('audio too long for RIFF/WAVE.');
  const dataBytes = frames * WAV_BLOCK_ALIGN;
  const bytes = new Uint8Array(WAV_HEADER_BYTES + dataBytes);
  const view = new DataView(bytes.buffer);
  writeAscii(view, 0, 'RIFF');
  view.setUint32(4, 36 + dataBytes, true);
  writeAscii(view, 8, 'WAVE');
  writeAscii(view, 12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, WAV_CHANNELS, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * WAV_BLOCK_ALIGN, true);
  view.setUint16(32, WAV_BLOCK_ALIGN, true);
  view.setUint16(34, WAV_BITS_PER_SAMPLE, true);
  writeAscii(view, 36, 'data');
  view.setUint32(40, dataBytes, true);
  let o = WAV_HEADER_BYTES;
  for (let n = 0; n < frames; n++) {
    view.setInt16(o, floatToPcm16(left[n]), true);
    view.setInt16(o + 2, floatToPcm16(right[n]), true);
    o += WAV_BLOCK_ALIGN;
  }
  return bytes;
}
