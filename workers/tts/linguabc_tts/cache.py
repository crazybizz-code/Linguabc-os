"""Segment cache of verified audio, one folder per scope.

    <root>/<scope>/<hash[:2]>/<hash>.npy   float32 samples
    <root>/<scope>/<hash[:2]>/<hash>.json  sample rate, transcript, WER

Only segments that passed QA are stored, so a later request reuses them
without speaking or checking again. Writes are atomic (temp file + rename):
a crash never leaves half a segment. The scope (centre id or "platform") is
both in the hash and in the path, so one centre's audio is never served to
another. On Modal the root is a Volume; the pilot runs one container at a
time (max_containers=1), so two requests never speak the same segment.
"""

from __future__ import annotations

import json
import os
import re
import tempfile
import threading
from dataclasses import dataclass
from pathlib import Path

import numpy as np

_HASH = re.compile(r"^[0-9a-f]{64}$")
_SCOPE = re.compile(r"^(platform|[0-9a-f-]{36})$")


@dataclass
class Cached:
    audio: np.ndarray
    sr: int
    meta: dict


class SegmentCache:
    def __init__(self, root: str | os.PathLike):
        self.root = Path(root)
        self._locks: dict[str, threading.Lock] = {}
        self._guard = threading.Lock()

    def _paths(self, scope: str, h: str) -> tuple[Path, Path]:
        if not _HASH.match(h) or not _SCOPE.match(scope):
            raise ValueError("bad scope or hash")
        d = self.root / scope / h[:2]
        return d / f"{h}.npy", d / f"{h}.json"

    def lock(self, h: str) -> threading.Lock:
        with self._guard:
            return self._locks.setdefault(h, threading.Lock())

    def get(self, scope: str, h: str) -> Cached | None:
        audio_p, meta_p = self._paths(scope, h)
        if not (audio_p.exists() and meta_p.exists()):
            return None
        try:
            meta = json.loads(meta_p.read_text("utf-8"))
            return Cached(np.load(audio_p, allow_pickle=False).astype(np.float32), int(meta["sr"]), meta)
        except (OSError, ValueError, KeyError):
            return None

    def put(self, scope: str, h: str, audio: np.ndarray, sr: int, meta: dict) -> None:
        audio_p, meta_p = self._paths(scope, h)
        audio_p.parent.mkdir(parents=True, exist_ok=True)
        for path, write in ((audio_p, lambda f: np.save(f, audio.astype(np.float32), allow_pickle=False)),
                            (meta_p, lambda f: f.write(json.dumps({**meta, "sr": sr}, ensure_ascii=False).encode("utf-8")))):
            fd, tmp = tempfile.mkstemp(dir=path.parent, suffix=".tmp")
            try:
                with os.fdopen(fd, "wb") as f:
                    write(f)
                os.replace(tmp, path)
            except BaseException:
                Path(tmp).unlink(missing_ok=True)
                raise
