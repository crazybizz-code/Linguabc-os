"""Segment hash, identical to src/lib/ai/segment-cache.ts (segmentHash).

A shared test vector (tests/test_hashing.py and
tests/ts/segment-cache.test.mjs) keeps the two implementations in step.
"""

from __future__ import annotations

import hashlib
import json
from typing import Any

HASH_VERSION = "linguabc-audio-segment:v1"


def canonical_json(value: Any) -> str:
    """Keys sorted at every level, no spaces, UTF-8 kept (like the TS version)."""
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False, allow_nan=False)


def segment_hash(*, provider: str, model: str, voice: str, expression: list[str], text: str,
                 params: dict[str, Any], scope: str) -> str:
    payload = {"provider": provider, "model": model, "voice": voice, "expression": expression,
               "text": text, "params": params, "scope": scope}
    return hashlib.sha256(f"{HASH_VERSION}\n{canonical_json(payload)}".encode("utf-8")).hexdigest()
