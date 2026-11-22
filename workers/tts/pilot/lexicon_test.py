"""Pick the respelling of "LinguABC" each engine says best.

    python pilot/lexicon_test.py --engine chatterbox|chatterbox-turbo|qwen-clone|qwen-custom|zonos --asr-dir ... --cc0-dir ... --out pilot/out/lexicon

Each candidate is spoken in a carrier sentence with 2 seeds; ASR must hear
the brand (qa.normalize maps "Lingua ABC" / "Lingua A B C" to it). Writes
<out>/<engine>.json and the clips, for a listener to confirm the winner.
"""

from __future__ import annotations

import argparse
import json
import sys
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent))
sys.path.insert(0, str(HERE / "bench"))

from linguabc_tts import audio as A  # noqa: E402
from linguabc_tts.qa import FasterWhisperTranscriber, normalize  # noqa: E402

CANDIDATES = ["Lingua A B C", "Lingua A-B-C", "Lingwa A B C", "Lingua, A, B, C", "LinguABC"]
CARRIER = "Welcome back to the {} podcast. Today we have a brilliant guest."
SEEDS = (11, 12)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--engine", required=True)
    ap.add_argument("--asr-dir", required=True)
    ap.add_argument("--cc0-dir", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--qwen-base-dir")
    ap.add_argument("--qwen-design-dir")
    ap.add_argument("--qwen-cv-dir")
    args = ap.parse_args()
    out = Path(args.out)
    (out / args.engine).mkdir(parents=True, exist_ok=True)
    if args.engine == "qwen-custom":
        from linguabc_tts.engines import QwenEngine
        engine, voice = QwenEngine(args.qwen_cv_dir), "Ryan"
    else:
        from run_bench import build
        engine, voice = build(args.engine, args).engine, "Emma"
    asr = FasterWhisperTranscriber(args.asr_dir, device="cpu")
    results = []
    for i, cand in enumerate(CANDIDATES):
        heard_ok, takes = 0, []
        for seed in SEEDS:
            t = time.monotonic()
            audio, sr = engine.synthesize(CARRIER.format(cand), voice, None, "English", seed)
            heard = asr.transcribe(audio, sr, "English")
            ok = "linguabc" in normalize(heard)
            heard_ok += ok
            path = out / args.engine / f"cand{i + 1}-seed{seed}.mp3"
            path.write_bytes(A.encode_mp3(A.trim(audio, sr), sr))
            takes.append({"heard": heard, "ok": ok, "file": str(path), "wall_s": round(time.monotonic() - t, 1)})
        results.append({"candidate": cand, "score": f"{heard_ok}/{len(SEEDS)}", "takes": takes})
        print(json.dumps({"engine": args.engine, "candidate": cand, "score": results[-1]["score"],
                          "heard": [x["heard"][:60] for x in takes]}), flush=True)
    (out / f"{args.engine}.json").write_text(json.dumps(results, indent=2, ensure_ascii=False), "utf-8")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
