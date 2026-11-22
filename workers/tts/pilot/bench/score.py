"""Score every engine's bench output the same way (run in the Qwen venv).

    python pilot/bench/score.py --bench pilot/out/bench --accent-dir <CommonAccent dir> --cc0-dir <data dir>

Per engine: IELTS accuracy and retries (from run.json), accent votes per
8-second window (CommonAccent), speaker similarity to the reference and
consistency between windows (Resemblyzer), expression A/B (prosody change
and timbre kept), speed and memory. Writes summary.json and summary.md.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import numpy as np
import soundfile as sf

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent.parent))
sys.path.insert(0, str(HERE))

from cases import AB_TAGS, CC0_REFERENCES, REFERENCES  # noqa: E402
from linguabc_tts import audio as A  # noqa: E402
from linguabc_tts.accent import AccentClassifier  # noqa: E402
from linguabc_tts.prosody import compare, measure  # noqa: E402
from linguabc_tts.qa import ResemblyzerEmbedder, speaker_consistency  # noqa: E402

SR = 24000


def cos(a, b):
    return float(a @ b / ((np.linalg.norm(a) * np.linalg.norm(b)) + 1e-9))


def windows(audio, sr, seconds=8):
    n = sr * seconds
    out = [audio[i:i + n] for i in range(0, max(1, audio.size - n // 2), n)]
    return [w for w in out if A.trim(w, sr).size > sr * 3]


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--bench", required=True)
    ap.add_argument("--accent-dir", required=True)
    ap.add_argument("--cc0-dir", required=True)
    args = ap.parse_args()
    bench = Path(args.bench)
    acc = AccentClassifier(args.accent_dir, savedir=bench / "_accent")
    emb = ResemblyzerEmbedder()

    def load_ref(path):
        a, sr = sf.read(path, dtype="float32")
        a = a.mean(1) if a.ndim > 1 else a
        return A.trim(A.resample(a, sr, SR), SR)

    refs = {n: load_ref(p) for n, (p, *_r) in REFERENCES.items()}
    refs |= {n: load_ref(Path(args.cc0_dir) / f) for n, (f, *_r) in CC0_REFERENCES.items()}
    ref_emb = {n: emb.embed(a, SR) for n, a in refs.items()}
    intended = {n: v[2] for n, v in REFERENCES.items()} | {n: v[1] for n, v in CC0_REFERENCES.items()}

    summary = {}
    for d in sorted(p for p in bench.iterdir() if p.is_dir() and (p / "run.json").exists()):
        run = json.loads((d / "run.json").read_text())
        e = summary[d.name] = {"model": run["model"], "load_s": run["load_s"], "totals": run.get("totals"), "cases": {}, "ab": {}}
        for case, m in run["cases"].items():
            row = {k: m[k] for k in ("status", "wer", "answers_missing", "failed", "segments", "attempts", "rtf", "seconds", "failures", "review")}
            mp3 = d / f"{case}.mp3"
            voice = case.split("-", 1)[1] if "-" in case else None
            if mp3.exists():
                audio = A.decode_mp3(mp3.read_bytes(), SR)
                ws = windows(audio, SR)
                if ws:
                    scores = [acc.scores(w, SR) for w in ws]
                    row["accent_votes"] = {g: sum(s["group"] == g for s in scores) for g in ("british", "american", "australian")}
                    if voice in ref_emb:
                        vecs = [emb.embed(w, SR) for w in ws]
                        row["intended_accent"] = intended[voice]
                        row["similarity_to_reference"] = round(float(np.mean([cos(ref_emb[voice], v) for v in vecs])), 3)
                        row["consistency_min"] = round(speaker_consistency({voice: vecs})[voice] or 0, 3) if len(vecs) > 1 else None
            e["cases"][case] = row
        for tag in AB_TAGS:
            n, s = d / "ab" / f"{tag}-neutral.wav", d / "ab" / f"{tag}-styled.wav"
            if n.exists() and s.exists():
                a1, sr1 = sf.read(n, dtype="float32")
                a2, sr2 = sf.read(s, dtype="float32")
                a1, a2 = A.resample(a1, sr1, SR), A.resample(a2, sr2, SR)
                if A.trim(a1, SR).size > SR and A.trim(a2, SR).size > SR:
                    c = compare(tag, measure(a1, SR), measure(a2, SR))
                    e["ab"][tag] = {"measurable_effect": c["measurable_effect"],
                                    "changes": {k: c[k] for k in ("f0_median_change_st", "f0_range_change_st", "end_rise_change_st", "loudness_change_db", "duration_change_pct")},
                                    "timbre_kept": round(cos(emb.embed(A.trim(a1, SR), SR), emb.embed(A.trim(a2, SR), SR)), 3)}
                else:
                    e["ab"][tag] = {"measurable_effect": None, "note": "silent clip"}
    (bench / "summary.json").write_text(json.dumps(summary, indent=2, ensure_ascii=False, default=str), "utf-8")

    lines = ["| Engine | Case | Status | WER | Answers missing | Attempts/segments | RTF | Accent votes (Br/Am/Au) | Sim. to ref | Consistency |", "|---|---|---|---|---|---|---|---|---|---|"]
    for eng, e in summary.items():
        for case, r in e["cases"].items():
            v = r.get("accent_votes") or {}
            lines.append(f"| {eng} | {case} | {r['status']} | {r['wer']} | {r['answers_missing']} | {r['attempts']}/{r['segments']} | {r['rtf']} | "
                         f"{v.get('british', '-')}/{v.get('american', '-')}/{v.get('australian', '-')} | {r.get('similarity_to_reference', '-')} | {r.get('consistency_min', '-')} |")
    lines += ["", "| Engine | Tag | Measurable effect | Changes | Timbre kept |", "|---|---|---|---|---|"]
    for eng, e in summary.items():
        for tag, r in e["ab"].items():
            lines.append(f"| {eng} | {tag} | {r.get('measurable_effect')} | {r.get('changes', r.get('note'))} | {r.get('timbre_kept', '-')} |")
    lines += ["", "| Engine | Load s | Engine calls | Generated audio s | Engine wall s | RTF | Peak RAM GB |", "|---|---|---|---|---|---|---|"]
    for eng, e in summary.items():
        t = e.get("totals") or {}
        lines.append(f"| {eng} | {e['load_s']} | {t.get('engine_calls')} | {t.get('generated_audio_s')} | {t.get('engine_wall_s')} | {t.get('rtf')} | {t.get('peak_rss_gb')} |")
    (bench / "summary.md").write_text("\n".join(lines) + "\n", "utf-8")
    print("\n".join(lines))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
