"""Request handling, independent of the web framework (Modal uses FastAPI).

Requests are signed by the Next.js app (src/lib/ai/qwen.ts):
    X-LinguABC-Timestamp: unix seconds
    X-LinguABC-Signature: hex HMAC-SHA256(secret, f"{timestamp}.{body}")
Old or replayed timestamps (more than 5 minutes off) are refused.
Nothing from the request (scripts, answers) is logged.
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
import time

from .cache import SegmentCache
from .engines import Engine
from .pipeline import QaConfig, render
from .plan import BadRequest, parse_request
from .qa import SpeakerEmbedder, Transcriber

MAX_SKEW_S = 300
MAX_BODY = 512 * 1024


def sign(body: bytes, secret: str, timestamp: int) -> str:
    return hmac.new(secret.encode(), f"{timestamp}.".encode() + body, hashlib.sha256).hexdigest()


def verify(body: bytes, timestamp: str | None, signature: str | None, secret: str, now: float | None = None) -> bool:
    if not secret or not timestamp or not signature or not timestamp.isdigit():
        return False
    if abs((now if now is not None else time.time()) - int(timestamp)) > MAX_SKEW_S:
        return False
    return hmac.compare_digest(sign(body, secret, int(timestamp)), signature)


def handle(body: bytes, headers: dict[str, str], secret: str, engine: Engine, transcriber: Transcriber,
           cache: SegmentCache, qa: QaConfig = QaConfig(), embedder: SpeakerEmbedder | None = None,
           params: dict | None = None) -> tuple[int, dict]:
    h = {k.lower(): v for k, v in headers.items()}
    if len(body) > MAX_BODY:
        return 413, {"error": "request too large"}
    if not verify(body, h.get("x-linguabc-timestamp"), h.get("x-linguabc-signature"), secret):
        return 401, {"error": "bad signature"}
    try:
        req = parse_request(json.loads(body))
    except (BadRequest, json.JSONDecodeError, UnicodeDecodeError) as e:
        return 400, {"error": str(e)[:200]}
    result = render(req, engine, transcriber, cache, qa=qa, embedder=embedder, params=params)
    reply = {"model": engine.model_id, "seconds": result.seconds, "billed_text_bytes": 0, "report": result.report}
    if not result.ok:
        return 422, {**reply, "error": f"{result.report['failed_segments']} segment(s) failed QA"}
    return 200, {**reply, "audio_mp3_base64": base64.b64encode(result.mp3 or b"").decode()}
