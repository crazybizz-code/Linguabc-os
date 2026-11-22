import json
import time

import pytest

fastapi = pytest.importorskip("fastapi")
from fastapi.testclient import TestClient  # noqa: E402

from linguabc_tts.cache import SegmentCache  # noqa: E402
from linguabc_tts.engines import FakeEngine  # noqa: E402
from linguabc_tts.http_app import build_engine, create_app  # noqa: E402
from linguabc_tts.qa import FakeTranscriber  # noqa: E402
from linguabc_tts.server import sign  # noqa: E402


def client(tmp_path, monkeypatch):
    monkeypatch.setenv("LINGUABC_TTS_SECRET", "s" * 40)
    engine = FakeEngine()
    return TestClient(create_app(lambda: (engine, FakeTranscriber(engine), SegmentCache(tmp_path), {}))), engine


def test_health_and_signed_render(tmp_path, monkeypatch):
    c, engine = client(tmp_path, monkeypatch)
    assert c.get("/health").json()["voices"] == engine.voices()
    body = json.dumps({"version": 1, "scope": "platform", "plan": [{"kind": "speech", "voice": "Ryan", "text": "It costs £185 in total."}]}).encode()
    ts = int(time.time())
    r = c.post("/render", content=body, headers={"X-LinguABC-Timestamp": str(ts), "X-LinguABC-Signature": sign(body, "s" * 40, ts)})
    assert r.status_code == 200 and r.json()["audio_mp3_base64"]
    assert engine.calls[0][0] == "It costs a hundred and eighty-five pounds in total."  # TTS_SPOKEN defaults on
    assert c.post("/render", content=body, headers={"X-LinguABC-Timestamp": str(ts), "X-LinguABC-Signature": "bad"}).status_code == 401


def test_cloning_engines_refuse_without_approved_voices(tmp_path):
    with pytest.raises(RuntimeError, match="TTS_VOICES_DIR"):
        build_engine("chatterbox", None)
    with pytest.raises(RuntimeError, match="no approved voices"):
        build_engine("chatterbox", str(tmp_path))
    with pytest.raises(RuntimeError, match="TTS_ENGINE"):
        build_engine("zonos", str(tmp_path))
