"""Provider-specific pronunciation lexicon (worker only).

Some words each engine misreads in its own way: on real runs "LinguABC"
came out as "Lingway BC" (Chatterbox 0.5B, Qwen VoiceDesign), "Linguay
ABC" and "Lingu ABC" (Zonos). The respelling that works differs per
engine, so the lexicon is keyed by engine. Fish is not affected: the Fish
path is in the Next.js app (src/lib/ai/script.ts SAY) and never reads this.

Only the audio uses the respelling; the transcript and QA keep the real
word (qa.normalize treats the respelling and the brand as the same word).

The intended pronunciation of LinguABC is "LING-gwuh A-B-C" (Lingua + the
letters A, B, C). This is an assumption until the owner confirms it.
Entries are chosen by pilot/lexicon_test.py (ASR check) and should be
confirmed by ear.
"""

from __future__ import annotations

import re

#: word -> {engine key: respelling}; "default" is used for engines without an entry.
LEXICON: dict[str, dict[str, str]] = {
    # pilot/lexicon_test.py, 2 seeds each (2026-11-22). As written, "LinguABC" was heard right
    # 0/2 on Chatterbox, 0/2 Turbo, 1/2 Qwen CustomVoice, 0/2 Qwen clone.
    "LinguABC": {
        "default": "Lingua A B C",     # Chatterbox 2/2, Turbo 2/2, Qwen CustomVoice 2/2, Zonos 1/2 (1 tried)
        "qwen": "Lingua, A, B, C",     # Qwen CustomVoice 2/2, Qwen clone 2/2 (the default: 1/2 on clone)
    },
}

LEXICON_VERSION = 2


def respell(text: str, engine_key: str) -> str:
    for word, by_engine in LEXICON.items():
        say = by_engine.get(engine_key, by_engine["default"])
        text = re.sub(rf"\b{re.escape(word)}\b", say, text)
    return text
