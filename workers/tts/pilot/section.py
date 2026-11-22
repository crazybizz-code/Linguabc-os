"""A full IELTS Listening section (Part 1, 7-8 minutes) on real Qwen3-TTS.

    python pilot/section.py --base-dir <Base weights> --voices-dir <voice-lab>/voices \
        --asr-dir <faster-whisper dir> --accent-dir <CommonAccent dir> --out <dir>

The script (section_part1.txt) goes through the app's own code: the exam
frame (src/lib/ai/listening-frame.ts -> frameListening: announcement, 30 s
reading time, mid-part break, 30 s check) and planScript. Voices are the
VoiceDesign references cloned with the Base model: Narrator = Oliver
(British male), Emma (British female, the sports centre), Chloe (Australian
female, the caller). Writes section.mp3, section.report.json (per segment:
ASR, attempts, unclear words) and section.summary.json (accent per voice,
speaker consistency, timing and memory).
"""

from __future__ import annotations

import argparse
import json
import resource
import subprocess
import sys
import time
from pathlib import Path

import numpy as np
import soundfile as sf

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[2]
sys.path.insert(0, str(HERE.parent))

from linguabc_tts.accent import AccentClassifier  # noqa: E402
from linguabc_tts.cache import SegmentCache  # noqa: E402
from linguabc_tts.engines import QwenCloneEngine  # noqa: E402
from linguabc_tts.license import check_weights_license  # noqa: E402
from linguabc_tts.pipeline import QaConfig, render  # noqa: E402
from linguabc_tts.plan import parse_request  # noqa: E402
from linguabc_tts.qa import FasterWhisperTranscriber, ResemblyzerEmbedder, cross_similarity, speaker_consistency  # noqa: E402

CAST = {"Narrator": "Oliver", "Emma": "Emma", "Chloe": "Chloe"}
INTENDED = {"Oliver": "british", "Emma": "british", "Chloe": "australian"}
ANSWERS = [["quarter to seven"], ["forty-two pounds", "£42"], ["car park"], ["tennis shoes"], ["eighteen pounds", "£18"],
           ["Pritchard"], ["twenty-seven Mill Street", "27 Mill Street"], ["shoulder"], ["fourteenth", "14th"], ["Daniel"]]


def app_plan(script: str) -> list:
    code = ("import { frameListening } from './src/lib/ai/listening-frame.ts';"
            "import { planScript } from './src/lib/ai/script.ts';"
            "const { script, cast } = JSON.parse(process.argv[1]);"
            "const framed = frameListening(script, 0, 1, 10);"
            "console.log(JSON.stringify({ framed, plan: planScript(framed, cast, Object.values(cast).map((id) => ({ id, label: id }))) }));")
    out = subprocess.run(["node", "--no-warnings", "--input-type=module", "-e", code, json.dumps({"script": script, "cast": CAST})],
                         cwd=ROOT, capture_output=True, text=True, check=True)
    return json.loads(out.stdout)


class Timed:
    def __init__(self, engine):
        self.engine, self.log = engine, []
        self.provider, self.model_id = engine.provider, engine.model_id
        self.voice_signature = engine.voice_signature

    def voices(self):
        return self.engine.voices()

    def takes_instruct(self, voice):
        return self.engine.takes_instruct(voice)

    def synthesize(self, text, voice, instruct, language, seed):
        t, c = time.monotonic(), time.process_time()
        audio, sr = self.engine.synthesize(text, voice, instruct, language, seed)
        self.log.append({"voice": voice, "words": len(text.split()), "wall_s": round(time.monotonic() - t, 1),
                         "cpu_s": round(time.process_time() - c, 1), "audio_s": round(audio.size / sr, 2)})
        return audio, sr


def main() -> int:
    ap = argparse.ArgumentParser()
    for a in ("--base-dir", "--voices-dir", "--asr-dir", "--accent-dir", "--out"):
        ap.add_argument(a, required=True)
    ap.add_argument("--max-attempts", type=int, default=4)
    args = ap.parse_args()
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    t0 = time.monotonic()

    planned = app_plan((HERE / "section_part1.txt").read_text("utf-8"))
    (out / "section.script.txt").write_text(planned["framed"], "utf-8")
    voices = {}
    for name in set(CAST.values()):
        audio, sr = sf.read(Path(args.voices_dir) / f"{name}.wav", dtype="float32")
        voices[name] = (audio, sr, (Path(args.voices_dir) / f"{name}.txt").read_text("utf-8").strip())
    engine = Timed(QwenCloneEngine(args.base_dir, voices))
    load_s = round(time.monotonic() - t0, 1)
    asr = FasterWhisperTranscriber(args.asr_dir, device="cpu")
    emb = ResemblyzerEmbedder()
    cache = SegmentCache(out / "segment-cache")

    req = parse_request({"version": 1, "scope": "platform", "language": "English", "plan": planned["plan"],
                         "checks": {"answers": ANSWERS}})
    t1 = time.monotonic()
    res = render(req, engine, asr, cache, qa=QaConfig(max_attempts=args.max_attempts), embedder=emb)
    render_s = round(time.monotonic() - t1, 1)
    (out / "section.report.json").write_text(json.dumps(res.report, indent=2, ensure_ascii=False, default=str), "utf-8")
    if res.mp3:
        (out / "section.mp3").write_bytes(res.mp3)

    # Accent and speaker checks per voice, on the accepted clips.
    acc = AccentClassifier(args.accent_dir, savedir=out / "_accent")
    per_voice: dict = {}
    vecs: dict = {}
    for p in res.report["segments"]:
        hit = cache.get("platform", p["hash"])
        if hit is None or hit.audio.size < hit.sr * 2:
            continue
        a = acc.scores(hit.audio, hit.sr)
        per_voice.setdefault(p["voice"], []).append(a)
        vecs.setdefault(p["voice"], []).append(emb.embed(hit.audio, hit.sr))
    accent = {v: {"intended": INTENDED[v], "segments": len(s),
                  "intended_share_mean": round(float(np.mean([x["groups"][INTENDED[v]] for x in s])), 3),
                  "votes": {g: sum(x["group"] == g for x in s) for g in ("british", "american", "australian")}}
              for v, s in per_voice.items()}
    names = sorted(vecs)
    cross = {f"{a}~{b}": round(cross_similarity(vecs[a], vecs[b]), 3) for i, a in enumerate(names) for b in names[i + 1:]}
    log = engine.log
    summary = {
        "file": str(out / "section.mp3") if res.mp3 else None,
        "weights_license": check_weights_license(args.base_dir),
        "status": res.report["status"], "problems": res.report.get("problems"), "duration_s": res.seconds,
        "wer": res.report.get("wer"), "answers_missing": res.report.get("answers_missing"),
        "segments": len(res.report["segments"]), "failed_segments": res.report["failed_segments"],
        "attempts_total": sum(p["attempts"] for p in res.report["segments"]),
        "retried_segments": [(p["voice"], p["text"][:60], p["attempts"], p["reasons"]) for p in res.report["segments"] if p["attempts"] > 1 or p["status"] != "pass"],
        "unclear_words": sorted({w for p in res.report["segments"] for w in p.get("unclear", [])}),
        "speaker_consistency": speaker_consistency(vecs), "cross_speaker_similarity": cross, "accent": accent,
        "loudness": res.report.get("loudness"),
        "timing": {"model_load_s": load_s, "render_wall_s": render_s, "engine_calls": len(log),
                   "speech_audio_s": round(sum(x["audio_s"] for x in log), 1), "engine_wall_s": round(sum(x["wall_s"] for x in log), 1),
                   "engine_cpu_s": round(sum(x["cpu_s"] for x in log), 1),
                   "rtf": round(sum(x["wall_s"] for x in log) / max(0.01, sum(x["audio_s"] for x in log)), 2),
                   "total_wall_s": round(time.monotonic() - t0, 1)},
        "peak_rss_gb": round(resource.getrusage(resource.RUSAGE_SELF).ru_maxrss / 1024 / 1024, 2),
    }
    (out / "section.summary.json").write_text(json.dumps(summary, indent=2, ensure_ascii=False, default=str), "utf-8")
    print(json.dumps(summary, ensure_ascii=False, default=str), flush=True)
    return 0 if res.ok else 2


if __name__ == "__main__":
    raise SystemExit(main())
