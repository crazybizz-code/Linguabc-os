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
Migrations live in `supabase/migrations/` (0001–0022):

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
| 0018 | LinguABC library tests: `platform_admins`, `library_tests`, `library_test_keys` (admins only), private `library-audio` bucket, admin RPCs (`new_library_test`, `save_library_test`, `set_library_test_status`, `delete_library_test`, `claim_admin_ai_request`) |
| 0019 | Online mocks: `mock_sessions.reading_test_id`/`listening_test_id`, `mock_attempts`, `mock_results.released_at` and raw scores, Academic band tables (`app.academic_band`), release before families see results, student RPCs (`my_online_mocks`, `start_mock_module`, `save_mock_answers`, `submit_mock_module`, `report_mock_focus`), staff RPCs (`set_mock_tests`, `close_expired_attempts`, `release_mock_results`), `norm_answer` keeps decimals |
| 0020 | Mock lockdown: `leave_mock_module` ends a part with 0 when the student leaves the exam screen, `mock_attempts.disqualified_at`/`disqualify_reason`, in-app notifications to the session's staff (`app.notify_mock_staff`) |
| 0021 | `notifications` in the `supabase_realtime` publication (live bell); the "left a mock" notice names the student and group |
| 0022 | Notification triggers for families and students (attendance absent/late, invoice, payment, new homework, homework reviewed, mock scheduled, mock released, lesson cancelled or moved), `app.notify`, `app.family_of`, `app.group_audience`, `mark_my_notifications_read` |

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

## LinguABC library tests (0018)
- **Full IELTS Academic tests** for every centre: reading (3 passages: 13 + 13 + 14 questions) and listening (4 recorded parts, 10 questions each). All are numbered q1..q40 across sections.
- **Written by LinguABC** with AI drafts (`src/lib/ai/test-draft.ts`, one section per call in the official shape) and Fish Audio recordings. The content is original, so there is no third-party licence.
- **Who can do what:**
  - Platform admins (`platform_admins`; there's no UI or grant to change it) use `/admin/tests` to create, edit, record, publish and hide tests.
  - Publishing checks the shape: 40 questions, 4 recorded parts or 3 passages.
  - A published test is locked and must be unpublished to edit.
- **Who sees what:**
  - Staff and mentors of any centre see published tests and can listen to their audio, so they can choose one for a mock.
  - **Keys and listening transcripts are for platform admins only.** Anyone can open a centre and become staff, so keys readable by every centre's staff would leak mock answers. Marking happens in the database.
- **Usage:** admin AI and voice use goes into `ai_requests` with `center_id` null, capped at 120 requests per hour.

## Progress (V1 step 3, basic)
- `src/lib/progress.ts` (`loadProgress`) builds one learner's progress from tables the user can already read. RLS decides visibility, and families see a mock only once it's released. No new schema.
  - Attendance by month (last 6, Tashkent time; late counts as attended, excused is left out).
  - Homework set for the student's groups while they were enrolled: done, missed, on time, score, average by month and by skill.
  - Completed mocks with L/R/W/S and overall, and the change since the previous mock.
- `components/progress/` holds the shared `ProgressView` (stat tiles, charts, tables). It's used by Student 360 (`?tab=progress`), `/student/progress` and `/parent/progress` (with the child switcher).
  - Charts are single-series SVG in the validated series colour `#2E7D4F`. Each mark has a tooltip and each chart has a table view.
  - Charts measure their container, so text stays 11px on phones and desktops.
- `/progress` (staff) lists every visible student, with a group filter and a flag:
  - **At risk:** attendance below 75%.
  - **Needs attention:** attendance below 85%, or less than 60% of homework done.
  - Students who need attention are listed first.

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
- **Mocks:** `mock_sessions` for a group, snapshotting its active students; `mock_results` with bands per module (0–9 in halves). The overall band comes from a view.
  - **Online (0019):** staff or the examiner pick a published LinguABC reading and/or listening test for the session.
    - Students take it at `/exam/{session}/{skill}`: full screen, IELTS computer-delivered layout, autosave.
    - The server sets the deadline: reading 60 minutes, listening 40 (the recording plays once, then 2 minutes to check).
    - **Lockdown (0020):** a big warning before starting, and a device without full screen can't start.
      - Leaving full screen (Esc), the tab or app, or closing or reloading the page stops the audio at once and calls `leave_mock_module` (via `navigator.sendBeacon` to `/exam/leave`, with a server action as fallback).
      - That part ends with raw 0 and band 0 and can't be restarted.
      - Owner, admins, academic managers, the examiner and the group mentor get an in-app notification. The staff header bell hears new ones live (Supabase Realtime, filtered by RLS) and shows a toast with the student's name and group. As a fallback it refreshes every 30 seconds and when the tab regains focus.
      - Browsers can't block Esc, so leaving is detected, not prevented.
    - Highlighting: select text in the passage, a question or its instructions, then pick light yellow, pink or blue (or clear). Highlights are stored as character ranges per block and kept in this browser's `localStorage` for the attempt.
    - Marking: `mark_map` against the key, raw score out of 40, then the Academic band. Bands go into `mock_results`.
  - **Release:** writing and speaking are entered by hand. Families and students see a result only after `release_mock_results`, which also writes the timeline entry. Released results can't be edited.
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
| Fish Audio | Text-to-speech for listening scripts (`src/lib/ai/fish.ts`). Scripts written as `Name: words` become a dialogue. Script markup: `[pause 30]` on its own line is silence (made locally, free), `[short pause]` is a 1 s break, `[break]` marks the mid-part break for the exam frame, and expression tags such as `[surprised]`, `[excited]`, `[laughing]` (list in `src/lib/ai/script.ts`) are sent to Fish S2 models as `[tag]` (s1: `(tag)`); other `[...]` notes are dropped and students never see tags. The AI prompts add a tag about every third turn. the mentor picks a voice per speaker from six voices the owner chose (defaults in the code; one has an Indian accent), each turn is one request and the MP3s are joined. Voice titles come from Fish (`GET /model/{id}`, cached a day). Counted as AI requests (kind `audio`, UTF-8 bytes in `prompt_tokens`). | `FISH_AUDIO_API_KEY`, `FISH_AUDIO_VOICES` (comma-separated ids, optional), `FISH_AUDIO_MODEL` (default `s2.1-pro`: Fish retires `s1` on 31 Dec 2026), `FISH_AUDIO_PODCAST_MODEL` (podcasts; defaults to `FISH_AUDIO_MODEL`), `FISH_AUDIO_BASE_URL` |
| Notifications | In-app (V1 step 4, 0022).
- **Writing:** database triggers, so every path notifies.
  - Parents: absent or late.
  - Student and parents: new invoice, payment received, mock result released.
  - The group's students: new homework, mock scheduled.
  - The student: homework reviewed.
  - The group's students and parents: lesson cancelled or moved.
  - Staff: a student left a mock (0020).
- **Format:** each row keeps an English title/body plus `data.kind` and values. `components/notifications/describe.ts` renders it in the reader's language (uz/ru/en) with a link.
- **Showing:** one bell component (`components/workspace/notification-bell.tsx`) in the staff header and the student and parent portals. It updates live through Supabase Realtime, shows a toast, polls every 30 s as a fallback, and marks all as read when opened.
- **Later:** `sms`, `telegram` and `push`. | — |

## Deployment
- **Vercel project** `linguabc-os` (team `crazybizz-codes-projects`), region `fra1`.
  - Every push gets a preview deployment; `main` deploys to production.
  - URLs: `linguabc-os.vercel.app`; auth emails use `app.linguabc.xyz`.
- **Supabase:** one project, `qycffcuuavtlojkxrkiz`, "LinguABC OS", eu-central-1. It's the production database, and there's no staging project.
  - Migrations are applied by hand (`supabase db push`, the SQL editor, or the MCP `apply_migration`).
- The public Supabase URL and publishable key are defaults in `src/lib/supabase/config.ts`, so builds work without env setup.
- Server actions accept request bodies up to 5 MB (`next.config.ts`), because Vercel caps them at 4.5 MB.
