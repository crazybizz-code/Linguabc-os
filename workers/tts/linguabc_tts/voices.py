"""Registry of reference voices for cloning, with licence and consent.

No voice can be cloned unless its record proves the speaker agreed to it.
A record is a JSON file next to its audio in the registry folder:

  voices/
    emma-gb.wav        prepared reference (mono, 24 kHz, -20 LUFS, edges trimmed)
    emma-gb.json       the record below

  {
    "id": "emma-gb",
    "display_name": "Emma (British, female)",
    "accent": "british",                 # british | american | australian | other
    "language": "en",
    "transcript": "Good morning. I'd like to ...",   # exact words (Qwen cloning needs them)
    "audio_sha256": "...",               # of the prepared WAV; checked on every load
    "duration_s": 12.4,
    "consent": {
      "speaker": "Full legal name",
      "signed_on": "2026-12-01",
      "document": "contracts/2026-12-01-emma.pdf",   # where the signed consent is kept (not in git)
      "scopes": ["voice-cloning", "commercial-use", "linguabc-platform"],
      "expires_on": null,                # or a date
      "revoked_on": null                 # set when the speaker withdraws consent
    },
    "licence": "work-for-hire",          # or the exact licence of the recording
    "source": "Studio recording, 2026-12-01",
    "qa": {...},                         # filled by prepare_reference()
    "approved_by": "owner",
    "approved_on": "2026-12-02"
  }

Chatterbox uses the first 10 s of a reference (decoder) and the first 6 s
(prompt tokens), so the first seconds must be the cleanest, most typical
speech; prepare_reference() keeps at most REF_MAX_S. Qwen cloning needs the
exact transcript. Datasets with research-only or unclear consent (e.g.
Common Voice clips of identifiable people) are not accepted for production.
"""

from __future__ import annotations

import datetime as dt
import hashlib
import json
import re
from dataclasses import dataclass
from pathlib import Path

import numpy as np

from . import audio as A

REQUIRED_SCOPES = {"voice-cloning", "commercial-use"}
ACCENTS = {"british", "american", "australian", "other"}
REF_MIN_S, REF_MAX_S = 8.0, 15.0
REF_SR = 24000
REF_LUFS = -20.0
_ID = re.compile(r"^[a-z][a-z0-9-]{2,40}$")


class VoiceNotAllowed(RuntimeError):
    pass


def _sha256(path: Path) -> str:
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def _date(s) -> dt.date | None:
    return dt.date.fromisoformat(s) if s else None


def check_record(rec: dict, today: dt.date | None = None) -> list[str]:
    """Problems that stop a voice from being used (empty list = usable)."""
    today = today or dt.date.today()
    errors = []
    if not _ID.match(str(rec.get("id", ""))):
        errors.append("id must be lower-case letters, digits and dashes")
    if rec.get("accent") not in ACCENTS:
        errors.append(f"accent must be one of {sorted(ACCENTS)}")
    if not str(rec.get("transcript", "")).strip():
        errors.append("transcript is required")
    c = rec.get("consent") or {}
    for field in ("speaker", "signed_on", "document"):
        if not c.get(field):
            errors.append(f"consent.{field} is required")
    missing = REQUIRED_SCOPES - set(c.get("scopes") or [])
    if missing:
        errors.append(f"consent does not cover {sorted(missing)}")
    try:
        if _date(c.get("signed_on")) and _date(c.get("signed_on")) > today:
            errors.append("consent is dated in the future")
        if c.get("expires_on") and _date(c["expires_on"]) < today:
            errors.append("consent has expired")
        if c.get("revoked_on") and _date(c["revoked_on"]) <= today:
            errors.append("consent was revoked")
    except ValueError:
        errors.append("consent dates must be YYYY-MM-DD")
    if not rec.get("licence"):
        errors.append("licence is required")
    if not rec.get("approved_by") or not rec.get("approved_on"):
        errors.append("the voice must be approved (approved_by, approved_on)")
    return errors


@dataclass
class Voice:
    id: str
    accent: str
    path: Path
    transcript: str
    record: dict


class VoiceRegistry:
    def __init__(self, folder: str | Path):
        self.folder = Path(folder)

    def records(self) -> list[dict]:
        return [json.loads(p.read_text("utf-8")) for p in sorted(self.folder.glob("*.json"))]

    def get(self, voice_id: str, today: dt.date | None = None) -> Voice:
        meta = self.folder / f"{voice_id}.json"
        wav = self.folder / f"{voice_id}.wav"
        if not meta.is_file() or not wav.is_file():
            raise VoiceNotAllowed(f"{voice_id}: not registered")
        rec = json.loads(meta.read_text("utf-8"))
        errors = check_record(rec, today)
        if rec.get("audio_sha256") != _sha256(wav):
            errors.append("audio changed since it was approved")
        if errors:
            raise VoiceNotAllowed(f"{voice_id}: " + "; ".join(errors))
        return Voice(rec["id"], rec["accent"], wav, rec["transcript"], rec)

    def usable(self, today: dt.date | None = None) -> dict[str, Voice]:
        out = {}
        for rec in self.records():
            try:
                out[rec["id"]] = self.get(rec["id"], today)
            except (VoiceNotAllowed, KeyError):
                continue
        return out

    def revoke(self, voice_id: str, on: dt.date | None = None) -> None:
        meta = self.folder / f"{voice_id}.json"
        rec = json.loads(meta.read_text("utf-8"))
        rec["consent"]["revoked_on"] = (on or dt.date.today()).isoformat()
        meta.write_text(json.dumps(rec, indent=2, ensure_ascii=False), "utf-8")


def reference_qa(audio: np.ndarray, sr: int) -> dict:
    """Recording checks; problems are listed, nothing is fixed silently."""
    db = A.frame_db(audio, sr)
    # Speech level (95th percentile of 20 ms frames) over the noise in the gaps between
    # words (5th percentile). Natural speech always has such gaps.
    snr = float(np.percentile(db, 95) - np.percentile(db, 5)) if db.size >= 50 else None
    problems = []
    seconds = audio.size / sr
    if seconds < REF_MIN_S:
        problems.append(f"too short: {seconds:.1f} s (need {REF_MIN_S:.0f}-{REF_MAX_S:.0f} s of speech)")
    clip = A.clipping_ratio(audio)
    if clip > 0.0005:
        problems.append(f"clipping {clip:.2%}")
    if snr is not None and snr < 30:
        problems.append(f"noisy: speech-to-noise {snr:.0f} dB (need >= 30 dB; record in a quiet room)")
    gap = A.longest_silence(audio, sr)
    if gap > 1.0:
        problems.append(f"long pause of {gap:.1f} s inside the reference")
    return {"duration_s": round(seconds, 2), "snr_db": None if snr is None else round(snr, 1), "clipping": round(clip, 5),
            "longest_pause_s": round(gap, 2), "problems": problems}


def prepare_reference(src: str | Path, record: dict, folder: str | Path, accent_classifier=None,
                      today: dt.date | None = None) -> dict:
    """Validate the record, clean the recording and register it.

    Raises VoiceNotAllowed if consent or licence are missing, or if the
    recording fails QA (the problems say what to re-record).
    """
    import soundfile as sf

    errors = check_record({**record, "approved_by": record.get("approved_by") or "-", "approved_on": record.get("approved_on") or "-"}, today)
    if errors:
        raise VoiceNotAllowed("; ".join(errors))
    data, sr = sf.read(str(src), dtype="float32", always_2d=True)
    audio = A.trim(A.resample(data.mean(axis=1), sr, REF_SR), REF_SR, keep_s=0.1)
    audio = audio[: int(REF_MAX_S * REF_SR)]
    qa = reference_qa(audio, REF_SR)
    if qa["problems"]:
        raise VoiceNotAllowed("recording: " + "; ".join(qa["problems"]))
    loud = A.measure_loudness(audio, REF_SR)["input_i"]
    audio = np.clip(audio * (10 ** ((REF_LUFS - loud) / 20)), -0.99, 0.99).astype(np.float32)
    if accent_classifier is not None:
        qa["accent"] = accent_classifier.scores(audio, REF_SR)
    folder = Path(folder)
    folder.mkdir(parents=True, exist_ok=True)
    wav = folder / f"{record['id']}.wav"
    sf.write(wav, audio, REF_SR, subtype="PCM_16")
    rec = {**record, "duration_s": qa["duration_s"], "audio_sha256": _sha256(wav), "qa": qa}
    rec.setdefault("approved_by", None)
    rec.setdefault("approved_on", None)
    (folder / f"{record['id']}.json").write_text(json.dumps(rec, indent=2, ensure_ascii=False), "utf-8")
    return rec
