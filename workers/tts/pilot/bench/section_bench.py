"""The full Part 1 section (pilot/section_part1.txt) with any bench engine.

    python pilot/bench/section_bench.py --engine chatterbox --asr-dir ... --cc0-dir ... --out pilot/out/bench

Same script, same exam frame and plan (the app's frameListening and
planScript), same reference voices (Oliver narrator, Emma, Chloe) and same
QA as pilot/section.py, so the result sits next to the Qwen section.
Writes <out>/<engine>/section.mp3, section.report.json, section.run.json.
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
sys.path.insert(0, str(HERE.parent))

from run_bench import build  # noqa: E402
from section import ANSWERS, app_plan  # noqa: E402

from linguabc_tts.cache import SegmentCache  # noqa: E402
from linguabc_tts.pipeline import QaConfig, render  # noqa: E402
from linguabc_tts.plan import parse_request  # noqa: E402
from linguabc_tts.qa import FasterWhisperTranscriber  # noqa: E402


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--engine", required=True)
    ap.add_argument("--asr-dir", required=True)
    ap.add_argument("--cc0-dir", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--qwen-base-dir")
    ap.add_argument("--qwen-design-dir")
    ap.add_argument("--max-attempts", type=int, default=4)
    args = ap.parse_args()
    out = Path(args.out) / args.engine
    out.mkdir(parents=True, exist_ok=True)
    t0 = time.monotonic()
    engine = build(args.engine, args)
    load_s = round(time.monotonic() - t0, 1)
    asr = FasterWhisperTranscriber(args.asr_dir, device="cpu")
    planned = app_plan((HERE.parent / "section_part1.txt").read_text("utf-8"))
    req = parse_request({"version": 1, "scope": "platform", "language": "English", "plan": planned["plan"],
                         "checks": {"answers": ANSWERS}})
    t1 = time.monotonic()
    res = render(req, engine, asr, SegmentCache(out / "segment-cache"), qa=QaConfig(max_attempts=args.max_attempts, assemble_failed=True),
                 spoken=True)
    (out / "section.report.json").write_text(json.dumps(res.report, indent=2, ensure_ascii=False, default=str), "utf-8")
    if res.mp3:
        (out / "section.mp3").write_bytes(res.mp3)
    log = engine.log
    run = {"engine": args.engine, "status": res.report["status"], "duration_s": res.seconds, "wer": res.report.get("wer"),
           "answers_missing": res.report.get("answers_missing"), "segments": len(res.report["segments"]),
           "failed": res.report["failed_segments"], "attempts": sum(p["attempts"] for p in res.report["segments"]),
           "failures": [(p["voice"], p["text"][:60], p["reasons"], p["heard"][:80]) for p in res.report["segments"] if p["status"] != "pass"],
           "review": [(p["voice"], p["text"][:40], p.get("review")) for p in res.report["segments"] if p.get("review")],
           "load_s": load_s, "render_wall_s": round(time.monotonic() - t1, 1), "engine_calls": len(log),
           "generated_audio_s": round(sum(c["audio_s"] for c in log), 1), "engine_wall_s": round(sum(c["wall_s"] for c in log), 1),
           "engine_cpu_s": round(sum(c["cpu_s"] for c in log), 1),
           "peak_rss_gb": round(resource.getrusage(resource.RUSAGE_SELF).ru_maxrss / 1024 / 1024, 2)}
    (out / "section.run.json").write_text(json.dumps(run, indent=2, ensure_ascii=False, default=str), "utf-8")
    print(json.dumps(run, ensure_ascii=False, default=str), flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
