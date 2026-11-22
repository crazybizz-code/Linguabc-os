# LinguABC TTS worker: Chatterbox (0.5B or Turbo) on an NVIDIA GPU. NOT built or deployed yet.
#   docker build -f docker/chatterbox.Dockerfile -t linguabc-tts-chatterbox .   (from workers/tts)
#   docker run --gpus all -p 8080:8080 \
#     -e LINGUABC_TTS_SECRET=... -e TTS_ENGINE=chatterbox \
#     -v linguabc-cache:/cache -v /path/to/voices:/voices:ro linguabc-tts-chatterbox
# Pins: chatterbox-tts 0.1.7 pins torch 2.6.0 (CUDA 12.4 wheels) and transformers 5.2.0;
# its watermarker needs setuptools<81 (pkg_resources). faster-whisper needs cuDNN 9.
FROM nvidia/cuda:12.4.1-cudnn-runtime-ubuntu22.04

ENV DEBIAN_FRONTEND=noninteractive PYTHONUNBUFFERED=1 PIP_NO_CACHE_DIR=1 \
    HF_HOME=/cache/hf HF_HUB_DISABLE_TELEMETRY=1 \
    TTS_ENGINE=chatterbox TTS_VOICES_DIR=/voices TTS_CACHE_DIR=/cache/segments TTS_SPOKEN=1 ASR_MODEL=large-v3

RUN apt-get update \
 && apt-get install -y --no-install-recommends python3 python3-venv python3-pip ffmpeg ca-certificates \
 && rm -rf /var/lib/apt/lists/*

RUN python3 -m venv /opt/venv
ENV PATH=/opt/venv/bin:$PATH
RUN pip install "setuptools<81" "chatterbox-tts==0.1.7" "faster-whisper==1.2.1" "fastapi[standard]>=0.115,<1" soundfile

RUN useradd --create-home --uid 10001 tts && mkdir -p /cache /voices && chown tts /cache
WORKDIR /app
COPY linguabc_tts /app/linguabc_tts
USER tts
EXPOSE 8080
CMD ["uvicorn", "linguabc_tts.http_app:app", "--host", "0.0.0.0", "--port", "8080", "--workers", "1"]
