"""A worker with the fake engine, for the cross-language end-to-end test (tests/ts/worker.e2e.mjs).

    TTS_ALLOW_HTTP=1 LINGUABC_TTS_SECRET=... uvicorn tests.e2e_server:app --port 8765   (from workers/tts)
"""
import os
import tempfile

from linguabc_tts.cache import SegmentCache
from linguabc_tts.engines import FakeEngine
from linguabc_tts.http_app import create_app
from linguabc_tts.jobs import JobRunner
from linguabc_tts.qa import FakeTranscriber

engine = FakeEngine()
cache = SegmentCache(tempfile.mkdtemp())
runner = JobRunner("chatterbox-turbo", engine, FakeTranscriber(engine), cache, os.environ["LINGUABC_TTS_SECRET"], progress_every_s=0.0)
runner.start()
app = create_app(lambda: (engine, FakeTranscriber(engine), cache, {}), lambda: runner)
