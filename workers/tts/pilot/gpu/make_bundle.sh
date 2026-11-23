#!/usr/bin/env bash
# Builds the upload for a Kaggle / Colab GPU run: worker code, the pilot script,
# the synthetic section plan and the three synthetic reference voices.
# No secrets, no user data, no real answer keys.   Run from workers/tts:
#   bash pilot/gpu/make_bundle.sh /path/to/voices out.zip
set -euo pipefail
VOICES=${1:?voices dir with Oliver.wav Emma.wav Chloe.wav}
OUT=${2:-linguabc-gpu-pilot.zip}
TMP=$(mktemp -d)
mkdir -p "$TMP/linguabc-gpu-pilot/pilot/gpu/voices"
cp -r linguabc_tts pyproject.toml "$TMP/linguabc-gpu-pilot/"
cp pilot/gpu/gpu_pilot.py pilot/gpu/section_plan.json "$TMP/linguabc-gpu-pilot/pilot/gpu/"
for v in Oliver Emma Chloe; do cp "$VOICES/$v.wav" "$TMP/linguabc-gpu-pilot/pilot/gpu/voices/"; done
find "$TMP" -name __pycache__ -prune -exec rm -rf {} +
(cd "$TMP" && zip -qr - linguabc-gpu-pilot) > "$OUT"
rm -rf "$TMP"
echo "$OUT"
