"""Modal deployment of the Chatterbox worker (pilot). NOT deployed: paid GPU, owner's approval first.

    modal secret create linguabc-tts LINGUABC_TTS_SECRET=<random 32+ characters>
    modal volume create linguabc-voices          # approved references (voices.py registry)
    modal volume put linguabc-voices voices/ /
    modal deploy modal_chatterbox.py

One L4, scale to zero after 2 minutes, one container, one request at a time.
The voice registry volume is read-only to the worker; only approved voices with
cloning consent load (voices.VoiceRegistry.usable()).
"""

from __future__ import annotations

import os

import fastapi
import modal

image = (
    modal.Image.debian_slim(python_version="3.11")
    .apt_install("ffmpeg")
    .pip_install("setuptools<81", "chatterbox-tts==0.1.7", "faster-whisper==1.2.1", "fastapi[standard]>=0.115,<1", "soundfile")
    .env({"HF_HOME": "/cache/hf", "HF_HUB_DISABLE_TELEMETRY": "1", "TTS_ENGINE": "chatterbox", "TTS_VOICES_DIR": "/voices",
          "TTS_CACHE_DIR": "/cache/segments", "TTS_SPOKEN": "1", "ASR_MODEL": "large-v3"})
    .add_local_python_source("linguabc_tts")
)
app = modal.App("linguabc-tts-chatterbox")
cache = modal.Volume.from_name("linguabc-tts-cache", create_if_missing=True)
voices = modal.Volume.from_name("linguabc-voices", create_if_missing=True)


@app.cls(gpu="L4", image=image, volumes={"/cache": cache, "/voices": voices.read_only()},
         secrets=[modal.Secret.from_name("linguabc-tts")], timeout=600, scaledown_window=120, max_containers=1)
@modal.concurrent(max_inputs=1)
class Worker:
    @modal.enter()
    def load(self) -> None:
        from linguabc_tts.http_app import worker

        worker()  # loads the engine, ASR and cache once per container
        cache.commit()

    @modal.fastapi_endpoint(method="POST", label="linguabc-tts-chatterbox-render")
    async def render(self, request: fastapi.Request):
        from fastapi.responses import JSONResponse

        from linguabc_tts.http_app import worker
        from linguabc_tts.server import handle

        engine, asr, seg_cache, params = worker()
        status, reply = handle(await request.body(), dict(request.headers), os.environ["LINGUABC_TTS_SECRET"], engine, asr,
                               seg_cache, params=params, spoken=True)
        if status in (200, 422):
            cache.commit()
        return JSONResponse(reply, status_code=status)
