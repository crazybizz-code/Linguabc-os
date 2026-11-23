"""Modal serverless deployment of the TTS worker (pilot). NOT deployed.

Deploying runs paid GPU time on the owner's Modal account, so it waits for
the owner's go-ahead. Steps (README.md):

    modal secret create linguabc-tts LINGUABC_TTS_SECRET=<random 32+ chars>
    modal deploy modal_app.py          # prints the /render URL

Then set QWEN_TTS_URL and QWEN_TTS_SECRET (same secret) in Vercel and, for
the pilot only, AUDIO_PROVIDER=qwen. Production stays on Fish until then.

Resources:
  * one L4 GPU (24 GB) for Qwen3-TTS 1.7B (bf16) and faster-whisper
    large-v3 (fp16); CPU does ffmpeg and the QA maths;
  * scales to zero: no cost while idle; scaledown after 2 minutes;
  * max_containers=1 and one request at a time: the GPU is never shared
    and two requests never speak the same segment;
  * a Volume keeps the weights (no download on cold start) and the
    verified segment cache.
"""

from __future__ import annotations

import os

import fastapi
import modal

MODEL_ID = "Qwen/Qwen3-TTS-12Hz-1.7B-CustomVoice"
ASR_MODEL = "large-v3"
CACHE = "/cache"

image = (
    modal.Image.debian_slim(python_version="3.12")
    .apt_install("ffmpeg", "sox", "libsox-fmt-all")
    .pip_install("qwen-tts==0.1.1", "faster-whisper==1.2.1", "huggingface_hub>=0.26", "numpy>=1.26", "fastapi[standard]")
    .env({"HF_HOME": f"{CACHE}/hf", "HF_HUB_DISABLE_TELEMETRY": "1", "TOKENIZERS_PARALLELISM": "false"})
    .add_local_python_source("linguabc_tts")
)

app = modal.App("linguabc-tts")
volume = modal.Volume.from_name("linguabc-tts-cache", create_if_missing=True)


@app.cls(gpu="L4", image=image, volumes={CACHE: volume}, secrets=[modal.Secret.from_name("linguabc-tts")],
         timeout=600, scaledown_window=120, max_containers=1)
@modal.concurrent(max_inputs=1)
class Worker:
    @modal.enter()
    def load(self) -> None:
        from huggingface_hub import snapshot_download

        from linguabc_tts.cache import SegmentCache
        from linguabc_tts.engines import GenerationConfig, QwenEngine
        from linguabc_tts.license import check_weights_license
        from linguabc_tts.qa import FasterWhisperTranscriber

        path = snapshot_download(MODEL_ID)
        self.license = check_weights_license(path)  # refuses to start on an unexpected licence
        self.config = GenerationConfig()
        self.engine = QwenEngine(path, model_id=MODEL_ID, config=self.config)
        self.asr = FasterWhisperTranscriber(ASR_MODEL, device="cuda")
        self.cache = SegmentCache(f"{CACHE}/segments")
        volume.commit()

    @modal.fastapi_endpoint(method="POST", label="linguabc-tts-render")
    async def render(self, request: fastapi.Request):
        from fastapi.responses import JSONResponse

        from linguabc_tts.server import handle

        body = await request.body()
        status, reply = handle(body, dict(request.headers), os.environ["LINGUABC_TTS_SECRET"], self.engine, self.asr,
                               self.cache, params=self.config.as_params())
        if status in (200, 422):
            volume.commit()  # keep newly verified segments
            reply["report"]["weights_license"] = self.license
        return JSONResponse(reply, status_code=status)
