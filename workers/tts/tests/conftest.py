import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))


import pytest


@pytest.fixture(autouse=True)
def _job_hosts(monkeypatch):
    """The worker refuses jobs without host allowlists; tests use these hosts."""
    monkeypatch.setenv("TTS_CALLBACK_HOSTS", "app.linguabc.xyz")
    monkeypatch.setenv("TTS_UPLOAD_HOSTS", "project.supabase.co")
