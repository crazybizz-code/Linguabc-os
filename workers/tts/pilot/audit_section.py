"""Audit a rendered section segment by segment (run in the Qwen venv).

    python pilot/audit_section.py --report <section.report.json> --cache <segment-cache> --voices-dir <voices> --out <dir>

For every accepted segment:
  * words: WER against the script, words ASR was unsure of, phrases said
    twice that the script says once (loops);
  * speaker drift: similarity to the voice's own centroid and to its
    reference clip, and whether the voice moves between the first and the
    last third of the section;
  * rate: words per minute (flags outside 110-220).
Writes audit.json and audit.md. Automatic checks support, not replace,
listening.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import numpy as np
import soundfile as sf

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent))

from linguabc_tts import audio as A  # noqa: E402
from linguabc_tts.cache import SegmentCache  # noqa: E402
from linguabc_tts.qa import ResemblyzerEmbedder, normalize, repeated_phrases, wer  # noqa: E402

DRIFT_MIN = 0.80


def cos(a, b):
    return float(a @ b / ((np.linalg.norm(a) * np.linalg.norm(b)) + 1e-9))


def diff_words(ref: str, hyp: str) -> list[str]:
    r, h = normalize(ref), normalize(hyp)
    return [w for w in r if w not in h] + [f"+{w}" for w in h if w not in r]


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--report", required=True)
    ap.add_argument("--cache", required=True)
    ap.add_argument("--voices-dir", required=True)
    ap.add_argument("--out", required=True)
    args = ap.parse_args()
    rep = json.loads(Path(args.report).read_text())
    cache = SegmentCache(args.cache)
    emb = ResemblyzerEmbedder()
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)

    rows, vecs = [], {}
    for i, p in enumerate(rep["segments"]):
        hit = cache.get("platform", p["hash"])
        row = {"n": i + 1, "voice": p["voice"], "text": p["text"], "heard": p["heard"], "status": p["status"],
               "attempts": p["attempts"], "wer": round(wer(p["text"], p["heard"]), 3),
               "word_diffs": diff_words(p["text"], p["heard"]), "loops": repeated_phrases(p["text"], p["heard"]),
               "unclear": p.get("unclear", []), "wpm": p.get("wpm"), "review": p.get("review", [])}
        if hit is not None and hit.audio.size >= hit.sr:
            v = emb.embed(hit.audio, hit.sr)
            vecs.setdefault(p["voice"], []).append((i, v))
            row["seconds"] = round(hit.audio.size / hit.sr, 2)
        rows.append(row)

    refs = {}
    for name in vecs:
        a, sr = sf.read(Path(args.voices_dir) / f"{name}.wav", dtype="float32")
        refs[name] = emb.embed(A.trim(a, sr), sr)
    drift = {}
    for name, items in vecs.items():
        m = np.stack([v / np.linalg.norm(v) for _, v in items])
        centre = m.mean(0)
        third = max(1, len(items) // 3)
        first, last = m[:third].mean(0), m[-third:].mean(0)
        drift[name] = {"segments": len(items), "first_vs_last_third": round(cos(first, last), 3),
                       "min_to_centroid": round(float(min(cos(v, centre) for v in m)), 3),
                       "mean_to_reference": round(float(np.mean([cos(v, refs[name]) for v in m])), 3)}
        for (i, v) in items:
            rows[i]["to_centroid"] = round(cos(v, centre), 3)
            rows[i]["to_reference"] = round(cos(v, refs[name]), 3)

    flags = {
        "words_off": [r for r in rows if r["wer"] > 0],
        "loops": [r for r in rows if r["loops"]],
        "unclear": [r for r in rows if r["unclear"]],
        "drift": [r for r in rows if r.get("to_centroid", 1) < DRIFT_MIN],
        "rate": [r for r in rows if r.get("wpm") and len(r["text"].split()) >= 5 and not 110 <= r["wpm"] <= 220],
        "retried": [r for r in rows if r["attempts"] > 1],
        "failed": [r for r in rows if r["status"] != "pass"],
    }
    result = {"segments": len(rows), "drift": drift, "counts": {k: len(v) for k, v in flags.items()}, "flags": flags, "rows": rows}
    (out / "audit.json").write_text(json.dumps(result, indent=2, ensure_ascii=False), "utf-8")

    md = [f"# Section audit ({len(rows)} segments)", "", "## Speaker drift", "",
          "| Voice | Segments | First vs last third | Min to centroid | Mean to reference |", "|---|---|---|---|---|"]
    md += [f"| {n} | {d['segments']} | {d['first_vs_last_third']} | {d['min_to_centroid']} | {d['mean_to_reference']} |" for n, d in drift.items()]
    md += ["", "## Flags", ""] + [f"- **{k}**: {len(v)}" for k, v in flags.items()]
    for k in ("words_off", "loops", "unclear", "drift", "rate", "failed"):
        if flags[k]:
            md += ["", f"### {k}", "", "| # | Voice | Script | Heard | Detail |", "|---|---|---|---|---|"]
            for r in flags[k]:
                detail = {"words_off": r["word_diffs"], "loops": r["loops"], "unclear": r["unclear"],
                          "drift": r.get("to_centroid"), "rate": r.get("wpm"), "failed": r["status"]}[k]
                md.append(f"| {r['n']} | {r['voice']} | {r['text'][:70]} | {r['heard'][:70]} | {detail} |")
    (out / "audit.md").write_text("\n".join(md) + "\n", "utf-8")
    print(json.dumps({"counts": result["counts"], "drift": drift}, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
