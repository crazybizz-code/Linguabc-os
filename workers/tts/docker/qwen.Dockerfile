# LinguABC TTS worker: Qwen3-TTS 1.7B (CustomVoice or Base cloning) on an NVIDIA GPU. NOT built or deployed yet.
#   docker build -f docker/qwen.Dockerfile -t linguabc-tts-qwen .   (from workers/tts)
#   docker run --gpus all -p 8081:8080 \
#     -e LINGUABC_TTS_SECRET=... -e TTS_ENGINE=qwen-clone \
#     -v linguabc-cache:/cache -v /path/to/voices:/voices:ro linguabc-tts-qwen
# Separate image from Chatterbox: qwen-tts 0.1.1 pins transformers 4.57.3 (Chatterbox needs 5.2.0).
# qwen-tts needs the sox binary. FlashAttention 2 is optional (sdpa is used without it).
FROM nvidia/cuda:12.4.1-cudnn-runtime-ubuntu22.04

ENV DEBIAN_FRONTEND=noninteractive PYTHONUNBUFFERED=1 PIP_NO_CACHE_DIR=1 \
    HF_HOME=/cache/hf HF_HUB_DISABLE_TELEMETRY=1 TOKENIZERS_PARALLELISM=false \
    TTS_ENGINE=qwen-clone TTS_VOICES_DIR=/voices TTS_CACHE_DIR=/cache/segments TTS_SPOKEN=1 ASR_MODEL=large-v3

RUN apt-get update \
 && apt-get install -y --no-install-recommends python3 python3-venv python3-pip ffmpeg sox libsox-fmt-all ca-certificates \
 && rm -rf /var/lib/apt/lists/*

RUN python3 -m venv /opt/venv
ENV PATH=/opt/venv/bin:$PATH
RUN pip install "torch==2.6.0" "torchaudio==2.6.0" "qwen-tts==0.1.1" "faster-whisper==1.2.1" \
                "huggingface_hub>=0.26" "fastapi[standard]>=0.115,<1" soundfile

RUN useradd --create-home --uid 10001 tts && mkdir -p /cache /voices && chown tts /cache
WORKDIR /app
COPY linguabc_tts /app/linguabc_tts
USER tts
EXPOSE 8080
CMD ["uvicorn", "linguabc_tts.http_app:app", "--host", "0.0.0.0", "--port", "8080", "--workers", "1"]
