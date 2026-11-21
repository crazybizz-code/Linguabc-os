from linguabc_tts.hashing import canonical_json, segment_hash

# Same vector as tests/ts/segment-cache.test.mjs (SHARED_VECTOR_HASH).
VECTOR = dict(provider="qwen", model="Qwen3-TTS-12Hz-1.7B-CustomVoice", voice="Ryan", expression=["excited"],
              text="[excited] Welcome to LinguABC — café!",
              params={"language": "English", "seed": 1234, "temperature": 0.3, "top_p": 0.8}, scope="platform")


def test_matches_typescript():
    assert segment_hash(**VECTOR) == "8ace185465c90c767134610931259264de8a684f21561624ec98286a1c5866ff"


def test_canonical_json():
    assert canonical_json({"b": 1, "a": [True, "x"]}) == '{"a":[true,"x"],"b":1}'


def test_every_field_matters():
    base = segment_hash(**VECTOR)
    for change in ({"scope": "11111111-1111-4111-8111-111111111111"}, {"voice": "Aiden"}, {"text": "Welcome!"},
                   {"params": {**VECTOR["params"], "instruct": "x"}}, {"expression": []}, {"model": "other"}):
        assert segment_hash(**{**VECTOR, **change}) != base, change
