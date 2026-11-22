"""Chatterbox engines (Resemble AI, MIT, retired upstream in August 2026).

Run in their own environment: chatterbox-tts 0.1.7 pins torch 2.6.0 and
transformers 5.2.0 (they clash with qwen-tts), and its watermarker
(resemble-perth) needs setuptools<81 for pkg_resources. Every output carries
Resemble's Perth watermark (applied inside generate()).

  * ChatterboxEngine (0.5B, "original"): expression through `exaggeration`
    and `cfg_weight` per call (README: expressive speech -> lower cfg,
    exaggeration >= 0.7). Tags are never spoken.
  * Turbo (350M): no exaggeration (ignored with a warning in its code);
    expression through inline tags. The official set is the tokenizer's
    added_tokens.json in ResembleAI/chatterbox-turbo (19 tags, below);
    the README names only [cough], [laugh] and [chuckle] "and more".
"""

from __future__ import annotations

import hashlib
import os
from pathlib import Path

import numpy as np

from .expressions import INSTRUCTIONS

TAG_OF = {instr: tag for tag, (instr, _) in INSTRUCTIONS.items()}

#: ResembleAI/chatterbox-turbo added_tokens.json (read 2026-11-22).
TURBO_OFFICIAL_TAGS = (
    "[laugh]", "[chuckle]", "[cough]", "[sigh]", "[gasp]", "[groan]", "[sniff]", "[shush]", "[clear throat]",
    "[happy]", "[angry]", "[fear]", "[surprised]", "[crying]", "[sarcastic]", "[whispering]", "[dramatic]",
    "[narration]", "[advertisement]",
)

#: LinguABC expression -> Turbo tag. Our choice; tags without a sensible match are dropped.
TURBO_TAG_FOR = {
    "laughing": "[laugh]", "chuckling": "[chuckle]", "amused": "[chuckle]", "sighing": "[sigh]",
    "whispering": "[whispering]", "surprised": "[surprised]", "sarcastic": "[sarcastic]",
    "happy": "[happy]", "excited": "[happy]", "enthusiastic": "[happy]",
    "annoyed": "[angry]", "frustrated": "[angry]", "worried": "[fear]", "nervous": "[fear]",
}

#: Chatterbox 0.5B: LinguABC expression -> (exaggeration, cfg_weight). Neutral is (0.5, 0.5).
EXAGGERATION_FOR = {
    "excited": (0.85, 0.3), "enthusiastic": (0.8, 0.3), "happy": (0.75, 0.35), "surprised": (0.8, 0.3),
    "amused": (0.7, 0.35), "shouting": (0.95, 0.3), "curious": (0.65, 0.4),
    "serious": (0.3, 0.5), "calm": (0.3, 0.5), "thoughtful": (0.35, 0.5), "sad": (0.4, 0.45),
}
NEUTRAL = (0.5, 0.5)


def _fingerprint(path: Path, *extra) -> str:
    h = hashlib.sha256(Path(path).read_bytes())
    for e in extra:
        h.update(str(e).encode())
    return h.hexdigest()[:16]


class ChatterboxEngine:
    """voices: name -> reference WAV (licensed, with cloning consent: see voices.py)."""

    provider = "chatterbox"

    def __init__(self, voices: dict[str, Path], variant: str = "original", device: str | None = None):
        import torch

        self._torch = torch
        dev = device or ("cuda" if torch.cuda.is_available() else "cpu")
        if dev == "cpu":
            torch.set_num_threads(max(1, os.cpu_count() or 1))
        if variant == "turbo":
            from chatterbox.tts_turbo import ChatterboxTurboTTS
            self.model = ChatterboxTurboTTS.from_pretrained(device=dev)
            self.model_id = "ResembleAI/chatterbox-turbo"
        else:
            from chatterbox.tts import ChatterboxTTS
            self.model = ChatterboxTTS.from_pretrained(device=dev)
            self.model_id = "ResembleAI/chatterbox"
        self.variant = variant
        self.lexicon_key = "chatterbox-turbo" if variant == "turbo" else "chatterbox"
        self._voices = {k: Path(v) for k, v in voices.items()}

    def voices(self):
        return list(self._voices)

    def takes_instruct(self, voice):
        return True

    def voice_signature(self, voice):
        return _fingerprint(self._voices[voice], self.variant)

    def synthesize(self, text, voice, instruct, language, seed):
        torch = self._torch
        torch.manual_seed(seed)
        tag = TAG_OF.get(instruct or "")
        ref = str(self._voices[voice])
        with torch.inference_mode():
            if self.variant == "turbo":
                said = f"{TURBO_TAG_FOR[tag]} {text}" if tag in TURBO_TAG_FOR else text
                # norm_loudness=False: Turbo's own reference loudness step (pyloudnorm) turns the clip into
                # float64 and its tokenizer then fails ("expected Double but found Float"; upstream bug,
                # unfixed since the project was retired). References are normalised when registered (voices.py).
                wav = self.model.generate(said, audio_prompt_path=ref, norm_loudness=False)
            else:
                ex, cfg = EXAGGERATION_FOR.get(tag, NEUTRAL) if tag else NEUTRAL
                wav = self.model.generate(text, audio_prompt_path=ref, exaggeration=ex, cfg_weight=cfg)
        return wav.squeeze(0).cpu().numpy().astype(np.float32), int(self.model.sr)

    def synthesize_raw(self, text: str, voice: str, seed: int):
        """Turbo tag tests: the text goes in exactly as written (tags included)."""
        torch = self._torch
        torch.manual_seed(seed)
        with torch.inference_mode():
            kwargs = {"norm_loudness": False} if self.variant == "turbo" else {}
            wav = self.model.generate(text, audio_prompt_path=str(self._voices[voice]), **kwargs)
        return wav.squeeze(0).cpu().numpy().astype(np.float32), int(self.model.sr)
