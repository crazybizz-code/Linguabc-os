import base64
import json
import time

from linguabc_tts.cache import SegmentCache
from linguabc_tts.engines import FakeEngine
from linguabc_tts.qa import FakeTranscriber
from linguabc_tts.server import handle, sign, verify

SECRET = "s" * 40
BODY = json.dumps({"version": 1, "scope": "platform", "language": "English",
                   "plan": [{"kind": "speech", "speaker": "A", "voice": "Ryan", "text": "Welcome to the museum tour."}]}).encode()


def headers(body=BODY, ts=None, secret=SECRET):
    ts = int(time.time()) if ts is None else ts
    return {"X-LinguABC-Timestamp": str(ts), "X-LinguABC-Signature": sign(body, secret, ts)}


def call(tmp_path, body=BODY, hdrs=None, engine=None):
    engine = engine or FakeEngine()
    return handle(body, hdrs if hdrs is not None else headers(body), SECRET, engine, FakeTranscriber(engine), SegmentCache(tmp_path))


def test_signed_request_returns_mp3(tmp_path):
    status, reply = call(tmp_path)
    assert status == 200
    assert base64.b64decode(reply["audio_mp3_base64"])[:1] == b"\xff"
    assert reply["billed_text_bytes"] == 0 and reply["report"]["status"] == "pass"


def test_signature_rules(tmp_path):
    assert call(tmp_path, hdrs={})[0] == 401
    assert call(tmp_path, hdrs=headers(secret="wrong" * 8))[0] == 401
    assert call(tmp_path, hdrs=headers(ts=int(time.time()) - 3600))[0] == 401
    tampered = BODY.replace(b"museum", b"secret")
    assert call(tmp_path, body=tampered, hdrs=headers(BODY))[0] == 401
    assert not verify(BODY, "abc", "x", SECRET)


def test_bad_json_and_failed_qa(tmp_path):
    assert call(tmp_path, body=b"{", hdrs=headers(b"{"))[0] == 400
    status, reply = call(tmp_path, engine=FakeEngine(garble={"Welcome to the museum tour.": 99}))
    assert status == 422 and "audio_mp3_base64" not in reply and reply["report"]["failed_segments"] == 1
