from linguabc_tts.lexicon import LEXICON, respell
from linguabc_tts.qa import normalize, wer


def test_brand_is_respelled_per_engine_and_left_alone_elsewhere():
    LEXICON["LinguABC"]["test-engine"] = "Lingwa A B C"
    try:
        assert respell("Welcome to LinguABC!", "test-engine") == "Welcome to Lingwa A B C!"
        assert respell("Welcome to LinguABC!", "other") == "Welcome to Lingua A B C!"
        assert respell("Welcome to Lingua classes!", "other") == "Welcome to Lingua classes!"
    finally:
        del LEXICON["LinguABC"]["test-engine"]


def test_qa_hears_the_respelling_as_the_brand():
    for heard in ("Welcome to the Lingua ABC podcast.", "Welcome to the Lingua A B C podcast.", "Welcome to the LinguABC podcast."):
        assert wer("Welcome to the LinguABC podcast.", heard) == 0, heard
    assert wer("Welcome to the LinguABC podcast.", "Welcome to the Lingway BC podcast.") > 0
    assert normalize("LinguABC")[0] == "linguabc"


def test_pipeline_sends_the_respelling(tmp_path):
    from linguabc_tts.cache import SegmentCache
    from linguabc_tts.engines import FakeEngine
    from linguabc_tts.pipeline import render
    from linguabc_tts.plan import parse_request
    from linguabc_tts.qa import FakeTranscriber

    engine = FakeEngine()
    req = parse_request({"version": 1, "scope": "platform", "plan": [{"kind": "speech", "voice": "Ryan", "text": "Welcome to LinguABC."}]})
    res = render(req, engine, FakeTranscriber(engine), SegmentCache(tmp_path))
    assert engine.calls[0][0] == "Welcome to Lingua A B C."
    assert res.ok
