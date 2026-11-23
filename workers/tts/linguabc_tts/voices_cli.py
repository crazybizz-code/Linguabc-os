"""Manage the reference voice registry (see VOICES.md).

  python -m linguabc_tts.voices_cli add --registry voices/ --audio raw/emma.wav --record emma-gb.json
  python -m linguabc_tts.voices_cli approve --registry voices/ --id emma-gb --by owner
  python -m linguabc_tts.voices_cli list --registry voices/
  python -m linguabc_tts.voices_cli revoke --registry voices/ --id emma-gb

`add` validates consent and licence, checks and cleans the recording and
registers it unapproved; `approve` is a separate, deliberate step by a person
who has listened to it and seen the signed consent.
"""

from __future__ import annotations

import argparse
import datetime as dt
import json
import sys
from pathlib import Path

from .voices import VoiceNotAllowed, VoiceRegistry, check_record, prepare_reference


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(prog="voices_cli")
    sub = ap.add_subparsers(dest="cmd", required=True)
    a = sub.add_parser("add")
    a.add_argument("--registry", required=True)
    a.add_argument("--audio", required=True)
    a.add_argument("--record", required=True, help="JSON with id, accent, transcript, consent, licence, source")
    a.add_argument("--accent-model", help="CommonAccent model dir, to store an accent score")
    p = sub.add_parser("approve")
    p.add_argument("--registry", required=True)
    p.add_argument("--id", required=True)
    p.add_argument("--by", required=True)
    ls = sub.add_parser("list")
    ls.add_argument("--registry", required=True)
    r = sub.add_parser("revoke")
    r.add_argument("--registry", required=True)
    r.add_argument("--id", required=True)
    args = ap.parse_args(argv)
    reg = VoiceRegistry(args.registry)

    if args.cmd == "add":
        record = json.loads(Path(args.record).read_text("utf-8"))
        record.pop("approved_by", None)
        record.pop("approved_on", None)
        acc = None
        if args.accent_model:
            from .accent import AccentClassifier
            acc = AccentClassifier(args.accent_model)
        try:
            rec = prepare_reference(args.audio, record, args.registry, accent_classifier=acc)
        except VoiceNotAllowed as e:
            print(f"refused: {e}", file=sys.stderr)
            return 2
        print(json.dumps({"registered": rec["id"], "qa": rec["qa"], "next": "listen, check the signed consent, then approve"}, indent=2))
    elif args.cmd == "approve":
        meta = Path(args.registry) / f"{args.id}.json"
        rec = json.loads(meta.read_text("utf-8"))
        rec.update(approved_by=args.by, approved_on=dt.date.today().isoformat())
        problems = check_record(rec)
        if problems:
            print("refused: " + "; ".join(problems), file=sys.stderr)
            return 2
        meta.write_text(json.dumps(rec, indent=2, ensure_ascii=False), "utf-8")
        reg.get(args.id)  # also checks the audio hash
        print(f"approved {args.id}")
    elif args.cmd == "list":
        usable = reg.usable()
        for rec in reg.records():
            state = "usable" if rec["id"] in usable else "; ".join(check_record(rec)) or "audio changed"
            print(f"{rec['id']:<16} {rec.get('accent', '?'):<11} {rec.get('duration_s', '?')} s  {state}")
    elif args.cmd == "revoke":
        reg.revoke(args.id)
        print(f"revoked {args.id}: it can no longer be used")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
