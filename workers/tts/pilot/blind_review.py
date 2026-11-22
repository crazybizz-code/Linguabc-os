"""Blind listening review kit: Qwen vs Fish (and any other engine).

    python pilot/blind_review.py --out <dir> \
        --item qwen-clone:british-female=<file.mp3> --item fish:part1=<file.mp3> ... \
        [--fish-dir <folder of Fish MP3s>]

Every file is copied under a random 6-character name, so listeners cannot
tell the engine. Writes:
  review-sheet.md  - what listeners fill in (1-5 scores, accent heard, issues)
  review-sheet.csv - the same, for a spreadsheet
  key.json         - which file is which engine (open only after scoring)

Fish samples: put existing Fish recordings (e.g. the Listening Test 1 part
the owner recorded) in --fish-dir; nothing is generated or fetched here,
so no Fish credits are spent and production is not touched.
"""

from __future__ import annotations

import argparse
import csv
import json
import random
import shutil
from pathlib import Path

QUESTIONS = [
    ("natural", "Natural, human-sounding (1-5)"),
    ("clarity", "Clear enough for an IELTS answer (1-5)"),
    ("accent_heard", "Accent you hear (British / American / Australian / other)"),
    ("accent_ok", "Accent consistent with what it should be? (y/n)"),
    ("emotion", "Expression fits the words (1-5, or n/a)"),
    ("issues", "Glitches: skipped/repeated words, odd pauses, robotic, noise"),
    ("ielts_ready", "Would you use this in a real mock? (y/n)"),
]


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", required=True)
    ap.add_argument("--item", action="append", default=[], help="engine:label=path.mp3")
    ap.add_argument("--fish-dir")
    ap.add_argument("--seed", type=int, default=11)
    args = ap.parse_args()
    items = []
    for spec in args.item:
        tag, path = spec.split("=", 1)
        engine, label = tag.split(":", 1)
        items.append((engine, label, Path(path)))
    if args.fish_dir:
        items += [("fish", p.stem, p) for p in sorted(Path(args.fish_dir).glob("*.mp3"))]
    out = Path(args.out)
    (out / "audio").mkdir(parents=True, exist_ok=True)
    rng = random.Random(args.seed)
    rng.shuffle(items)
    key, rows = [], []
    used = set()
    for engine, label, path in items:
        code = f"{rng.randrange(16**6):06x}"
        while code in used:
            code = f"{rng.randrange(16**6):06x}"
        used.add(code)
        shutil.copyfile(path, out / "audio" / f"{code}.mp3")
        key.append({"file": f"{code}.mp3", "engine": engine, "label": label, "source": str(path)})
        rows.append(code)
    md = ["# Blind listening review", "",
          "Listen to every file in `audio/` (any order). Score each one. Do not open `key.json` until all scores are in.",
          "Use headphones. For IELTS, judge as an examiner would: could a B1-B2 student catch every answer?", "",
          "| File | " + " | ".join(q for _, q in QUESTIONS) + " |", "|" + "---|" * (len(QUESTIONS) + 1)]
    md += [f"| {c}.mp3 |" + " |" * len(QUESTIONS) for c in rows]
    md += ["", f"{len(rows)} files. Fish files included: {sum(k['engine'] == 'fish' for k in key)}."]
    (out / "review-sheet.md").write_text("\n".join(md) + "\n", "utf-8")
    with open(out / "review-sheet.csv", "w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(["file", *[k for k, _ in QUESTIONS]])
        w.writerows([[f"{c}.mp3"] + [""] * len(QUESTIONS) for c in rows])
    (out / "key.json").write_text(json.dumps(key, indent=2), "utf-8")
    print(f"{len(rows)} files -> {out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
