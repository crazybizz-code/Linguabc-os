"""Chatterbox and Zonos behind the worker's Engine interface (pilot only).

Each runs in its own virtualenv (their pins clash with qwen-tts):
  * Chatterbox 0.1.7 pins torch 2.6.0 and transformers 5.2.0;
  * Zonos (git) needs a lazy Japanese dictionary and a source checkout
    on PYTHONPATH (its pyproject packages only the top-level module).

How LinguABC expression tags reach each engine (none is official LinguABC
mapping; all are our choices, checked by the A/B test):
  * Chatterbox (original 0.5B): `exaggeration` / `cfg_weight` per call.
    Turbo: only the inline non-verbal tags its README names ([laugh],
    [chuckle], [cough]); emotion tags have no Turbo equivalent.
  * Zonos: the 8-way emotion vector of make_cond_dict
    (Happiness, Sadness, Disgust, Fear, Surprise, Anger, Other, Neutral).
"""

from __future__ import annotations

import hashlib
from pathlib import Path

import numpy as np

from linguabc_tts.engines import token_budget
from linguabc_tts.expressions import INSTRUCTIONS

TAG_OF = {instr: tag for tag, (instr, _) in INSTRUCTIONS.items()}


def _sig(path: Path, *extra) -> str:
    h = hashlib.sha256(Path(path).read_bytes())
    for e in extra:
        h.update(str(e).encode())
    return h.hexdigest()[:16]


# Chatterbox original: (exaggeration, cfg_weight). README: expressive speech -> lower cfg, exaggeration >= 0.7.
CB_STYLE = {
    "excited": (0.85, 0.3), "enthusiastic": (0.8, 0.3), "happy": (0.75, 0.35), "surprised": (0.8, 0.3),
    "amused": (0.7, 0.35), "shouting": (0.95, 0.3), "curious": (0.65, 0.4),
    "serious": (0.3, 0.5), "calm": (0.3, 0.5), "thoughtful": (0.35, 0.5), "sad": (0.4, 0.45),
}
CB_NEUTRAL = (0.5, 0.5)
TURBO_TAGS = {"laughing": "[laugh]", "chuckling": "[chuckle]"}


class ChatterboxEngine:
    provider = "chatterbox"

    def __init__(self, voices: dict[str, Path], variant: str = "original"):
        import torch

        self._torch = torch
        torch.set_num_threads(max(1, __import__("os").cpu_count() or 1))
        if variant == "turbo":
            from chatterbox.tts_turbo import ChatterboxTurboTTS
            self.model = ChatterboxTurboTTS.from_pretrained(device="cpu")
            self.model_id = "ResembleAI/chatterbox-turbo"
        else:
            from chatterbox.tts import ChatterboxTTS
            self.model = ChatterboxTTS.from_pretrained(device="cpu")
            self.model_id = "ResembleAI/chatterbox"
        self.variant, self._voices = variant, {k: Path(v) for k, v in voices.items()}

    def voices(self):
        return list(self._voices)

    def takes_instruct(self, voice):
        return True

    def voice_signature(self, voice):
        return _sig(self._voices[voice], self.variant)

    def synthesize(self, text, voice, instruct, language, seed):
        torch = self._torch
        torch.manual_seed(seed)
        tag = TAG_OF.get(instruct or "")
        with torch.inference_mode():
            if self.variant == "turbo":
                t = f"{TURBO_TAGS[tag]} {text}" if tag in TURBO_TAGS else text
                wav = self.model.generate(t, audio_prompt_path=str(self._voices[voice]))
            else:
                ex, cfg = CB_STYLE.get(tag, CB_NEUTRAL) if tag else CB_NEUTRAL
                wav = self.model.generate(text, audio_prompt_path=str(self._voices[voice]), exaggeration=ex, cfg_weight=cfg)
        return wav.squeeze(0).cpu().numpy().astype(np.float32), int(self.model.sr)


# Zonos emotion vectors: Happiness, Sadness, Disgust, Fear, Surprise, Anger, Other, Neutral.
ZONOS_NEUTRAL = [0.3077, 0.0256, 0.0256, 0.0256, 0.0256, 0.0256, 0.2564, 0.3077]  # make_cond_dict default
ZONOS_EMOTION = {
    "excited": [0.65, 0.02, 0.02, 0.02, 0.25, 0.02, 0.02, 0.02],
    "enthusiastic": [0.7, 0.02, 0.02, 0.02, 0.15, 0.02, 0.05, 0.02],
    "happy": [0.8, 0.02, 0.02, 0.02, 0.05, 0.02, 0.05, 0.02],
    "surprised": [0.2, 0.02, 0.02, 0.05, 0.65, 0.02, 0.02, 0.02],
    "curious": [0.25, 0.02, 0.02, 0.02, 0.45, 0.02, 0.2, 0.04],
    "serious": [0.03, 0.05, 0.02, 0.02, 0.02, 0.05, 0.21, 0.6],
    "calm": [0.15, 0.02, 0.02, 0.02, 0.02, 0.02, 0.15, 0.6],
    "sad": [0.02, 0.7, 0.02, 0.05, 0.02, 0.02, 0.15, 0.02],
    "worried": [0.02, 0.2, 0.02, 0.55, 0.05, 0.02, 0.12, 0.02],
    "annoyed": [0.02, 0.05, 0.15, 0.02, 0.02, 0.6, 0.12, 0.02],
}


class ZonosEngine:
    provider = "zonos"

    def __init__(self, voices: dict[str, tuple[Path, str]], repo: str = "Zyphra/Zonos-v0.1-transformer"):
        import os

        import soundfile as sf
        import torch
        from zonos.model import Zonos

        self._torch = torch
        torch.set_num_threads(max(1, os.cpu_count() or 1))
        self.model = Zonos.from_pretrained(repo, device="cpu")
        self.model_id = repo
        self._voices, self._spk, self._lang = {}, {}, {}
        for name, (path, lang) in voices.items():
            # soundfile, not torchaudio.load: torchaudio >= 2.9 needs torchcodec for that.
            data, sr = sf.read(str(path), dtype="float32", always_2d=True)
            self._spk[name] = self.model.make_speaker_embedding(torch.from_numpy(data.T.copy()), sr)
            self._voices[name], self._lang[name] = Path(path), lang

    def voices(self):
        return list(self._voices)

    def takes_instruct(self, voice):
        return True

    def voice_signature(self, voice):
        return _sig(self._voices[voice], self._lang[voice])

    def synthesize(self, text, voice, instruct, language, seed):
        from zonos.conditioning import make_cond_dict

        torch = self._torch
        torch.manual_seed(seed)
        tag = TAG_OF.get(instruct or "")
        emotion = ZONOS_EMOTION.get(tag, ZONOS_NEUTRAL)
        cond = make_cond_dict(text=text, speaker=self._spk[voice], language=self._lang[voice], emotion=emotion)
        with torch.inference_mode():
            conditioning = self.model.prepare_conditioning(cond)
            # 86 codec frames per second; same budget rule as the Qwen engines.
            budget = int(token_budget(text, 10_000) / 12.5 * 86)
            codes = self.model.generate(conditioning, max_new_tokens=min(budget, 86 * 30), progress_bar=False,
                                        disable_torch_compile=True)
            wav = self.model.autoencoder.decode(codes).cpu()
        return wav[0, 0].numpy().astype(np.float32), int(self.model.autoencoder.sampling_rate)
