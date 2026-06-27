// μ-law (G.711) encode/decode + linear PCM resamplers between 8kHz, 16kHz, and 24kHz.
// Used to bridge Twilio Media Streams (8kHz μ-law) and Gemini Live (16kHz in / 24kHz out, linear PCM s16le).

const BIAS = 0x84;
const CLIP = 32635;

export function mulawDecodeByte(ulaw: number): number {
  ulaw = ~ulaw & 0xff;
  const sign = ulaw & 0x80;
  const exponent = (ulaw >> 4) & 0x07;
  const mantissa = ulaw & 0x0f;
  let sample = ((mantissa << 3) + BIAS) << exponent;
  sample -= BIAS;
  return sign ? -sample : sample;
}

export function mulawEncodeSample(sample: number): number {
  let sign = 0;
  if (sample < 0) {
    sample = -sample;
    sign = 0x80;
  }
  if (sample > CLIP) sample = CLIP;
  sample += BIAS;
  let exponent = 7;
  for (let mask = 0x4000; (sample & mask) === 0 && exponent > 0; mask >>= 1) {
    exponent--;
  }
  const mantissa = (sample >> (exponent + 3)) & 0x0f;
  return ~(sign | (exponent << 4) | mantissa) & 0xff;
}

// μ-law buffer → 16-bit linear PCM Buffer (little-endian)
export function mulawDecode(mulaw: Buffer): Buffer {
  const out = Buffer.alloc(mulaw.length * 2);
  for (let i = 0; i < mulaw.length; i++) {
    const s = mulawDecodeByte(mulaw[i]);
    out.writeInt16LE(s, i * 2);
  }
  return out;
}

// 16-bit linear PCM Buffer (little-endian) → μ-law buffer
export function mulawEncode(pcm: Buffer): Buffer {
  const samples = pcm.length / 2;
  const out = Buffer.alloc(samples);
  for (let i = 0; i < samples; i++) {
    out[i] = mulawEncodeSample(pcm.readInt16LE(i * 2));
  }
  return out;
}

// 8kHz → 16kHz: 2× linear interpolation (mono, s16le)
export function upsample8to16(pcm8k: Buffer): Buffer {
  const inSamples = pcm8k.length / 2;
  const out = Buffer.alloc(inSamples * 2 * 2);
  for (let i = 0; i < inSamples; i++) {
    const a = pcm8k.readInt16LE(i * 2);
    const b = i + 1 < inSamples ? pcm8k.readInt16LE((i + 1) * 2) : a;
    out.writeInt16LE(a, i * 4);
    out.writeInt16LE((a + b) >> 1, i * 4 + 2);
  }
  return out;
}

// 24kHz → 8kHz: 3:1 average decimation (mono, s16le). Sufficient quality for telephony.
export function downsample24to8(pcm24k: Buffer): Buffer {
  const inSamples = pcm24k.length / 2;
  const outSamples = Math.floor(inSamples / 3);
  const out = Buffer.alloc(outSamples * 2);
  for (let i = 0; i < outSamples; i++) {
    const a = pcm24k.readInt16LE(i * 6);
    const b = pcm24k.readInt16LE(i * 6 + 2);
    const c = pcm24k.readInt16LE(i * 6 + 4);
    out.writeInt16LE(((a + b + c) / 3) | 0, i * 2);
  }
  return out;
}

// Chunk a buffer into N-byte pieces (last piece may be short).
export function chunkBuffer(buf: Buffer, chunkSize: number): Buffer[] {
  const chunks: Buffer[] = [];
  for (let i = 0; i < buf.length; i += chunkSize) {
    chunks.push(buf.slice(i, Math.min(i + chunkSize, buf.length)));
  }
  return chunks;
}
