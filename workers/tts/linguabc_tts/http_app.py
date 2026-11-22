"""HTTP server for any GPU host (Docker, Modal, a rented box): POST /render, GET /health.

Configuration (environment):
  TTS_ENGINE           chatterbox | chatterbox-turbo | qwen-custom | qwen-clone
  LINGUABC_TTS_SECRET  shared HMAC secret (same value as QWEN_TTS_SECRET / CHATTERBOX_TTS_SECRET in Vercel)
  TTS_VOICES_DIR       voice registry (voices.py) for cloning engines; only approved voices with consent load
  TTS_CACHE_DIR        verified segment cache (default /cache/segments)
  TTS_SPOKEN           1 (default) = numbers, money and codes are said as words (spoken.py)
  QWEN_MODEL_DIR       local Qwen weights (qwen engines); else downloaded from Hugging Face
  ASR_MODEL            faster-whisper model or path (default large-v3)

The request and reply are the same as the Modal worker's (server.handle).
Nothing from requests (scripts, answers) is logged.
"""

import os
from functools import lru_cache

from .cache import SegmentCache
from .server import handle

ENGINES = ("chatterbox", "chatterbox-turbo", "qwen-custom", "qwen-clone")


def build_engine(name, voices_dir):
    if name not in ENGINES:
        raise RuntimeError(f"TTS_ENGINE must be one of {ENGINES}")
    if name in ("chatterbox", "chatterbox-turbo", "qwen-clone"):
        from .voices import VoiceRegistry

        if not voices_dir:
            raise RuntimeError("TTS_VOICES_DIR is required for cloning engines")
        voices = VoiceRegistry(voices_dir).usable()
        if not voices:
            raise RuntimeError("no approved voices with cloning consent in TTS_VOICES_DIR")
        if name.startswith("chatterbox"):
            from .engines_chatterbox import ChatterboxEngine

            return ChatterboxEngine({v.id: v.path for v in voices.values()}, "turbo" if name.endswith("turbo") else "original")
        import soundfile as sf

        from .engines import QwenCloneEngine

        loaded = {}
        for v in voices.values():
            audio, sr = sf.read(v.path, dtype="float32")
            loaded[v.id] = (audio, sr, v.transcript)
        return QwenCloneEngine(_qwen_dir("Qwen/Qwen3-TTS-12Hz-1.7B-Base"), loaded)
    from .engines import QwenEngine

    return QwenEngine(_qwen_dir("Qwen/Qwen3-TTS-12Hz-1.7B-CustomVoice"))


def _qwen_dir(repo):
    path = os.environ.get("QWEN_MODEL_DIR")
    if not path:
        from huggingface_hub import snapshot_download

        path = snapshot_download(repo)
    from .license import check_weights_license

    check_weights_license(path)  # refuses unexpected weight licences
    return path


@lru_cache(maxsize=1)
def worker():
    from .engines import GenerationConfig
    from .qa import FasterWhisperTranscriber

    name = os.environ.get("TTS_ENGINE", "")
    engine = build_engine(name, os.environ.get("TTS_VOICES_DIR"))
    asr = FasterWhisperTranscriber(os.environ.get("ASR_MODEL", "large-v3"))
    cache = SegmentCache(os.environ.get("TTS_CACHE_DIR", "/cache/segments"))
    params = GenerationConfig().as_params() if name.startswith("qwen") else {}
    return engine, asr, cache, params


def create_app(get_worker=worker):
    from fastapi import FastAPI, Request
    from fastapi.responses import JSONResponse

    app = FastAPI(title="LinguABC TTS worker", docs_url=None, redoc_url=None, openapi_url=None)

    @app.get("/health")
    def health():
        engine, *_ = get_worker()
        return {"engine": engine.provider, "model": engine.model_id, "voices": engine.voices()}

    # No "from __future__ import annotations" in this module: FastAPI needs the real Request class here.
    @app.post("/render")
    async def render(request: Request):
        engine, asr, cache, params = get_worker()
        body = await request.body()
        status, reply = handle(body, dict(request.headers), os.environ.get("LINGUABC_TTS_SECRET", ""), engine, asr, cache,
                               params=params, spoken=os.environ.get("TTS_SPOKEN", "1") != "0")
        return JSONResponse(reply, status_code=status)

    return app


def __getattr__(name):  # uvicorn linguabc_tts.http_app:app builds the app lazily
    if name == "app":
        return create_app()
    raise AttributeError(name)
