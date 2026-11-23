"""Real-inference pilot: three LinguABC recordings with Qwen3-TTS on CPU.

    python pilot/run_pilot.py --model-dir <qwen weights> --asr-dir <faster-whisper dir> --out <dir>

Scripts are written in the app's own format and planned by the app's code
(src/lib/ai/script.ts -> planScript, run with node), so the worker gets
exactly what production would send. For each recording it writes
<name>.mp3 and <name>.report.json; expression A/B clips go in ab/; and
summary.json collects ASR, expression, speaker and timing results.
"""

from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[2]
sys.path.insert(0, str(HERE.parent))

from linguabc_tts import audio as A  # noqa: E402
from linguabc_tts.cache import SegmentCache  # noqa: E402
from linguabc_tts.engines import GenerationConfig, QwenEngine  # noqa: E402
from linguabc_tts.expressions import INSTRUCTIONS  # noqa: E402
from linguabc_tts.license import check_weights_license  # noqa: E402
from linguabc_tts.pipeline import QaConfig, render  # noqa: E402
from linguabc_tts.plan import parse_request  # noqa: E402
from linguabc_tts.prosody import compare, measure  # noqa: E402
from linguabc_tts.qa import FasterWhisperTranscriber, ResemblyzerEmbedder, cross_similarity, wer  # noqa: E402

SCRIPTS = {
    "1-narration": {
        "cast": {"Narrator": "Ryan"},
        "answers": [["10th of January"], ["1863"], ["38,000"]],
        "script": """Narrator: This is an IELTS Listening test. There are four parts to the test. You will hear each part once only. As you listen, answer the questions.
Narrator: Part Four. You will hear a lecture about the history of the London Underground. First, you have some time to look at questions 31 to 40.
[pause 5]
Narrator: Now listen carefully and answer questions 31 to 40.
Narrator: Good afternoon. Today I'm going to talk about the world's first underground railway. It opened in London on the 10th of January 1863, and on its first day it carried around 38,000 passengers. The trains were pulled by steam engines, so the tunnels were often full of smoke.""",
    },
    "2-conversation": {
        "cast": {"Receptionist": "Ryan", "Woman": "Serena"},
        "answers": [["Thompson"], ["14th of June"], ["£95", "95 pounds"], ["three nights", "3 nights"]],
        "script": """Receptionist: Good morning, Riverside Hotel. How can I help you?
Woman: Hello. I'd like to book a double room for three nights, from the 14th of June.
Receptionist: Certainly. Could I have your surname, please?
Woman: Yes, it's Thompson. That's T-H-O-M-P-S-O-N.
Receptionist: Thank you, Ms Thompson. The room is £95 a night, and breakfast is included.
Woman: That sounds fine. And what time is check-in?
Receptionist: Check-in is from 2 pm, and check-out is at 11 am.""",
    },
    "3-podcast": {
        "cast": {"Host": "Aiden", "Guest": "Ryan"},
        "answers": [],
        "script": """Host: [excited] Welcome back to the LinguABC podcast! Today we're talking about how to improve your listening score.
Guest: Thanks for having me. It's a topic I really love.
Host: [curious] So, what's the biggest mistake students make in the listening test?
Guest: [serious] Honestly, they stop listening when they miss an answer. This is extremely important. You have to move on to the next question.
Host: [excited] That's such a useful tip!""",
    },
}

# Same sentence, same voice, same seed: with the instruction and without.
AB = [
    ("excited", "Aiden", "Welcome back to the LinguABC podcast! Today we're talking about how to improve your listening score."),
    ("curious", "Aiden", "So, what's the biggest mistake students make in the listening test?"),
    ("serious", "Ryan", "Honestly, they stop listening when they miss an answer. This is extremely important."),
]


def plan(script: str, cast: dict) -> list:
    """The app's planScript, so the plan is exactly what production sends."""
    code = ("import { planScript } from './src/lib/ai/script.ts';"
            "const { script, cast, voices } = JSON.parse(process.argv[1]);"
            "console.log(JSON.stringify(planScript(script, cast, voices.map((id) => ({ id, label: id })))));")
    voices = ["Ryan", "Aiden", "Serena", "Vivian"]
    out = subprocess.run(["node", "--no-warnings", "--input-type=module", "-e", code, json.dumps({"script": script, "cast": cast, "voices": voices})],
                         cwd=ROOT, capture_output=True, text=True, check=True)
    return json.loads(out.stdout)


class Timed:
    """Wraps the engine to time each call (real-time factor on this CPU)."""

    def __init__(self, engine):
        self.engine, self.log = engine, []
        self.provider, self.model_id = engine.provider, engine.model_id

    def voices(self):
        return self.engine.voices()

    def takes_instruct(self, voice):
        return self.engine.takes_instruct(voice)

    def synthesize(self, text, voice, instruct, language, seed):
        t = time.monotonic()
        audio, sr = self.engine.synthesize(text, voice, instruct, language, seed)
        self.log.append({"text": text[:60], "voice": voice, "compute_s": round(time.monotonic() - t, 1), "audio_s": round(audio.size / sr, 2)})
        return audio, sr


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--model-dir", required=True)
    ap.add_argument("--asr-dir", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--only", help="comma-separated recording names")
    ap.add_argument("--skip-ab", action="store_true")
    ap.add_argument("--max-attempts", type=int, default=3)
    ap.add_argument("--cache-dir", help="segment cache (default: <out>/segment-cache)")
    args = ap.parse_args()
    out = Path(args.out)
    (out / "ab").mkdir(parents=True, exist_ok=True)

    summary: dict = {"weights_license": check_weights_license(args.model_dir), "cpu_threads": os.cpu_count(),
                     "dtype": os.environ.get("QWEN_CPU_DTYPE", "float32"), "recordings": {}, "expression_ab": []}
    t0 = time.monotonic()
    config = GenerationConfig()
    engine = Timed(QwenEngine(args.model_dir, config=config))
    summary["load_s"] = round(time.monotonic() - t0, 1)
    summary["voices"] = engine.voices()
    asr = FasterWhisperTranscriber(args.asr_dir, device="cpu")
    embedder = ResemblyzerEmbedder()
    cache = SegmentCache(args.cache_dir or out / "segment-cache")
    params = config.as_params()

    names = [n.strip() for n in (args.only or ",".join(SCRIPTS)).split(",")]
    for name in names:
        s = SCRIPTS[name]
        req = parse_request({"version": 1, "scope": "platform", "language": "English", "plan": plan(s["script"], s["cast"]),
                             "checks": {"answers": s["answers"]}})
        start = len(engine.log)
        t = time.monotonic()
        res = render(req, engine, asr, cache, qa=QaConfig(max_attempts=args.max_attempts), embedder=embedder, params=params)
        took = time.monotonic() - t
        (out / f"{name}.report.json").write_text(json.dumps(res.report, indent=2, ensure_ascii=False, default=str), "utf-8")
        if res.mp3:
            (out / f"{name}.mp3").write_bytes(res.mp3)
        calls = engine.log[start:]
        # Cross-speaker check for the conversation: two voices should be easy to tell apart.
        cross = None
        if res.ok and len({p["voice"] for p in res.report["segments"]}) > 1:
            by_voice: dict = {}
            for p in res.report["segments"]:
                hit = cache.get("platform", p["hash"])
                if hit is not None and hit.audio.size >= hit.sr * 1.5:
                    by_voice.setdefault(p["voice"], []).append(embedder.embed(hit.audio, hit.sr))
            v = sorted(by_voice)
            cross = {f"{v[0]}~{v[1]}": round(cross_similarity(by_voice[v[0]], by_voice[v[1]]), 3)} if len(v) == 2 else None
        summary["recordings"][name] = {
            "file": str(out / f"{name}.mp3") if res.mp3 else None,
            "status": res.report["status"], "duration_s": res.seconds, "wall_s": round(took, 1),
            "wer": res.report.get("wer"), "answers_missing": res.report.get("answers_missing"),
            "problems": res.report.get("problems", []), "failed_segments": res.report["failed_segments"],
            "segment_wer": [(p["voice"], p["expression"], p["wer"], p["attempts"], p["status"]) for p in res.report["segments"]],
            "speaker_consistency": res.report.get("speaker_consistency"), "cross_speaker_similarity": cross,
            "loudness": res.report.get("loudness"), "engine_calls": len(calls),
            "rtf": round(sum(c["compute_s"] for c in calls) / max(0.01, sum(c["audio_s"] for c in calls)), 2) if calls else None,
            "experimental_expressions_used": res.report.get("experimental_expressions_used"),
        }
        print(json.dumps({name: summary["recordings"][name]}, ensure_ascii=False, default=str), flush=True)
        (out / "summary.json").write_text(json.dumps(summary, indent=2, ensure_ascii=False, default=str), "utf-8")

    if not args.skip_ab:
        for tag, voice, text in AB:
            seed = 4242
            pair = {}
            for label, instruct in (("neutral", None), (tag, INSTRUCTIONS[tag][0])):
                audio, sr = engine.synthesize(text, voice, instruct, "English", seed)
                clip = A.trim(audio, sr)
                (out / "ab" / f"{tag}-{label}.mp3").write_bytes(A.encode_mp3(A.normalize_loudness(clip, sr)[0], sr))
                pair[label] = (clip, sr, asr.transcribe(audio, sr, "English"))
            p_neutral, p_styled = measure(*pair["neutral"][:2]), measure(*pair[tag][:2])
            summary["expression_ab"].append({
                "tag": tag, "voice": voice, "instruct": INSTRUCTIONS[tag][0],
                "files": [str(out / "ab" / f"{tag}-neutral.mp3"), str(out / "ab" / f"{tag}-{tag}.mp3")],
                "neutral": p_neutral.as_dict(), "styled": p_styled.as_dict(), "comparison": compare(tag, p_neutral, p_styled),
                "wer_neutral": round(wer(text, pair["neutral"][2]), 3), "wer_styled": round(wer(text, pair[tag][2]), 3),
            })
            print(json.dumps(summary["expression_ab"][-1]["comparison"] | {"tag": tag}), flush=True)
            (out / "summary.json").write_text(json.dumps(summary, indent=2, ensure_ascii=False, default=str), "utf-8")

    summary["total_wall_s"] = round(time.monotonic() - t0, 1)
    summary["engine_log"] = engine.log
    (out / "summary.json").write_text(json.dumps(summary, indent=2, ensure_ascii=False, default=str), "utf-8")
    print(f"done in {summary['total_wall_s']}s -> {out}", flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
