# Chatterbox Turbo pilot: real model, local staging, GPU kit (2026-11-23/24)

**GPU results: not available yet.** Every number below is from a CPU (4 vCPU, no GPU). The owner runs the Kaggle notebook and sends the results; until then nothing GPU-related is marked as passed.

Branch `claude/chatterbox-gpu-pilot`. Nothing in production was touched: no
migration, no Vercel variable, no deployment, no paid resource. All content is
synthetic: pilot scripts, and three reference voices designed with Qwen3-TTS
VoiceDesign (Apache-2.0, no real person). No user data and no real answer key
left this machine.

## What could and could not run here

| Item | State |
|---|---|
| Real Chatterbox Turbo model (`ResembleAI/chatterbox-turbo`, chatterbox-tts 0.1.7) | **Ran**, on CPU (4 vCPU, no GPU in this session) |
| Real GPU | **Not run.** Kaggle and Colab need the owner's sign-in; Modal costs credit. Kit ready: `workers/tts/pilot/gpu/` |
| Cloud staging Supabase | **Not created.** The Supabase organisation is on the Free plan with 2 active projects (the limit); branching needs Pro. The isolated local Supabase stack (`docs/STAGING-QA-AUDIO.md`) was used again |
| Real worker in the app flow | **Ran**: the worker's HTTP app with the real model, HTTPS, signed jobs, `TTS_CALLBACK_HOSTS=localhost`, `TTS_UPLOAD_HOSTS=127.0.0.1`, pilot voice registry with consent checks |

## CPU baseline (real model, measured)

`pilot/gpu/gpu_pilot.py`, 4 vCPU, torch 2.6.0, ASR faster-whisper distil-large-v3 (int8, CPU).
Cold model load 15.4 s; warm calls 6.0–7.5 s for ~3 s of speech.

| Case | Status | Audio s | Wall s | RTF | Synth / ASR s | Retries | WER | Answers |
|---|---|---|---|---|---|---|---|---|
| A1 narration (Oliver) | pass | 17.3 | 51.4 | 2.98 | 39.8 / 10.1 | 0 | 1.8% | 2/2 |
| A2 dialogue (Emma, Oliver) | pass | 21.1 | 80.5 | 3.82 | 54.7 / 24.0 | 0 | 2.0% | 3/3 |
| A3 podcast (Chloe) | pass | 20.7 | 70.7 | 3.42 | 49.9 / 18.9 | 0 | 0% | - |
| B section Part 1, first run (3 voices, 62 parts) | **failed** | - | 1101 | (2.76 per audio s) | 790 / 311 | 4 | - | - |
| B section after the spelling fix | pass | 399.5 (6:39) | 60 (cached parts reused) | - | - | 1 | 0.79% | 10/10 |
| C [laughing] / [chuckling] / [sighing] / [happy] / [surprised] | pass (words) | 3.6–5.2 | 16–30 | 3.6–8.4 | - | 0–1 | 0% | - |
| C [gasp] (raw Turbo tag; no Studio tag maps to it) | words OK | - | 13.7 | - | - | - | 0% | - |

Loudness −16.1 to −16.3 LUFS (target −16), true peak −1.5 dB, no clipping, no
repeats, no silences. Speaker consistency in the section: Oliver 0.96, Emma
0.91, Chloe 0.88; similarity to the reference 0.85–0.94. Loudness and MP3
encoding take under 1 s per case: synthesis is ~70% of the time, ASR ~30%.

Why the first section failed: one part of 62, Chloe spelling "P-R-I-T-C-H-A-R-D",
lost the C in all four takes. Measured on the same voice (4 seeds each):
hyphenated 2/4 correct, comma-separated 2/4, one letter per sentence 3/4 with
Chloe but invented words with Emma, groups of three ("P-R-I. T-C-H. A-R-D.")
4/4 with Chloe and 1/4 with Emma. The worker now says spellings of 6+ letters in
threes (`spoken.py`); the section then passed. Long spellings remain the
weakest point (Emma): IELTS needs them, so they stay a review item.

Other findings:
- Turbo speaks fast: 12 of 62 section parts were flagged for speaking rate
  (~200–220 wpm; IELTS Part 1 is ~150). Turbo has no speed control in 0.1.7.
  Listening is needed; a slower voice reference may help.
- **Accent not proven.** The CommonAccent screen scored every clip American
  (0.93–0.999), including the voices designed as British and Australian. The
  accent comes from the reference: licensed, consented British and Australian
  recordings are needed (`workers/tts/VOICES.md`).
- Emotion is not measured automatically: the six expression clips are words-correct and need listening.
- Turbo output carries Resemble's PerthNet watermark (inaudible); note it in the voice policy.
- QA fixes from real takes (each one had failed or flagged a correct recording):
  - "at 9.30 in the morning", "10.15 am": a British time, not a decimal;
  - "built in 1860" = "built in eighteen sixty" (years 1100-1999 after in/since/from/by...);
  - British spelling = what ASR writes ("harbour"/"harbor", "colour", "centre", "theatre", "programme"...),
    on both sides, so British answer keys are not flagged.

## Speaking rate (IELTS ~150 wpm; Turbo ~180-220)

Cause, measured: the three references themselves are fast (Oliver 192 wpm,
Emma 189, Chloe 219; articulation 245-286 wpm), and Turbo copies the
reference's pace. Turbo 0.1.7 has no speed parameter; `cfg_weight` and
`exaggeration` are ignored by Turbo (it logs a warning).

Study (real model, CPU, 3 voices x 3 seeds per variant, 45 takes, two-sentence
IELTS-style lines; `wpm` counts pauses, articulation counts voiced time only;
WER 0 for every take with the corrected QA; similarity to the original
reference with Resemblyzer):

| Variant | wpm (Oliver / Emma / Chloe) | Articulation | Similarity | Verdict |
|---|---|---|---|---|
| 1. Original reference | 177 (190 / 145 / 197) | 217 | 0.933 | baseline |
| 2. Same reference re-timed to ~150 wpm (pitch kept), output not stretched | 164 (197 / 126 / 171) | 196 | 0.928 | partial: slows Emma and Chloe, not Oliver |
| 3. Temperature 0.6 | 174 | 216 | 0.932 | no effect |
| 4. Each sentence alone + 0.45 s planned pause | 172 | 218 | 0.931 | small; speech itself stays fast |
| 5. Finished take stretched to 0.85x (comparison only) | 151 | 184 | 0.932 | reaches the target, but it changes the recording after QA; needs listening for artefacts; not an automatic fix |

Small sample: these are directions, not settled numbers.

Options, in order:

1. **Record the references at IELTS pace (~140-150 wpm, natural pauses).**
   This is the real fix, and it is the same work as the accent blocker
   (licensed, consented British and Australian speakers): ask them to read
   the reference script slowly and clearly. Variant 2 shows the model follows
   the reference's pace, but a re-timed clip is only a proxy; a naturally slow
   reading has to be measured.
2. **Pauses in the plan:** the planner can put a short pause between
   sentences of a long turn (as IELTS recordings do). It lowers overall wpm a
   little without touching the voice; it does not slow the words.
3. **Keep the speed check as a gate:** the worker already flags parts above
   the rate limit for review; with option 1 in place it can fail parts
   instead.
4. **Not automatic:** stretching the finished audio (variant 5) reaches 150
   wpm, but it alters a recording that already passed QA and can add
   artefacts. Only as a manual, listened-to fallback, never a default.

## Production blockers (Chatterbox Turbo)

| Blocker | Evidence | Needed before production |
|---|---|---|
| **British / Australian accent not proven** | Every clip screens American (0.93-0.999), including voices designed as British and Australian; the synthetic references themselves are the cause | Licensed references from real British and Australian speakers with signed cloning consent (`workers/tts/VOICES.md`), then the accent screen plus a blind listening review by the owner |
| **Long spellings** | 9-letter spelling: about half the takes lost a letter; grouped in threes, Chloe 4/4 but Emma 1/4; the first section run failed on it | Re-test with the real references; keep every spelling answer in the answer check (a missing letter sends the recording to review, never to students); consider a spelling-specific retry with more seeds |
| **Speaking rate** | ~180-220 wpm vs ~150 | Slow, natural references (option 1 above), then re-measure |
| GPU speed and cost | Not measured | Kaggle run (owner) |
| Cloud staging | Free plan at its 2-project limit | Owner's decision |

## Local staging end to end with the real worker

Local Supabase (Postgres 17, Auth, Realtime, Storage, pg_cron) at the
production schema (0028), then 0029 and 0030 applied with `psql -1` (cron job
and Realtime publication created). App built with the local URL,
`AUDIO_ENGINES=fish,chatterbox-turbo`, Fish pointed at a local stand-in that
counts calls.

| # | Check | Result |
|---|---|---|
| 1 | Platform admin picks Chatterbox Turbo; voices come from the worker (`/health`) | PASS |
| 2 | Generate creates a job | PASS |
| 3 | The worker accepts the signed request (`POST /jobs` 202) | PASS |
| 4 | Realtime progress in the editor (16% → 83%, "6 qismdan 5 tasi") | PASS |
| 5 | Signed upload writes the MP3 to `library-audio` | PASS |
| 6 | HMAC callback completes the job (forged callbacks: PASS on 2026-11-22) | PASS |
| 7 | Player opens the recording (signed URL, 15.3 s and 22.4 s) | PASS |
| 8 | A wrong answer key is flagged as "Yozuvda eshitilmagan javoblar: 3-savollar" (no answer shown), Approve works | PASS |
| 9 | Tab closed at 83%, reopened: job found, progress continues, finished recording offered, "earlier script" warning | PASS |
| 10 | The same request again: 0 new worker requests | PASS |
| 11 | IELTS answers: 3/3 checked and heard on a correct key; 2/3 on a wrong key → needs review | PASS |
| 12 | No fallback to Fish: 0 Fish calls during all worker jobs | PASS |
| - | Worker refuses jobs without host allowlists (now mandatory) | PASS (tests) |
| - | No answer or script words in the worker log, app log or job rows | PASS |
| - | Real GPU worker in this flow | NOT RUN (no GPU) |
| - | Cloud Supabase + Vercel preview in this flow | NOT RUN (no staging project) |

End-to-end time on CPU: a 15 s recording (4 parts, 3 answers) took 93 s from
"Generate" to completed. A test-harness mistake during this run (a build
without the local Supabase URL baked in, so the browser pointed at the
production URL) was caught: the session's network blocks the production host,
so no request reached it; the build was redone with the local URL.

## Cost

Measured: CPU only. GPU cost is **not measured**. What can be said:

- Fish for the same 6:39 section: 4,783 bytes × $15 / 1M = **$0.072**.
- A GPU at Modal's published T4 rate ($0.000164/s) would cost **at most about
  $0.18** per section even at this CPU's speed (1,101 s); a GPU is much faster,
  so the real figure is lower, plus cold starts (~15 s load here). The GPU run
  below gives the real number.
- Kaggle / Colab free T4: $0 within the free quota (Kaggle ~30 GPU h/week; Colab unpublished, not guaranteed).

## Free GPU options (read 2026-11-23; third-party sources, verify in the product)

| Option | GPU / VRAM | Limits | Needs | Fits this pilot |
|---|---|---|---|---|
| Kaggle Notebooks | T4 ×2, 16 GB each (P100 reported retired) | ~30 GPU h/week (floating), 12 h per session | Kaggle account, phone verification for internet | **Yes**: pip installs, HF downloads, upload the bundle as a dataset. Not for hosting a worker endpoint |
| Google Colab free | T4 16 GB when available | No published quota, ~12 h max, ~90 min idle disconnect | Google account | Yes for the benchmark; GPU not guaranteed |
| Modal Starter | T4 / L4 / A10G… | $30 credit a month (T4 ~$0.59/h, L4 ~$0.80/h) | Account and card; credits are spent | Comparison only; needs owner approval before any run |
| Lightning AI free | varies | one-time / monthly hours (sources disagree) | Account | Possible; not checked further |
| SageMaker Studio Lab | - | closed to new users | - | No |
| HF ZeroGPU | shared | minutes per day; Spaces, not notebooks | - | No |

A notebook cannot host the production-style worker: there is no stable HTTPS
address for callbacks, and tunnels would bypass the network rules. The GPU
run therefore measures the engine and QA; the app flow is proven locally.

## Running the GPU pilot on Kaggle

1. On this branch: `cd workers/tts && bash pilot/gpu/make_bundle.sh <voices dir> linguabc-gpu-pilot.zip`
   (or use the zip sent with this report).
2. kaggle.com → Create → New Notebook → File → Import Notebook → `workers/tts/pilot/gpu/chatterbox_gpu_pilot.ipynb`.
3. Right panel → Session options: Accelerator **GPU T4 x2**; Internet **On** (needs a phone-verified account).
4. Right panel → Add Input → Upload → New Dataset → `linguabc-gpu-pilot.zip` (private), then add it to the notebook.
5. Run all. Installs take ~5 min, the run ~10–20 min. If faster-whisper cannot use the GPU, add `--asr-device cpu` to the benchmark cell.
6. Output tab → download `linguabc-gpu-pilot-results.zip` (MP3s, `summary.md`, `summary.json`, per-case reports) and send it back.
7. Stop the session when done (GPU hours count while it is on).
