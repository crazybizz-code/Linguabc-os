import datetime as dt
import json

import numpy as np
import pytest
import soundfile as sf

from linguabc_tts.voices import VoiceNotAllowed, VoiceRegistry, check_record, prepare_reference

TODAY = dt.date(2026, 12, 10)


def record(**over):
    rec = {
        "id": "emma-gb", "display_name": "Emma (British, female)", "accent": "british", "language": "en",
        "transcript": "Good morning, this is a test recording for the LinguABC voice library.",
        "consent": {"speaker": "Test Speaker", "signed_on": "2026-12-01", "document": "contracts/test.pdf",
                    "scopes": ["voice-cloning", "commercial-use", "linguabc-platform"], "expires_on": None, "revoked_on": None},
        "licence": "work-for-hire", "source": "test",
    }
    rec.update(over)
    return rec


def speechlike(seconds=12.0, sr=48000, noise=0.0005, seed=0):
    rng = np.random.default_rng(seed)
    t = np.arange(int(sr * seconds)) / sr
    env = 0.5 + 0.5 * np.sin(2 * np.pi * 3 * t) ** 2  # syllable-like loudness changes
    env[(t % 1.5) > 1.25] = 0.0                         # short gaps between phrases, as in speech
    return (0.3 * env * np.sin(2 * np.pi * 180 * t) + noise * rng.standard_normal(t.size)).astype(np.float32), sr


def test_consent_and_licence_are_required():
    assert check_record(record(approved_by="owner", approved_on="2026-12-02"), TODAY) == []
    bad = check_record(record(consent={"speaker": "X", "signed_on": "2026-12-01", "document": "d", "scopes": ["voice-cloning"]},
                              licence="", approved_by=None), TODAY)
    assert any("commercial-use" in e for e in bad)
    assert any("licence" in e for e in bad)
    assert any("approved" in e for e in bad)


def test_expired_or_revoked_consent_blocks_use():
    exp = record(approved_by="o", approved_on="2026-12-02")
    exp["consent"] = {**exp["consent"], "expires_on": "2026-12-05"}
    assert any("expired" in e for e in check_record(exp, TODAY))
    rev = record(approved_by="o", approved_on="2026-12-02")
    rev["consent"] = {**rev["consent"], "revoked_on": "2026-12-09"}
    assert any("revoked" in e for e in check_record(rev, TODAY))


def test_prepare_register_approve_and_revoke(tmp_path):
    src = tmp_path / "raw.wav"
    sf.write(src, *speechlike())
    folder = tmp_path / "voices"
    rec = prepare_reference(src, record(), folder, today=TODAY)
    assert rec["qa"]["problems"] == [] and 8 <= rec["duration_s"] <= 15
    reg = VoiceRegistry(folder)
    with pytest.raises(VoiceNotAllowed, match="approved"):
        reg.get("emma-gb", TODAY)  # registered, not yet approved by a person
    meta = folder / "emma-gb.json"
    data = json.loads(meta.read_text())
    data.update(approved_by="owner", approved_on="2026-12-02")
    meta.write_text(json.dumps(data))
    v = reg.get("emma-gb", TODAY)
    assert v.accent == "british" and v.path.exists()
    assert list(reg.usable(TODAY)) == ["emma-gb"]
    reg.revoke("emma-gb", TODAY)
    with pytest.raises(VoiceNotAllowed, match="revoked"):
        reg.get("emma-gb", TODAY)


def test_changed_audio_is_refused(tmp_path):
    src = tmp_path / "raw.wav"
    sf.write(src, *speechlike())
    folder = tmp_path / "voices"
    prepare_reference(src, record(approved_by="owner", approved_on="2026-12-02"), folder, today=TODAY)
    sf.write(folder / "emma-gb.wav", *speechlike(seed=5))
    with pytest.raises(VoiceNotAllowed, match="audio changed"):
        VoiceRegistry(folder).get("emma-gb", TODAY)


def test_bad_recordings_say_what_to_fix(tmp_path):
    short = tmp_path / "short.wav"
    sf.write(short, *speechlike(seconds=4))
    with pytest.raises(VoiceNotAllowed, match="too short"):
        prepare_reference(short, record(), tmp_path / "v", today=TODAY)
    noisy = tmp_path / "noisy.wav"
    sf.write(noisy, *speechlike(noise=0.08))
    with pytest.raises(VoiceNotAllowed, match="noisy"):
        prepare_reference(noisy, record(), tmp_path / "v", today=TODAY)
    with pytest.raises(VoiceNotAllowed, match="consent"):
        prepare_reference(short, record(consent={}), tmp_path / "v", today=TODAY)
