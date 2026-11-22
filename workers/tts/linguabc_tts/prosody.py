"""Prosody measures used to check whether an expression was heard.

There is no reliable automatic "emotion detector", so the expression test
is an A/B comparison: the same sentence, same voice and same seed, spoken
with and without the instruction. A real effect shows up as a change in
pitch level or range, loudness or speed, in the direction the expression
implies (excited: higher and livelier; serious: lower range, slower;
curious: rising at the end). The numbers support a listener's judgement;
they do not replace it.

Pitch is estimated per 40 ms frame with normalised autocorrelation
(70-400 Hz), numpy only.
"""

from __future__ import annotations

from dataclasses import asdict, dataclass

import numpy as np


def pitch_track(audio: np.ndarray, sr: int, fmin: float = 70.0, fmax: float = 400.0,
                frame_s: float = 0.04, hop_s: float = 0.01, voicing: float = 0.5) -> np.ndarray:
    """F0 in Hz per frame; 0 where the frame is unvoiced or quiet."""
    n, hop = int(sr * frame_s), int(sr * hop_s)
    lo, hi = int(sr / fmax), int(sr / fmin)
    if audio.size < n or hi >= n:
        return np.zeros(0)
    peak = float(np.max(np.abs(audio))) or 1.0
    out = []
    for start in range(0, audio.size - n, hop):
        x = audio[start:start + n].astype(np.float64)
        x = x - x.mean()
        if np.sqrt(np.mean(x ** 2)) < 0.02 * peak:
            out.append(0.0)
            continue
        ac = np.correlate(x, x, mode="full")[n - 1:]
        if ac[0] <= 0:
            out.append(0.0)
            continue
        ac = ac / ac[0]
        lag = lo + int(np.argmax(ac[lo:hi]))
        out.append(sr / lag if ac[lag] >= voicing else 0.0)
    return np.asarray(out)


@dataclass
class Prosody:
    seconds: float
    f0_median_hz: float
    f0_range_st: float      # 10th-90th percentile, semitones
    f0_end_rise_st: float   # last 25% of voiced frames vs the rest
    loudness_db: float      # RMS of voiced speech, dBFS
    voiced_ratio: float

    def as_dict(self) -> dict:
        return {k: round(v, 3) for k, v in asdict(self).items()}


def measure(audio: np.ndarray, sr: int) -> Prosody:
    f0 = pitch_track(audio, sr)
    voiced = f0[f0 > 0]
    if voiced.size < 5:
        return Prosody(audio.size / sr, 0.0, 0.0, 0.0, -120.0, 0.0)
    st = 12 * np.log2(voiced / np.median(voiced))
    cut = max(1, int(voiced.size * 0.75))
    end = 12 * np.log2(np.median(voiced[cut:]) / np.median(voiced[:cut])) if voiced.size - cut >= 2 else 0.0
    rms = np.sqrt(np.mean(audio.astype(np.float64) ** 2))
    return Prosody(audio.size / sr, float(np.median(voiced)), float(np.percentile(st, 90) - np.percentile(st, 10)),
                   float(end), float(20 * np.log10(max(rms, 1e-9))), float(voiced.size / max(1, f0.size)))


#: What each tested expression should change, versus the neutral reading.
EXPECTED = {
    "excited": "higher pitch and/or wider range, louder or faster",
    "curious": "rising pitch at the end (question intonation) or wider range",
    "serious": "narrower pitch range and/or slower, not louder",
}


def compare(tag: str, neutral: Prosody, styled: Prosody) -> dict:
    d = {
        "f0_median_change_st": round(12 * np.log2(styled.f0_median_hz / neutral.f0_median_hz), 2) if neutral.f0_median_hz and styled.f0_median_hz else None,
        "f0_range_change_st": round(styled.f0_range_st - neutral.f0_range_st, 2),
        "end_rise_change_st": round(styled.f0_end_rise_st - neutral.f0_end_rise_st, 2),
        "loudness_change_db": round(styled.loudness_db - neutral.loudness_db, 2),
        "duration_change_pct": round(100 * (styled.seconds / neutral.seconds - 1), 1) if neutral.seconds else None,
    }
    m, r, e, l, t = (d["f0_median_change_st"] or 0), d["f0_range_change_st"], d["end_rise_change_st"], d["loudness_change_db"], (d["duration_change_pct"] or 0)
    if tag == "excited":
        moved = m >= 1.0 or r >= 1.5 or l >= 1.5 or t <= -8
    elif tag == "curious":
        moved = e >= 1.0 or r >= 1.5
    elif tag == "serious":
        moved = (r <= -1.0 or t >= 8 or m <= -1.0) and l < 2.0
    else:
        moved = abs(m) >= 1.0 or abs(r) >= 1.5 or abs(l) >= 1.5 or abs(t) >= 8
    return {**d, "expected": EXPECTED.get(tag, "a measurable change"), "measurable_effect": bool(moved)}
