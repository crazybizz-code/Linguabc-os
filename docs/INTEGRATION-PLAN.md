# PR #36–#43: merge and migration compatibility

_2026-11-25. `main` = `e120631` (#35 merged). Production database: migrations 0001–0028 only. Every PR below is open; nothing applied._

## 1. Matrix
| PR | Migration | Depends on (DB) | Replaces existing objects | New objects | Shared files with other PRs |
|---|---|---|---|---|---|
| #35 ✅ merged | 0031, 0032 | 0001–0028 | `app.notify`, `app.notify_lesson_change` | telegram_* tables, tg_* functions, `centers.phone/address` | — |
| #36 Telegram app | 0033 | 0031, 0032; **pg_net + Vault secrets** | — | `telegram_dispatch_state`, `app.tg_dispatch_tick`, cron `telegram-dispatch`, `telegram-prune` | `actions.ts`, `database.types.ts`, `uz.ts`/`ru.ts` |
| #37 Finance | 0034 | 0001–0028 | — | `expenses`, `record_expense`, `void_expense`, `cash_operating_result`, `app.center_today` | `actions.ts`, `sidebar.tsx`, `database.types.ts`, i18n, `supabase/local` + `tests/e2e` (QA tools) |
| #38 Admin ops | 0035 | 0001–0028 (tested also with 0031/0032) | **`app.issue_invoice`** (0008) | `enrollments.transferred_from`, 8 RPCs, `app.period_billed_via_transfer`, `app.centre_local_date` | `actions.ts`, `database.types.ts`, i18n, `supabase/tests/run.sh` |
| #39 Mentor KPI | 0036 | 0001–0028 | — | `mentor_kpis` (read only) | `sidebar.tsx`, `database.types.ts`, i18n |
| #40 Mentor mocks | 0037 | 0011 | **`create_mock_session`** (0011) | — | — |
| #36 (cont.) | 0039 | 0031 | — | `telegram_queue_health` (read only) | — |
| #42 Settings | 0038 | 0032 (`centers.phone/address`) | **drops policy `centers_update`, revokes UPDATE on `centers`** | `update_center_settings` | `actions.ts` (replaces `renameCentre`), `database.types.ts`, i18n, `settings/*` |
| #43 Suggestions | — | — | — | — (TS only) | `progress.ts`, `student/plan`, i18n |

No two migrations create or replace the same object. `app.center_today` (0034) and `app.centre_local_date` (0035) are different names on purpose.

**0038 is the one exception to "backward compatible": it removes the direct `UPDATE centers` that the current `renameCentre` uses, so apply 0038 and merge #42 together (migration, then merge within minutes); in between, renaming the centre fails with a permission message and nothing else is affected.**

**Every other migration is backward compatible with the code already on `main`:** they only add objects, or widen/narrow behaviour that the current UI does not reach (0035's `issue_invoice` change only matters for enrolments with `transferred_from`, which no current code writes; 0037 lets mentors create sessions, which the current UI does not offer them; 0031 adds Telegram-linked parents to `app.notify`, of which there are none). So **"migration first, then merge the code"** is safe.

## 2. What happens if the code is deployed before its migration
Merging to `main` deploys to Vercel production. Checked by reading the code and, for #36, on a local stack without 0031–0033:
| PR | Without its migration | Severity |
|---|---|---|
| #36 | Parents page renders (Telegram 0); "Telegram link" says "The Telegram bot is not set up yet." (or the button is hidden while `TELEGRAM_BOT_USERNAME` is unset); webhook/dispatch 401 without secrets; staff actions unaffected (`after()` dispatch is a no-op without a token). **Verified locally.** | none |
| #37 | `/finance` (owner menu) shows "The figures could not be loaded". Nothing else touched. | low, owner only |
| #38 | Student 360 / group buttons appear but their RPCs fail with a database message; "Partial" and translations work. | **medium — apply 0035 first** |
| #39 | Mentors page: the KPI card says "could not be loaded"; the old table still works. | low |
| #40 | Mentors see "Create mock session" but get "You don't have permission". | **medium — apply 0037 first** |
| #42 | Settings save fails with a database message; renaming the centre no longer works. | **medium — apply 0038 first** |
| #43 | Nothing: no migration. | none |

## 3. Sequence (each step needs the owner's approval)
1. **0031 + 0032 → production** (procedure: `DEPLOY-TELEGRAM-MIGRATIONS.md`). No visible change.
2. Merge **#36** (code only; webhook stays off, no bot env needed). 0033 waits.
3. **0034 → production**, then merge **#37**.
4. **0035 → production**, then merge **#38** (rebase on `main` first: conflicts in `actions.ts`, i18n and the SQL test file are append-only).
5. **0036 → production**, then merge **#39**.
6. **0037 → production**, then merge **#40**.
6b. **0038 → production**, then merge **#42** right after (see the exception above).
6c. Merge **#43** (no migration).
6d. **0039** with #36 or later (read only).
7. Follow-up PR (small): `schedule_changed` added to the Telegram kinds; new admin actions call the Telegram dispatch.
8. Telegram go-live: env vars → `setWebhook` → 0033 (pg_net, Vault, cron) — `TELEGRAM-BOT.md` checklist.

Before each merge: rebase/merge `main`, run `supabase/tests/run.sh` and `PROD_SHAPE=1`, `test:ts`, `tsc`, `eslint`, `next build`, the relevant local browser QA, and wait for the Vercel check.

Never: `supabase db push`, `migration repair`, applying 0029/0030.

## 4. How a migration is applied
MCP `apply_migration` with `name` = the file name (e.g. `0034_expenses`) and the file's exact content from `main` (or the PR head, when applied before the merge), then a role check in a rolled-back transaction with a throwaway `qa-*` centre, then `get_advisors`. History stays truthful: rows are timestamped when applied; 0029/0030 remain absent.

## 5. Rollback (reverse order)
| Step | Undo |
|---|---|
| 0037 | `rollback/0037_mentor_mock_scheduling.down.sql` (0011 body) |
| 0036 | `rollback/0036_mentor_kpis.down.sql` |
| 0035 | `rollback/0035_admin_operations.down.sql` (restores 0008 `issue_invoice`, drops `transferred_from`; edits stay) |
| 0034 | `rollback/0034_expenses.down.sql` (**deletes expenses: export first**) |
| 0033 | `deleteWebhook`; `rollback/0033_telegram_dispatch.down.sql` |
| 0032, 0031 | their rollback files (links and queue lost; parents relink) |
Code rollback: revert the merge commit on `main` (Vercel redeploys). Each rollback script is tested to give back the exact earlier schema (`pg_dump -s` diff empty).
