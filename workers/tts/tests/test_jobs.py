import json
import time
import uuid

import pytest

from linguabc_tts.cache import SegmentCache
from linguabc_tts.engines import FakeEngine
from linguabc_tts.jobs import JobRunner, parse_job
from linguabc_tts.plan import BadRequest
from linguabc_tts.qa import FakeTranscriber
from linguabc_tts.server import sign, verify

SECRET = "w" * 40
TOKEN = "f" * 64


class FakeHttp:
    def __init__(self, post_codes=None, put_codes=None):
        self.posts, self.puts = [], []
        self.post_codes, self.put_codes = list(post_codes or []), list(put_codes or [])

    def post(self, url, body, headers):
        self.posts.append((url, json.loads(body), headers, body))
        return self.post_codes.pop(0) if self.post_codes else 200

    def put(self, url, body, headers):
        self.puts.append((url, body, headers))
        return self.put_codes.pop(0) if self.put_codes else 200


def job_body(**over):
    data = {
        "version": 1, "job_id": str(uuid.uuid4()), "attempt": 1, "engine": "chatterbox-turbo", "scope": "platform", "language": "English",
        "plan": [{"kind": "speech", "speaker": "A", "voice": "Ryan", "text": "The course costs £185 in total."},
                 {"kind": "pause", "seconds": 0.4},
                 {"kind": "speech", "speaker": "B", "voice": "Aiden", "text": "Good, I will book it today."}],
        "checks": {"answers": [{"id": "q7", "accepted": ["185 pounds", "£185"]}]},
        "upload": {"url": "https://project.supabase.co/storage/v1/object/upload/sign/library-podcasts/podcasts/x.mp3?token=t", "content_type": "audio/mpeg"},
        "callback": {"url": "https://app.linguabc.xyz/api/audio-jobs/callback", "token": TOKEN},
    }
    data.update(over)
    return data


def runner(tmp_path, http=None, engine=None):
    engine = engine or FakeEngine()
    return JobRunner("chatterbox-turbo", engine, FakeTranscriber(engine), SegmentCache(tmp_path / "cache"), SECRET,
                     http=http or FakeHttp(), sleep=lambda s: None, progress_every_s=0.0), engine


def test_job_runs_uploads_and_reports(tmp_path):
    r, engine = runner(tmp_path)
    job = parse_job(job_body(), "chatterbox-turbo")
    assert r.submit(job)
    r.run_pending()
    http = r.http
    assert len(http.puts) == 1
    url, mp3, headers = http.puts[0]
    assert url.startswith("https://project.supabase.co/") and mp3[:1] == b"\xff" and headers["Content-Type"] == "audio/mpeg"
    statuses = [p[1]["status"] for p in http.posts]
    assert statuses[0] == "processing" and statuses[-1] == "completed"
    final = http.posts[-1][1]
    assert final["token"] == TOKEN and final["attempt"] == 1 and final["progress"] == 100 and final["seconds"] > 0
    assert final["qa"]["status"] == "pass" and final["qa"]["manual_review_required"] is True
    assert "text" not in json.dumps(final["qa"])  # no script in the report
    progress = [p[1]["progress"] for p in http.posts]
    assert progress == sorted(progress)
    # spoken form reached the engine; every report is signed and names the engine
    assert engine.calls[0][0].startswith("The course costs a hundred and eighty-five pounds")
    for _, _, headers, body in http.posts:
        assert headers["X-LinguABC-Engine"] == "chatterbox-turbo"
        assert verify(body, headers["X-LinguABC-Timestamp"], headers["X-LinguABC-Signature"], SECRET)


def test_same_job_is_accepted_once(tmp_path):
    r, _ = runner(tmp_path)
    body = job_body()
    assert r.submit(parse_job(body, "chatterbox-turbo"))
    assert not r.submit(parse_job(body, "chatterbox-turbo"))
    assert r.submit(parse_job({**body, "attempt": 2}, "chatterbox-turbo"))  # a retry is a new attempt
    r2, _ = runner(tmp_path)  # after a restart too
    assert not r2.submit(parse_job(body, "chatterbox-turbo"))


def test_failed_qa_reports_failure_without_upload(tmp_path):
    engine = FakeEngine(garble={"Good, I will book it today.": 99})
    r, _ = runner(tmp_path, engine=engine)
    r.submit(parse_job(job_body(), "chatterbox-turbo"))
    r.run_pending()
    assert r.http.puts == []
    final = r.http.posts[-1][1]
    assert final["status"] == "failed" and "failed the automatic check" in final["error"] and final["qa"]["failed_segments"] == 1


def test_upload_failure_and_report_retries(tmp_path):
    http = FakeHttp(put_codes=[500, 500, 500])
    r, _ = runner(tmp_path, http=http)
    r.submit(parse_job(job_body(), "chatterbox-turbo"))
    r.run_pending()
    assert len(http.puts) == 3 and http.posts[-1][1]["status"] == "failed" and "upload" in http.posts[-1][1]["error"]
    # 409 (upload not visible yet) is retried; 404 (unknown token) is not
    http2 = FakeHttp(post_codes=[409, 200])
    r2, _ = runner(tmp_path / "b", http=http2)
    job = parse_job(job_body(), "chatterbox-turbo")
    assert r2.report(job, "processing", 5) and len(http2.posts) == 2
    http3 = FakeHttp(post_codes=[404])
    r3, _ = runner(tmp_path / "c", http=http3)
    assert not r3.report(job, "processing", 5) and len(http3.posts) == 1


def test_jobs_need_host_allowlists(monkeypatch):
    monkeypatch.delenv("TTS_CALLBACK_HOSTS")
    with pytest.raises(BadRequest, match="no host allowlist"):
        parse_job(job_body(), "chatterbox-turbo")
    monkeypatch.setenv("TTS_CALLBACK_HOSTS", "app.linguabc.xyz")
    monkeypatch.setenv("TTS_UPLOAD_HOSTS", " ")
    with pytest.raises(BadRequest, match="no host allowlist"):
        parse_job(job_body(), "chatterbox-turbo")


def test_bad_jobs_are_refused(tmp_path, monkeypatch):
    with pytest.raises(BadRequest, match="runs chatterbox-turbo"):
        parse_job(job_body(engine="qwen"), "chatterbox-turbo")
    with pytest.raises(BadRequest, match="https"):
        parse_job(job_body(callback={"url": "http://evil.example/cb", "token": TOKEN}), "chatterbox-turbo")
    with pytest.raises(BadRequest, match="token"):
        parse_job(job_body(callback={"url": "https://app.linguabc.xyz/cb", "token": "short"}), "chatterbox-turbo")
    parse_job(job_body(), "chatterbox-turbo")
    with pytest.raises(BadRequest, match="host is not allowed"):
        parse_job(job_body(callback={"url": "https://attacker.example/cb", "token": TOKEN}), "chatterbox-turbo")
    with pytest.raises(BadRequest, match="host is not allowed"):
        parse_job(job_body(upload={"url": "https://attacker.example/up"}), "chatterbox-turbo")


def test_http_jobs_endpoint(tmp_path, monkeypatch):
    pytest.importorskip("fastapi")
    from fastapi.testclient import TestClient

    from linguabc_tts.http_app import create_app

    monkeypatch.setenv("LINGUABC_TTS_SECRET", SECRET)
    r, engine = runner(tmp_path)
    app = create_app(lambda: (engine, r.asr, r.cache, {}), lambda: r)
    c = TestClient(app)
    body = json.dumps(job_body()).encode()
    ts = int(time.time())
    ok = c.post("/jobs", content=body, headers={"X-LinguABC-Timestamp": str(ts), "X-LinguABC-Signature": sign(body, SECRET, ts)})
    assert ok.status_code == 202 and ok.json() == {"accepted": True, "duplicate": False}
    again = c.post("/jobs", content=body, headers={"X-LinguABC-Timestamp": str(ts), "X-LinguABC-Signature": sign(body, SECRET, ts)})
    assert again.status_code == 202 and again.json()["duplicate"] is True
    assert c.post("/jobs", content=body, headers={"X-LinguABC-Timestamp": str(ts), "X-LinguABC-Signature": "0" * 64}).status_code == 401
    bad = json.dumps(job_body(engine="qwen")).encode()
    assert c.post("/jobs", content=bad, headers={"X-LinguABC-Timestamp": str(ts), "X-LinguABC-Signature": sign(bad, SECRET, ts)}).status_code == 400
    assert c.get("/health").json()["voices"] == engine.voices()


def test_answers_are_checked_but_never_reported(tmp_path):
    # the answer is said: completed, one answer checked, nothing missing
    r, _ = runner(tmp_path)
    r.submit(parse_job(job_body(), "chatterbox-turbo"))
    r.run_pending()
    final = r.http.posts[-1][1]
    assert final["status"] == "completed" and final["qa"]["answers_checked"] == 1 and final["qa"]["answers_missing"] == []
    # an answer that is not in the recording: needs review, reported by id only
    r2, _ = runner(tmp_path / "b")
    r2.submit(parse_job(job_body(checks={"answers": [{"id": "q7", "accepted": ["185 pounds"]},
                                                        {"id": "q8", "accepted": ["Thursday the 14th", "14 Thursday"]}]}), "chatterbox-turbo"))
    r2.run_pending()
    final = r2.http.posts[-1][1]
    assert final["status"] == "needs_review" and final["qa"]["answers_missing"] == ["q8"] and final["qa"]["answers_checked"] == 2
    every_report = json.dumps([p[1] for p in r2.http.posts])
    assert "Thursday" not in every_report and "14th" not in every_report and "185 pounds" not in every_report


def test_bad_answer_checks_are_refused():
    for bad in ([{"id": "q 1", "accepted": ["x"]}], [{"id": "q1", "accepted": []}], [{"id": "q1", "accepted": ["x" * 101]}],
                [{"id": "q1", "accepted": ["a"]}, {"id": "q1", "accepted": ["b"]}], [{"id": "q1", "accepted": ["a"] * 6}],
                [{"id": f"q{i}", "accepted": ["a"]} for i in range(61)], "185"):
        with pytest.raises(BadRequest):
            parse_job(job_body(checks={"answers": bad}), "chatterbox-turbo")


def test_failure_reasons_do_not_carry_script_words():
    from linguabc_tts.jobs import qa_summary
    out = qa_summary({"status": "failed", "problems": ["1 answer(s) not heard: questions q3"],
                      "segments": [{"status": "failed", "reasons": ["not heard: number '23rd of March', name 'Smythe'", "RuntimeError: said Smythe badly"]}]})
    text = json.dumps(out)
    assert "Smythe" not in text and "March" not in text and "RuntimeError" in text and "q3" in text
