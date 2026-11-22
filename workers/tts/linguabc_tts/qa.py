"""Automatic QA for IELTS listening audio.

What is checked for every spoken segment:
  * transcript accuracy: ASR text vs the script, as word error rate (WER);
  * critical spans: numbers, dates, money, times and spelled-out words
    (S-M-Y-T-H-E) must all be heard, since they are what IELTS answers are;
  * answer-bearing words (from the answer key, when sent) across the whole
    recording;
  * clipping, long silences inside speech, and speaking rate (a segment far
    too fast or slow usually means skipped or repeated words);
  * speaker consistency, when a speaker embedder is available.

Passing these checks does not prove the audio is professional: accent,
naturalness and expression still need a person to listen (the report always
says manual_review_required).

Text is compared after normalisation: lower case, no punctuation, numbers
as words ("£12.50" -> "twelve pounds fifty", "23rd" -> "twenty third"),
"double three" -> "three three", and spelled letters joined
("S-M-Y-T-H-E", "S M Y T H E" -> "smythe").
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Protocol

import numpy as np

from .expressions import strip_tags

_ONES = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve",
         "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen"]
_TENS = ["", "", "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety"]
_ORD = {"one": "first", "two": "second", "three": "third", "five": "fifth", "eight": "eighth", "nine": "ninth",
        "twelve": "twelfth", "twenty": "twentieth", "thirty": "thirtieth", "forty": "fortieth", "fifty": "fiftieth",
        "sixty": "sixtieth", "seventy": "seventieth", "eighty": "eightieth", "ninety": "ninetieth"}
MONTHS = {"january", "february", "march", "april", "may", "june", "july", "august", "september", "october",
          "november", "december"}
_CURRENCY = {"£": ("pound", "pounds", "pence"), "$": ("dollar", "dollars", "cents"), "€": ("euro", "euros", "cents")}


def number_words(n: int) -> str:
    if n < 0:
        return "minus " + number_words(-n)
    if n < 20:
        return _ONES[n]
    if n < 100:
        return _TENS[n // 10] + ("" if n % 10 == 0 else " " + _ONES[n % 10])
    if n < 1000:
        return _ONES[n // 100] + " hundred" + ("" if n % 100 == 0 else " " + number_words(n % 100))
    for size, word in ((10**9, "billion"), (10**6, "million"), (1000, "thousand")):
        if n >= size:
            return number_words(n // size) + " " + word + ("" if n % size == 0 else " " + number_words(n % size))
    raise ValueError(n)


def ordinal_words(n: int) -> str:
    words = number_words(n).split()
    last = words[-1]
    words[-1] = _ORD.get(last, last + "th")
    return " ".join(words)


def _digits(s: str) -> str:
    """Long digit strings (phone numbers, codes) are read digit by digit."""
    return " ".join(_ONES[int(c)] for c in s)


def _expand_numbers(t: str) -> str:
    def money(m: re.Match) -> str:
        one, many, small = _CURRENCY[m.group(1)]
        whole = int(m.group(2).replace(",", ""))
        out = f"{number_words(whole)} {one if whole == 1 else many}"
        if m.group(3) and int(m.group(3)):
            out += f" {number_words(int(m.group(3)))}"
        return f" {out} "

    # Phone-like sequences ("07793 461 258") are read digit by digit, every group.
    t = re.sub(r"\b0\d+(?:[\s,-]+\d+)+\b", lambda m: " " + " ".join(_digits(g) for g in re.findall(r"\d+", m.group(0))) + " ", t)
    t = re.sub(r"([£$€])\s?(\d[\d,]*)(?:\.(\d{2}))?", money, t)
    t = re.sub(r"\b(\d{1,2}):(\d{2})\b", lambda m: f" {number_words(int(m.group(1)))} " + (
        "o'clock" if m.group(2) == "00" else ("oh " + number_words(int(m.group(2))) if m.group(2)[0] == "0" else number_words(int(m.group(2))))) + " ", t)
    t = re.sub(r"\b(\d+)(st|nd|rd|th)\b", lambda m: f" {ordinal_words(int(m.group(1)))} ", t)
    t = re.sub(r"\b(\d+)\.(\d+)\b", lambda m: f" {number_words(int(m.group(1)))} point {_digits(m.group(2))} ", t)
    t = re.sub(r"\b(\d+)%", lambda m: f" {number_words(int(m.group(1)))} percent ", t)
    t = re.sub(r"\b\d{1,3}(?:,\d{3})+\b", lambda m: f" {number_words(int(m.group(0).replace(',', '')))} ", t)
    t = re.sub(r"\b\d+\b", lambda m: f" {_digits(m.group(0)) if len(m.group(0)) > 4 or m.group(0).startswith('0') else number_words(int(m.group(0)))} ", t)
    return t


#: Words the app respells for the voice (src/lib/ai/script.ts, SAY): ASR hears the real word.
RESPELLED = {("eye", "elts"): "ielts"}
#: Same word, different spelling: what the script writes vs what ASR tends to write.
ALIASES = {"eyeelts": "ielts", "ms": "miss", "okay": "ok", "mr": "mister", "dr": "doctor", "colour": "color", "centre": "center",
           "theatre": "theater", "metre": "meter", "programme": "program", "travelling": "traveling"}
_NUMBER_WORDS = set(_ONES) | set(_TENS[2:]) | {"hundred", "thousand", "million", "billion"} | set(_ORD.values())


def normalize(text: str) -> list[str]:
    t = strip_tags(text)
    t = re.sub(r"\b([A-Za-z])(?:-(?=[A-Za-z]\b)|\.(?=\s*[A-Za-z]\b))", r"\1 ", t)  # S-M-I-T-H, S.M.I.T.H.
    t = _expand_numbers(t)
    t = t.lower().replace("’", "'")
    # Compounds are one word ("check-out" = "checkout"); number words stay apart ("twenty-third").
    t = re.sub(r"\b([a-z]{2,})-(?=([a-z]{2,})\b)", lambda m: m.group(1) + (" " if m.group(1) in _NUMBER_WORDS or m.group(2) in _NUMBER_WORDS else ""), t)
    t = re.sub(r"[^a-z0-9' ]+", " ", t.replace("-", " "))
    words = [w.strip("'") for w in t.split()]
    words = [ALIASES.get(w, w) for w in words if w]
    out: list[str] = []
    i = 0
    while i < len(words):
        w = words[i]
        # "a hundred and ninety" = "one hundred ninety"
        if w == "a" and i + 1 < len(words) and words[i + 1] in ("hundred", "thousand", "million"):
            out.append("one")
            i += 1
            continue
        if w == "and" and out and out[-1] in _NUMBER_WORDS and i + 1 < len(words) and words[i + 1] in _NUMBER_WORDS:
            i += 1
            continue
        if w in ("double", "triple") and i + 1 < len(words) and words[i + 1] in _ONES[:10]:
            out += [words[i + 1]] * (2 if w == "double" else 3)
            i += 2
            continue
        if w in ("oh", "o") and out and (out[-1] in _ONES[:10] or (i + 1 < len(words) and words[i + 1] in _ONES[:10])):
            out.append("zero")
            i += 1
            continue
        out.append(w)
        i += 1
    for (a, b), word in RESPELLED.items():
        i = 0
        while i < len(out) - 1:
            if out[i] == a and out[i + 1] == b:
                out[i:i + 2] = [word]
            i += 1
    # Join runs of single letters (spelling), keep "a" and "i" when alone.
    joined: list[str] = []
    run: list[str] = []
    for w in out + [""]:
        if len(w) == 1 and w.isalpha():
            run.append(w)
            continue
        if len(run) >= 2:
            joined.append("".join(run))
        else:
            joined += run
        run = []
        if w:
            joined.append(w)
    return joined


def word_errors(ref: list[str], hyp: list[str]) -> int:
    prev = list(range(len(hyp) + 1))
    for i, r in enumerate(ref, 1):
        cur = [i] + [0] * len(hyp)
        for j, h in enumerate(hyp, 1):
            cur[j] = min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (r != h))
        prev = cur
    return prev[-1]


def wer(reference: str, hypothesis: str) -> float:
    ref, hyp = normalize(reference), normalize(hypothesis)
    if not ref:
        return 0.0 if not hyp else 1.0
    return word_errors(ref, hyp) / len(ref)


@dataclass(frozen=True)
class Span:
    kind: str  # number | date | money | time | spelling
    text: str


_SPANS = [
    ("money", re.compile(r"[£$€]\s?\d[\d,]*(?:\.\d{2})?")),
    ("date", re.compile(r"\b\d{1,2}(?:st|nd|rd|th)?\s+(?:of\s+)?(?:" + "|".join(MONTHS) + r")\b|\b(?:" + "|".join(MONTHS) + r")\s+\d{1,2}(?:st|nd|rd|th)?\b", re.I)),
    ("time", re.compile(r"\b\d{1,2}:\d{2}\b|\b\d{1,2}\s?(?:am|pm|a\.m\.|p\.m\.)", re.I)),
    ("spelling", re.compile(r"\b[A-Za-z](?:-[A-Za-z]){2,}\b")),
    ("number", re.compile(r"\b\d[\d,.]*(?:st|nd|rd|th|%)?")),
]


def critical_spans(text: str) -> list[Span]:
    """Numbers, dates, money, times and spellings in a script line, without overlaps."""
    taken: list[tuple[int, int]] = []
    spans: list[tuple[int, Span]] = []
    plain = strip_tags(text)
    for kind, rx in _SPANS:
        for m in rx.finditer(plain):
            if any(m.start() < b and a < m.end() for a, b in taken):
                continue
            taken.append((m.start(), m.end()))
            spans.append((m.start(), Span(kind, m.group(0).strip(" .,"))))
    return [s for _, s in sorted(spans, key=lambda x: x[0])]


def contains(haystack: list[str], needle: list[str]) -> bool:
    if not needle:
        return True
    n = len(needle)
    return any(haystack[i:i + n] == needle for i in range(len(haystack) - n + 1))


def missing_spans(reference: str, hypothesis: str) -> list[Span]:
    heard = normalize(hypothesis)
    return [s for s in critical_spans(reference) if not contains(heard, normalize(s.text))]


def missing_answers(answers: list[list[str]], transcript: str) -> list[list[str]]:
    """Answers (each with accepted variants) not heard anywhere in the recording."""
    heard = normalize(transcript)
    return [variants for variants in answers if not any(contains(heard, normalize(v)) for v in variants)]


def _doubled(words: list[str], n: int) -> set[tuple[str, ...]]:
    return {tuple(words[i:i + n]) for i in range(len(words) - 2 * n + 1) if words[i:i + n] == words[i + n:i + 2 * n]}


def repeated_phrases(reference: str, hypothesis: str) -> list[str]:
    """Phrases said twice in a row that the script says once: the voice looped
    (seen on real Qwen audio: "full of smoke. of smoke.")."""
    ref, hyp = normalize(reference), normalize(hypothesis)
    found = []
    for n in (4, 3, 2):
        for gram in sorted(_doubled(hyp, n) - _doubled(ref, n)):
            if not any(" ".join(gram) in f for f in found):
                found.append(" ".join(gram))
    return found


def words_per_minute(text: str, seconds: float) -> float:
    return len(normalize(text)) / (seconds / 60) if seconds > 0 else 0.0


class Transcriber(Protocol):
    def transcribe(self, audio: np.ndarray, sr: int, language: str) -> str: ...


class FasterWhisperTranscriber:
    """faster-whisper (MIT), greedy and deterministic: temperature 0, no context carry-over."""

    def __init__(self, model: str = "large-v3", device: str | None = None):
        from faster_whisper import WhisperModel

        if device is None:
            try:
                import torch
                device = "cuda" if torch.cuda.is_available() else "cpu"
            except ImportError:
                device = "cpu"
        import os

        self.model = WhisperModel(model, device=device, compute_type="float16" if device == "cuda" else "int8",
                                  cpu_threads=os.cpu_count() or 1)

    def transcribe(self, audio, sr, language):
        from .audio import resample

        segments, _ = self.model.transcribe(resample(audio, sr, 16000), language="en" if language in ("English", "Auto") else None,
                                            beam_size=5, temperature=0.0, condition_on_previous_text=False, vad_filter=False,
                                            word_timestamps=True)
        segments = list(segments)
        # Word confidence: a low one often marks a mispronounced or slurred word.
        self.last_words = [(w.word.strip(), round(float(w.probability), 3)) for s in segments for w in (s.words or [])]
        return " ".join(s.text.strip() for s in segments).strip()


class FakeTranscriber:
    """Reads back what FakeEngine said into each clip."""

    def __init__(self, engine):
        self.engine = engine

    def transcribe(self, audio, sr, language):
        from .engines import clip_id

        return self.engine.registry.get(clip_id(audio), "")


class SpeakerEmbedder(Protocol):
    def embed(self, audio: np.ndarray, sr: int) -> np.ndarray: ...


class ResemblyzerEmbedder:
    """Speaker embeddings from Resemblyzer (MIT, weights ship with the package, CPU is fine)."""

    def __init__(self):
        from resemblyzer import VoiceEncoder

        self.encoder = VoiceEncoder("cpu", verbose=False)

    def embed(self, audio, sr):
        from resemblyzer import preprocess_wav

        from .audio import resample

        return self.encoder.embed_utterance(preprocess_wav(resample(audio, sr, 16000), source_sr=16000))


def cross_similarity(a: list[np.ndarray], b: list[np.ndarray]) -> float | None:
    """Cosine similarity between two voices' average embeddings (lower = easier to tell apart)."""
    if not a or not b:
        return None
    ca, cb = (np.mean([v / (np.linalg.norm(v) + 1e-9) for v in vs], axis=0) for vs in (a, b))
    return float(ca @ cb / ((np.linalg.norm(ca) * np.linalg.norm(cb)) + 1e-9))


def speaker_consistency(embeddings: dict[str, list[np.ndarray]]) -> dict[str, float | None]:
    """Lowest cosine similarity of a voice's segments to that voice's average."""
    out: dict[str, float | None] = {}
    for voice, vecs in embeddings.items():
        if len(vecs) < 2:
            out[voice] = None
            continue
        m = np.stack([v / (np.linalg.norm(v) + 1e-9) for v in vecs])
        centre = m.mean(axis=0)
        centre /= np.linalg.norm(centre) + 1e-9
        out[voice] = float(np.min(m @ centre))
    return out
