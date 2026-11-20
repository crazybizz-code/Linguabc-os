# Architecture

This describes the system as built on `main` (Nov 2026). Plans live in `V1-ROADMAP.md`.

## Overview
```
Browser ── Next.js 16 on Vercel (fra1) ── Supabase (eu-central-1)
             server components / actions     Postgres + RLS + RPCs
             src/proxy.ts (session refresh)  Auth (email+password)
             src/lib/ai → OpenRouter | Gemini API
```
Pages are server components that read through the Supabase client using the **signed-in user's session**, so RLS applies to every read. Writes go through server actions, which call Postgres RPCs.

## Code layout (`src/`)
| Path | Holds |
|---|---|
| `proxy.ts` | Refreshes the session cookie and sends signed-out visitors to `/login`. It doesn't authorise anything. |
| `app/(auth)/` | Login, register, join, forgot and reset password, plus their server actions |
| `app/auth/callback`, `app/auth/confirm` | Landing routes for links in auth emails (`confirm` verifies a `token_hash`) |
| `app/page.tsx` | Sends each person to their workspace by role |
| `app/(staff)/` | dashboard, branches, groups, students (+ Student 360), attendance, payments (+ receipts), homework (library, new: upload/AI, assignments, review), mocks, staff |
| `app/(portal)/student`, `app/(portal)/parent` | Family portals |
| `lib/supabase/` | `server.ts` and `client.ts` (user session), `admin.ts` (service role), `config.ts` (public defaults), `database.types.ts` (generated) |
| `lib/auth/` | Memberships, home route per role, finishing sign-up |
| `lib/ai/` | Provider client (`gemini.ts`), drafting prompts and schemas |
| `lib/questions.ts` | Question types and display helpers only; marking happens in the database |
| `i18n/` | gettext-style dictionaries: the English sentence is the key, and missing strings fall back to English |

## Auth
- Supabase Auth with email and password.
- **Phone sign-in:** the server finds the account email for a phone number using the service-role client (`SUPABASE_SECRET_KEY`). An unknown phone and a wrong password give the same error.
- **Owner sign-up:** `/register` → confirm email → the centre is created on first sign-in (`create_center`).
- **Everyone else** is invited (`invite_member`) → opens `/join?code=…` → confirms email → the code is redeemed on first sign-in (`accept_invite`).
- Branded email templates live in `supabase/email-templates/` and link to `{{ .SiteURL }}/auth/confirm`. The Site URL is configured as `https://app.linguabc.xyz`.

## Multi-tenant model
- `centers` is the tenant. Every business table has `center_id`.
- Child tables reference parents through composite `(id, center_id)` foreign keys, so the database refuses a row that points into another centre.
- A person belongs to a centre through `memberships` (role, status `invited`/`active`/`suspended`). One user can hold memberships in several centres.
- **Shared across centres:** `library_items` (published content, readable by any signed-in user) and `library_answer_keys` (readable by staff and mentors of any centre). Each centre gets its own copy as an `assignments` row plus `assignment_keys` when the content is assigned.

## Database
Migrations live in `supabase/migrations/` (0001–0017):

| # | Adds |
|---|---|
| 0001 | Core schema: 23 tables, enums. Money as `bigint` UZS. |
| 0002 | RLS for all six roles, plus `app.*` helpers (`security definer`) |
| 0003 | RPCs: centre, invites, enrolment, invoicing, payments and refunds, lessons, attendance, homework flow. Immutable ledger, audit triggers. |
| 0004 | `security_invoker` views: `invoice_balances`, `student_overview` (Student 360), `group_overview`, `mock_result_scores` |
| 0005–0006 | Unique normalised phone on profiles; `invite_preview` |
| 0007–0008 | `create_student` and `create_group` in one transaction each; first invoice never due before the start date |
| 0009 | `profiles.locale` |
| 0010 | `group_mentor_name()`, so families see the mentor's name |
| 0011 | `create_mock_session`, `save_mock_results` |
| 0012 | `library_items`, `library_answer_keys`, `assignment_keys`, `assign_library_item` |
| 0013 | Auto-marking on submit; `my_homework_result` |
| 0014 | `create_custom_assignment`, `ai_requests`, AI limits |
| 0015 | AI usage accounting: model, tokens, cost |
| 0016 | IELTS question types and per-question marks (`grade_one`, `mark_map`, `grade_answers`, `submission_marks`, `check_questions`) |
| 0017 | Listening audio: private `listening-audio` bucket and its storage policies, `assignment_keys.transcript`, `create_custom_assignment(p_audio_path)`, transcript in `my_homework_result`, AI request kind `audio` |

Other rules the database enforces:
- Exclusion constraints (`btree_gist`) stop a room or mentor from being double-booked.
- The `audit_log` records who changed memberships, students, guardians, enrolments, invoices, payments, attendance and mock results.
- Private helpers live in schema `app`, which isn't exposed through the API.

## Storage
- **Listening audio (decided 2026-11-20): a private Supabase Storage bucket, `listening-audio` (0017).**
  - Path: `{center_id}/{uuid}.mp3`, MP3 only, 20 MB per file.
  - Staff and mentors of the centre may upload and listen (`app.can_make_audio`). Students and parents may listen only to audio on an assignment set as homework for a group they can see (`app.can_hear_audio`).
  - Only the uploader may delete a file, and only while no assignment uses it (used when a mentor records again).
  - Pages play it through signed URLs valid for 2 hours (`src/lib/audio.ts`). The browser never gets a permanent link.
  - With generated audio, the passage is the transcript. It is kept in `assignment_keys.transcript`, not in the assignment content, so a student gets it from `my_homework_result` only after submitting.
- Uploaded worksheets (PDF, DOCX, TXT, PNG/JPG/WEBP, up to 4 MB, PDFs up to 12 pages) are read in the server action and sent inline to the AI provider. They aren't kept.
- Library audio (`library_items.audio_url`) and assignment `audio_url` are external URLs.
- Cue-card progress is kept only in the browser's `localStorage`.

## Roles and permissions
- RLS helpers in `app` (0002):
  - `has_role`, `is_member`
  - `is_staff`: owner, admin, academic manager
  - `is_admin`: owner and admin; the only roles that see money
  - `is_mentor_of_group`, `is_mentor_of_student`
  - `my_student_ids`: the student themselves, or a parent's children
  - `can_see_student`, `can_see_finance`, `can_see_group`
- Sensitive writes (payments, submissions, attendance, enrolment, invites) happen only through RPCs, which check the role again. Tables without a write policy can't be written directly.
- The UI hides menu items by role (`components/workspace/sidebar.tsx`), but that's cosmetic.

## Academic engines
- **Homework:** an assignment (source `library`, `upload` or `ai`; status `draft` → `pending_approval` → `approved`) is assigned to a group as `homework`. Each student has one `submission`.
  - Assignments from a manager are approved immediately; a mentor's wait for a manager.
- **Questions and marking (0016):** types `mc`, `multi`, `tfng`, `ynng`, `gap`, `matching`, `headings`, `open`.
  - Questions can share a group with instructions and an option pool.
  - Postgres marks against the key on submit. Going over the word limit, or choosing more options than asked, scores zero.
  - `open` answers are scored by the mentor.
  - Students get the key only through `my_homework_result`, after they submit.
- **AI drafting:** `src/lib/ai/`. Text from uploaded files is extracted, and instructions inside the file are ignored.
  - Limits, enforced in the database: 20 requests per user per hour and 200 per centre per day.
  - Every request is recorded in `ai_requests` (model, tokens, cost).
- **Mocks:** `mock_sessions` for a group, snapshotting its active students; `mock_results` with bands per module (0–9 in halves). The overall band comes from a view. Results are entered by hand; there's no online test-taking yet.
- **Vocabulary cue cards:** `library_items.vocabulary` is shown as a flip deck on the student homework page, after submission, for library-based homework.

## Integrations
| Integration | Status | Config |
|---|---|---|
| OpenRouter | In code; used when its key is set | `OPENROUTER_API_KEY`, `OPENROUTER_MODEL` (default `google/gemini-3.7-flash`), `OPENROUTER_BASE_URL` |
| Gemini API | In code; the alternative provider | `GEMINI_API_KEY`, `GEMINI_MODEL` (default `gemini-3.7-flash`), `GEMINI_BASE_URL` |
| Supabase service role | Server only: phone sign-in, register phone check | `SUPABASE_SECRET_KEY` or `SUPABASE_SERVICE_ROLE_KEY` |
| SMTP for auth email | Configured in the Supabase dashboard (sender domain `linguabc.xyz`) | Outside the repo |
| The Conversation | Republished articles carry their page-view pixel, as their guidelines require | Inside the content |
| Click (online payments) | Not integrated yet. **Click is the V1 provider** (decided 2026-11-19). Payme and Uzum come later, and the payment model must allow adding them without a rewrite. The UI and server still refuse Click and Payme as "V2" (PR #7). The `payment_method` enum already includes `click`, `payme` and `uzum`, and the `(method, provider_txn_id)` unique index is ready for idempotent callbacks. | — |
| Fish Audio | Text-to-speech for listening scripts (`src/lib/ai/fish.ts`). Scripts written as `Name: words` become a dialogue: the mentor picks a voice per speaker from six voices the owner chose (defaults in the code; one has an Indian accent), each turn is one request and the MP3s are joined. Voice titles come from Fish (`GET /model/{id}`, cached a day). Counted as AI requests (kind `audio`, UTF-8 bytes in `prompt_tokens`). | `FISH_AUDIO_API_KEY`, `FISH_AUDIO_VOICES` (comma-separated ids, optional), `FISH_AUDIO_MODEL` (default `s1`), `FISH_AUDIO_BASE_URL` |
| Notifications | Not built. The `notifications` table and channel enum exist (0001), but no code uses them. V1 uses the `in_app` channel only; `sms`, `telegram` and `push` delivery come later. | — |

## Deployment
- **Vercel project** `linguabc-os` (team `crazybizz-codes-projects`), region `fra1`.
  - Every push gets a preview deployment; `main` deploys to production.
  - URLs: `linguabc-os.vercel.app`; auth emails use `app.linguabc.xyz`.
- **Supabase:** one project, `qycffcuuavtlojkxrkiz`, "LinguABC OS", eu-central-1. It's the production database, and there's no staging project.
  - Migrations are applied by hand (`supabase db push`, the SQL editor, or the MCP `apply_migration`).
- The public Supabase URL and publishable key are defaults in `src/lib/supabase/config.ts`, so builds work without env setup.
- Server actions accept request bodies up to 5 MB (`next.config.ts`), because Vercel caps them at 4.5 MB.
