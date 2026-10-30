// RIFF/WAVE decoding for sample sources (plan11 "Sample source", T18 header checks). Pure: bytes in, mono float PCM out.
// Accepts PCM 8/16/24/32-bit and IEEE float 32, 1-8 channels (mixed down to mono), any rate (resampled linearly to
// 48 kHz). Rejects anything else with a reason instead of guessing.
export const SAMPLE_RATE_OUT = 48000;
/** Longest accepted sound (seconds): library sounds are short one-shots and beds. */
export const MAX_SAMPLE_SECONDS = 30;

export type DecodedWav = { sampleRate: number; channels: number; bitsPerSample: number; format: 'pcm' | 'float'; data: Float32Array };

/** Decodes a WAV file to mono float at its own rate, or returns an error message. */
export function decodeWav(bytes: Uint8Array): DecodedWav | string {
  if (bytes.length < 44) return 'File is too short to be a WAV.';
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength), tag = (o: number) => String.fromCharCode(bytes[o], bytes[o + 1], bytes[o + 2], bytes[o + 3]);
  if (tag(0) !== 'RIFF' || tag(8) !== 'WAVE') return 'Not a RIFF/WAVE file.';
  let fmt: { format: number; channels: number; rate: number; bits: number } | undefined, dataAt = -1, dataLen = 0;
  for (let o = 12; o + 8 <= bytes.length;) {
    const id = tag(o), len = v.getUint32(o + 4, true);
    if (id === 'fmt ') {
      let format = v.getUint16(o + 8, true);
      if (format === 0xfffe && len >= 26) format = v.getUint16(o + 32, true); // WAVE_FORMAT_EXTENSIBLE: sub-format GUID
      fmt = { format, channels: v.getUint16(o + 10, true), rate: v.getUint32(o + 12, true), bits: v.getUint16(o + 22, true) };
    } else if (id === 'data') { dataAt = o + 8; dataLen = Math.min(len, bytes.length - dataAt); break; }
    o += 8 + len + (len & 1);
  }
  if (!fmt) return 'WAV has no fmt chunk.';
  if (dataAt < 0) return 'WAV has no data chunk.';
  const { format, channels, rate, bits } = fmt;
  if (format !== 1 && format !== 3) return `Unsupported WAV encoding ${format} (PCM or IEEE float only).`;
  if (format === 3 && bits !== 32) return `Unsupported float WAV bit depth ${bits}.`;
  if (format === 1 && ![8, 16, 24, 32].includes(bits)) return `Unsupported PCM bit depth ${bits}.`;
  if (channels < 1 || channels > 8) return `Unsupported channel count ${channels}.`;
  if (rate < 8000 || rate > 192000) return `Unsupported sample rate ${rate}.`;
  const step = bits / 8, frames = Math.floor(dataLen / (step * channels));
  if (frames / rate > MAX_SAMPLE_SECONDS) return `Sound is longer than ${MAX_SAMPLE_SECONDS} s.`;
  const read = (o: number): number => format === 3 ? v.getFloat32(o, true)
    : bits === 8 ? (bytes[o] - 128) / 128 : bits === 16 ? v.getInt16(o, true) / 32768
      : bits === 24 ? ((bytes[o] | (bytes[o + 1] << 8) | (bytes[o + 2] << 16)) << 8 >> 8) / 8388608 : v.getInt32(o, true) / 2147483648;
  const data = new Float32Array(frames);
  for (let i = 0; i < frames; i++) {
    let s = 0;
    for (let c = 0; c < channels; c++) s += read(dataAt + (i * channels + c) * step);
    data[i] = s / channels;
  }
  return { sampleRate: rate, channels, bitsPerSample: bits, format: format === 3 ? 'float' : 'pcm', data };
}

/** Linear resampling to 48 kHz (identity when already 48 kHz). */
export function to48k(d: DecodedWav): Float32Array {
  if (d.sampleRate === SAMPLE_RATE_OUT) return d.data;
  const n = Math.max(2, Math.round(d.data.length * SAMPLE_RATE_OUT / d.sampleRate)), out = new Float32Array(n), r = d.sampleRate / SAMPLE_RATE_OUT;
  for (let i = 0; i < n; i++) { const p = i * r, j = Math.min(d.data.length - 2, Math.floor(p)), f = p - j; out[i] = d.data[j] + (d.data[j + 1] - d.data[j]) * f; }
  return out;
}
