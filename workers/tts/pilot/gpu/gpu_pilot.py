"""Chatterbox Turbo pilot on a real GPU (Kaggle / Colab T4, or any CUDA box). CPU works too (slow).

    python pilot/gpu/gpu_pilot.py --voices-dir pilot/gpu/voices --out out/gpu --cases short,section,expr

Runs the worker's real pipeline (spoken form, lexicon, per-segment ASR check,
retries, loudness, MP3: linguabc_tts.pipeline.render) with the real Chatterbox
Turbo model. Nothing here is a fake engine. Measures, per case and overall:

  * GPU name / VRAM, peak VRAM (allocated and reserved), model download, cold
    load, first (warm-up) and warm synthesis, real-time factor;
  * time in synthesis, ASR, loudness + MP3 encoding, end to end; retries;
  * WER, IELTS answers heard (question numbers only), speaker consistency,
    similarity to the reference clip (all takes), loudness, clipping,
    repeats, silences, accent scores (if --accent-dir), and a GPU cost estimate.

All content is synthetic (scripts written for this pilot, references are
synthetic voices designed with Qwen3-TTS VoiceDesign: no real person, no
user data, no real answer keys). manual_review_required stays true: automatic
QA never replaces listening, and an accent is never "passed" automatically.

Writes <out>/<case>.mp3, <case>.report.json, summary.json, summary.md.
"""

from __future__ import annotations

import argparse
import json
import os
import platform
import sys
import time
from pathlib import Path

import numpy as np

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent.parent))

from linguabc_tts import audio as A  # noqa: E402
from linguabc_tts import pipeline as P  # noqa: E402
from linguabc_tts.cache import SegmentCache  # noqa: E402
from linguabc_tts.pipeline import QaConfig, render  # noqa: E402
from linguabc_tts.plan import parse_request  # noqa: E402

VOICES = {"Oliver": "british (designed)", "Emma": "british (designed)", "Chloe": "australian (designed)"}

# Published per-second rates (Modal pricing pages, read 2026-11-23); estimates only.
GPU_PRICE_PER_S = {"T4": 0.000164, "L4": 0.000222, "A10G": 0.000306, "A100": 0.000583}
FISH_USD_PER_MILLION_BYTES = 15.0   # src/lib/ai/fish.ts list price (S2.1 Pro)

# ---------------------------------------------------------------- cases

SHORT = {
    "a1-narration": {
        "plan": [{"kind": "speech", "speaker": "Narrator", "voice": "Oliver", "text":
                  "You will hear a talk about a new community library in the town of Ashford. "
                  "The library opens on the 3rd of February at nine thirty in the morning. "
                  "Membership costs twelve pounds fifty a year, and students under eighteen join for free. "
                  "First, you have some time to look at questions one to five."}],
        "answers": [{"id": "1", "accepted": ["3rd of February", "3 February"]}, {"id": "2", "accepted": ["£12.50", "twelve pounds fifty"]}],
    },
    "a2-dialogue": {
        "plan": [
            {"kind": "speech", "speaker": "Emma", "voice": "Emma", "text": "Good afternoon, Riverside Sports Centre. How can I help you?"},
            {"kind": "pause", "seconds": 0.35},
            {"kind": "speech", "speaker": "Man", "voice": "Oliver", "text": "Hello, I'd like to book a badminton court for Saturday, please."},
            {"kind": "pause", "seconds": 0.35},
            {"kind": "speech", "speaker": "Emma", "voice": "Emma", "text": "Of course. Can I take your surname?"},
            {"kind": "pause", "seconds": 0.35},
            {"kind": "speech", "speaker": "Man", "voice": "Oliver", "text": "It's Whitfield. That's W-H-I-T-F-I-E-L-D."},
            {"kind": "pause", "seconds": 0.35},
            {"kind": "speech", "speaker": "Emma", "voice": "Emma", "text": "Thank you. The court is free from a quarter past ten, and it costs eight pounds an hour."},
        ],
        "answers": [{"id": "1", "accepted": ["Whitfield"]}, {"id": "2", "accepted": ["quarter past ten", "10:15"]},
                    {"id": "3", "accepted": ["£8", "eight pounds"]}],
    },
    "a3-podcast": {
        "plan": [{"kind": "speech", "speaker": "Host", "voice": "Chloe", "text":
                  "Welcome back to Study Break, the podcast for busy language learners. "
                  "Today we're talking about sleep, and why a good night's rest might be the easiest way to remember new words. "
                  "Researchers found that students who slept for eight hours after learning recalled almost twice as much vocabulary "
                  "as those who stayed up late. So tonight, put the phone down a little earlier."}],
        "answers": [],
    },
}

# Each line carries one LinguABC script tag; [gasp] has no Studio tag, so it is tested raw (see EXPR_RAW).
EXPR = {
    "laughing": ("Oliver", "[laughing] Honestly, I thought the bus would never come, but here we are!"),
    "chuckling": ("Emma", "[chuckling] Well, that's one way to learn the timetable, I suppose."),
    "sighing": ("Oliver", "[sighing] I'm afraid the museum is closed on Mondays, so we'll have to come back."),
    "happy": ("Chloe", "[happy] Great news, everyone: the trip to the coast is going ahead on Friday!"),
    "surprised": ("Emma", "[surprised] Really? The tickets are only five pounds? That's much cheaper than last year."),
}
EXPR_RAW = {"gasp": ("Chloe", "[gasp] Oh no, I've left my passport at the hotel!")}

# ---------------------------------------------------------------- measuring wrappers


class Clock:
    def __init__(self):
        self.t = {"synth_s": 0.0, "asr_s": 0.0, "loudness_s": 0.0, "encode_s": 0.0}
        self.synth_calls = 0
        self.audio_s = 0.0


class TimedEngine:
    def __init__(self, engine, clock: Clock):
        self.engine, self.clock = engine, clock
        self.provider, self.model_id = engine.provider, engine.model_id
        self.lexicon_key = getattr(engine, "lexicon_key", None)
        self.voice_signature = engine.voice_signature
        self.clips: dict[str, list[np.ndarray]] = {}
        self.sr = 24000

    def voices(self):
        return self.engine.voices()

    def takes_instruct(self, voice):
        return self.engine.takes_instruct(voice)

    def synthesize(self, text, voice, instruct, language, seed):
        t = time.monotonic()
        audio, sr = self.engine.synthesize(text, voice, instruct, language, seed)
        _sync()
        self.clock.t["synth_s"] += time.monotonic() - t
        self.clock.synth_calls += 1
        self.clock.audio_s += audio.size / sr
        self.sr = sr
        keep = self.clips.setdefault(voice, [])
        if audio.size >= sr * 1.5 and len(keep) < 12:
            keep.append(audio)
        return audio, sr


class TimedAsr:
    def __init__(self, asr, clock: Clock):
        self.asr, self.clock = asr, clock

    def transcribe(self, audio, sr, language):
        t = time.monotonic()
        try:
            return self.asr.transcribe(audio, sr, language)
        finally:
            self.clock.t["asr_s"] += time.monotonic() - t

    def __getattr__(self, name):  # word confidences etc.
        return getattr(self.asr, name)


def _patch_audio(clock: Clock):
    """Times loudness normalisation and MP3 encoding inside the pipeline."""
    norm, enc = A.normalize_loudness, A.encode_mp3

    def timed_norm(*a, **k):
        t = time.monotonic()
        try:
            return norm(*a, **k)
        finally:
            clock.t["loudness_s"] += time.monotonic() - t

    def timed_enc(*a, **k):
        t = time.monotonic()
        try:
            return enc(*a, **k)
        finally:
            clock.t["encode_s"] += time.monotonic() - t

    P.A.normalize_loudness, P.A.encode_mp3 = timed_norm, timed_enc


def _torch():
    import torch
    return torch


def _sync():
    torch = _torch()
    if torch.cuda.is_available():
        torch.cuda.synchronize()


def gpu_info() -> dict:
    torch = _torch()
    info = {"python": platform.python_version(), "torch": torch.__version__, "cpu_count": os.cpu_count()}
    if torch.cuda.is_available():
        p = torch.cuda.get_device_properties(0)
        info |= {"device": "cuda", "gpu": p.name, "gpu_count": torch.cuda.device_count(), "vram_gb": round(p.total_memory / 2**30, 1),
                 "cuda": torch.version.cuda}
    else:
        info |= {"device": "cpu", "gpu": None}
    return info


def peak_vram() -> dict:
    torch = _torch()
    if not torch.cuda.is_available():
        return {}
    return {"peak_allocated_gb": round(torch.cuda.max_memory_allocated() / 2**30, 2),
            "peak_reserved_gb": round(torch.cuda.max_memory_reserved() / 2**30, 2)}


def reset_vram():
    torch = _torch()
    if torch.cuda.is_available():
        torch.cuda.reset_peak_memory_stats()


def cosine(a, b) -> float:
    return float(np.dot(a, b) / (np.linalg.norm(a) * np.linalg.norm(b) + 1e-9))

# ---------------------------------------------------------------- run


def run_case(name, plan, answers, engine, asr, clock_factory, out: Path, args, embedder, ref_emb, accent) -> dict:
    clock = clock_factory()
    eng, a = TimedEngine(engine, clock), TimedAsr(asr, clock)
    _patch_audio(clock)
    req = parse_request({"version": 1, "scope": "platform", "language": "English", "plan": plan, "checks": {"answers": answers}})
    reset_vram()
    t0 = time.monotonic()
    res = render(req, eng, a, SegmentCache(out / "cache" / name), qa=QaConfig(max_attempts=args.max_attempts),
                 spoken=True, embedder=embedder)
    _sync()
    wall = time.monotonic() - t0
    if res.mp3:
        (out / f"{name}.mp3").write_bytes(res.mp3)
    r = res.report
    segs = r.get("segments", [])
    retries = sum(max(0, int(s.get("attempts", 1)) - 1) for s in segs)
    sim = {}
    if embedder is not None:
        for v, clips in eng.clips.items():
            if v in ref_emb and clips:
                sim[v] = round(float(np.mean([cosine(embedder.embed(c, eng.sr), ref_emb[v]) for c in clips])), 3)
    acc = {}
    if accent is not None:
        for v, clips in eng.clips.items():
            joined = np.concatenate(clips[:6])
            scores = accent.scores(joined, eng.sr)
            top = sorted(scores.items(), key=lambda kv: -kv[1])[:3]
            acc[v] = {"intended": VOICES.get(v), "top": [[k, round(s, 3)] for k, s in top], "verdict": "not proven: listen"}
    summary = {
        "case": name, "status": r.get("status"), "ok": res.ok, "manual_review_required": True,
        "duration_s": res.seconds, "wall_s": round(wall, 1), "rtf": round(wall / max(res.seconds or 0.001, 0.001), 3),
        "synth_rtf": round(clock.t["synth_s"] / max(clock.audio_s, 0.001), 3),
        "time_s": {k: round(v, 1) for k, v in clock.t.items()}, "synth_calls": clock.synth_calls, "segments": len(segs),
        "retries": retries, "failed_segments": r.get("failed_segments", 0),
        "wer": r.get("wer"), "answers_checked": r.get("answers_checked"), "answers_missing": r.get("answers_missing"),
        "problems": r.get("problems"), "speaker_consistency": r.get("speaker_consistency"), "reference_similarity_all_takes": sim,
        "loudness": r.get("loudness"), "clipping": r.get("clipping"),
        "repeats_or_silence_flags": sum(1 for s in segs if any(("repeated" in x) or ("silen" in x) for x in s.get("reasons", []))),
        "review_flags": sum(1 for s in segs if s.get("review")), "accent": acc, "vram": peak_vram(),
        "bytes_for_fish_estimate": sum(len(p.text.encode()) for p in req.speech),
    }
    (out / f"{name}.report.json").write_text(json.dumps({"summary": summary, "report": r}, indent=2, ensure_ascii=False, default=str), "utf-8")
    print(json.dumps({k: summary[k] for k in ("case", "status", "duration_s", "wall_s", "rtf", "retries", "wer", "answers_missing")}), flush=True)
    return summary


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--voices-dir", required=True, help="Oliver.wav, Emma.wav, Chloe.wav (synthetic references)")
    ap.add_argument("--out", required=True)
    ap.add_argument("--cases", default="short,section,expr")
    ap.add_argument("--only", help="comma-separated case names (debug)")
    ap.add_argument("--asr", default="distil-large-v3", help="faster-whisper model name or local dir")
    ap.add_argument("--asr-device", help="cuda | cpu (default: cuda when available)")
    ap.add_argument("--accent-dir", help="speechbrain CommonAccent model dir (optional)")
    ap.add_argument("--max-attempts", type=int, default=4)
    ap.add_argument("--no-embedder", action="store_true")
    args = ap.parse_args()
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    cases = set(args.cases.split(","))
    started = time.monotonic()
    info = gpu_info()
    print(json.dumps(info), flush=True)

    # download (cached models load faster: measured separately from the cold load)
    t = time.monotonic()
    try:
        from huggingface_hub import snapshot_download
        snapshot_download("ResembleAI/chatterbox-turbo")
    except Exception as e:  # offline with a cache is fine
        print("download step:", type(e).__name__, flush=True)
    download_s = round(time.monotonic() - t, 1)

    from linguabc_tts.engines_chatterbox import ChatterboxEngine
    voices = {v: Path(args.voices_dir) / f"{v}.wav" for v in VOICES}
    reset_vram()
    t = time.monotonic()
    engine = ChatterboxEngine(voices, "turbo")
    _sync()
    load_s = round(time.monotonic() - t, 1)
    load_vram = peak_vram()

    warm = []
    for i in range(3):
        t = time.monotonic()
        wav, sr = engine.synthesize("The library opens at half past nine on weekdays.", "Oliver", None, "English", 1000 + i)
        _sync()
        warm.append({"wall_s": round(time.monotonic() - t, 2), "audio_s": round(wav.size / sr, 2)})

    t = time.monotonic()
    from linguabc_tts.qa import FasterWhisperTranscriber
    asr = FasterWhisperTranscriber(args.asr, device=args.asr_device)
    asr_load_s = round(time.monotonic() - t, 1)

    embedder, ref_emb = None, {}
    if not args.no_embedder:
        try:
            from linguabc_tts.qa import ResemblyzerEmbedder
            embedder = ResemblyzerEmbedder()
            for v, p in voices.items():
                audio, sr = A.read_wav(p) if hasattr(A, "read_wav") else _read(p)
                ref_emb[v] = embedder.embed(audio, sr)
        except Exception as e:
            print("embedder unavailable:", type(e).__name__, e, flush=True)
            embedder = None
    accent = None
    if args.accent_dir:
        from linguabc_tts.accent import AccentClassifier
        accent = AccentClassifier(args.accent_dir)

    results = []
    if "short" in cases:
        for name, c in SHORT.items():
            if args.only and name not in args.only.split(","):
                continue
            results.append(run_case(name, c["plan"], c["answers"], engine, asr, Clock, out, args, embedder, ref_emb, accent))
    if "section" in cases:
        planned = json.loads((HERE / "section_plan.json").read_text("utf-8"))
        results.append(run_case("b-section-part1", planned["plan"], planned["answers"], engine, asr, Clock, out, args, embedder, ref_emb, accent))
    expr = []
    if "expr" in cases:
        for tag, (voice, line) in EXPR.items():
            plan = [{"kind": "speech", "speaker": voice, "voice": voice, "text": line}]
            s = run_case(f"c-expr-{tag}", plan, [], engine, asr, Clock, out, args, embedder, ref_emb, accent)
            expr.append({"tag": tag, "via": "Studio script tag", "status": s["status"], "wer": s["wer"], "emotion": "listen: not measured automatically"})
        for tag, (voice, line) in EXPR_RAW.items():
            t = time.monotonic()
            wav, sr = engine.synthesize_raw(line, voice, 7)
            _sync()
            heard = asr.transcribe(wav, sr, "English")
            text = heard if isinstance(heard, str) else getattr(heard, "text", str(heard))
            from linguabc_tts.expressions import strip_tags as _strip
            from linguabc_tts.qa import wer as wer_fn
            mp3 = A.encode_mp3(A.normalize_loudness(wav, sr)[0], sr)
            (out / f"c-expr-{tag}-raw.mp3").write_bytes(mp3)
            expr.append({"tag": tag, "via": "raw Turbo tag (no Studio tag maps to it)", "wall_s": round(time.monotonic() - t, 1),
                         "wer": round(wer_fn(_strip(line), text), 3), "emotion": "listen: not measured automatically"})

    total_s = round(time.monotonic() - started, 1)
    gpu = (info.get("gpu") or "").upper()
    price = next((v for k, v in GPU_PRICE_PER_S.items() if k in gpu), None)
    section = next((r for r in results if r["case"] == "b-section-part1"), None)
    summary = {
        "environment": info, "download_s": download_s, "cold_load_s": load_s, "load_vram": load_vram, "warmup": warm,
        "asr_model": args.asr, "asr_load_s": asr_load_s, "cases": results, "expressions": expr, "total_wall_s": total_s,
        "cost_estimate_usd": {
            "basis": "wall seconds of this run x published per-second GPU price (Modal), estimate only; Kaggle/Colab free quota costs $0",
            "gpu_price_per_s": price,
            "this_run": round(total_s * price, 4) if price else None,
            "section_render": round(section["wall_s"] * price, 4) if price and section else None,
            "fish_same_section": round(section["bytes_for_fish_estimate"] * FISH_USD_PER_MILLION_BYTES / 1e6, 4) if section else None,
        },
        "manual_review_required": True,
        "content": "synthetic scripts and synthetic reference voices (Qwen3-TTS VoiceDesign); no user data, no real answer keys",
    }
    (out / "summary.json").write_text(json.dumps(summary, indent=2, ensure_ascii=False, default=str), "utf-8")
    (out / "summary.md").write_text(markdown(summary), "utf-8")
    print("done", total_s, "s", flush=True)
    return 0


def _read(p: Path):
    import soundfile as sf
    a, sr = sf.read(str(p), dtype="float32", always_2d=False)
    return (a.mean(axis=1) if a.ndim > 1 else a), sr


def markdown(s: dict) -> str:
    e = s["environment"]
    lines = [f"# Chatterbox Turbo pilot: {e.get('gpu') or 'CPU'}", "",
             f"- torch {e['torch']}, CUDA {e.get('cuda')}, VRAM {e.get('vram_gb')} GB, {e['cpu_count']} CPUs",
             f"- download {s['download_s']} s, cold load {s['cold_load_s']} s, load VRAM {s['load_vram']}",
             f"- warm-up calls (wall s / audio s): {[ (w['wall_s'], w['audio_s']) for w in s['warmup'] ]}",
             f"- ASR {s['asr_model']} loaded in {s['asr_load_s']} s; total run {s['total_wall_s']} s", "",
             "| Case | Status | Audio s | Wall s | RTF | Synth / ASR / loudness / MP3 s | Retries | WER | Answers missing | Peak VRAM GB |",
             "|---|---|---|---|---|---|---|---|---|---|"]
    for c in s["cases"]:
        t = c["time_s"]
        lines.append(f"| {c['case']} | {c['status']} | {c['duration_s']} | {c['wall_s']} | {c['rtf']} | "
                     f"{t['synth_s']} / {t['asr_s']} / {t['loudness_s']} / {t['encode_s']} | {c['retries']} | {c['wer']} | "
                     f"{c['answers_missing']} | {c['vram'].get('peak_allocated_gb', '-')} |")
    lines += ["", "Expressions (emotion is judged by listening):", ""]
    lines += [f"- {x['tag']} ({x['via']}): status {x.get('status', '-')}, WER {x['wer']}" for x in s["expressions"]]
    lines += ["", f"Cost estimate: {json.dumps(s['cost_estimate_usd'])}", "", "manual_review_required: true"]
    return "\n".join(lines) + "\n"


if __name__ == "__main__":
    raise SystemExit(main())
