"""Command line for local runs and the pilot.

  python -m linguabc_tts.cli render request.json --out out.mp3 --report report.json [--engine qwen|fake]
  python -m linguabc_tts.cli accent-suite --voices Ryan,Aiden --out-dir accent-test [--engine qwen|fake]
  python -m linguabc_tts.cli license <model_dir>

--engine qwen needs the [qwen,asr] extras, the downloaded weights and
(sensibly) a GPU. --engine fake runs the whole pipeline with a tone instead
of speech, to check the plumbing for free.
"""

from __future__ import annotations

import argparse
import json
import os
import random
import sys
from pathlib import Path

from .cache import SegmentCache
from .engines import DEFAULT_MODEL, FakeEngine, GenerationConfig
from .license import check_weights_license
from .pipeline import render
from .plan import parse_request
from .qa import FakeTranscriber


def build(engine_name: str, model_dir: str | None):
    if engine_name == "fake":
        engine = FakeEngine()
        return engine, FakeTranscriber(engine)
    from .engines import QwenEngine
    from .qa import FasterWhisperTranscriber

    path = model_dir or os.environ.get("QWEN_MODEL_DIR")
    if not path:
        from huggingface_hub import snapshot_download
        path = snapshot_download(DEFAULT_MODEL)
    print(f"weights licence: {check_weights_license(path)}", file=sys.stderr)
    return QwenEngine(path, config=GenerationConfig()), FasterWhisperTranscriber(os.environ.get("ASR_MODEL", "large-v3"))


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(prog="linguabc_tts")
    sub = ap.add_subparsers(dest="cmd", required=True)
    r = sub.add_parser("render")
    r.add_argument("request")
    r.add_argument("--out", required=True)
    r.add_argument("--report", required=True)
    a = sub.add_parser("accent-suite")
    a.add_argument("--voices", default="Ryan,Aiden")
    a.add_argument("--out-dir", required=True)
    a.add_argument("--seed", type=int, default=7)
    for p in (r, a):
        p.add_argument("--engine", choices=["qwen", "fake"], default="fake")
        p.add_argument("--model-dir")
        p.add_argument("--cache-dir", default=".segment-cache")
    lic = sub.add_parser("license")
    lic.add_argument("model_dir")
    args = ap.parse_args(argv)

    if args.cmd == "license":
        print(check_weights_license(args.model_dir))
        return 0

    engine, asr = build(args.engine, args.model_dir)
    cache = SegmentCache(args.cache_dir)
    params = GenerationConfig().as_params()

    if args.cmd == "render":
        req = parse_request(json.loads(Path(args.request).read_text("utf-8")))
        result = render(req, engine, asr, cache, params=params)
        Path(args.report).write_text(json.dumps(result.report, indent=2, ensure_ascii=False), "utf-8")
        if result.mp3:
            Path(args.out).write_bytes(result.mp3)
        print(f"status={result.report['status']} seconds={result.seconds}", file=sys.stderr)
        return 0 if result.ok else 2

    # Accent suite: one file per sentence and voice, named blind for listeners.
    suite = json.loads((Path(__file__).parent / "accent_suite.json").read_text("utf-8"))
    out = Path(args.out_dir)
    out.mkdir(parents=True, exist_ok=True)
    rng = random.Random(args.seed)
    key, rows, reports = [], [], []
    for s in suite["sentences"]:
        for voice in [v.strip() for v in args.voices.split(",") if v.strip()]:
            req = parse_request({"version": 1, "scope": "platform", "language": "English",
                                 "plan": [{"kind": "speech", "speaker": "A", "voice": voice, "text": s["text"]}]})
            res = render(req, engine, asr, cache, params=params)
            code = f"{rng.randrange(16**6):06x}"
            if res.mp3:
                (out / f"{code}.mp3").write_bytes(res.mp3)
            key.append({"file": f"{code}.mp3", "voice": voice, "engine": engine.model_id, "sentence": s["id"]})
            rows.append((code, s))
            reports.append({"file": code, "sentence": s["id"], "voice": voice, "status": res.report["status"],
                            "wer": res.report.get("wer"), "problems": res.report.get("problems", []),
                            "experimental": res.report.get("experimental_expressions_used", [])})
    rng.shuffle(rows)
    lines = ["# Blind listening review", "", "Score each file 1-5. Do not open key.json until you finish.", "",
             "| File | Category | Listen for | Natural (1-5) | Accent as intended? (Br/Am/Au/other) | Expression heard? | IELTS-ready? (y/n) | Notes |",
             "|---|---|---|---|---|---|---|---|"]
    lines += [f"| {c}.mp3 | {s['category']} | {s['listen_for']} | | | | | |" for c, s in rows]
    (out / "review-sheet.md").write_text("\n".join(lines) + "\n", "utf-8")
    (out / "key.json").write_text(json.dumps(key, indent=2), "utf-8")
    (out / "auto-qa.json").write_text(json.dumps(reports, indent=2, ensure_ascii=False), "utf-8")
    print(f"{len(key)} files in {out}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
