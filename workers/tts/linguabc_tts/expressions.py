"""Expression tags -> Qwen3-TTS natural-language instructions.

LinguABC scripts carry 31 expression tags (src/lib/ai/script.ts,
EXPRESSIONS), written before a sentence: "Kate: [surprised] Really?".
Fish S2 reads them inline. Qwen3-TTS has no inline tags: emotion is set per
generation call with `instruct`, and only on the 1.7B CustomVoice and
VoiceDesign models (qwen_tts 0.1.1 drops `instruct` for 0.6B; Base models
have no `instruct` at all). So a turn is cut at each tag, and each piece is
spoken with that tag's instruction.

Nothing here is guaranteed to be heard. Qwen documents instruction control
for "timbre, emotion, and prosody", not a list of expressions, so:

  * "tone": an emotion or speaking manner. Plausible; check by listening.
  * "experimental": a non-verbal sound or voice quality (laughing,
    whispering, shouting, sighing). Qwen does not document these; the
    instruction is still sent, and the report flags it for listening.

A tag that is not in this table is dropped and reported as unsupported.
"""

from __future__ import annotations

import re
from dataclasses import dataclass

TONE = "tone"
EXPERIMENTAL = "experimental"

#: tag -> (instruction, support level). Keys must match script.ts EXPRESSIONS.
INSTRUCTIONS: dict[str, tuple[str, str]] = {
    "excited": ("Speak with excitement and high energy.", TONE),
    "surprised": ("Speak with genuine surprise.", TONE),
    "happy": ("Speak in a happy, cheerful tone.", TONE),
    "amused": ("Speak in an amused tone, as if something is funny.", TONE),
    "laughing": ("Speak while laughing lightly.", EXPERIMENTAL),
    "chuckling": ("Speak with a soft chuckle in the voice.", EXPERIMENTAL),
    "curious": ("Speak with genuine curiosity.", TONE),
    "confident": ("Speak in a confident, assured tone.", TONE),
    "enthusiastic": ("Speak with enthusiasm.", TONE),
    "relieved": ("Speak in a relieved tone.", TONE),
    "sad": ("Speak in a sad, subdued tone.", TONE),
    "disappointed": ("Speak in a disappointed tone.", TONE),
    "worried": ("Speak in a worried, anxious tone.", TONE),
    "nervous": ("Speak nervously, a little unsure.", TONE),
    "confused": ("Speak in a confused, puzzled tone.", TONE),
    "hesitant": ("Speak hesitantly, with small pauses.", TONE),
    "thoughtful": ("Speak thoughtfully, at a measured pace.", TONE),
    "doubtful": ("Speak in a doubtful, sceptical tone.", TONE),
    "annoyed": ("Speak in an annoyed tone.", TONE),
    "frustrated": ("Speak in a frustrated tone.", TONE),
    "apologetic": ("Speak in an apologetic tone.", TONE),
    "sympathetic": ("Speak in a warm, sympathetic tone.", TONE),
    "sarcastic": ("Speak in a sarcastic tone.", EXPERIMENTAL),
    "serious": ("Speak in a calm and serious tone.", TONE),
    "calm": ("Speak in a calm, relaxed tone.", TONE),
    "polite": ("Speak in a polite, friendly tone.", TONE),
    "friendly": ("Speak in a friendly, warm tone.", TONE),
    "sighing": ("Speak with a sigh, sounding tired.", EXPERIMENTAL),
    "whispering": ("Speak in a soft whisper.", EXPERIMENTAL),
    "shouting": ("Speak loudly, almost shouting.", EXPERIMENTAL),
    "in a hurry": ("Speak quickly, as if in a hurry.", TONE),
}

_TAG = re.compile(r"\[([^\]]+)\]")


@dataclass(frozen=True)
class Piece:
    """Part of a turn spoken in one call: text and the expression before it."""

    text: str
    tag: str | None = None
    instruct: str | None = None
    support: str | None = None


@dataclass
class ExpressionNotes:
    unsupported: list[str]
    experimental: list[str]
    #: tags dropped because the voice cannot take instructions (Base / 0.6B)
    dropped_no_instruct: list[str]


def split_expressions(text: str, voice_takes_instruct: bool = True) -> tuple[list[Piece], ExpressionNotes]:
    """Cuts a turn at each [tag]; text before the first tag has no expression.

    An expression applies until the next tag, like a stage direction. A tag
    with no words after it is dropped.
    """
    notes = ExpressionNotes([], [], [])
    pieces: list[Piece] = []
    tag: str | None = None
    at = 0

    def push(chunk: str, current: str | None) -> None:
        chunk = re.sub(r"\s+", " ", chunk).strip()
        if not chunk:
            return
        if current is None:
            pieces.append(Piece(chunk))
            return
        entry = INSTRUCTIONS.get(current)
        if entry is None:
            notes.unsupported.append(current)
            pieces.append(Piece(chunk))
        elif not voice_takes_instruct:
            notes.dropped_no_instruct.append(current)
            pieces.append(Piece(chunk))
        else:
            if entry[1] == EXPERIMENTAL:
                notes.experimental.append(current)
            pieces.append(Piece(chunk, current, entry[0], entry[1]))

    for m in _TAG.finditer(text):
        push(text[at:m.start()], tag)
        tag = m.group(1).strip().lower()
        at = m.end()
    push(text[at:], tag)

    # Neighbouring pieces with the same expression are one call.
    merged: list[Piece] = []
    for p in pieces:
        if merged and merged[-1].tag == p.tag and merged[-1].instruct == p.instruct:
            prev = merged.pop()
            merged.append(Piece(f"{prev.text} {p.text}", p.tag, p.instruct, p.support))
        else:
            merged.append(p)
    return merged, notes


def strip_tags(text: str) -> str:
    """Words only, as a listener (and the transcript) has them."""
    return re.sub(r"\s+", " ", _TAG.sub(" ", text)).strip()
