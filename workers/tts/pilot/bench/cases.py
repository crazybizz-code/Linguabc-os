"""The same test material for every engine (Qwen, Chatterbox, Zonos).

References (no consent or licence issue):
  * Emma / Oliver / Chloe: voices designed with Qwen3-TTS VoiceDesign
    (Apache-2.0 model output) in pilot/out/voice-lab/voices. Used to
    compare engines on the same voice.
  * england_1 / australia_1: Common Voice (CC0) clips shipped with the
    CommonAccent model, 3 s each. Used only to see whether an engine
    carries a real accent over from its reference. Feasibility only:
    never for production audio.
"""

from __future__ import annotations

from pathlib import Path

HERE = Path(__file__).resolve().parent
VOICES_DIR = HERE.parent / "out" / "voice-lab" / "voices"

# name -> (wav path, transcript or None, intended accent, espeak language for Zonos)
REFERENCES = {
    "Emma": (VOICES_DIR / "Emma.wav", "designed", "british", "en-gb"),
    "Oliver": (VOICES_DIR / "Oliver.wav", "designed", "british", "en-gb"),
    "Chloe": (VOICES_DIR / "Chloe.wav", "designed", "australian", "en-us"),
}
CC0_REFERENCES = {
    "england": ("england_1.wav", "british", "en-gb"),
    "australia": ("australia_1.wav", "australian", "en-us"),
}

# IELTS accuracy: names, numbers, dates, spelling, money, times, phone, postcode.
IELTS_LINES = [
    "My name is Rebecca Thornton. That's T-H-O-R-N-T-O-N.",
    "The course starts on the 23rd of March and costs £185 in total.",
    "You can reach me on 07946 328 150, any time after 4 pm.",
    "The address is 42 Hillside Road, and the postcode is CB2 1TN.",
    "The coach leaves at a quarter past seven, from platform 9.",
]
IELTS_ANSWERS = [["Thornton"], ["23rd of March"], ["£185", "185 pounds"], ["07946 328 150"], ["4 pm"],
                 ["42 Hillside Road"], ["CB2 1TN"], ["quarter past seven"], ["platform 9"]]

# Podcast: the same expression tags for every engine.
PODCAST = [
    ("Host", "[excited] Welcome back to the LinguABC podcast! Today we've got a brilliant guest."),
    ("Guest", "Thanks for having me. I've been looking forward to this."),
    ("Host", "[curious] So, what's the one habit that helps students the most?"),
    ("Guest", "[serious] Honestly, listening every single day. Even ten minutes makes a real difference."),
]
PODCAST_CAST = {"Host": "Emma", "Guest": "Oliver"}

# Expression A/B: same sentence, voice and seed, with and without the expression.
AB_LINE = "We've just heard the results of the competition, and our team came first."
AB_TAGS = ["excited", "serious", "curious"]

ACCENT_LINES = [
    "Could you tell me how much the tickets cost for the guided tour?",
    "I'm afraid the last bus to the city centre leaves at a quarter past eleven.",
]
