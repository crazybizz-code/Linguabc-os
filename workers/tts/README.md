# LinguABC TTS worker (AI Audio Engine V2, pilot)

A Python worker that speaks LinguABC listening scripts with
**Qwen3-TTS-12Hz-1.7B-CustomVoice** ([QwenLM/Qwen3-TTS](https://github.com/QwenLM/Qwen3-TTS)),
checks every segment with ASR, and returns one MP3 with a QA report. It runs
on its own (Modal serverless GPU); the Next.js app only calls it when
`AUDIO_PROVIDER=qwen`. Production stays on Fish Audio.

**Status:** the pipeline is tested end to end with a fake engine and fake ASR.
It has **not** run real Qwen inference yet: this build environment has no GPU
and cannot reach huggingface.co for the weights. It is **not deployed**.

## How a request flows

1. The app plans the script (`src/lib/ai/script.ts` → `planScript`): turns,
   voices, `[pause N]` silences and the gaps between turns. Same rules as
   the Fish path.
2. It POSTs the plan to `/render`, signed with HMAC-SHA256
   (`X-LinguABC-Timestamp`, `X-LinguABC-Signature`, 5-minute window).
3. The worker (`linguabc_tts/pipeline.py`), for each turn:
   - cuts it at expression tags; each piece gets that tag's `instruct`
     (`expressions.py`);
   - hashes provider, model, voice, expression, text, every setting and the
     scope (`hashing.py`, identical to `src/lib/ai/segment-cache.ts`);
   - reuses a verified clip from the cache, or speaks it with a seed derived
     from the hash, transcribes it (faster-whisper large-v3) and accepts it
     only if WER ≤ 10% and every number, date, price, time and spelling is
     heard. Otherwise it tries the next seed (3 attempts). Accepted clips are
     cached at once.
4. It joins the clips with the planned pauses, applies one loudness gain
   (EBU R128, −16 LUFS, true peak −1.5 dB), checks the whole recording
   (WER ≤ 3%, answer words from `checks.answers`, clipping, speaker
   consistency when an embedder is set) and encodes 128 kbps mono MP3.
5. Replies `200` with the MP3 and the report (`status` `pass` or
   `needs_review`), or `422` with the report when a segment failed. A retry
   of the same request speaks only the failed segments.

`manual_review_required` is always true: automatic checks do not prove the
audio sounds professional, is in the intended accent or carries the
expression. Use the accent suite below and listen.

## Expression tags

All 31 app tags are mapped to instructions (`expressions.py`). Qwen
documents instruction control of "timbre, emotion, and prosody", not a list
of expressions, so none is guaranteed:

- `tone` tags (excited, curious, serious, calm…): plausible, check by ear;
- `experimental` tags (laughing, chuckling, sighing, whispering, shouting,
  sarcastic): not documented by Qwen; still sent, and listed in the report;
- unknown tags are dropped and listed as `unsupported_expressions`;
- voices that cannot take instructions (Base / 0.6B models: `qwen_tts`
  drops `instruct` for 0.6B) get no expression; listed as
  `expressions_dropped_no_instruct`.

## Voices

CustomVoice ships 9 speakers. Only **Ryan** and **Aiden** (American) are
native English, and both are male. Serena and Vivian are female but native
Chinese. There is no British or Australian preset. See the accent suite.

## Run locally

```bash
cd workers/tts
pip install -e ".[test]"
python -m pytest -q
python -m linguabc_tts.cli render request.json --out out.mp3 --report report.json --engine fake
python -m linguabc_tts.cli accent-suite --voices Ryan,Aiden --out-dir accent-test --engine fake
```

With real inference (GPU recommended; downloads ~4 GB of weights and the ASR model):

```bash
pip install -e ".[qwen,asr]"
python -m linguabc_tts.cli accent-suite --voices Ryan,Aiden,Serena --out-dir accent-test --engine qwen
```

The accent suite (`linguabc_tts/accent_suite.json`) covers rhoticity,
t-flapping, BATH/TRAP, LOT, GOAT, Australian vowels, spelling, phone numbers,
postcodes, dates, money, times, expressions and a long turn. It writes blind
file names, `review-sheet.md` for listeners, `auto-qa.json`, and `key.json`
(open after scoring).

## Licence check

Before loading, the worker reads the weights' own model card
(`README.md` front matter in the snapshot) and refuses anything but
`apache-2.0` or `mit` (`license.py`). The GitHub repo's Apache 2.0 covers
the code; the weights' card is checked separately.

## Deploy (needs the owner's go-ahead: paid GPU)

```bash
pip install -e ".[modal]"
modal secret create linguabc-tts LINGUABC_TTS_SECRET=<random 32+ characters>
modal deploy modal_app.py
```

Then in Vercel, for the pilot only: `QWEN_TTS_URL` (the printed `/render`
URL), `QWEN_TTS_SECRET` (same secret), `AUDIO_PROVIDER=qwen`.

`modal_app.py`: one L4 GPU, scale to zero (2-minute idle), one container and
one request at a time, a Volume for the weights and the segment cache.

## Data and privacy

Scripts, transcripts and answers are never logged. The segment cache keeps
verified clips with their text on the private Modal Volume, one folder per
scope (centre id or `platform`); no scope reads another's clips.
