"""Chatterbox Turbo: does each official tag do something, and only that?

    python pilot/turbo_tags.py --asr-dir ... --out pilot/out/turbo-tags

For every tag in the tokenizer's added_tokens.json, the same sentence, voice
and seed are spoken with and without the tag. Checks: the words are still
right (WER), the tag is not read out as a word ("laugh", "clear throat"),
and how much audio the tag adds (a non-verbal sound should add some).
Speaker similarity is scored afterwards in the Qwen venv (score_tags()).
Writes <out>/<tag>.wav|.mp3, <out>/plain.wav and tags.json.
"""

from __future__ import annotations

import argparse
import json
import re
import resource
import sys
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent))
sys.path.insert(0, str(HERE / "bench"))

import soundfile as sf  # noqa: E402

from cases import REFERENCES  # noqa: E402
from linguabc_tts import audio as A  # noqa: E402
from linguabc_tts.engines_chatterbox import TURBO_OFFICIAL_TAGS, ChatterboxEngine  # noqa: E402
from linguabc_tts.qa import FasterWhisperTranscriber, normalize, wer  # noqa: E402

BEFORE = "That's a really good point."
AFTER = "I hadn't thought of that before."
SEED = 31


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--asr-dir", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--voice", default="Emma")
    args = ap.parse_args()
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    t0 = time.monotonic()
    engine = ChatterboxEngine({args.voice: REFERENCES[args.voice][0]}, "turbo")
    load_s = round(time.monotonic() - t0, 1)
    asr = FasterWhisperTranscriber(args.asr_dir, device="cpu")
    words = f"{BEFORE} {AFTER}"

    def take(name, text):
        t = time.monotonic()
        audio, sr = engine.synthesize_raw(text, args.voice, SEED)
        wall = time.monotonic() - t
        clip = A.trim(audio, sr)
        sf.write(out / f"{name}.wav", clip, sr)
        (out / f"{name}.mp3").write_bytes(A.encode_mp3(A.normalize_loudness(clip, sr)[0], sr))
        heard = asr.transcribe(audio, sr, "English")
        return {"heard": heard, "seconds": round(clip.size / sr, 2), "wall_s": round(wall, 1), "audio_s": round(audio.size / sr, 2)}

    plain = take("plain", words)
    rows = []
    for tag in TURBO_OFFICIAL_TAGS:
        name = re.sub(r"\W+", "-", tag.strip("[]"))
        r = take(name, f"{BEFORE} {tag} {AFTER}")
        tag_words = normalize(tag.strip("[]"))
        heard = normalize(r["heard"])
        r.update(tag=tag, wer=round(wer(words, r["heard"]), 3),
                 tag_read_aloud=any(w in heard and w not in normalize(words) for w in tag_words),
                 added_s=round(r["seconds"] - plain["seconds"], 2))
        rows.append(r)
        print(json.dumps({k: r[k] for k in ("tag", "wer", "tag_read_aloud", "added_s", "heard")}), flush=True)
    log = {"load_s": load_s, "plain": plain, "tags": rows,
           "rtf": round(sum(r["wall_s"] for r in rows) / max(0.01, sum(r["audio_s"] for r in rows)), 2),
           "peak_rss_gb": round(resource.getrusage(resource.RUSAGE_SELF).ru_maxrss / 1024 / 1024, 2)}
    (out / "tags.json").write_text(json.dumps(log, indent=2, ensure_ascii=False), "utf-8")
    print(json.dumps({"done": {"rtf": log["rtf"], "peak_rss_gb": log["peak_rss_gb"]}}), flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
