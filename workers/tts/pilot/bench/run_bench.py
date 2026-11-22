"""Run one engine on the shared cases (pilot/bench/cases.py).

    python pilot/bench/run_bench.py --engine chatterbox|chatterbox-turbo|zonos|qwen-clone|qwen-design \
        --asr-dir <faster-whisper dir> --cc0-dir <CommonAccent data dir> --out pilot/out/bench \
        [--qwen-base-dir ... --qwen-design-dir ...]

Every case goes through the worker's own pipeline (render: expression
pieces, segment hash, ASR QA, retries with fresh seeds, pauses, loudness,
MP3), so engines are judged by identical rules. Writes, under
<out>/<engine>/: <case>.mp3, <case>.report.json, ab/<tag>-{neutral,styled}.wav,
and run.json (timing, engine calls, retries, peak memory).
"""

from __future__ import annotations

import argparse
import json
import resource
import sys
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent.parent))
sys.path.insert(0, str(HERE))

import soundfile as sf  # noqa: E402

from cases import (AB_LINE, AB_TAGS, ACCENT_LINES, CC0_REFERENCES, IELTS_ANSWERS, IELTS_LINES, PODCAST,  # noqa: E402
                   PODCAST_CAST, REFERENCES)
from linguabc_tts import audio as A  # noqa: E402
from linguabc_tts.cache import SegmentCache  # noqa: E402
from linguabc_tts.expressions import INSTRUCTIONS  # noqa: E402
from linguabc_tts.pipeline import QaConfig, render  # noqa: E402
from linguabc_tts.plan import parse_request  # noqa: E402
from linguabc_tts.qa import FasterWhisperTranscriber  # noqa: E402

CC0_TEXT = {"england": "This is my last chance.", "australia": "And all's fair in love and war?"}
DESIGN = {  # same descriptions as pilot/voice_lab.py
    "Emma": "A woman in her early thirties with a natural Southern British English accent, standard Received Pronunciation as heard in London. Warm, clear and friendly voice, medium pitch, calm natural pace, like a BBC radio presenter.",
    "Oliver": "A man in his forties with a natural British English accent, Received Pronunciation. Deep, clear, confident voice, measured pace, like a university lecturer in London.",
}


class Timed:
    def __init__(self, engine):
        self.engine, self.log = engine, []
        self.provider, self.model_id = engine.provider, engine.model_id
        if hasattr(engine, "voice_signature"):
            self.voice_signature = engine.voice_signature

    def voices(self):
        return self.engine.voices()

    def takes_instruct(self, voice):
        return self.engine.takes_instruct(voice)

    def synthesize(self, text, voice, instruct, language, seed):
        t, c = time.monotonic(), time.process_time()
        audio, sr = self.engine.synthesize(text, voice, instruct, language, seed)
        self.log.append({"voice": voice, "wall_s": round(time.monotonic() - t, 2), "cpu_s": round(time.process_time() - c, 2),
                         "audio_s": round(audio.size / sr, 2)})
        return audio, sr


def build(engine: str, args) -> Timed:
    refs = {n: p for n, (p, *_r) in REFERENCES.items()}
    cc0 = {n: Path(args.cc0_dir) / f for n, (f, *_r) in CC0_REFERENCES.items()}
    if engine.startswith("chatterbox"):
        from linguabc_tts.engines_chatterbox import ChatterboxEngine
        return Timed(ChatterboxEngine({**refs, **cc0}, "turbo" if engine.endswith("turbo") else "original"))
    if engine == "zonos":
        from engines_bench import ZonosEngine
        langs = {n: lang for n, (_p, _t, _a, lang) in REFERENCES.items()} | {n: lang for n, (_f, _a, lang) in CC0_REFERENCES.items()}
        return Timed(ZonosEngine({n: (p, langs[n]) for n, p in {**refs, **cc0}.items()}))
    if engine == "qwen-clone":
        from linguabc_tts.engines import QwenCloneEngine
        voices = {}
        for n, p in {**refs, **cc0}.items():
            a, sr = sf.read(p, dtype="float32")
            a = a.mean(1) if a.ndim > 1 else a
            text = CC0_TEXT.get(n) or (Path(p).with_suffix(".txt")).read_text("utf-8").strip()
            voices[n] = (a, sr, text)
        return Timed(QwenCloneEngine(args.qwen_base_dir, voices))
    if engine == "qwen-design":
        from linguabc_tts.engines import QwenDesignEngine
        return Timed(QwenDesignEngine(args.qwen_design_dir, DESIGN))
    raise SystemExit(f"unknown engine {engine}")


def request(items, answers=None):
    plan = []
    for i, (voice, text) in enumerate(items):
        if i:
            plan.append({"kind": "pause", "seconds": 0.4})
        plan.append({"kind": "speech", "speaker": voice, "voice": voice, "text": text})
    return parse_request({"version": 1, "scope": "platform", "language": "English", "plan": plan,
                          "checks": {"answers": answers or []}})


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--engine", required=True)
    ap.add_argument("--asr-dir", required=True)
    ap.add_argument("--cc0-dir", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--qwen-base-dir")
    ap.add_argument("--qwen-design-dir")
    ap.add_argument("--qwen-cv-dir")
    ap.add_argument("--cases", default="ielts,podcast,ab,accent")
    ap.add_argument("--max-attempts", type=int, default=4)
    ap.add_argument("--spoken", action="store_true", help="say numbers, money and codes as words (spoken.to_spoken)")
    ap.add_argument("--voices", default=",".join(REFERENCES))
    args = ap.parse_args()
    out = Path(args.out) / args.engine
    (out / "ab").mkdir(parents=True, exist_ok=True)
    cases = set(args.cases.split(","))

    t0 = time.monotonic()
    engine = build(args.engine, args)
    prev = out / "run.json"
    run = json.loads(prev.read_text()) if prev.exists() else {"cases": {}}
    run.update(engine=args.engine, model=engine.model_id, load_s=round(time.monotonic() - t0, 1))
    asr = FasterWhisperTranscriber(args.asr_dir, device="cpu")
    cache = SegmentCache(out / "segment-cache")
    qa = QaConfig(max_attempts=args.max_attempts, assemble_failed=True)

    def do(name, req):
        start, t = len(engine.log), time.monotonic()
        res = render(req, engine, asr, cache, qa=qa, spoken=args.spoken)
        calls = engine.log[start:]
        (out / f"{name}.report.json").write_text(json.dumps(res.report, indent=2, ensure_ascii=False, default=str), "utf-8")
        if res.mp3:
            (out / f"{name}.mp3").write_bytes(res.mp3)
        segs = res.report["segments"]
        run["cases"][name] = {
            "status": res.report["status"], "seconds": res.seconds, "wall_s": round(time.monotonic() - t, 1),
            "wer": res.report.get("wer"), "answers_missing": res.report.get("answers_missing"),
            "failed": res.report["failed_segments"], "segments": len(segs),
            "attempts": sum(p["attempts"] for p in segs), "engine_calls": len(calls),
            "generated_audio_s": round(sum(c["audio_s"] for c in calls), 1),
            "engine_wall_s": round(sum(c["wall_s"] for c in calls), 1),
            "rtf": round(sum(c["wall_s"] for c in calls) / max(0.01, sum(c["audio_s"] for c in calls)), 2) if calls else None,
            "failures": [(p["voice"], p["text"][:60], p["reasons"], p["heard"][:80]) for p in segs if p["status"] != "pass"],
            "review": [(p["voice"], p["text"][:40], p.get("review")) for p in segs if p.get("review")],
            "unsupported": res.report.get("unsupported_expressions"), "dropped": res.report.get("expressions_dropped_no_instruct"),
        }
        print(json.dumps({name: {k: run["cases"][name][k] for k in ("status", "wer", "failed", "attempts", "rtf", "seconds")}}), flush=True)
        (out / "run.json").write_text(json.dumps(run, indent=2, ensure_ascii=False, default=str), "utf-8")

    if "ielts" in cases and args.engine != "qwen-design":
        for voice in args.voices.split(","):
            do(f"ielts{'-spoken' if args.spoken else ''}-{voice}", request([(voice, line) for line in IELTS_LINES], IELTS_ANSWERS))
    if "podcast" in cases:
        do("podcast", request([(PODCAST_CAST[s], text) for s, text in PODCAST]))
    if "ab" in cases:
        voice = "Emma"
        run["ab"] = []
        for tag in AB_TAGS:
            for label, instruct in (("neutral", None), ("styled", INSTRUCTIONS[tag][0])):
                audio, sr = engine.synthesize(AB_LINE, voice, instruct, "English", 4242)
                sf.write(out / "ab" / f"{tag}-{label}.wav", A.trim(audio, sr), sr)
            run["ab"].append(tag)
        (out / "run.json").write_text(json.dumps(run, indent=2, ensure_ascii=False, default=str), "utf-8")
        print(json.dumps({"ab": "done"}), flush=True)
    if "accent" in cases and args.engine != "qwen-design":
        for ref in CC0_REFERENCES:
            do(f"accent-{ref}", request([(ref, line) for line in ACCENT_LINES]))

    log = engine.log
    run["totals"] = {"engine_calls": len(log), "generated_audio_s": round(sum(c["audio_s"] for c in log), 1),
                     "engine_wall_s": round(sum(c["wall_s"] for c in log), 1), "engine_cpu_s": round(sum(c["cpu_s"] for c in log), 1),
                     "rtf": round(sum(c["wall_s"] for c in log) / max(0.01, sum(c["audio_s"] for c in log)), 2) if log else None,
                     "total_wall_s": round(time.monotonic() - t0, 1),
                     "peak_rss_gb": round(resource.getrusage(resource.RUSAGE_SELF).ru_maxrss / 1024 / 1024, 2)}
    (out / "run.json").write_text(json.dumps(run, indent=2, ensure_ascii=False, default=str), "utf-8")
    print(json.dumps({"done": run["totals"]}), flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
