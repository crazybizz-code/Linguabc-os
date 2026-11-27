# Preflight: applying 0031 + 0032 to production

_Prepared 2026-11-27. **Not applied. Needs the owner's explicit go-ahead.** Read-only checks below were run on production `qycffcuuavtlojkxrkiz` on 2026-11-27._

## 1. Production now (read-only, verified)
| Item | Value |
|---|---|
| Migration history | 0001 … 0028 (`0016` in three parts); last version `20261121073304` (`0028_practice`). No 0029/0030/0031/0032. |
| Data fingerprint | centres 1 (`convora-5hqe`), memberships 1, auth users 1, students 0, guardians 0, enrollments 0, invoices 0, payments 0 (sum 0), attendance 0, lessons 0, notifications 0, audit_log 118, published library items 277 |
| Name clashes | no `telegram*` tables, no `tg_*`/`*telegram*` functions, no `centers.phone/address` columns |
| Functions 0031 replaces | `app.notify` md5 `ae6748152c4c5e93b5efa7c187120b75`, `app.notify_lesson_change` md5 `0c597355a19e8e853823119c0a790116` — **identical** to the 0022 versions in the repo (checked on a local 0001–0028 build) |
| Triggers on `notifications` | `notifications_guard` only |
| Cron jobs | `payment-reminders` (`0 4 * * *`, active) — untouched by 0031/0032 |
| Extensions | btree_gist, pg_cron, pg_stat_statements, pgcrypto, plpgsql, supabase_vault, uuid-ossp (0031/0032 need only pgcrypto, present) |
| Security advisor baseline | 1 INFO (platform_admins no policy), 1 WARN anon definer (`invite_preview`, by design), 52 WARN authenticated definer (by design: each re-checks the role), leaked-password protection off |

## 2. Exact SQL
From `main` at `e120631` (merged #35), applied unchanged:
| File | Lines / bytes | sha256 |
|---|---|---|
| `supabase/migrations/0031_telegram_parents.sql` | 541 / 30 197 | `13e12c87ae6b5b30dc5d4b39169cef75bbc3d655fb6c3a7e3342c26165f56bd7` |
| `supabase/migrations/0032_telegram_views.sql` | 200 / 12 069 | `1bf4e9172086417514e6879fddda7dc4d4baee8ab896c4669c43b1ffba7565e9` |
Method: Supabase MCP `apply_migration`, `name` = `0031_telegram_parents`, then `0032_telegram_views` (two calls, each one transaction). Before each call the sha256 of the text sent is compared with the table above. Never `supabase db push`, never `migration repair`, never 0029/0030.

## 3. Dependencies
- 0031 needs 0001–0028 (memberships, guardians, students, notifications, `app.notify`, `app.forbid`, `app.has_role`/`is_admin`, `app.my_staff_membership`, pgcrypto in `extensions`). All present.
- 0032 needs 0031 (`app.tg_can_see_student`).
- Neither needs 0029/0030 (proven: `PROD_SHAPE=1` suite passes; order 0028→0031→0032→0029→0030 also applies).
- No app code depends on them today (`main` has no Telegram code); #36 works without them (verified locally).

## 4. Effect on today's workflows
| Workflow | Effect |
|---|---|
| Attendance, payments, invoices, mock release, reminders | Same notifications to the same people with the same text. A new trigger on `notifications` copies parent notices to the Telegram queue **only for parents with a live Telegram link** — none exist, so it inserts nothing. Any error inside it is caught (warning) and never fails the attendance/payment transaction (tested, SQL §39). |
| `app.notify` | Same as 0022 for active members; additionally reaches *invited* parent memberships that have a live Telegram link (none today). |
| Lesson cancelled/moved notices | Data gains `group_id`, `lesson_id`; text and recipients unchanged; the in-app bell reads only the old fields. |
| `centers` | Two nullable columns (`phone`, `address`); no table rewrite, no default. |
| Storage, Auth, cron, Vercel | Unchanged. |

## 5. Security checks after applying (each in a transaction that is rolled back)
1. As a throwaway `qa-*` owner: `issue_telegram_link` works for their guardian; a stranger and a mentor get `forbidden`.
2. As `authenticated`: `tg_children`, `tg_redeem_link`, `tg_child_*` → `permission denied` (service role only).
3. As `service_role`: redeem the QA token with chat id = user id → ok; a second use → refused; `tg_children` returns only the QA child; `tg_child_payments` for another student → `forbidden`.
4. `mark_attendance` (absent) for the QA student still succeeds; one in-app notice is written; no Telegram row (no link) — then with a QA link, exactly one queued row.
5. `rollback`; re-run the fingerprint of section 1 — must be identical.
6. `get_advisors(security)`: expected new items only — 3 WARN (`issue_telegram_link`, `attach_guardian_to_parent`, `revoke_telegram_link`, authenticated, by design) and INFO "RLS enabled, no policy" for `telegram_link_tokens`, `telegram_updates`, `telegram_outbox` (service-only by design). Anything else → stop and roll back.

## 6. Rollback
- `supabase/rollback/0032_telegram_views.down.sql`, then `supabase/rollback/0031_telegram_parents.down.sql`, each via `apply_migration` named `0032_telegram_views_rollback` / `0031_telegram_parents_rollback` so the history stays truthful.
- Restores `app.notify` and `app.notify_lesson_change` byte-for-byte (md5 checked locally after rollback: same values as in section 1) and removes everything else; schema diff against 0028 is empty (SQL §36).
- Data loss on rollback: Telegram links and queue only (none exist today).

## 7. Not part of this step
- 0033 (pg_net, Vault, cron) and 0039 (queue health): separate decisions, with #36.
- Telegram env vars and `setWebhook`: separate decision (`TELEGRAM-BOT.md`, steps C–E).

## 8. Owner's go-ahead needed for
"Apply 0031 and 0032 to production as described in PREFLIGHT-0031-0032.md" — then I run sections 2 → 5 and report each result before continuing.
