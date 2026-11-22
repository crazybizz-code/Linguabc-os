import json

import pytest

from linguabc_tts import audio as A
from linguabc_tts.cache import SegmentCache
from linguabc_tts.engines import FakeEngine
from linguabc_tts.pipeline import render
from linguabc_tts.plan import BadRequest, parse_request
from linguabc_tts.qa import FakeTranscriber

CENTRE = "11111111-1111-4111-8111-111111111111"


def request(lines, scope=CENTRE, answers=None):
    plan = []
    for i, (voice, text) in enumerate(lines):
        if i:
            plan.append({"kind": "pause", "seconds": 0.35})
        plan.append({"kind": "speech", "speaker": voice, "voice": voice, "text": text})
    data = {"version": 1, "scope": scope, "language": "English", "plan": plan}
    if answers:
        data["checks"] = {"answers": answers}
    return parse_request(data)


LINES = [
    ("Ryan", "Good morning, how can I help you today?"),
    ("Serena", "[curious] I'd like to book a room for the 23rd of March, please."),
    ("Ryan", "Of course. Can I have your surname?"),
    ("Serena", "It's Smythe. That's S-M-Y-T-H-E."),
]


def setup(tmp_path, **kw):
    engine = FakeEngine(**kw)
    return engine, FakeTranscriber(engine), SegmentCache(tmp_path / "cache")


def test_renders_mp3_with_pauses_loudness_and_report(tmp_path):
    engine, asr, cache = setup(tmp_path)
    res = render(request(LINES, answers=[["Smythe"], ["23rd of March"]]), engine, asr, cache)
    assert res.ok and res.mp3
    r = res.report
    assert r["status"] == "pass", r.get("problems")
    assert r["manual_review_required"] is True
    assert r["wer"] == 0 and r["answers_missing"] == []
    assert abs(r["loudness"]["after_lufs"] - A.TARGET_LUFS) <= 1.0
    spoken = sum(s["seconds"] for s in r["segments"])
    assert spoken + 3 * 0.35 - 0.2 <= res.seconds <= spoken + 3 * 0.35 + 0.2
    assert abs(A.decode_mp3(res.mp3, 24000).size / 24000 - res.seconds) < 0.2
    # the expression became an instruction, not words
    curious = [s for s in r["segments"] if s["expression"] == "curious"][0]
    assert curious["instruct"] == "Speak with genuine curiosity." and "[" not in curious["text"]
    assert ("I'd like to book a room for the 23rd of March, please.", "Serena", "Speak with genuine curiosity.") in [c[:3] for c in engine.calls]


def test_cache_hit_speaks_nothing(tmp_path):
    engine, asr, cache = setup(tmp_path)
    first = render(request(LINES), engine, asr, cache)
    calls = len(engine.calls)
    again = render(request(LINES), engine, asr, cache)
    assert len(engine.calls) == calls
    assert again.report["cache"] == {"hits": 4, "misses": 0, "engine_calls": 0}
    assert again.mp3 == first.mp3  # reproducible


def test_one_changed_line_speaks_only_that_line(tmp_path):
    engine, asr, cache = setup(tmp_path)
    render(request(LINES), engine, asr, cache)
    engine.calls.clear()
    edited = list(LINES)
    edited[2] = ("Ryan", "Of course. Could I have your family name?")
    res = render(request(edited), engine, asr, cache)
    assert [c[0] for c in engine.calls] == ["Of course. Could I have your family name?"]
    assert res.report["cache"]["hits"] == 3


def test_only_the_bad_segment_is_regenerated(tmp_path):
    engine, asr, cache = setup(tmp_path, garble={"Of course. Can I have your surname?": 1})
    res = render(request(LINES), engine, asr, cache)
    assert res.ok
    seg = [s for s in res.report["segments"] if s["text"] == "Of course. Can I have your surname?"][0]
    assert seg["attempts"] == 2
    assert [s["attempts"] for s in res.report["segments"]].count(1) == 3
    seeds = [c[3] for c in engine.calls if c[0] == seg["text"]]
    assert len(set(seeds)) == 2  # a new seed for the retry


def test_failure_keeps_verified_segments(tmp_path):
    engine, asr, cache = setup(tmp_path, garble={"It's Smythe. That's S-M-Y-T-H-E.": 99})
    res = render(request(LINES), engine, asr, cache)
    assert not res.ok and res.mp3 is None
    failed = [s for s in res.report["segments"] if s["status"] == "failed"]
    assert len(failed) == 1 and failed[0]["attempts"] == 3
    assert any("not heard" in r or "WER" in r for r in failed[0]["reasons"])
    engine.garble.clear()
    engine.calls.clear()
    res = render(request(LINES), engine, asr, cache)
    assert res.ok
    assert [c[0] for c in engine.calls] == ["It's Smythe. That's S-M-Y-T-H-E."]


def test_engine_crash_is_retried_then_reported(tmp_path):
    engine, asr, cache = setup(tmp_path, fail={"Good morning, how can I help you today?"})
    res = render(request(LINES), engine, asr, cache)
    assert not res.ok
    assert "RuntimeError" in res.report["segments"][0]["reasons"][0]


def test_scopes_never_share_segments(tmp_path):
    engine, asr, cache = setup(tmp_path)
    render(request(LINES), engine, asr, cache)
    engine.calls.clear()
    other = render(request(LINES, scope="22222222-2222-4222-8222-222222222222"), engine, asr, cache)
    assert other.report["cache"]["hits"] == 0 and len(engine.calls) == 4


def test_voice_without_instruct_and_unknown_tags_are_reported(tmp_path):
    engine, asr, cache = setup(tmp_path, no_instruct_voices={"Serena"})
    res = render(request([("Serena", "[excited] Hello there, everyone!"), ("Ryan", "[robotic] Beep boop beep.")]), engine, asr, cache)
    assert res.report["expressions_dropped_no_instruct"] == ["excited"]
    assert res.report["unsupported_expressions"] == ["robotic"]


def test_missing_answer_needs_review(tmp_path):
    engine, asr, cache = setup(tmp_path)
    res = render(request(LINES, answers=[["platform four"]]), engine, asr, cache)
    assert res.ok and res.report["status"] == "needs_review"
    assert res.report["answers_missing"] == [["platform four"]]


def test_unknown_voice_fails(tmp_path):
    engine, asr, cache = setup(tmp_path)
    res = render(request([("Bob", "Hello there.")]), engine, asr, cache)
    assert not res.ok and "unknown voice" in res.report["segments"][0]["reasons"][0]


@pytest.mark.parametrize("bad", [
    {"version": 2},
    {"version": 1, "scope": "../etc", "plan": [{"kind": "speech", "voice": "Ryan", "text": "x"}]},
    {"version": 1, "scope": "platform", "plan": []},
    {"version": 1, "scope": "platform", "plan": [{"kind": "pause", "seconds": 500}]},
    {"version": 1, "scope": "platform", "plan": [{"kind": "speech", "voice": "Ry an!", "text": "x"}]},
    {"version": 1, "scope": "platform", "plan": [{"kind": "pause", "seconds": 1}]},
])
def test_bad_requests_are_refused(bad):
    with pytest.raises(BadRequest):
        parse_request(bad)


def test_cached_clips_are_rechecked_when_rules_change(tmp_path):
    import json as _json
    engine, asr, cache = setup(tmp_path)
    render(request(LINES), engine, asr, cache)
    # Pretend one clip was accepted by older, looser rules with a looped ending.
    meta_files = sorted((tmp_path / "cache").rglob("*.json"))
    target = next(m for m in meta_files if "surname?" in _json.loads(m.read_text())["text"])
    meta = _json.loads(target.read_text())
    meta.update(qa_version=1, heard=meta["heard"] + " your surname?")
    target.write_text(_json.dumps(meta))
    engine.calls.clear()
    res = render(request(LINES), engine, asr, cache)
    assert [c[0] for c in engine.calls] == ["Of course. Can I have your surname?"]
    assert res.ok


def test_long_turns_are_spoken_sentence_by_sentence(tmp_path):
    from linguabc_tts.pipeline import sentence_chunks
    long = ("Good afternoon. Today I'm going to talk about the world's first underground railway. "
            "It opened in London on the 10th of January 1863, and on its first day it carried around 38,000 passengers. "
            "The trains were pulled by steam engines, so the tunnels were often full of smoke.")
    chunks = sentence_chunks(long, 30)
    assert len(chunks) == 3 and " ".join(chunks) == long
    assert all(len(c.split()) <= 30 for c in chunks)
    assert sentence_chunks("Short line.", 30) == ["Short line."]
    engine, asr, cache = setup(tmp_path)
    res = render(request([("Ryan", long)]), engine, asr, cache)
    assert res.ok and len(res.report["segments"]) == 3
    assert [s["continues"] for s in res.report["segments"]] == [False, True, True]


def test_recheck_failure_tries_new_seeds(tmp_path):
    import json as _json
    engine, asr, cache = setup(tmp_path)
    render(request(LINES[:1]), engine, asr, cache)
    meta_file = next((tmp_path / "cache").rglob("*.json"))
    meta = _json.loads(meta_file.read_text())
    old_seed = [c[3] for c in engine.calls][0]
    meta.update(qa_version=1, heard=meta["heard"] + " help you today?", attempts=3)
    meta_file.write_text(_json.dumps(meta))
    engine.calls.clear()
    render(request(LINES[:1]), engine, asr, cache)
    assert engine.calls and engine.calls[0][3] != old_seed


def test_token_budget_bounds_runaway_generation():
    from linguabc_tts.engines import token_budget
    short = token_budget("Could you tell me how much the tickets cost for the guided tour?", 2048)
    assert 120 <= short <= 200  # ~10-16 s, not 164 s
    spelled = token_budget("My surname is Harrison, that's H-A-R-R-I-S-O-N.", 2048)
    assert spelled > token_budget("My surname is Harrison, that's it.", 2048)
    assert token_budget("word " * 5000, 2048) == 2048
