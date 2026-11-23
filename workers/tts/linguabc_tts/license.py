"""Refuse to load model weights whose licence is not one we accept.

The Hugging Face model card (README.md in the snapshot) states the weights'
licence in its YAML front matter, e.g. `license: apache-2.0`. The GitHub
repository's Apache 2.0 licence covers the code, not necessarily the
weights, so the worker checks the weights' own card before loading them.
"""

from __future__ import annotations

import re
from pathlib import Path

ALLOWED = {"apache-2.0", "mit"}


class LicenseError(RuntimeError):
    pass


def weights_license(model_dir: str | Path) -> str:
    card = Path(model_dir) / "README.md"
    if not card.is_file():
        raise LicenseError(f"no model card in {model_dir}: licence unverified")
    text = card.read_text("utf-8", "replace")
    front = re.match(r"^---\s*\n(.*?)\n---\s*\n", text, re.S)
    if not front:
        raise LicenseError("model card has no front matter: licence unverified")
    m = re.search(r"^license:\s*['\"]?([A-Za-z0-9.+-]+)['\"]?\s*$", front.group(1), re.M)
    if not m:
        raise LicenseError("model card names no licence: licence unverified")
    return m.group(1).lower()


def check_weights_license(model_dir: str | Path) -> str:
    lic = weights_license(model_dir)
    if lic not in ALLOWED:
        raise LicenseError(f"weights licence '{lic}' is not allowed for commercial use here ({', '.join(sorted(ALLOWED))})")
    return lic
