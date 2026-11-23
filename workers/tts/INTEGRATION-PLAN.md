# Chatterbox as the main open-source voice: integration plan

Status: plan only. Fish Audio stays the production default and is not removed.
Nothing here is applied, deployed or merged without the owner's approval.

## Why Chatterbox (0.5B)

Measured on a free 4-vCPU container, same script, voices and QA for every engine
(`pilot/bench/`):

- Full IELTS Part 1 section first time: 413 s, WER 0.45%, 10/10 answers,
  69 engine calls for 62 segments (~43 min CPU). Qwen3 cloning: 119 calls, ~87 min.
- Audit of that section (`pilot/audit_section.py`): no loops, no speaker drift
  (min similarity to the voice's centroid 0.87-0.93; first vs last third 0.96-0.99).
- Expression via `exaggeration` keeps the voice (timbre similarity 0.95-0.97).
- MIT code and weights.

Known limits: upstream retired (August 2026), pinned old dependencies, Perth
watermark on every file, digits and symbols must be rewritten to words
(`spoken.py`), British and Australian accents not yet proven (need licensed
references), some voices speak fast (220-257 wpm on short lines).

## Architecture

```
Next.js (Vercel)                          GPU worker (container, one per engine)
  AUDIO_PROVIDER / per-purpose flag  ──▶  POST /render  (HMAC, same contract as Qwen)
  src/lib/ai/worker.ts (planScript)        linguabc_tts.http_app  TTS_ENGINE=chatterbox
  uploads the MP3 to the same buckets      voices registry (consent) · lexicon · spoken
  Fish path unchanged (fish.ts)            ASR QA · retries · segment cache · MP3
```

- Images: `docker/chatterbox.Dockerfile`, `docker/qwen.Dockerfile` (separate: their
  pins clash). Modal: `modal_chatterbox.py`, `modal_app.py`.
- Voices: `linguabc_tts/voices.py` registry. A voice loads only with a signed
  consent record (scopes `voice-cloning` + `commercial-use`), a licence, an owner
  approval, an unchanged audio hash, and no expiry or revocation.
- Pronunciation: `linguabc_tts/lexicon.py`, keyed by engine. The Fish path
  (`src/lib/ai/script.ts` SAY) is separate and untouched.

## Steps

| # | Step | Who | Production impact | Approval |
|---|---|---|---|---|
| 0 | Licensed references: 2 British (F/M), 1 Australian, 1 American, 10-15 s each, quiet room, signed consent for cloning and commercial use. Confirm how "LinguABC" is said. | Owner | none | — |
| 1 | Register them (`prepare_reference`), run `pilot/bench` and the accent suite with them, blind review against Fish | Claude + owner | none | — |
| 2 | App: generalise `src/lib/ai/qwen.ts` into a worker client used by `qwen` and `chatterbox` providers; voices from the worker's `/health`; `AUDIO_PROVIDER=chatterbox`; per-purpose override so only the LinguABC library (platform admins) uses Chatterbox at first | Claude | none until the flag is set | PR review |
| 3 | Long sections: a recording job table (`audio_jobs`) so a 7-minute section does not hit Vercel's 300 s limit; worker reports progress | Claude | new migration | **migration approval** |
| 4 | Deploy the Chatterbox worker (one GPU, scale to zero) | owner's account | paid GPU | **GPU approval** |
| 5 | Pilot: library podcasts and the missing listening mocks with Chatterbox, each reviewed by ear before publishing | owner | library content only | — |
| 6 | Centre homework: keep Fish by default; offer Chatterbox per centre after the pilot | owner | per flag | owner decision |

Rollback at any step: set the flag back to `fish`. Recordings already made stay
valid (they are ordinary MP3s in the existing buckets).

## Rules that keep Fish safe

- `AUDIO_PROVIDER` unset or unknown means Fish (`src/lib/ai/voice.ts`).
- A failed worker recording never switches to Fish in the middle of a script
  (voices would change mid-dialogue); the editor shows the error and offers
  "Record with Fish".
- Worker recordings bill 0 Fish bytes; `ai_requests.model` records `chatterbox/...`.

## Risks and mitigations

| Risk | Mitigation |
|---|---|
| Chatterbox no longer maintained | Pin 0.1.7 in our image; keep a fork; Qwen worker ready as the second engine |
| Old pins (torch 2.6.0, transformers 5.2.0, setuptools<81) | Separate image; no other code in it; rebuild on security advisories |
| Turbo upstream bug (float64 reference) | Engine passes `norm_loudness=False`; references are normalised at registration |
| Accent not proven | Step 1 with licensed references before any rollout |
| Consent withdrawn | `revoke` makes the registry refuse the voice; recordings made before stay (decide with legal) |
| Digits/symbols misread | `spoken.py` rewrite + QA spans for numbers, dates, money, phone, postcodes |
| Fast speech for IELTS | QA flags > 220 wpm for review; reference choice and pacing tests in step 1 |
