# LinguABC OS — backend (V1)

Database, access control and server logic for the learning-center OS,
built on Supabase (Postgres + Auth + Row Level Security).

## Migrations (`supabase/migrations`)

| File | What it holds |
|---|---|
| `0001_core_schema.sql` | 23 tables: centers, branches, memberships (roles), rooms, courses, groups, weekly slots, lessons, students, guardians, enrollments, attendance, invoices, payments, assignments, homework, submissions, mock sessions/results, activities, notifications, audit log |
| `0002_access_control.sql` | Row Level Security for all six roles |
| `0003_server_functions.sql` | RPCs: `create_center`, `invite_member`, `accept_invite`, `set_member_status`, `enroll_student`, `generate_invoices`, `record_payment`, `refund_payment`, `void_invoice`, `generate_lessons`, `mark_attendance`, `approve_assignment`, `assign_homework`, `save_submission`, `review_submission`; ledger immutability; audit triggers |
| `0004_views.sql` | Read models: `invoice_balances`, `student_overview` (Student 360), `group_overview`, `mock_result_scores` |

Apply in order with `supabase db push` (after `supabase link`) or paste
into the SQL editor of a new Supabase project.

## Guarantees enforced by the database

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

## Tests

`supabase/tests/run.sh` builds a throwaway database (with a minimal
Supabase auth stub) and runs ~90 checks across two centers and every role:
cross-center leaks, forbidden writes, ledger tampering, schedule clashes,
the homework approval flow, band rounding, and Student 360 numbers.
