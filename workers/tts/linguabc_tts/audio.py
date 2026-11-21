"""Audio assembly: silence, joining, measuring, loudness and MP3 (ffmpeg).

All audio is mono float32 at one sample rate. Pauses are made here (free),
as in the Fish path.
"""

from __future__ import annotations

import json
import re
import shutil
import subprocess

import numpy as np

TARGET_LUFS = -16.0      # spoken-word streaming norm
TRUE_PEAK = -1.5
MP3_RATE = 44100
MP3_BITRATE = "128k"


def silence(seconds: float, sr: int) -> np.ndarray:
    return np.zeros(int(round(max(0.0, seconds) * sr)), dtype=np.float32)


def resample(audio: np.ndarray, sr: int, target: int) -> np.ndarray:
    """Linear resampling, enough to join engines with different rates."""
    if sr == target or audio.size == 0:
        return audio.astype(np.float32, copy=False)
    n = int(round(audio.size * target / sr))
    x = np.linspace(0, audio.size - 1, n)
    return np.interp(x, np.arange(audio.size), audio).astype(np.float32)


def frame_db(audio: np.ndarray, sr: int, frame_s: float = 0.02) -> np.ndarray:
    n = max(1, int(sr * frame_s))
    usable = audio[: audio.size - audio.size % n] if audio.size >= n else np.pad(audio, (0, n - audio.size))
    frames = usable.reshape(-1, n)
    rms = np.sqrt(np.mean(frames.astype(np.float64) ** 2, axis=1))
    return 20 * np.log10(np.maximum(rms, 1e-9))


def trim(audio: np.ndarray, sr: int, threshold_db: float = -45.0, keep_s: float = 0.05) -> np.ndarray:
    """Cuts silence at both ends of a spoken piece; the plan sets the gaps."""
    db = frame_db(audio, sr)
    loud = np.nonzero(db > threshold_db)[0]
    if loud.size == 0:
        return audio[:0]
    n = max(1, int(sr * 0.02))
    keep = int(sr * keep_s)
    start = max(0, loud[0] * n - keep)
    end = min(audio.size, (loud[-1] + 1) * n + keep)
    return audio[start:end]


def clipping_ratio(audio: np.ndarray, limit: float = 0.999) -> float:
    return float(np.mean(np.abs(audio) >= limit)) if audio.size else 0.0


def longest_silence(audio: np.ndarray, sr: int, threshold_db: float = -45.0) -> float:
    """Longest run of silence inside a spoken piece, in seconds."""
    quiet = frame_db(audio, sr) <= threshold_db
    best = run = 0
    for q in quiet:
        run = run + 1 if q else 0
        best = max(best, run)
    return best * 0.02


def _ffmpeg() -> str:
    path = shutil.which("ffmpeg")
    if not path:
        raise RuntimeError("ffmpeg is required")
    return path


def _run(args: list[str], data: bytes) -> subprocess.CompletedProcess:
    return subprocess.run([_ffmpeg(), "-hide_banner", "-nostdin", *args], input=data, capture_output=True, check=True)


def measure_loudness(audio: np.ndarray, sr: int) -> dict:
    """EBU R128 integrated loudness and true peak (ffmpeg loudnorm, analysis pass)."""
    proc = _run(["-f", "f32le", "-ar", str(sr), "-ac", "1", "-i", "pipe:0",
                 "-af", f"loudnorm=I={TARGET_LUFS}:TP={TRUE_PEAK}:LRA=11:print_format=json", "-f", "null", "-"],
                audio.astype(np.float32).tobytes())
    found = re.findall(r"\{[^{}]*\"input_i\"[^{}]*\}", proc.stderr.decode("utf-8", "replace"))
    if not found:
        raise RuntimeError("could not measure loudness")
    m = json.loads(found[-1])
    return {k: float(m[k]) for k in ("input_i", "input_tp", "input_lra", "input_thresh", "target_offset")}


def normalize_loudness(audio: np.ndarray, sr: int) -> tuple[np.ndarray, dict]:
    """Two-pass linear loudnorm: one gain for the whole recording, pauses stay silent."""
    m = measure_loudness(audio, sr)
    proc = _run(["-f", "f32le", "-ar", str(sr), "-ac", "1", "-i", "pipe:0",
                 "-af", (f"loudnorm=I={TARGET_LUFS}:TP={TRUE_PEAK}:LRA=11:linear=true:"
                         f"measured_I={m['input_i']}:measured_TP={m['input_tp']}:measured_LRA={m['input_lra']}:"
                         f"measured_thresh={m['input_thresh']}:offset={m['target_offset']}"),
                 "-ar", str(sr), "-f", "f32le", "pipe:1"], audio.astype(np.float32).tobytes())
    out = np.frombuffer(proc.stdout, dtype=np.float32)
    # loudnorm may pad; keep the planned length.
    out = out[: audio.size] if out.size >= audio.size else np.pad(out, (0, audio.size - out.size))
    return out.copy(), m


def encode_mp3(audio: np.ndarray, sr: int, bitrate: str = MP3_BITRATE) -> bytes:
    """Constant-bitrate mono MP3 without tags, byte-identical for identical input."""
    proc = _run(["-f", "f32le", "-ar", str(sr), "-ac", "1", "-i", "pipe:0",
                 "-ar", str(MP3_RATE), "-ac", "1", "-codec:a", "libmp3lame", "-b:a", bitrate,
                 "-id3v2_version", "0", "-write_id3v1", "0", "-map_metadata", "-1",
                 "-fflags", "+bitexact", "-flags:a", "+bitexact", "-f", "mp3", "pipe:1"],
                audio.astype(np.float32).tobytes())
    return proc.stdout


def decode_mp3(data: bytes, sr: int) -> np.ndarray:
    proc = _run(["-f", "mp3", "-i", "pipe:0", "-ar", str(sr), "-ac", "1", "-f", "f32le", "pipe:1"], data)
    return np.frombuffer(proc.stdout, dtype=np.float32).copy()
