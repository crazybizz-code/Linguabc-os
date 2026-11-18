# LinguABC OS (V1)

The learning-centre operating system: a Next.js app on Vercel with a
Supabase backend (Postgres + Auth + Row Level Security).

## Run locally

```bash
cp .env.example .env.local   # fill SUPABASE_SECRET_KEY for phone sign-in
npm install
npm run dev                  # http://localhost:3000
```

## App structure (`src/`)

| Path | What it is |
|---|---|
| `proxy.ts` | Refreshes the Supabase session; sends signed-out visitors to `/login` |
| `app/(auth)/` | `/login`, `/register`, `/join`, `/forgot-password`, `/reset-password` and their server actions |
| `app/auth/callback` | Landing point for links in Supabase auth emails |
| `app/page.tsx` | Routes each person to their workspace by role |
| `app/(staff)/` | Staff workspace: `/dashboard`, `/branches`, `/groups` (+ courses), `/students`, `/staff` |
| `app/(workspace)/` | `/student`, `/parent` (placeholder frames) |
| `lib/supabase/` | Browser, server and service-role clients, generated DB types |
| `lib/auth/workspace.ts` | Memberships, role → home route, finishing sign-up (create centre / redeem invite) |

### Sign-up flows

- **Owner:** `/register` → confirm email → the centre is created on first sign-in.
- **Everyone else:** staff invite them (`invite_member`) → they open `/join?code=…` → confirm email → the invite is redeemed on first sign-in.
- **Phone sign-in:** the phone is resolved to the account email on the server with the secret key. The error is the same for an unknown phone and a wrong password.

### Supabase settings to configure

- **Auth → URL Configuration:** set the Site URL to the production domain, and add `https://<domain>/auth/callback` (plus preview domains) to the Redirect URLs.
- **Auth → SMTP:** add a custom SMTP provider (e.g. Resend). The built-in mailer only sends to team members and is heavily rate-limited.

## Database

### Migrations (`supabase/migrations`)

| File | What it holds |
|---|---|
| `0001_core_schema.sql` | 23 tables: centers, branches, memberships (roles), rooms, courses, groups, weekly slots, lessons, students, guardians, enrollments, attendance, invoices, payments, assignments, homework, submissions, mock sessions/results, activities, notifications, audit log |
| `0002_access_control.sql` | Row Level Security for all six roles |
| `0003_server_functions.sql` | RPCs: `create_center`, `invite_member`, `accept_invite`, `set_member_status`, `enroll_student`, `generate_invoices`, `record_payment`, `refund_payment`, `void_invoice`, `generate_lessons`, `mark_attendance`, `approve_assignment`, `assign_homework`, `save_submission`, `review_submission`; ledger immutability; audit triggers |
| `0004_views.sql` | Read models: `invoice_balances`, `student_overview` (Student 360), `group_overview`, `mock_result_scores` |
| `0005_profile_phone_login.sql` | Unique, normalised phone on profiles for phone sign-in |
| `0006_invite_preview.sql` | `invite_preview(code)` — centre and role shown on `/join` |
| `0007_workspace_rpcs.sql` | `create_student` (student + parent + enrolment + first invoice) and `create_group` (room + group + slots + 12 weeks of lessons), each in one transaction |
| `0008_first_invoice_due_date.sql` | First invoice is never due before the enrolment start date |

Apply in order with `supabase db push` (after `supabase link`) or paste
into the SQL editor of a new Supabase project.

### Guarantees enforced by the database

- **Tenant isolation** — every row has `center_id`; composite foreign keys
  stop a row in one center from referencing another center's data; RLS
  hides other centers entirely.
- **Roles** — owner/admin see money; academic manager sees academics only;
  a mentor sees only the groups they teach; a student sees only themselves;
  a parent sees only their linked children.
- **Money** — whole UZS in `bigint`. Payments are append-only (no UPDATE or
  DELETE, even for the owner); refunds are new rows, owner only. Receipt
  numbers are sequential per center. Click/Payme/Uzum retries are
  idempotent via `provider_txn_id`. Card data is never stored.
- **Schedule** — Postgres exclusion constraints make it impossible to book
  the same room or mentor twice at overlapping times.
- **Audit** — memberships, students, guardians, enrollments, invoices,
  payments, attendance and mock results are logged with the acting user.

### Database tests

`supabase/tests/run.sh` builds a throwaway database (with a minimal
Supabase auth stub) and runs ~90 checks across two centers and every role:
cross-center leaks, forbidden writes, ledger tampering, schedule clashes,
the homework approval flow, band rounding, and Student 360 numbers.
