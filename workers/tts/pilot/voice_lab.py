"""VoiceDesign vs Base cloning, on real Qwen3-TTS (CPU is fine, slow).

    python pilot/voice_lab.py --design-dir <VoiceDesign weights> --base-dir <Base weights> \
        --asr-dir <faster-whisper dir> --accent-dir <CommonAccent dir> --out <dir>

For each designed voice (British female/male, Australian female, American female):
  1. VoiceDesign makes a reference clip from the description;
  2. VoiceDesign speaks 4 test lines from the same description (does the
     timbre drift between calls?);
  3. Base clones the reference clip and speaks the same 4 lines;
  4. every clip gets ASR (WER), an accent score (CommonAccent) and a
     speaker embedding (Resemblyzer): consistency within each method, and
     similarity of each line to the reference;
  5. emotion: VoiceDesign with the description plus an expression
     instruction vs without (same seed), measured with prosody.
Base cannot take instructions, so step 5 has no Base counterpart.

Writes references to <out>/voices/<name>.wav + .txt (for the section run),
every clip as MP3 under <out>/clips, and lab.json.
"""

from __future__ import annotations

import argparse
import gc
import json
import resource
import sys
import time
from pathlib import Path

import numpy as np

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent))

from linguabc_tts import audio as A  # noqa: E402
from linguabc_tts.accent import AccentClassifier  # noqa: E402
from linguabc_tts.engines import QwenCloneEngine, QwenDesignEngine  # noqa: E402
from linguabc_tts.expressions import INSTRUCTIONS  # noqa: E402
from linguabc_tts.license import check_weights_license  # noqa: E402
from linguabc_tts.prosody import compare, measure  # noqa: E402
from linguabc_tts.qa import FasterWhisperTranscriber, ResemblyzerEmbedder, speaker_consistency, wer  # noqa: E402

VOICES = {
    "Emma": ("british", "A woman in her early thirties with a natural Southern British English accent, standard Received "
             "Pronunciation as heard in London. Warm, clear and friendly voice, medium pitch, calm natural pace, like a BBC radio presenter."),
    "Oliver": ("british", "A man in his forties with a natural British English accent, Received Pronunciation. Deep, clear, "
               "confident voice, measured pace, like a university lecturer in London."),
    "Chloe": ("australian", "A young woman in her twenties with a natural Australian English accent from Sydney. Bright, "
              "friendly and relaxed voice, natural conversational pace."),
    "Hannah": ("american", "A woman in her thirties with a natural General American English accent. Clear, warm, professional "
               "voice, medium pitch, natural pace, like a public radio host."),
}
REFERENCE = ("Good morning. I'd like to tell you a little about our city library. It opens at half past nine, "
             "and you can borrow up to six books at a time.")
LINES = [
    "Could you tell me how much the tickets cost for the guided tour?",
    "The castle was built in the twelfth century, and it's open every day except Monday.",
    "My surname is Harrison, that's H-A-R-R-I-S-O-N, and I live at 24 Park Road.",
    "I'm afraid the last bus to the city centre leaves at a quarter past eleven.",
]
EMOTION_LINE = "We've just heard the results of the competition, and our team came first."
EMOTIONS = ["excited", "serious", "curious"]
SEED = 2026


def peak_rss_gb() -> float:
    return round(resource.getrusage(resource.RUSAGE_SELF).ru_maxrss / 1024 / 1024, 2)


def main() -> int:
    ap = argparse.ArgumentParser()
    for a in ("--design-dir", "--base-dir", "--asr-dir", "--accent-dir", "--out"):
        ap.add_argument(a, required=True)
    ap.add_argument("--voices", default=",".join(VOICES))
    ap.add_argument("--skip-design", action="store_true",
                    help="score the VoiceDesign clips already in <out>/clips instead of generating them again")
    args = ap.parse_args()
    out = Path(args.out)
    (out / "clips").mkdir(parents=True, exist_ok=True)
    (out / "voices").mkdir(parents=True, exist_ok=True)
    names = [v.strip() for v in args.voices.split(",")]

    asr = FasterWhisperTranscriber(args.asr_dir, device="cpu")
    emb = ResemblyzerEmbedder()
    acc = AccentClassifier(args.accent_dir, savedir=out / "_accent")
    lab: dict = {"licences": {"design": check_weights_license(args.design_dir), "base": check_weights_license(args.base_dir)},
                 "voices": {}, "timing": []}

    def save(name: str, audio: np.ndarray, sr: int) -> str:
        clip = A.trim(audio, sr)
        path = out / "clips" / f"{name}.mp3"
        path.write_bytes(A.encode_mp3(A.normalize_loudness(clip, sr)[0], sr))
        return str(path)

    def score(text: str, audio: np.ndarray, sr: int) -> dict:
        clip = A.trim(audio, sr)
        if clip.size < sr * 0.5:
            return {"wer": 1.0, "heard": "", "accent": {"top": None, "top_p": 0, "groups": {g: 0.0 for g in ("british", "american", "australian")}, "group": None},
                    "unclear": [], "seconds": round(clip.size / sr, 2), "_emb": None, "silent": True}
        heard = asr.transcribe(audio, sr, "English")
        return {"wer": round(wer(text, heard), 3), "heard": heard, "accent": acc.scores(clip, sr),
                "unclear": [w for w, p in (asr.last_words or []) if p < 0.5], "seconds": round(clip.size / sr, 2),
                "_emb": emb.embed(clip, sr)}

    def timed(label: str, fn):
        t, c = time.monotonic(), time.process_time()
        audio, sr = fn()
        lab["timing"].append({"what": label, "wall_s": round(time.monotonic() - t, 1), "cpu_s": round(time.process_time() - c, 1),
                              "audio_s": round(audio.size / sr, 2)})
        return audio, sr

    refs: dict = {}
    if args.skip_design:
        import soundfile as sf
        sr = 24000
        def load(name):
            return A.decode_mp3((out / "clips" / f"{name}.mp3").read_bytes(), sr)
        for n in names:
            v = lab["voices"][n] = {"intended": VOICES[n][0], "description": VOICES[n][1], "design": [], "clone": [], "emotion": [],
                                    "note": "design clips scored from the saved MP3s (loudness-normalised: no loudness deltas)"}
            ref, rsr = sf.read(out / "voices" / f"{n}.wav", dtype="float32")
            refs[n] = (ref, rsr)
            v["reference"] = {"file": str(out / "clips" / f"{n}-reference.mp3"), **score(REFERENCE, ref, rsr)}
            for i, line in enumerate(LINES):
                v["design"].append({"file": str(out / "clips" / f"{n}-design-{i + 1}.mp3"), "text": line, **score(line, load(f"{n}-design-{i + 1}"), sr)})
            for tag in EMOTIONS:
                neutral, styled = load(f"{n}-emotion-{tag}-neutral"), load(f"{n}-emotion-{tag}-{tag}")
                pn, ps = measure(A.trim(neutral, sr), sr), measure(A.trim(styled, sr), sr)
                v["emotion"].append({"tag": tag, "files": [str(out / "clips" / f"{n}-emotion-{tag}-{x}.mp3") for x in ("neutral", tag)],
                                     "comparison": compare(tag, pn, ps), "wer_styled": round(wer(EMOTION_LINE, asr.transcribe(styled, sr, "English")), 3),
                                     "timbre_vs_neutral": round(float(_cos(emb.embed(A.trim(neutral, sr), sr), emb.embed(A.trim(styled, sr), sr))), 3)})
            print(json.dumps({n: "design scored"}), flush=True)
    names_to_design = [] if args.skip_design else names
    if names_to_design:
        t0 = time.monotonic()
        design = QwenDesignEngine(args.design_dir, {n: VOICES[n][1] for n in names})
        lab["design_load_s"] = round(time.monotonic() - t0, 1)
    for n in names_to_design:
        v = lab["voices"][n] = {"intended": VOICES[n][0], "description": VOICES[n][1], "design": [], "clone": [], "emotion": []}
        audio, sr = timed(f"design ref {n}", lambda: design.synthesize(REFERENCE, n, None, "English", SEED))
        ref = A.trim(audio, sr)
        refs[n] = (ref, sr)
        import soundfile as sf
        sf.write(out / "voices" / f"{n}.wav", ref, sr)
        (out / "voices" / f"{n}.txt").write_text(REFERENCE, "utf-8")
        v["reference"] = {"file": save(f"{n}-reference", audio, sr), **score(REFERENCE, audio, sr)}
        for i, line in enumerate(LINES):
            audio, sr = timed(f"design line {n}", lambda: design.synthesize(line, n, None, "English", SEED + i))
            v["design"].append({"file": save(f"{n}-design-{i + 1}", audio, sr), "text": line, **score(line, audio, sr)})
        for tag in EMOTIONS:
            pair = {}
            for label, instruct in (("neutral", None), (tag, INSTRUCTIONS[tag][0])):
                audio, sr = timed(f"design emotion {n}", lambda: design.synthesize(EMOTION_LINE, n, instruct, "English", SEED + 99))
                pair[label] = (A.trim(audio, sr), sr, save(f"{n}-emotion-{tag}-{label}", audio, sr), asr.transcribe(audio, sr, "English"))
            pn, ps = measure(*pair["neutral"][:2]), measure(*pair[tag][:2])
            v["emotion"].append({"tag": tag, "files": [pair["neutral"][2], pair[tag][2]], "comparison": compare(tag, pn, ps),
                                 "wer_styled": round(wer(EMOTION_LINE, pair[tag][3]), 3),
                                 "timbre_vs_neutral": round(float(_cos(emb.embed(pair["neutral"][0], sr), emb.embed(pair[tag][0], sr))), 3)})
        print(json.dumps({n: "design done"}), flush=True)
    lab["design_peak_rss_gb"] = peak_rss_gb()
    if names_to_design:
        del design
    gc.collect()

    # 3: Base clones the designed reference
    t0 = time.monotonic()
    clone = QwenCloneEngine(args.base_dir, {n: (refs[n][0], refs[n][1], REFERENCE) for n in names})
    lab["base_load_s"] = round(time.monotonic() - t0, 1)
    for n in names:
        v = lab["voices"][n]
        v["clone_silent_takes"] = 0
        for i, line in enumerate(LINES):
            for attempt in range(3):
                audio, sr = timed(f"clone line {n}", lambda: clone.synthesize(line, n, None, "English", SEED + i + 1000 * attempt))
                if A.trim(audio, sr).size >= sr * 0.5:
                    break
                v["clone_silent_takes"] += 1  # the Base model sometimes returns silence: try another seed
            v["clone"].append({"file": save(f"{n}-clone-{i + 1}", audio, sr), "text": line, "takes": attempt + 1, **score(line, audio, sr)})
        print(json.dumps({n: "clone done", "clips": [(c["seconds"], c["wer"], c["accent"]["group"]) for c in v["clone"]]}), flush=True)
        (out / "lab.partial.json").write_text(json.dumps(lab, ensure_ascii=False, default=lambda o: None), "utf-8")
    lab["peak_rss_gb"] = peak_rss_gb()

    # 4: summaries
    for n, v in lab["voices"].items():
        r = v["reference"]["_emb"]
        for method in ("design", "clone"):
            clips = v[method]
            vecs = [c["_emb"] for c in clips if c["_emb"] is not None]
            v[f"{method}_summary"] = {
                "consistency_min": round(speaker_consistency({n: vecs})[n] or 0, 3) if len(vecs) > 1 else None,
                "silent_clips": sum(1 for c in clips if c.get("silent")),
                "similarity_to_reference": [round(float(_cos(r, x)), 3) for x in vecs],
                "mean_wer": round(float(np.mean([c["wer"] for c in clips])), 3),
                "accent_group_votes": [c["accent"]["group"] for c in clips],
                "accent_intended_share": round(float(np.mean([c["accent"]["groups"][v["intended"]] for c in clips])), 3),
                "unclear_words": sorted({w for c in clips for w in c["unclear"]}),
            }
    for v in lab["voices"].values():
        for c in [v["reference"], *v["design"], *v["clone"]]:
            c.pop("_emb", None)
    t = lab["timing"]
    lab["rtf_overall"] = round(sum(x["wall_s"] for x in t) / max(0.01, sum(x["audio_s"] for x in t)), 2)
    (out / "lab.json").write_text(json.dumps(lab, indent=2, ensure_ascii=False), "utf-8")
    print(json.dumps({n: {k: v[k] for k in ("design_summary", "clone_summary")} | {"emotion": [(e["tag"], e["comparison"]["measurable_effect"], e["wer_styled"], e["timbre_vs_neutral"]) for e in v["emotion"]]}
                      for n, v in lab["voices"].items()}, ensure_ascii=False), flush=True)
    print(f"done rtf={lab['rtf_overall']} peak_rss_gb={lab['peak_rss_gb']}", flush=True)
    return 0


def _cos(a: np.ndarray, b: np.ndarray) -> float:
    return float(a @ b / ((np.linalg.norm(a) * np.linalg.norm(b)) + 1e-9))


if __name__ == "__main__":
    raise SystemExit(main())
