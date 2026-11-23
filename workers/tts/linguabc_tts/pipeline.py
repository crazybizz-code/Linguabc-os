"""Render a plan into one MP3 with a QA report.

For every speech item:
  1. cut it at expression tags (expressions.split_expressions);
  2. for each piece, hash (provider, model, voice, expression, text, all
     settings incl. the instruction, scope) and reuse a verified cached clip;
  3. otherwise speak it with a seed derived from the hash, transcribe it,
     and accept it only if its WER and critical spans pass; else try again
     with the next seed, up to max_attempts. Accepted clips are cached at
     once, so a failure elsewhere never loses them;
then join everything with the planned pauses, apply one loudness gain to
the whole recording, check it, and encode MP3.

If any piece still fails, the job fails (status "failed") with the reasons,
and a retry of the same request only speaks the failed pieces.
"""

from __future__ import annotations

import re
import time
from dataclasses import dataclass, field

import numpy as np

from . import audio as A
from .cache import SegmentCache
from .engines import Engine
from .expressions import split_expressions, strip_tags
from .hashing import segment_hash
from .plan import Pause, RenderRequest, Speech
from .spoken import to_spoken
from .lexicon import LEXICON_VERSION, respell
from .qa import (Transcriber, SpeakerEmbedder, critical_spans, missing_answers, repeated_phrases, missing_spans, speaker_consistency, wer,
                 words_per_minute)


@dataclass(frozen=True)
class QaConfig:
    segment_wer_max: float = 0.10     # one slip in a 10-word line is retried
    job_wer_max: float = 0.03
    clipping_max: float = 0.001
    silence_max_s: float = 1.2       # inside one spoken piece
    wpm_min: float = 90
    wpm_max: float = 220
    wpm_hard_min: float = 60
    wpm_hard_max: float = 330
    min_words_for_rate: int = 5
    speaker_similarity_min: float = 0.80
    max_attempts: int = 3
    piece_gap_s: float = 0.12        # between expression pieces of one turn
    # Long generations tend to loop at the end (seen on real Qwen audio), so a
    # long piece is spoken sentence by sentence, up to this many words per call.
    max_words_per_call: int = 30
    sentence_gap_s: float = 0.28
    unclear_word_p: float = 0.5      # ASR word probability below this is flagged (not failed)
    # Benchmarks only: still join the recording when segments fail (using their last take),
    # so people can listen to what went wrong. The status stays "failed".
    assemble_failed: bool = False


@dataclass
class PieceReport:
    item: int
    voice: str
    text: str
    expression: str | None
    support: str | None
    instruct: str | None
    hash: str
    cached: bool
    attempts: int = 0
    wer: float | None = None
    heard: str = ""
    missing: list[dict] = field(default_factory=list)
    clipping: float = 0.0
    silence_s: float = 0.0
    wpm: float = 0.0
    seconds: float = 0.0
    status: str = "pending"
    reasons: list[str] = field(default_factory=list)
    continues: bool = False  # a later sentence of the same piece
    unclear: list[str] = field(default_factory=list)  # words ASR was unsure of: listen for mispronunciation
    review: list[str] = field(default_factory=list)   # passed, but a listener should check this


@dataclass
class RenderResult:
    ok: bool
    mp3: bytes | None
    seconds: float
    report: dict


#: Bump when the acceptance rules change: cached clips are re-checked (with their
#: stored transcript, so no new speech or ASR) and dropped if they now fail.
QA_VERSION = 4


def sentence_chunks(text: str, max_words: int) -> list[str]:
    """Splits text at sentence ends so no call says more than max_words
    (a single longer sentence stays whole)."""
    if len(text.split()) <= max_words:
        return [text]
    sentences = [s for s in re.split(r"(?<=[.!?])\s+(?=[A-Z0-9\"'£$€])", text) if s.strip()]
    chunks: list[str] = []
    for s in sentences:
        if chunks and len(chunks[-1].split()) + len(s.split()) <= max_words:
            chunks[-1] = f"{chunks[-1]} {s}"
        else:
            chunks.append(s)
    return chunks


def _seed(h: str, attempt: int) -> int:
    return (int(h[:8], 16) + attempt * 7919) % (2**31 - 1)


def _check(piece: PieceReport, clip: np.ndarray, sr: int, heard: str, qa: QaConfig) -> list[str]:
    reasons: list[str] = []
    piece.review = []
    piece.heard = heard
    piece.wer = round(wer(piece.text, heard), 4)
    piece.missing = [{"kind": s.kind, "text": s.text} for s in missing_spans(piece.text, heard)]
    piece.clipping = round(A.clipping_ratio(clip), 5)
    trimmed = A.trim(clip, sr)
    piece.silence_s = round(A.longest_silence(trimmed, sr), 2) if trimmed.size else 0.0
    piece.seconds = round(trimmed.size / sr, 3)
    piece.wpm = round(words_per_minute(piece.text, piece.seconds), 1)
    if piece.wer > qa.segment_wer_max:
        reasons.append(f"WER {piece.wer:.0%} > {qa.segment_wer_max:.0%}")
    loops = repeated_phrases(piece.text, heard)
    if loops:
        reasons.append("repeated: " + "; ".join(f"'{l}'" for l in loops))
    if piece.missing:
        reasons.append("not heard: " + ", ".join(f"{m['kind']} '{m['text']}'" for m in piece.missing))
    if piece.clipping > qa.clipping_max:
        reasons.append(f"clipping {piece.clipping:.2%}")
    if trimmed.size == 0:
        reasons.append("silent")
    elif piece.silence_s > qa.silence_max_s:
        reasons.append(f"silence of {piece.silence_s}s inside speech")
    spelled = any(s.kind == "spelling" for s in critical_spans(piece.text))
    # Spelling letter by letter is slow on purpose: no rate check there.
    if not spelled and len(piece.text.split()) >= qa.min_words_for_rate:
        # Far outside speech rates means skipped or stretched words: retry. Merely fast or
        # slow speech (short questions are quick) is flagged for the listener, not failed.
        if not qa.wpm_hard_min <= piece.wpm <= qa.wpm_hard_max:
            reasons.append(f"speaking rate {piece.wpm:.0f} wpm")
        elif not qa.wpm_min <= piece.wpm <= qa.wpm_max:
            piece.review.append(f"speaking rate {piece.wpm:.0f} wpm")
    return reasons


def render(req: RenderRequest, engine: Engine, transcriber: Transcriber, cache: SegmentCache,
           qa: QaConfig = QaConfig(), embedder: SpeakerEmbedder | None = None, params: dict | None = None,
           sample_rate: int = 24000, spoken: bool = False, on_progress=None) -> RenderResult:
    """spoken=True: numbers, money, codes and times are said as words (spoken.to_spoken)
    before they reach the engine; QA still compares against the written script."""
    started = time.monotonic()
    params = dict(params or {})
    unsupported: list[str] = []
    experimental: list[str] = []
    no_instruct: list[str] = []
    pieces: list[PieceReport] = []
    clips: dict[int, np.ndarray] = {}
    spoken_calls = 0

    # qwen_tts lists speakers in lower case and matches them case-insensitively.
    known = {v.lower() for v in engine.voices()}
    for item_no, item in enumerate(req.plan):
        if not isinstance(item, Speech):
            continue
        if known and item.voice.lower() not in known:
            pieces.append(PieceReport(item_no, item.voice, strip_tags(item.text), None, None, None, "", False,
                                      status="failed", reasons=[f"unknown voice {item.voice}"]))
            continue
        parts, notes = split_expressions(item.text, engine.takes_instruct(item.voice))
        unsupported += notes.unsupported
        experimental += notes.experimental
        no_instruct += notes.dropped_no_instruct
        for part in parts:
            settings = {**params, "language": req.language, "instruct": part.instruct or ""}
            if spoken:
                settings["spoken"] = 1
            lex = respell(part.text, getattr(engine, "lexicon_key", engine.provider))
            if lex != part.text:
                settings["lexicon"] = LEXICON_VERSION  # a respelled word changes the audio
            # A designed or cloned voice is its description or reference clip, not just its name.
            sig = getattr(engine, "voice_signature", None)
            if sig is not None:
                settings["voice_sig"] = sig(item.voice)
            for k, chunk in enumerate(sentence_chunks(part.text, qa.max_words_per_call)):
                h = segment_hash(provider=engine.provider, model=engine.model_id, voice=item.voice,
                                 expression=[part.tag] if part.tag else [], text=chunk, params=settings, scope=req.scope)
                piece = PieceReport(item_no, item.voice, chunk, part.tag, part.support, part.instruct, h, False)
                piece.continues = k > 0
                pieces.append(piece)

    for idx, piece in enumerate(pieces):
        if on_progress is not None and idx:
            on_progress(idx, len(pieces))  # pieces finished so far (jobs report progress)
        if piece.status == "failed":
            continue
        with cache.lock(piece.hash):
            hit = cache.get(req.scope, piece.hash)
            # Seeds already tried on an earlier failed run give the same audio: skip them.
            tried = cache.failed_attempts(req.scope, piece.hash)
            if hit is not None and hit.meta.get("qa_version") != QA_VERSION:
                if _check(piece, hit.audio, hit.sr, hit.meta.get("heard", ""), qa):
                    # Fails today's rules: speak it again, with seeds not tried before
                    # (generation is deterministic, the old seeds give the same audio).
                    tried = max(tried, int(hit.meta.get("attempts") or qa.max_attempts))
                    hit = None
                else:
                    cache.put(req.scope, piece.hash, hit.audio, hit.sr, {**hit.meta, "qa_version": QA_VERSION})
            if hit is not None:
                piece.cached, piece.status = True, "pass"
                piece.wer, piece.heard, piece.seconds = hit.meta.get("wer"), hit.meta.get("heard", ""), round(hit.audio.size / hit.sr, 3)
                clips[idx] = A.resample(hit.audio, hit.sr, sample_rate)
                continue
            for attempt in range(qa.max_attempts):
                piece.attempts = attempt + 1
                try:
                    said = respell(to_spoken(piece.text) if spoken else piece.text,
                                   getattr(engine, "lexicon_key", engine.provider))
                    raw, sr = engine.synthesize(said, piece.voice, piece.instruct, req.language, _seed(piece.hash, tried + attempt))
                    spoken_calls += 1
                    heard = transcriber.transcribe(raw, sr, req.language)
                except Exception as e:  # engine or ASR crash: try the next seed
                    piece.reasons = [f"{type(e).__name__}: {str(e)[:200]}"]
                    continue
                piece.reasons = _check(piece, raw, sr, heard, qa)
                if qa.assemble_failed:
                    clips[idx] = A.resample(A.trim(raw, sr), sr, sample_rate)
                words = getattr(transcriber, "last_words", None) or []
                piece.unclear = [w for w, p in words if p < qa.unclear_word_p]
                if not piece.reasons:
                    clip = A.trim(raw, sr)
                    cache.put(req.scope, piece.hash, clip, sr, {"wer": piece.wer, "heard": heard, "text": piece.text,
                                                                "voice": piece.voice, "expression": piece.expression,
                                                                "attempts": piece.attempts, "model": engine.model_id,
                                                                "qa_version": QA_VERSION})
                    piece.status = "pass"
                    clips[idx] = A.resample(clip, sr, sample_rate)
                    break
            else:
                piece.status = "failed"
                cache.put_failure(req.scope, piece.hash, tried + qa.max_attempts)

    if on_progress is not None:
        on_progress(len(pieces), len(pieces))
    failed = [p for p in pieces if p.status != "pass"]
    report: dict = {
        "engine": engine.provider, "model": engine.model_id, "scope": req.scope,
        "manual_review_required": True,
        "segments": [p.__dict__ for p in pieces],
        "failed_segments": len(failed),
        "cache": {"hits": sum(p.cached for p in pieces), "misses": sum(not p.cached for p in pieces), "engine_calls": spoken_calls},
        "unsupported_expressions": sorted(set(unsupported)),
        "experimental_expressions_used": sorted(set(experimental)),
        "expressions_dropped_no_instruct": sorted(set(no_instruct)),
    }
    if failed and not (qa.assemble_failed and all(i in clips for i in range(len(pieces)))):
        report.update(status="failed", elapsed_s=round(time.monotonic() - started, 2))
        return RenderResult(False, None, 0.0, report)

    # Join: pieces of one turn with a short gap, then the planned pauses.
    out: list[np.ndarray] = []
    by_item: dict[int, list[int]] = {}
    for idx, p in enumerate(pieces):
        by_item.setdefault(p.item, []).append(idx)
    for item_no, item in enumerate(req.plan):
        if isinstance(item, Pause):
            out.append(A.silence(item.seconds, sample_rate))
            continue
        for k, idx in enumerate(by_item.get(item_no, [])):
            if k:
                out.append(A.silence(qa.sentence_gap_s if pieces[idx].continues else qa.piece_gap_s, sample_rate))
            out.append(clips[idx])
    joined = np.concatenate(out) if out else np.zeros(0, dtype=np.float32)
    normalized, before = A.normalize_loudness(joined, sample_rate)
    after = A.measure_loudness(normalized, sample_rate)
    mp3 = A.encode_mp3(normalized, sample_rate)
    seconds = round(normalized.size / sample_rate, 2)

    heard_all = " ".join(p.heard for p in pieces)
    said_all = " ".join(p.text for p in pieces)
    job_wer = round(wer(said_all, heard_all), 4)
    # ids only: the report goes back to the app, and answers must not leave the key
    missing = {id(v) for v in missing_answers(req.answers, heard_all)}
    ids = req.answer_ids or [str(i + 1) for i in range(len(req.answers))]
    answers_missing = [ids[i] for i, v in enumerate(req.answers) if id(v) in missing]
    consistency: dict = {}
    if embedder is not None:
        vecs: dict[str, list[np.ndarray]] = {}
        for idx, p in enumerate(pieces):
            if clips[idx].size >= sample_rate * 1.5:
                vecs.setdefault(p.voice, []).append(embedder.embed(clips[idx], sample_rate))
        consistency = speaker_consistency(vecs)
    problems = []
    if job_wer > qa.job_wer_max:
        problems.append(f"recording WER {job_wer:.1%} > {qa.job_wer_max:.0%}")
    if answers_missing:
        problems.append(f"{len(answers_missing)} answer(s) not heard: questions " + ", ".join(answers_missing))
    low = {v: s for v, s in consistency.items() if s is not None and s < qa.speaker_similarity_min}
    if low:
        problems.append("voice drifts: " + ", ".join(f"{v} {s:.2f}" for v, s in low.items()))
    clip_all = A.clipping_ratio(normalized)
    if clip_all > qa.clipping_max:
        problems.append(f"clipping {clip_all:.2%}")
    if abs(after["input_i"] - A.TARGET_LUFS) > 1.0:
        problems.append(f"loudness {after['input_i']} LUFS")

    report.update(
        status="failed" if failed else ("needs_review" if problems else "pass"),
        problems=problems,
        wer=job_wer,
        answers_missing=answers_missing,
        answers_checked=len(req.answers),
        speaker_consistency=consistency or "not measured",
        loudness={"before_lufs": before["input_i"], "after_lufs": after["input_i"], "true_peak_db": after["input_tp"]},
        clipping=round(clip_all, 6),
        duration_s=seconds,
        elapsed_s=round(time.monotonic() - started, 2),
    )
    return RenderResult(not failed, mp3, seconds, report)
