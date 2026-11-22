"""Speech engines. QwenEngine is the real one; FakeEngine is for tests.

An engine turns one piece of text into mono float32 samples. It is called
one segment at a time, with a seed derived from the segment hash, so the
same request is reproducible (up to GPU kernel nondeterminism).
"""

from __future__ import annotations

import hashlib
import os
from dataclasses import dataclass, field
from typing import Protocol

import numpy as np

DEFAULT_MODEL = "Qwen/Qwen3-TTS-12Hz-1.7B-CustomVoice"


@dataclass(frozen=True)
class GenerationConfig:
    """Sampling settings. Low temperature keeps a voice steady between turns."""

    temperature: float = 0.3
    top_p: float = 0.8
    top_k: int = 50
    repetition_penalty: float = 1.05
    max_new_tokens: int = 2048

    def as_params(self) -> dict:
        return {"temperature": self.temperature, "top_p": self.top_p, "top_k": self.top_k,
                "repetition_penalty": self.repetition_penalty, "max_new_tokens": self.max_new_tokens}


class Engine(Protocol):
    provider: str
    model_id: str

    def takes_instruct(self, voice: str) -> bool: ...

    def voices(self) -> list[str]: ...

    def synthesize(self, text: str, voice: str, instruct: str | None, language: str, seed: int) -> tuple[np.ndarray, int]: ...


class QwenEngine:
    """Qwen3-TTS CustomVoice through the official `qwen-tts` package.

    Loads lazily so the rest of the worker (and its tests) never needs torch.
    """

    provider = "qwen"

    def __init__(self, model_path: str, model_id: str = DEFAULT_MODEL, device: str | None = None,
                 config: GenerationConfig = GenerationConfig()):
        import torch
        from qwen_tts import Qwen3TTSModel

        self._torch = torch
        self.model_id = model_id
        self.config = config
        cuda = torch.cuda.is_available() if device is None else device.startswith("cuda")
        self.device = device or ("cuda:0" if cuda else "cpu")
        # CPU: float32 by default; QWEN_CPU_DTYPE=bfloat16 is much faster on CPUs with AMX/AVX-512 BF16.
        cpu_dtype = torch.bfloat16 if os.environ.get("QWEN_CPU_DTYPE", "").lower() in ("bf16", "bfloat16") else torch.float32
        kwargs: dict = {"device_map": self.device, "dtype": torch.bfloat16 if cuda else cpu_dtype}
        if cuda:
            try:
                import flash_attn  # noqa: F401
                kwargs["attn_implementation"] = "flash_attention_2"
            except ImportError:
                kwargs["attn_implementation"] = "sdpa"
        if not cuda:
            torch.set_num_threads(max(1, os.cpu_count() or 1))
        self.model = Qwen3TTSModel.from_pretrained(model_path, **kwargs)
        inner = self.model.model
        if inner.tts_model_type != "custom_voice":
            raise RuntimeError(f"{model_id} is a {inner.tts_model_type} model; the pilot needs CustomVoice")
        # qwen_tts drops `instruct` for 0.6B models (inference/qwen3_tts_model.py).
        self._instruct = "0b6" not in str(inner.tts_model_size)
        self._voices = [v for v in (self.model.get_supported_speakers() or [])]

    def voices(self) -> list[str]:
        return list(self._voices)

    def takes_instruct(self, voice: str) -> bool:
        return self._instruct

    def synthesize(self, text, voice, instruct, language, seed):
        torch = self._torch
        torch.manual_seed(seed)
        if torch.cuda.is_available():
            torch.cuda.manual_seed_all(seed)
        c = self.config
        with torch.inference_mode():
            wavs, sr = self.model.generate_custom_voice(
                text=text, speaker=voice, language=language, instruct=instruct or "", **_sampling(c, text))
        return np.asarray(wavs[0], dtype=np.float32).reshape(-1), int(sr)


def _load_qwen(model_path: str, device: str | None):
    """Loads any Qwen3-TTS checkpoint the same way (GPU bf16; CPU fp32 or QWEN_CPU_DTYPE=bfloat16)."""
    import torch
    from qwen_tts import Qwen3TTSModel

    cuda = torch.cuda.is_available() if device is None else device.startswith("cuda")
    dev = device or ("cuda:0" if cuda else "cpu")
    cpu_dtype = torch.bfloat16 if os.environ.get("QWEN_CPU_DTYPE", "").lower() in ("bf16", "bfloat16") else torch.float32
    kwargs: dict = {"device_map": dev, "dtype": torch.bfloat16 if cuda else cpu_dtype}
    if cuda:
        try:
            import flash_attn  # noqa: F401
            kwargs["attn_implementation"] = "flash_attention_2"
        except ImportError:
            kwargs["attn_implementation"] = "sdpa"
    else:
        torch.set_num_threads(max(1, os.cpu_count() or 1))
    return torch, Qwen3TTSModel.from_pretrained(model_path, **kwargs)


def token_budget(text: str, cap: int) -> int:
    """Codec frames (12.5 per second) a text can need: ~0.8 s per word, letter
    or digit plus 3 s, at most `cap`. Stops a runaway generation (seen with
    Base cloning on CPU: 2048 frames, ~160 s of audio, for one short line)."""
    import re as _re

    units = len(_re.findall(r"[A-Za-z]+(?:'[a-z]+)?|\d", text))
    spelled = sum(len(m) // 2 for m in _re.findall(r"\b(?:[A-Za-z]-){2,}[A-Za-z]\b", text))
    return int(min(cap, 12.5 * (0.8 * (units + spelled) + 3)))


def _sampling(c: GenerationConfig, text: str) -> dict:
    return dict(do_sample=True, temperature=c.temperature, top_p=c.top_p, top_k=c.top_k,
                repetition_penalty=c.repetition_penalty, max_new_tokens=token_budget(text, c.max_new_tokens),
                subtalker_dosample=True, subtalker_temperature=c.temperature, subtalker_top_p=c.top_p)


def _fingerprint(*parts) -> str:
    h = hashlib.sha256()
    for p in parts:
        h.update(p if isinstance(p, bytes) else str(p).encode("utf-8"))
        h.update(b"\0")
    return h.hexdigest()[:16]


class QwenDesignEngine:
    """Qwen3-TTS VoiceDesign: each voice is a natural-language description
    ("A woman in her 30s with a Southern British accent ..."). An expression
    instruction is appended to the description for that call. The timbre is
    re-imagined on every call, so the same description can drift between
    lines; use it to design a voice, then clone it (QwenCloneEngine)."""

    provider = "qwen"

    def __init__(self, model_path: str, voices: dict[str, str], model_id: str = "Qwen/Qwen3-TTS-12Hz-1.7B-VoiceDesign",
                 device: str | None = None, config: GenerationConfig = GenerationConfig()):
        self._torch, self.model = _load_qwen(model_path, device)
        if self.model.model.tts_model_type != "voice_design":
            raise RuntimeError(f"{model_id} is not a VoiceDesign model")
        self.model_id, self.config, self.descriptions = model_id, config, dict(voices)

    def voices(self) -> list[str]:
        return list(self.descriptions)

    def takes_instruct(self, voice: str) -> bool:
        return True

    def voice_signature(self, voice: str) -> str:
        return _fingerprint(self.descriptions[voice])

    def synthesize(self, text, voice, instruct, language, seed):
        torch = self._torch
        torch.manual_seed(seed)
        desc = self.descriptions[voice] + (f" {instruct}" if instruct else "")
        with torch.inference_mode():
            wavs, sr = self.model.generate_voice_design(text=text, instruct=desc, language=language, **_sampling(self.config, text))
        return np.asarray(wavs[0], dtype=np.float32).reshape(-1), int(sr)


class QwenCloneEngine:
    """Qwen3-TTS Base: every voice is cloned from a reference clip and its
    transcript (ICL mode). Same timbre on every line; no `instruct`, so
    expression tags are dropped (reported as expressions_dropped_no_instruct)."""

    provider = "qwen"

    def __init__(self, model_path: str, voices: dict[str, tuple[np.ndarray, int, str]],
                 model_id: str = "Qwen/Qwen3-TTS-12Hz-1.7B-Base", device: str | None = None,
                 config: GenerationConfig = GenerationConfig()):
        self._torch, self.model = _load_qwen(model_path, device)
        if self.model.model.tts_model_type != "base":
            raise RuntimeError(f"{model_id} is not a Base model")
        self.model_id, self.config = model_id, config
        self._prompts, self._sigs = {}, {}
        for name, (audio, sr, ref_text) in voices.items():
            self._prompts[name] = self.model.create_voice_clone_prompt(ref_audio=(audio, sr), ref_text=ref_text)
            self._sigs[name] = _fingerprint(np.ascontiguousarray(audio, dtype=np.float32).tobytes(), sr, ref_text)

    def voices(self) -> list[str]:
        return list(self._prompts)

    def takes_instruct(self, voice: str) -> bool:
        return False

    def voice_signature(self, voice: str) -> str:
        return self._sigs[voice]

    def synthesize(self, text, voice, instruct, language, seed):
        torch = self._torch
        torch.manual_seed(seed)
        with torch.inference_mode():
            # non_streaming_mode=True: qwen_tts defaults to simulated streaming text input for
            # cloning, which (on real runs) produced silence and never stopped until the token cap.
            wavs, sr = self.model.generate_voice_clone(text=text, language=language, voice_clone_prompt=self._prompts[voice],
                                                       non_streaming_mode=True, **_sampling(self.config, text))
        return np.asarray(wavs[0], dtype=np.float32).reshape(-1), int(sr)


@dataclass
class FakeEngine:
    """A deterministic stand-in: a tone whose length follows the text.

    `registry` maps each produced clip to the words "heard" in it, which the
    FakeTranscriber reads back. `garble` makes the first N attempts at a
    text lose its last word, to test retries.
    """

    sample_rate: int = 24000
    provider: str = "qwen"
    model_id: str = "fake-qwen"
    no_instruct_voices: set[str] = field(default_factory=set)
    garble: dict[str, int] = field(default_factory=dict)
    fail: set[str] = field(default_factory=set)
    amplitude: float = 0.3
    calls: list[tuple[str, str, str | None, int]] = field(default_factory=list)
    registry: dict[str, str] = field(default_factory=dict)

    def voices(self) -> list[str]:
        return ["Ryan", "Aiden", "Serena", "Vivian"]

    def takes_instruct(self, voice: str) -> bool:
        return voice not in self.no_instruct_voices

    def synthesize(self, text, voice, instruct, language, seed):
        self.calls.append((text, voice, instruct, seed))
        if text in self.fail:
            raise RuntimeError(f"engine failed on {text!r}")
        heard = text
        if self.garble.get(text, 0) > 0:
            self.garble[text] -= 1
            heard = " ".join(text.split()[:-1])
        words = max(1, len(text.split()))
        n = int(self.sample_rate * (0.4 * words))  # 150 words per minute
        t = np.arange(n, dtype=np.float32) / self.sample_rate
        pitch = 110 + (int(hashlib.sha256(voice.encode()).hexdigest()[:4], 16) % 120)
        rng = np.random.default_rng(seed)
        audio = (self.amplitude * np.sin(2 * np.pi * pitch * t) + 0.01 * rng.standard_normal(n)).astype(np.float32)
        self.registry[clip_id(audio)] = heard
        return audio, self.sample_rate


def clip_id(audio: np.ndarray) -> str:
    return hashlib.sha256(np.ascontiguousarray(audio, dtype=np.float32).tobytes()).hexdigest()
