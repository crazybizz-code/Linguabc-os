# Current state

_Last updated: 2026-11-25. Update this file at the end of every working session._

## 2026-11-25: final V1 pilot scope (supersedes the older plan below)
- The founder set the final V1 scope: a 14-day pilot for one centre, 25 Nov → **9 Dec 2026**. Parents use a **Telegram bot** instead of the web portal (the portal stays in the repo). No Click/Payme/Uzum, no new TTS engines, PR #34 not merged, content targets deferred. Audit, readiness matrix, bot design and day-by-day plan: **`docs/V1-PILOT-PLAN.md`** (Uzbek).
- `main` is at `19e8475` (#33). Production has migrations **0001–0028**; `0029_audio_segments` and `0030_audio_jobs` are merged but **not applied**. Production (read-only, 2026-11-25): 1 centre (`convora-5hqe`), 1 membership, 1 auth user, DB 19 MB, Storage 25.5 MB, extensions include `pg_cron`, not `pg_net`.
- Branch `claude/linguabc-v1-audit-g5yk1c` (PR: Telegram DB foundation): `0031_telegram_parents` (hashed one-time link tokens, one live link per parent, private chats only, two-step webhook update claim, outbox fed by the 0022 notification triggers with leases, claim ids, 429/403 handling and re-checks before sending) and `0032_telegram_views` (one read RPC per bot menu, centre phone/address columns). **Neither is applied.** Rollback scripts in `supabase/rollback/`; deploy plan in `docs/DEPLOY-TELEGRAM-MIGRATIONS.md` (awaiting approval). Local: SQL suite §1–36 pass in both the full and `PROD_SHAPE=1` (no 0029/0030) runs.
- Next: webhook, menus and dispatch (stacked branch), admin linking UI, then expenses (approved 2026-11-26).
- Founder decisions 2026-11-26: bot approved (secrets server-side only; no production webhook before tests pass); 0029/0030 stay unapplied; pg_cron + pg_net dispatch approved in principle (extension, jobs and config need separate approval); expenses approved (owner only, void instead of edit, "net cash-based operating result").


## Code
- `main`: the last feature merge is **`8826a16`**, "IELTS question types, server marking and vocabulary cue cards (#17)". It's followed by docs-only commits: `4f02d1c` (#18, project memory) and this state update (#19).
- Latest merged PRs:
  - #19 docs: current state after QA cleanup
  - #18 docs: project memory (`CLAUDE.md`, `docs/`)
  - #17 IELTS engine and cue cards
  - #16 Settings marked "Soon"
  - #15 Frankfurt region, loading states, owner menu
- **Merged 2026-11-20:** #21, AI drafts always carry their answers (the owner had to type gap-fill answers by hand: Gemini drops optional fields). #20, Fish Audio / AI listening (migration 0017, `src/lib/ai/fish.ts`, `src/lib/audio.ts`, listening editor and playback).
- Old feature branches are still on the remote: `feat/*`, `fix/*`, `docs/*`, `backend/v1-schema`, `frontend/auth`, `chore/env-defaults`. They're all merged.

## Production
- **Vercel:** the production deployment of `8826a16` succeeded on 2026-11-19. URL: `https://linguabc-os.vercel.app`.
- **Supabase** `qycffcuuavtlojkxrkiz` holds **one centre**: `convora-5hqe` ("Convora"), with 1 member and no academic data. There's 1 auth user, Convora's.
- 277 published library items.
- **No QA centres or QA users are left.** `qa-q-centre` and its users `qa.q.owner`, `qa.q.mentor` and `qa.q.student` (`@linguabc.test`) were deleted on 2026-11-19, after the cue-card check.
  - Convora's data fingerprint was the same before and after.
  - The append-only `audit_log` keeps 15 rows for the deleted QA centre, plus 68 from earlier QA centres. They point to centre ids that no longer exist. That's expected and harmless.

**Production check on 2026-11-20 (read-only):** project `ACTIVE_HEALTHY`, Postgres 17. Still one centre (Convora), 1 membership, 1 auth user, no QA centres or users. Library: 277 published, 18 hidden. `audit_log` 84 rows. No storage buckets yet.
- Security advisor: `security definer` RPCs callable by `authenticated` (by design: each re-checks the role), `invite_preview` callable by `anon` (by design, for the join page), and **leaked-password protection is off** (Auth setting in the dashboard).
- Performance advisor: 47 foreign keys without an index, 6 RLS policies that call `auth.uid()` per row, and 10 tables with two permissive SELECT policies. None matter at today's size. Worth one clean-up migration before launch.
- Note: `finish_ai_request` takes token counts and cost from the caller. A mentor calling the RPC directly could under-report their own usage. The hourly and daily request limits still hold, so only the cost report is affected.

## Migrations applied to production
**2026-11-21:** `0026_payment_reminders` (pg_cron job `payment-reminders`, `0 4 * * *` = 09:00 Tashkent, active), `0027_center_report`, `0028_practice`. Checked as roles in a rolled-back transaction: a stranger is refused `center_report`, `remind_payment`, `practice_library_item` ("students only") and cannot run `app.send_payment_reminders`; the Convora owner gets the full report (8 sections, 6 months); the daily job runs and sent 0 (no invoices yet). Nothing left behind.

**2026-11-20 (later), with the owner's go-ahead:** `0023_invite_expiry`, `0024_answer_key_scope`, `0025_library_podcasts`. Checked as roles in one rolled-back transaction: a stranger is not a platform admin, sees no answer keys or drafts, and is refused `save_library_podcast` and `reissue_invite`; the Convora owner (platform admin) can save a draft podcast and sees it; nothing was left behind (295 library items, 277 published, as before). The `library-podcasts` bucket is public.

`0017_listening_audio` applied on 2026-11-20. The `listening-audio` bucket and its 3 storage policies exist.

**Listening SQL check on production (2026-11-20):** one transaction with throwaway QA users and a `qa-listening` centre, rolled back at the end, so nothing was left behind (verified by counts afterwards). All checks passed: the mentor can upload and outsiders and students can't; a student hears the audio only once it's set as homework, can't read the transcript or key before submitting, and gets the transcript and a 100% score after; an outsider can't hear it. Direct `DELETE` on `storage.objects` is blocked by Supabase (`storage.protect_delete`), so the delete policy is tested only in the local suite and through the Storage API.

`0001`–`0015`, and `0016` applied as three parts: `0016_ielts_questions_part1`, `_part2` and `_part3`. The repo has a single `0016_ielts_questions.sql`, and the parts were applied from it.

## Tests known to pass
**`8826a16`, checked on 2026-11-19:**
- `npx next typegen && npx tsc --noEmit`: clean
- `npx eslint src`: clean
- `npm run build`: clean
- The Vercel preview and production builds succeeded.

**SQL suite**
- `supabase/tests/run.sh` has 17 sections, the last being "17. IELTS question types". All passed on the machine where #17 was written.
- They weren't re-run on 2026-11-19: the current Windows machine has no local Postgres.

**Cue cards on live: passed (2026-11-19).**
- In a QA centre, acting as the mentor and then the student under RLS, a library article was assigned and submitted. The student could read its 8 vocabulary words, and `my_homework_result` returned the result.
- The owner then checked the deck visually in the browser.

## Not yet verified
Checked 2026-11-20. None of these can be seen from the agent's environment: the Supabase token can't read auth settings, and Vercel and `app.linguabc.xyz` are blocked by its network. The owner has to check them in the dashboards.
- ~~AI keys in Vercel~~: **confirmed 2026-11-20.** OpenRouter is set: `ai_requests` shows a live `google/gemini-3.7-flash` call from the owner. Fish Audio is set too (a live `fish/s1` call). **Fish retires `s1` on 31 Dec 2026** (owner's screenshot of the Fish dashboard, 2026-11-20: later `s1` requests are served by S2.1 Pro at the same price); the code now defaults to `s2.1-pro`. If `FISH_AUDIO_MODEL=s1` is set in Vercel, remove it or change it to `s2.1-pro`. Fish API spend so far: $0.57 over 30 days.
- ~~Phone sign-in key~~: **confirmed 2026-11-20** from the owner's screenshot of Vercel: `SUPABASE_SECRET_KEY` and `SUPABASE_SERVICE_ROLE_KEY` are set for Production (marked sensitive). Values not seen. `/join` now asks for a phone (required) and an email (optional, owner's choice 2026-11-20); phone-only accounts are created confirmed on the server under `p<digits>@phone.linguabc.xyz` (never mailed) and sign in by phone. They can't reset a password by email yet: the centre has to help.
- **Domain:** whether `app.linguabc.xyz` is attached to the Vercel project as the production domain. The auth email config says it's the Site URL.
- **Custom SMTP** in the Supabase dashboard.

## Blockers and open items
**Pre-launch security blockers:** both fixed (0023, 0024), merged in PR #31 and applied to production on 2026-11-20. Original notes:
- Unused invite codes never expire.
- Every mentor in a centre can read and write answer keys, not only the mentor of the group.

**Launch gate (owner, 2026-11-20):** V1 goes to no centre until all Base44 prototype sections exist, the library has at least 5 full reading and 5 full listening mocks plus enough homework content, and all 3 ways of creating homework work. See `V1-ROADMAP.md` → Launch gate.

**Owner, 2026-11-20 (later):** no online payment in V1, only payment reminders for parents. Podcasts: as many as articles, the new ones made with Fish Audio from A1 to C2. Listening mock parts must open with the exam's spoken instructions. Roles to be set up in order, with a review of how each role signs in.

**Fish Audio credits (owner, 2026-11-20):** parked. Balance $0.43; no top-up for now. Library audio (podcasts, the 4 missing listening mocks) waits for a decision: Fish (~$25-30 in total) or a free model (Kokoro was tried: free but flat and blurry; Chatterbox on a free Colab GPU not tried yet).

**PR #32 (merged 2026-11-21, owner's go-ahead):** 0026 payment reminders (pg_cron), 0027 centre report, 0028 practice; per-role menus and every Base44 section (see `V1-ROADMAP.md`); two-step sign-in. SQL suite: 28 sections pass locally. tsc, eslint and build clean. No page was clicked through in a browser: the agent can't sign in to production.

**Open decisions:** target counts for library podcasts, articles, sections and passages at launch.

**Settled on 2026-11-20:** listening audio lives in a private Supabase Storage bucket and plays through signed URLs (`ARCHITECTURE.md` → Storage). The owner set `FISH_AUDIO_API_KEY` in Vercel and chose six voices (now the defaults in `src/lib/ai/fish.ts`).

**Settled on 2026-11-19:**
- Click is the first payment provider.
- V1 notifications are in-app.
- The V1 build order is in `V1-ROADMAP.md`.

**Environment:** there's no staging, so all QA happens on production.

**Documentation debt:** `README.md` is out of date. It lists migrations only up to 0008 and an `app/(workspace)/` folder that is now `app/(portal)/`. It hasn't been edited yet.

**Listening UI check passed (2026-11-20):** the owner created a B2 gap-fill listening (6 questions) with AI in Convora, and Fish Audio recorded the conversation. This was the first live Fish call.

**Mock engine part A merged and live (2026-11-20):** #22. 0018 applied; the Convora owner's auth user is the only row in `platform_admins` (checked: `am_platform_admin()` returns true as that user). Library drafts on 2026-11-20:
- **Listening Test 1:** Part 1 was written with AI and recorded by the owner. Parts 2–4 were written by Claude, are not recorded yet, and the owner records them in the editor.
- **Reading Test 1:** written by Claude, 40 questions; all-correct answers score 40/40 in the database.

Both are drafts waiting for the owner's review before publishing.

**Known marking bug:** `app.norm_answer` strips the dot from decimals, so "1.5" becomes "1 5" (two words). A gap answer with a decimal can then break its word limit. Fix it in part B.

 Live checks: section drafting works (one early failed attempt, cause unknown), and after #23 the owner confirmed voices stay steady across lines.

## AI Audio Engine V2 (branch `claude/affectionate-gates-o40z82`, 2026-11-21, not merged)
- **Segment cache for Fish (Phase 1):** migration `0029_audio_segments` (**not applied**), `src/lib/ai/segment-cache.ts` (hash, claim, checkpoint, retry), `segment-store.ts` (Supabase), `fish.ts` uses it. Re-recording speaks only changed turns; failures keep finished turns; parallel requests don't pay twice.
- **Provider switch:** `src/lib/ai/voice.ts`, `AUDIO_PROVIDER` = fish (default) | qwen | kokoro (stub). All three record actions and four pages go through it.
- **Qwen3-TTS worker (Phase 2-4):** `workers/tts` (Python). Tested only with a fake engine and fake ASR: no GPU here and huggingface.co is blocked, so **no real Qwen inference has run**. Modal config written, **not deployed**.
- Production usage before the change (read-only, 2026-11-21): 9 Fish recordings, 26,870 bytes (~$0.40), 7 files kept (2 were re-takes). Fish dashboard said $0.57.
- Tests: SQL suite 29 sections pass (new: 29. audio segment cache); `npm run test:ts` 17 pass; `workers/tts` pytest 40 pass; tsc, eslint, build clean.
- **Before production:** owner approves applying 0029; the cache works without it (speaks as before) but saves nothing.
- **Real Qwen runs (2026-11-22, free 4-vCPU container, no GPU):** CustomVoice pilot (3 recordings), VoiceDesign vs Base-clone lab (4 designed voices), and a full Part 1 section with cloned voices (400 s, 62 segments, WER 0.67%, all 10 answers heard, ~87 min of compute). Every Qwen voice, designed as British or Australian or not, was scored American by the CommonAccent check; the owner's blind listening decides. Audio is in `workers/tts/pilot/out/` (not committed); blind review kit in `workers/tts/pilot/out/blind-review/` (Fish samples to be added by the owner).
- The environment's network allowlist now includes Hugging Face hosts and `download.pytorch.org` (added with the owner's approval, 2026-11-22).
- **Engine bench (2026-11-22, CPU):** Chatterbox (MIT, retired upstream), Zonos v0.1 transformer (Apache-2.0) and Qwen3-TTS run on the same cases (`workers/tts/pilot/bench/`). With numbers/money/codes rewritten to words before synthesis (`linguabc_tts/spoken.py`; both Qwen cloning and Chatterbox fail on raw digits), Chatterbox passed every IELTS case and rendered the full Part 1 section first time (413 s, WER 0.45%, 10/10 answers, 69 calls for 62 segments, ~43 min on 4 vCPU vs ~87 min for Qwen). Zonos mispronounced IELTS details ("Malksh" for March) and is ~3x slower. Results and the blind review kit: `workers/tts/pilot/out/bench/` (not committed).
- **Chatterbox Turbo and integration prep (2026-11-22):** Turbo passed every IELTS case and the podcast at ~2x the 0.5B speed (RTF 2.5 on CPU); its tokenizer has 19 official tags: 8 non-verbal ones work (laugh, chuckle, cough, sigh, gasp, sniff, shush, clear throat), whispering/dramatic/narration/advertisement/sarcastic garble the words and are never sent. "LinguABC" is respelled per engine in the worker only (`linguabc_tts/lexicon.py`; Fish untouched). Audit of the 0.5B section: no loops, no speaker drift. Ready but not built or deployed: voice registry with consent checks (`VOICES.md`), Chatterbox and Qwen GPU images (`workers/tts/docker/`), Modal configs. Plan: `workers/tts/INTEGRATION-PLAN.md`.
- **Audio jobs (2026-11-22, not merged):** migration `0030_audio_jobs` (**not applied**), Audio Studio engine choice for platform admins (Fish / Chatterbox Turbo / Chatterbox 0.5B / Qwen; `AUDIO_ENGINES`, default Fish only), async jobs with signed dispatch, signed upload URLs, signed webhook, Realtime progress, QA review and retry. Centres' homework, players and the Fish path are unchanged. Jobs are recovered when the editor is reopened (draft slot per job, attached at most once, no re-recording), and test recordings carry the section's answer key to the worker's ASR check (ids only come back; a recording with an unheard or unchecked answer cannot complete without review). Deployment and rollback: `docs/AUDIO-ENGINES.md`; before production: `docs/STAGING-CHECKLIST-AUDIO.md`; local isolated QA results: `docs/STAGING-QA-AUDIO.md`. No worker is deployed.

## Exact next task
1. **V1 step 4, in-app notifications:** built on the branch (0022 triggers; a bell in the student and parent portals; translated text). With the owner's go-ahead: apply 0022, then merge.
2. Then V1 step 5: Click payments (with a provider interface so Payme and Uzum can follow). This needs Click merchant credentials and a sandbox.
