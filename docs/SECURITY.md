# Security

The database is the security boundary. The Next.js app reads and writes with the signed-in user's session. `src/proxy.ts` only refreshes the session and redirects signed-out visitors, and the UI hides things only for convenience.

## Pre-launch blockers
Confirmed by the owner on 2026-11-19. Both must be fixed before V1 goes live.

1. **Unused invite codes never expire.** A pending invite stays redeemable until it's used or its membership is changed. Fix: give codes an expiry, check it in `accept_invite`, and let staff reissue a code.
2. **Answer keys are visible too widely.** `assignment_keys` can be read and written by staff and by **every mentor in the centre** (`app.has_role(center_id, '{mentor}')`), not only the mentor of the group the work is set for. Fix: limit mentor access to assignments they created, or that are set for groups they teach. Add a test where a mentor from a different group gets nothing.

## Tenant isolation
- Every business row has `center_id`.
- Child tables reference parents with composite `(id, center_id)` foreign keys, so a row can't point into another centre even by mistake.
- RLS hides other centres completely. The SQL suite checks two centres against each other: section 5, "who sees what".
- Only the LinguABC library is shared across centres:
  - published `library_items` can be read by any signed-in user;
  - `library_answer_keys` can be read by staff and mentors of any centre (`app.is_any_staff()`).
- New tables must include `center_id`, composite foreign keys and RLS. Revoke `anon`.

## RLS
- RLS is on for every table. Helpers live in the private `app` schema as `security definer` functions with `search_path = ''`.
- Views use `security_invoker = true`, so they run under the caller's RLS.
- Tables without a write policy can't be written by API users. Writes go through RPCs, which re-check the role.
- PR #9 found a NULL-comparison hole in a permission check: a user from another centre would have passed it. When writing `security definer` functions:
  - compare against a value you know isn't NULL;
  - `forbid()` when lookups find nothing;
  - add a cross-centre test.

## Role authorisation
| Check | Who |
|---|---|
| `is_admin` | Owner, admin. Money and personal data. |
| `is_staff` | Owner, admin, academic manager. Academics. |
| Mentor | Own groups and their active students only (`is_mentor_of_group`, `is_mentor_of_student`) |
| Owner only | Invite or change owners and admins (`invite_member`, `set_member_status`); refunds |

A few specific rules:
- **Mentor drafts:** AI and upload drafts from a mentor need approval by a manager.
- **Mocks:** results can be saved by staff or the session's examiner. The examiner must be a manager or the group's own mentor.
- **Answer keys** (`assignment_keys`) can be read and written by staff and by **any mentor in the centre**, not only the group's mentor. This is a pre-launch blocker (see above). Students never get the key until they submit, and then only through `my_homework_result`.
- **Marking** happens in Postgres. The browser never sees the key while the student is working, and it never computes marks.

## Student 360 privacy
- `student_overview` is a `security_invoker` view:
  - staff see every student in their centre;
  - mentors see only their own students;
  - students and parents see only their own record.
- The Payments tab and every money figure need `can_see_finance`: owner, admin, the student, or their parent. Academic managers and mentors never see money.
- Personal data writes (`guardians`, and so on) are limited to owner and admin.

## Parent–child access
- A parent's access comes only from `guardians.membership_id` → their membership (`app.my_student_ids()`). They see exactly their linked children: attendance, homework, results, invoices, receipts.
- Families see the mentor's name through `group_mentor_name()`, which is gated by `can_see_group`. They don't read staff memberships.
- Verified on live (PR #8): parent B opening parent A's receipt gets a 404.

## Invite security
- **Codes:** 6 random bytes as 12 hex characters (`gen_random_bytes`), single-use. Redeeming one sets `invite_code = null` and binds the membership to the signed-in user.
- **No expiry:** invite codes don't expire in the database. A pending invite stays redeemable until it's used or the membership is changed. This is a pre-launch blocker (see above).
- **Issuing:** only owner or admin can issue invites, and only the owner can invite owners or admins.
  - A student invite must point to an existing student without a login.
  - A parent invite must point to an existing guardian without a login.
- `/join` shows only the centre name and role (`invite_preview`).

## Payments
- Whole UZS in `bigint`. Payme's tiyin conversion belongs at the integration boundary.
- Append-only ledger: payments can't be updated or deleted, even by the owner. Refunds are new rows, and only the owner can make them.
- Receipt numbers are sequential per centre, advanced only inside `record_payment`. Overpaying is refused.
- `(method, provider_txn_id)` is unique, so provider retries are idempotent.
- No card data is stored. Click and Payme are still refused by the server, a leftover of the earlier V2 decision.
- Owner, admin, the student and their parents can read payments. Nobody else can.

**Online parent payments (V1, through Click; not built yet).** The flow is Parent app → Pay now → Click → payment verified → records updated. These rules apply to Click and to any provider added later:
- A payment counts only after the **server verifies it with the provider**, through the provider's signature or callback check. A browser redirect or any value sent by the client is never proof of payment.
- Verified payments are written through `record_payment`, with the provider's transaction id in `provider_txn_id`. Retries then don't create duplicates, and the append-only ledger and receipt numbering still apply.
- The parent pays only invoices of their own linked children. The amount comes from the invoice on the server, never from the client.
- Card details are entered on the provider's page and never reach LinguABC.
- Provider keys and secrets are server-only environment variables.

## File uploads
- Worksheet uploads are a server action, open to staff and mentors (the role is checked in the database by `claim_ai_request`):
  - 4 MB limit;
  - allowed types are PDF (`%PDF-` magic bytes checked, 12 pages or fewer), `.docx` (text extracted with mammoth), `.txt`, and PNG/JPEG/WEBP (extension and MIME both checked).
- Files are sent inline to the AI provider and **not stored**.
- The prompt tells the model to ignore instructions inside the file. The mentor edits every draft before saving, and `check_questions` validates the structure in the database.
- AI limits are enforced in the database: 20 requests per user per hour and 200 per centre per day. Every request is logged in `ai_requests`.
- Library HTML is sanitised with `sanitize-html`: links get `rel="noopener noreferrer"` and iframes are sandboxed.
- There's no Supabase Storage yet. Where Fish Audio / listening audio will be stored is **undecided**. Whatever is chosen has to keep each centre's files separate, the way RLS does for rows.

## Secrets
- Server only: `SUPABASE_SECRET_KEY` / `SUPABASE_SERVICE_ROLE_KEY`, `OPENROUTER_API_KEY`, `GEMINI_API_KEY`.
  - Never prefix them with `NEXT_PUBLIC_`.
  - Never commit them. `.env*` is gitignored, and only `.env.example` is committed.
- The service-role client (`src/lib/supabase/admin.ts`) is used only in `app/(auth)/actions.ts`, to resolve phone → email and check a phone at registration. Don't widen its use. It bypasses RLS.
- The Supabase URL and publishable key are public by design and committed as defaults.

## Production QA rules
- The Supabase project is production and there's no staging.
- QA only in throwaway centres with a `qa-*` slug and users `qa.*@linguabc.test`.
  - Create them for the check and delete the centre and its auth users afterwards.
  - Never touch real centres; today that's `convora-5hqe`.
- **Check flows as a role in SQL**, the same way the test suite does. RLS and RPC checks apply exactly as in the app:
  ```sql
  select set_config('request.jwt.claims', '{"sub":"<auth user id>","role":"authenticated"}', true);
  set local role authenticated;
  ```
- AI agents don't type passwords into the production site. The owner signs in for visual checks.
- Before deleting, list exactly what will be removed. Delete only the agreed QA centre, and only after the owner confirms.
- **How to delete a QA centre:** deleting the `centers` row alone fails, because cascades run into `NO ACTION` membership foreign keys.
  - In one transaction, delete the centre's rows children-first: submissions → homework → keys → assignments → … → memberships. Then delete the centre, then its auth users (profiles cascade).
  - Fingerprint the other centres before and after, and roll back if anything changed.
  - `audit_log` is append-only and keeps its rows. That's by design.
- Don't apply migrations, deploy, or change live data unless asked.
