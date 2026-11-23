"""LinguABC AI Audio Engine V2 (pilot): Qwen3-TTS worker.

The Next.js app plans a script (src/lib/ai/script.ts -> planScript) and
sends the plan; this package speaks it segment by segment, checks every
segment with ASR, joins the audio with the planned pauses, normalises
loudness and returns one MP3 with a QA report.
"""

__version__ = "0.1.0"
