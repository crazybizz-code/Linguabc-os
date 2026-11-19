/**
 * Just enough MPEG audio (Layer III) parsing to check what a TTS service
 * returned, measure it, and join several clips into one file.
 *
 * No decoding: frames are found from their headers, so a file is accepted
 * only if it is a clean run of MP3 frames (an ID3 tag in front and a tag at
 * the end are allowed). Xing/Info/VBRI header frames are dropped, because
 * after joining clips they would report the wrong length.
 */

const BITRATES_V1 = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320];
const BITRATES_V2 = [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160];
const RATES: Record<number, number[]> = { 3: [44100, 48000, 32000], 2: [22050, 24000, 16000], 0: [11025, 12000, 8000] };

export class InvalidAudio extends Error {}

type Header = { version: number; sampleRate: number; bitrate: number; size: number; samples: number; mono: boolean };

function header(b: Uint8Array, i: number): Header | null {
  if (i + 4 > b.length || b[i] !== 0xff || (b[i + 1] & 0xe0) !== 0xe0) return null;
  const version = (b[i + 1] >> 3) & 3; // 3 = MPEG1, 2 = MPEG2, 0 = MPEG2.5
  const layer = (b[i + 1] >> 1) & 3; // 1 = Layer III
  const brIdx = b[i + 2] >> 4;
  const srIdx = (b[i + 2] >> 2) & 3;
  if (version === 1 || layer !== 1 || brIdx === 0 || brIdx === 15 || srIdx === 3) return null;
  const bitrate = (version === 3 ? BITRATES_V1 : BITRATES_V2)[brIdx] * 1000;
  const sampleRate = RATES[version][srIdx];
  const padding = (b[i + 2] >> 1) & 1;
  const size = Math.floor(((version === 3 ? 144 : 72) * bitrate) / sampleRate) + padding;
  return { version, sampleRate, bitrate, size, samples: version === 3 ? 1152 : 576, mono: (b[i + 3] >> 6) === 3 };
}

function id3Length(b: Uint8Array) {
  if (b.length < 10 || b[0] !== 0x49 || b[1] !== 0x44 || b[2] !== 0x33) return 0; // "ID3"
  const size = ((b[6] & 0x7f) << 21) | ((b[7] & 0x7f) << 14) | ((b[8] & 0x7f) << 7) | (b[9] & 0x7f);
  return 10 + size + (b[5] & 0x10 ? 10 : 0);
}

function isInfoFrame(b: Uint8Array, start: number, size: number) {
  const s = Buffer.from(b.subarray(start, start + Math.min(size, 64))).toString("latin1");
  return s.includes("Xing") || s.includes("Info") || s.includes("VBRI");
}

export type Mp3 = {
  /** Audio frames only: no tags, no Xing/Info frame. */
  frames: Buffer;
  durationMs: number;
  sampleRate: number;
  version: number;
  mono: boolean;
  /** A frame header to copy for silence. */
  template: Uint8Array;
};

export function parseMp3(input: Uint8Array): Mp3 {
  const b = input;
  let i = id3Length(b);
  if (i >= b.length) throw new InvalidAudio("The audio is empty.");
  const kept: Buffer[] = [];
  let samples = 0, first: Header | null = null, template: Uint8Array | null = null, n = 0;
  while (i < b.length) {
    const h = header(b, i);
    if (!h || i + h.size > b.length) break;
    if (!first) first = h;
    else if (h.sampleRate !== first.sampleRate || h.version !== first.version) throw new InvalidAudio("The audio changes format part-way.");
    if (!(n === 0 && isInfoFrame(b, i + 4, h.size - 4))) {
      kept.push(Buffer.from(b.subarray(i, i + h.size)));
      samples += h.samples;
      template ??= b.slice(i, i + 4);
    }
    i += h.size;
    n++;
  }
  if (!first || !template || samples === 0) throw new InvalidAudio("The audio is not a valid MP3 file.");
  // Allow a trailing ID3v1 / APE tag, nothing else.
  const rest = b.length - i;
  if (rest > 512 && rest > b.length * 0.02) throw new InvalidAudio("The audio is not a clean MP3 file.");
  return {
    frames: Buffer.concat(kept),
    durationMs: Math.round((samples / first.sampleRate) * 1000),
    sampleRate: first.sampleRate,
    version: first.version,
    mono: first.mono,
    template,
  };
}

/**
 * Silent frames in the clip's own format: a Layer III frame whose side
 * information and main data are all zero decodes to silence.
 */
export function silence(like: Mp3, ms: number): Buffer {
  const head = Uint8Array.from(like.template);
  head[2] &= ~0x02; // no padding
  head[1] |= 0x01; // no CRC
  const h = header(head, 0)!;
  const count = Math.ceil((ms / 1000) * (h.sampleRate / h.samples));
  const frame = Buffer.alloc(h.size);
  frame.set(head, 0);
  return Buffer.concat(Array.from({ length: count }, () => frame));
}

/** Joins clips of the same format, with a pause between them. */
export function joinMp3(clips: Mp3[], pauseMs: number): Mp3 {
  if (clips.length === 0) throw new InvalidAudio("Nothing to join.");
  const a = clips[0];
  for (const c of clips) {
    if (c.sampleRate !== a.sampleRate || c.version !== a.version || c.mono !== a.mono) throw new InvalidAudio("The audio clips have different formats.");
  }
  const gap = pauseMs > 0 ? silence(a, pauseMs) : Buffer.alloc(0);
  const parts: Buffer[] = [];
  clips.forEach((c, k) => { if (k > 0) parts.push(gap); parts.push(c.frames); });
  const frames = Buffer.concat(parts);
  const gapMs = gap.length ? parseMp3(gap).durationMs : 0;
  return { ...a, frames, durationMs: clips.reduce((s, c) => s + c.durationMs, 0) + gapMs * (clips.length - 1) };
}
