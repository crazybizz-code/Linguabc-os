"""Modal deployment of a Chatterbox worker. NOT deployed: paid GPU, owner's approval first.

    modal secret create linguabc-tts LINGUABC_TTS_SECRET=<random 32+ characters> \
        TTS_CALLBACK_HOSTS=app.linguabc.xyz TTS_UPLOAD_HOSTS=qycffcuuavtlojkxrkiz.supabase.co
    modal volume create linguabc-voices          # approved references (voices.py registry)
    modal volume put linguabc-voices voices/ /
    TTS_ENGINE=chatterbox-turbo modal deploy modal_chatterbox.py   # or chatterbox

The web app (same routes as http_app: GET /health, POST /render, POST /jobs)
is served by create_app. A job is not run in a background thread here:
Modal may stop an idle container while a thread still runs, so /jobs spawns
run_job, which is its own Modal input and keeps the container alive.
One L4, one container; the GPU lock keeps one recording at a time.
"""

from __future__ import annotations

import os
import threading

import modal

ENGINE = os.environ.get("TTS_ENGINE", "chatterbox-turbo")
image = (
    modal.Image.debian_slim(python_version="3.11")
    .apt_install("ffmpeg")
    .pip_install("setuptools<81", "chatterbox-tts==0.1.7", "faster-whisper==1.2.1", "fastapi[standard]>=0.115,<1", "soundfile")
    .env({"HF_HOME": "/cache/hf", "HF_HUB_DISABLE_TELEMETRY": "1", "TTS_ENGINE": ENGINE, "TTS_VOICES_DIR": "/voices",
          "TTS_CACHE_DIR": "/cache/segments", "TTS_SPOKEN": "1", "ASR_MODEL": "large-v3"})
    .add_local_python_source("linguabc_tts")
)
app = modal.App(f"linguabc-tts-{ENGINE}")
cache = modal.Volume.from_name("linguabc-tts-cache", create_if_missing=True)
voices = modal.Volume.from_name("linguabc-voices", create_if_missing=True)


@app.cls(gpu="L4", image=image, volumes={"/cache": cache, "/voices": voices.read_only()},
         secrets=[modal.Secret.from_name("linguabc-tts")], timeout=3600, scaledown_window=120, max_containers=1)
@modal.concurrent(max_inputs=4)
class Worker:
    @modal.enter()
    def load(self) -> None:
        from linguabc_tts.http_app import worker
        from linguabc_tts.jobs import JobRunner

        self.parts = worker()          # engine, ASR, cache, params: loaded once per container
        engine, asr, seg_cache, params = self.parts
        self.runner = JobRunner(ENGINE, engine, asr, seg_cache, os.environ["LINGUABC_TTS_SECRET"], params=params)  # no thread here
        self.gpu = threading.Lock()

    @modal.method()
    def run_job(self, job) -> None:
        with self.gpu:
            self.runner.run(job)
        cache.commit()

    @modal.asgi_app()
    def web(self):
        from linguabc_tts.http_app import create_app

        outer = self

        class SpawnRunner:
            engine_name = outer.runner.engine_name

            def submit(self, job) -> bool:
                if not outer.runner.submit_only(job):
                    return False
                outer.run_job.spawn(job)
                return True

        return create_app(lambda: self.parts, lambda: SpawnRunner())
