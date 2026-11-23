"""Asynchronous recording jobs (the app side is src/lib/audio-jobs.ts, migration 0030).

POST /jobs (signed like /render) returns 202 at once; a single background
thread speaks the plan (the GPU is never shared), reporting progress after
every segment. The finished MP3 is PUT straight to Supabase Storage with the
signed upload URL the app made as the signed-in user (no Storage key here),
then the result is reported. Every report is signed with the worker secret,
names the engine (X-LinguABC-Engine) and carries the job's own token.

Safety:
  * the same (job, attempt) is accepted once (kept on disk across restarts);
  * TTS_CALLBACK_HOSTS / TTS_UPLOAD_HOSTS (comma separated) limit where the
    worker may send anything; https only, unless TTS_ALLOW_HTTP=1 (tests);
  * reports are retried (409 = upload not visible yet, 5xx, network);
  * nothing from the script is logged.
"""

from __future__ import annotations

import json
import os
import queue
import re
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass, field
from pathlib import Path
from typing import Callable

from .cache import SegmentCache
from .pipeline import QaConfig, render
from .plan import BadRequest, parse_request
from .server import sign

_UUID = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$")
_TOKEN = re.compile(r"^[0-9a-f]{64}$")


@dataclass
class Job:
    job_id: str
    attempt: int
    scope: str
    upload_url: str
    callback_url: str
    token: str
    request: object  # plan.RenderRequest


def _hosts(var: str) -> set[str]:
    return {h.strip().lower() for h in os.environ.get(var, "").split(",") if h.strip()}


def _check_url(url: str, allowed: set[str], what: str) -> None:
    u = urllib.parse.urlparse(url)
    if u.scheme != "https" and not (u.scheme == "http" and os.environ.get("TTS_ALLOW_HTTP") == "1"):
        raise BadRequest(f"{what} must be https")
    if allowed and (u.hostname or "").lower() not in allowed:
        raise BadRequest(f"{what} host is not allowed")


def parse_job(data: dict, engine_name: str) -> Job:
    if not isinstance(data, dict) or data.get("version") != 1:
        raise BadRequest("version must be 1")
    if data.get("engine") != engine_name:
        raise BadRequest(f"this worker runs {engine_name}")
    job_id, attempt = data.get("job_id"), data.get("attempt")
    if not isinstance(job_id, str) or not _UUID.match(job_id):
        raise BadRequest("job_id must be a uuid")
    if not isinstance(attempt, int) or isinstance(attempt, bool) or not 1 <= attempt <= 10:
        raise BadRequest("attempt must be 1-10")
    upload, callback = data.get("upload") or {}, data.get("callback") or {}
    if not isinstance(upload.get("url"), str) or not isinstance(callback.get("url"), str):
        raise BadRequest("upload.url and callback.url are required")
    if not isinstance(callback.get("token"), str) or not _TOKEN.match(callback["token"]):
        raise BadRequest("callback.token is required")
    _check_url(upload["url"], _hosts("TTS_UPLOAD_HOSTS"), "upload.url")
    _check_url(callback["url"], _hosts("TTS_CALLBACK_HOSTS"), "callback.url")
    req = parse_request({"version": 1, "scope": data.get("scope"), "language": data.get("language", "English"),
                         "plan": data.get("plan"), "checks": data.get("checks") or {}})
    return Job(job_id, attempt, req.scope, upload["url"], callback["url"], callback["token"], req)


class Http:
    """The two calls the runner makes; replaced by a fake in tests."""

    def post(self, url: str, body: bytes, headers: dict[str, str]) -> int:
        req = urllib.request.Request(url, data=body, headers=headers, method="POST")
        try:
            with urllib.request.urlopen(req, timeout=30) as r:
                return r.status
        except urllib.error.HTTPError as e:
            return e.code

    def put(self, url: str, body: bytes, headers: dict[str, str]) -> int:
        req = urllib.request.Request(url, data=body, headers=headers, method="PUT")
        try:
            with urllib.request.urlopen(req, timeout=120) as r:
                return r.status
        except urllib.error.HTTPError as e:
            return e.code


_QUOTED = re.compile(r"'[^']*'")
_EXC = re.compile(r"^([A-Za-z_]\w*(?:Error|Exception)):.*$", re.S)


def _redact(reason: str) -> str:
    """A segment reason without the words of the script (they can be answers)."""
    return _EXC.sub(r"\1", _QUOTED.sub("'…'", str(reason)))[:200]


def qa_summary(report: dict) -> dict:
    """What the app keeps about a recording: no script text and no answers
    (answers_missing holds question ids, answers_checked a count)."""
    keys = ("status", "wer", "answers_missing", "answers_checked", "problems", "failed_segments", "unsupported_expressions",
            "experimental_expressions_used", "expressions_dropped_no_instruct", "duration_s", "loudness", "cache")
    out = {k: report[k] for k in keys if k in report}
    out["review_flags"] = sum(1 for s in report.get("segments", []) if s.get("review"))
    out["problems"] = [_redact(p) for p in out.get("problems", [])]
    out["failures"] = [{"n": i + 1, "reasons": [_redact(r) for r in s.get("reasons", [])[:3]]} for i, s in enumerate(report.get("segments", [])) if s.get("status") != "pass"][:10]
    out["manual_review_required"] = True
    return out


@dataclass
class JobRunner:
    engine_name: str
    engine: object
    asr: object
    cache: SegmentCache
    secret: str
    params: dict = field(default_factory=dict)
    spoken: bool = True
    qa: QaConfig = QaConfig()
    http: Http = field(default_factory=Http)
    state_dir: Path | None = None
    sleep: Callable[[float], None] = time.sleep
    progress_every_s: float = 2.0

    def __post_init__(self):
        self._queue: queue.Queue[Job] = queue.Queue()
        self._lock = threading.Lock()
        self._seen_path = Path(self.state_dir or self.cache.root) / "jobs-seen.json"
        try:
            self._seen = set(json.loads(self._seen_path.read_text("utf-8")))
        except (OSError, ValueError):
            self._seen = set()
        self._thread: threading.Thread | None = None

    def submit_only(self, job: Job) -> bool:
        """Record a job as accepted; False if this (job, attempt) was already accepted."""
        key = f"{job.job_id}:{job.attempt}"
        with self._lock:
            if key in self._seen:
                return False
            self._seen.add(key)
            self._seen_path.parent.mkdir(parents=True, exist_ok=True)
            self._seen_path.write_text(json.dumps(sorted(self._seen)[-5000:]), "utf-8")
        return True

    def submit(self, job: Job) -> bool:
        """Queue a job for the background thread; False if it was already accepted."""
        if not self.submit_only(job):
            return False
        self._queue.put(job)
        return True

    def start(self) -> None:
        if self._thread is None:
            self._thread = threading.Thread(target=self._loop, name="tts-jobs", daemon=True)
            self._thread.start()

    def _loop(self) -> None:
        while True:
            job = self._queue.get()
            try:
                self.run(job)
            except Exception as e:  # never let one job stop the queue
                self.report(job, "failed", 0, error=f"worker error: {type(e).__name__}")

    def run_pending(self) -> None:
        """Tests: run what is queued, in this thread."""
        while not self._queue.empty():
            self.run(self._queue.get())

    def report(self, job: Job, status: str, progress: int, **extra) -> bool:
        body = json.dumps({"job_id": job.job_id, "attempt": job.attempt, "token": job.token, "status": status,
                           "progress": int(progress), **{k: v for k, v in extra.items() if v is not None}},
                          separators=(",", ":"), default=float).encode()
        for delay in (0, 2, 5, 15):
            if delay:
                self.sleep(delay)
            ts = int(time.time())
            code = self.http.post(job.callback_url, body, {"Content-Type": "application/json", "X-LinguABC-Engine": self.engine_name,
                                                          "X-LinguABC-Timestamp": str(ts), "X-LinguABC-Signature": sign(body, self.secret, ts)})
            if 200 <= code < 300:
                return True
            if code not in (0, 409, 429) and code < 500:
                return False  # refused for good (bad token, finished job)
        return False

    def run(self, job: Job) -> None:
        self.report(job, "processing", 1, segments_done=0, segments_total=None)
        last = [0.0]

        def progress(done: int, all_pieces: int) -> None:
            now = time.monotonic()
            if done < all_pieces and now - last[0] < self.progress_every_s:
                return
            last[0] = now
            self.report(job, "processing", max(1, min(99, int(100 * done / max(all_pieces, 1)))), segments_done=done, segments_total=all_pieces)

        result = render(job.request, self.engine, self.asr, self.cache, qa=self.qa, params=self.params, spoken=self.spoken, on_progress=progress)
        summary = qa_summary(result.report)
        if not result.ok or not result.mp3:
            self.report(job, "failed", 0, qa=summary, error=f"{result.report.get('failed_segments', 0)} part(s) failed the automatic check")
            return
        code = 0
        for delay in (0, 3, 10):
            if delay:
                self.sleep(delay)
            code = self.http.put(job.upload_url, result.mp3, {"Content-Type": "audio/mpeg", "x-upsert": "false", "cache-control": "3600"})
            if 200 <= code < 300:
                break
        if not 200 <= code < 300:
            self.report(job, "failed", 0, qa=summary, error=f"could not upload the recording ({code})")
            return
        status = "completed" if result.report.get("status") == "pass" else "needs_review"
        self.report(job, status, 100, segments_done=len(result.report.get("segments", [])), segments_total=len(result.report.get("segments", [])),
                    seconds=result.seconds, qa=summary)
