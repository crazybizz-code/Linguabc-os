"""The render request the Next.js app sends (src/lib/ai/qwen.ts), validated.

{
  "version": 1,
  "scope": "<centre uuid>" | "platform",
  "language": "English",
  "plan": [
    {"kind": "speech", "speaker": "Kate", "voice": "Ryan", "text": "[surprised] Really?"},
    {"kind": "pause", "seconds": 0.35},
    ...
  ],
  "checks": {"answers": [["four", "4"], ["Smythe"]]}   # optional
}
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Any

MAX_ITEMS = 400
MAX_TEXT = 2000
MAX_TOTAL_TEXT = 15000
MAX_PAUSE = 120.0
_SCOPE = re.compile(r"^(platform|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$")
_VOICE = re.compile(r"^[A-Za-z][A-Za-z0-9_-]{1,40}$")
LANGUAGES = {"English", "Auto"}


class BadRequest(ValueError):
    pass


@dataclass(frozen=True)
class Speech:
    speaker: str
    voice: str
    text: str


@dataclass(frozen=True)
class Pause:
    seconds: float


@dataclass
class RenderRequest:
    scope: str
    language: str
    plan: list[Speech | Pause]
    answers: list[list[str]] = field(default_factory=list)

    @property
    def speech(self) -> list[Speech]:
        return [p for p in self.plan if isinstance(p, Speech)]


def parse_request(data: Any) -> RenderRequest:
    if not isinstance(data, dict) or data.get("version") != 1:
        raise BadRequest("version must be 1")
    scope = data.get("scope")
    if not isinstance(scope, str) or not _SCOPE.match(scope):
        raise BadRequest("scope must be a centre id or 'platform'")
    language = data.get("language", "English")
    if language not in LANGUAGES:
        raise BadRequest(f"language must be one of {sorted(LANGUAGES)}")
    items = data.get("plan")
    if not isinstance(items, list) or not items or len(items) > MAX_ITEMS:
        raise BadRequest(f"plan must have 1-{MAX_ITEMS} items")

    plan: list[Speech | Pause] = []
    total = 0
    for i, item in enumerate(items):
        if not isinstance(item, dict):
            raise BadRequest(f"plan[{i}] must be an object")
        kind = item.get("kind")
        if kind == "pause":
            seconds = item.get("seconds")
            if not isinstance(seconds, (int, float)) or isinstance(seconds, bool) or not 0 <= seconds <= MAX_PAUSE:
                raise BadRequest(f"plan[{i}].seconds must be 0-{MAX_PAUSE}")
            plan.append(Pause(float(seconds)))
        elif kind == "speech":
            text, voice, speaker = item.get("text"), item.get("voice"), item.get("speaker", "")
            if not isinstance(text, str) or not text.strip() or len(text) > MAX_TEXT:
                raise BadRequest(f"plan[{i}].text must be 1-{MAX_TEXT} characters")
            if not isinstance(voice, str) or not _VOICE.match(voice):
                raise BadRequest(f"plan[{i}].voice is not a voice name")
            if not isinstance(speaker, str) or len(speaker) > 40:
                raise BadRequest(f"plan[{i}].speaker is too long")
            total += len(text)
            plan.append(Speech(speaker, voice, text.strip()))
        else:
            raise BadRequest(f"plan[{i}].kind must be speech or pause")
    if total > MAX_TOTAL_TEXT:
        raise BadRequest("the script is too long for one recording")
    if not any(isinstance(p, Speech) for p in plan):
        raise BadRequest("nothing to say")

    answers: list[list[str]] = []
    checks = data.get("checks") or {}
    if not isinstance(checks, dict):
        raise BadRequest("checks must be an object")
    for a in checks.get("answers") or []:
        variants = [a] if isinstance(a, str) else a
        if not isinstance(variants, list) or not variants or not all(isinstance(v, str) and 0 < len(v) <= 100 for v in variants):
            raise BadRequest("checks.answers must be strings or lists of strings")
        answers.append(variants)
    return RenderRequest(scope, language, plan, answers)
