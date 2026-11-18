-- =====================================================================
-- LinguABC OS — core schema (V1)
--
-- Principles
--   * Multi-tenant: every business row carries center_id. Child tables
--     reference parents through composite (id, center_id) foreign keys, so
--     the database itself refuses a row that points into another center.
--   * No denormalised names or counters. Names come from joins; counts and
--     percentages come from views (0004_views.sql).
--   * Money is stored as bigint whole so'm (UZS). Payme works in tiyin —
--     multiply by 100 at the integration boundary, never in the database.
--   * Payments are an append-only ledger (see 0003_functions.sql).
-- =====================================================================

create extension if not exists pgcrypto with schema extensions;
create extension if not exists btree_gist with schema extensions;

create schema if not exists app;        -- private helpers, never exposed via API
revoke all on schema app from public;

-- ----------------------------------------------------------------- enums
create type public.member_role   as enum ('owner','admin','academic_manager','mentor','student','parent');
create type public.member_status as enum ('invited','active','suspended');
create type public.record_status as enum ('active','archived');
create type public.student_status as enum ('lead','active','paused','graduated','left');
create type public.enrollment_status as enum ('active','paused','completed','dropped');
create type public.lesson_status as enum ('scheduled','held','cancelled');
create type public.attendance_status as enum ('present','late','absent','excused');
create type public.invoice_status as enum ('open','void');
create type public.payment_kind as enum ('payment','refund');
create type public.payment_method as enum ('cash','card','bank_transfer','click','payme','uzum');
create type public.skill as enum ('reading','listening','writing','speaking','vocabulary','grammar');
create type public.cefr_level as enum ('A1','A2','B1','B2','C1','C2');
create type public.assignment_source as enum ('library','upload','ai');
create type public.assignment_status as enum ('draft','pending_approval','approved','archived');
create type public.submission_status as enum ('not_started','in_progress','submitted','reviewed');
create type public.mock_status as enum ('scheduled','in_progress','completed','cancelled');
create type public.mock_result_status as enum ('pending','in_progress','completed','absent');
create type public.activity_type as enum ('enrollment','attendance','payment','homework','mock','note');
create type public.notification_channel as enum ('in_app','sms','telegram','push');
create type public.notification_status as enum ('queued','sent','failed');

-- ------------------------------------------------------- helper: updated_at
create function app.set_updated_at() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  return new;
end $$;

-- ================================================================ tenancy
create table public.centers (
  id          uuid primary key default gen_random_uuid(),
  name        text not null check (length(trim(name)) between 2 and 120),
  slug        text not null unique check (slug ~ '^[a-z0-9][a-z0-9-]{1,48}$'),
  timezone    text not null default 'Asia/Tashkent',
  currency    char(3) not null default 'UZS',
  receipt_seq bigint not null default 0,   -- advanced only inside record_payment()
  created_at  timestamptz not null default now()
);

-- One row per signed-up person (mirrors auth.users).
create table public.profiles (
  id         uuid primary key references auth.users(id) on delete cascade,
  full_name  text,
  phone      text,
  created_at timestamptz not null default now()
);

create table public.branches (
  id         uuid primary key default gen_random_uuid(),
  center_id  uuid not null references public.centers(id) on delete cascade,
  name       text not null,
  address    text,
  phone      text,
  status     public.record_status not null default 'active',
  created_at timestamptz not null default now(),
  unique (id, center_id),
  unique (center_id, name)
);

-- A person's role inside one center. A person may hold several roles
-- (e.g. mentor in one center, parent in another).
create table public.memberships (
  id          uuid primary key default gen_random_uuid(),
  center_id   uuid not null references public.centers(id) on delete cascade,
  user_id     uuid references auth.users(id) on delete set null,  -- null until invite accepted
  role        public.member_role not null,
  status      public.member_status not null default 'invited',
  branch_id   uuid,
  full_name   text not null,
  email       text,
  phone       text,
  invite_code text unique,
  invited_by  uuid references public.memberships(id),
  created_at  timestamptz not null default now(),
  unique (id, center_id),
  foreign key (branch_id, center_id) references public.branches(id, center_id),
  check (status <> 'active' or user_id is not null)
);
create unique index memberships_one_role_per_user
  on public.memberships (center_id, user_id, role) where user_id is not null;
create index memberships_user_idx on public.memberships (user_id) where status = 'active';

create table public.rooms (
  id         uuid primary key default gen_random_uuid(),
  center_id  uuid not null references public.centers(id) on delete cascade,
  branch_id  uuid not null,
  name       text not null,
  capacity   int check (capacity > 0),
  unique (id, center_id),
  unique (branch_id, name),
  foreign key (branch_id, center_id) references public.branches(id, center_id)
);

-- ============================================================ academics
create table public.courses (
  id                  uuid primary key default gen_random_uuid(),
  center_id           uuid not null references public.centers(id) on delete cascade,
  name                text not null,
  code                text not null,
  level               public.cefr_level,
  duration_weeks      int check (duration_weeks > 0),
  default_monthly_fee bigint not null default 0 check (default_monthly_fee >= 0),
  description         text,
  status              public.record_status not null default 'active',
  created_at          timestamptz not null default now(),
  unique (id, center_id),
  unique (center_id, code)
);

create table public.groups (
  id         uuid primary key default gen_random_uuid(),
  center_id  uuid not null references public.centers(id) on delete cascade,
  branch_id  uuid not null,
  course_id  uuid not null,
  mentor_id  uuid,                 -- memberships.id with role mentor
  room_id    uuid,
  name       text not null,
  short_name text,
  capacity   int check (capacity > 0),
  start_date date,
  end_date   date,
  status     public.record_status not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, center_id),
  unique (center_id, name),
  foreign key (branch_id, center_id) references public.branches(id, center_id),
  foreign key (course_id, center_id) references public.courses(id, center_id),
  foreign key (mentor_id, center_id) references public.memberships(id, center_id),
  foreign key (room_id, center_id)   references public.rooms(id, center_id),
  check (end_date is null or start_date is null or end_date >= start_date)
);
create trigger groups_updated_at before update on public.groups
  for each row execute function app.set_updated_at();

-- Weekly recurring timetable of a group. ISO weekday: 1 = Monday … 7 = Sunday.
create table public.group_schedule_slots (
  id         uuid primary key default gen_random_uuid(),
  center_id  uuid not null,
  group_id   uuid not null,
  weekday    smallint not null check (weekday between 1 and 7),
  start_time time not null,
  end_time   time not null check (end_time > start_time),
  room_id    uuid,
  foreign key (group_id, center_id) references public.groups(id, center_id) on delete cascade,
  foreign key (room_id, center_id)  references public.rooms(id, center_id)
);

-- Concrete lesson occurrences (generated from slots, or added ad hoc).
-- Exclusion constraints make double-booking a room or a mentor impossible.
create table public.lessons (
  id         uuid primary key default gen_random_uuid(),
  center_id  uuid not null,
  group_id   uuid not null,
  mentor_id  uuid,
  room_id    uuid,
  starts_at  timestamptz not null,
  ends_at    timestamptz not null,
  status     public.lesson_status not null default 'scheduled',
  topic      text,
  created_at timestamptz not null default now(),
  unique (id, center_id),
  unique (group_id, starts_at),
  foreign key (group_id, center_id)  references public.groups(id, center_id) on delete cascade,
  foreign key (mentor_id, center_id) references public.memberships(id, center_id),
  foreign key (room_id, center_id)   references public.rooms(id, center_id),
  check (ends_at > starts_at),
  constraint lessons_no_room_overlap exclude using gist
    (room_id with =, tstzrange(starts_at, ends_at) with &&)
    where (status <> 'cancelled' and room_id is not null),
  constraint lessons_no_mentor_overlap exclude using gist
    (mentor_id with =, tstzrange(starts_at, ends_at) with &&)
    where (status <> 'cancelled' and mentor_id is not null)
);
create index lessons_group_time_idx on public.lessons (group_id, starts_at);

-- ============================================================== people
create table public.students (
  id            uuid primary key default gen_random_uuid(),
  center_id     uuid not null references public.centers(id) on delete cascade,
  branch_id     uuid,
  membership_id uuid unique,        -- the student's own login, once invited
  full_name     text not null check (length(trim(full_name)) >= 2),
  phone         text,
  email         text,
  date_of_birth date,
  status        public.student_status not null default 'active',
  joined_on     date not null default current_date,
  notes         text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (id, center_id),
  foreign key (branch_id, center_id)     references public.branches(id, center_id),
  foreign key (membership_id, center_id) references public.memberships(id, center_id)
);
create trigger students_updated_at before update on public.students
  for each row execute function app.set_updated_at();

create table public.guardians (
  id            uuid primary key default gen_random_uuid(),
  center_id     uuid not null,
  student_id    uuid not null,
  membership_id uuid,               -- parent login, once invited
  full_name     text not null,
  phone         text,
  relationship  text,
  is_primary    boolean not null default false,
  created_at    timestamptz not null default now(),
  foreign key (student_id, center_id)    references public.students(id, center_id) on delete cascade,
  foreign key (membership_id, center_id) references public.memberships(id, center_id),
  unique (student_id, membership_id)
);
create index guardians_membership_idx on public.guardians (membership_id);

create table public.enrollments (
  id               uuid primary key default gen_random_uuid(),
  center_id        uuid not null,
  student_id       uuid not null,
  group_id         uuid not null,
  status           public.enrollment_status not null default 'active',
  start_date       date not null default current_date,
  end_date         date,
  monthly_fee      bigint not null check (monthly_fee >= 0),
  discount_percent numeric(5,2) not null default 0 check (discount_percent between 0 and 100),
  due_day          smallint not null default 5 check (due_day between 1 and 28),
  created_at       timestamptz not null default now(),
  unique (id, center_id),
  foreign key (student_id, center_id) references public.students(id, center_id),
  foreign key (group_id, center_id)   references public.groups(id, center_id)
);
create unique index enrollments_one_active
  on public.enrollments (student_id, group_id) where status = 'active';
create index enrollments_group_idx on public.enrollments (group_id) where status = 'active';

create table public.attendance_records (
  id         uuid primary key default gen_random_uuid(),
  center_id  uuid not null,
  lesson_id  uuid not null,
  student_id uuid not null,
  status     public.attendance_status not null,
  note       text,
  marked_by  uuid,
  marked_at  timestamptz not null default now(),
  unique (lesson_id, student_id),
  foreign key (lesson_id, center_id)  references public.lessons(id, center_id) on delete cascade,
  foreign key (student_id, center_id) references public.students(id, center_id),
  foreign key (marked_by, center_id)  references public.memberships(id, center_id)
);
create index attendance_student_idx on public.attendance_records (student_id, marked_at);

-- ============================================================== finance
-- A charge for one enrollment for one month. Paid / partial / overdue are
-- derived from the payments ledger (view invoice_balances), never stored.
create table public.invoices (
  id            uuid primary key default gen_random_uuid(),
  center_id     uuid not null,
  student_id    uuid not null,
  enrollment_id uuid not null,
  period        date not null check (extract(day from period) = 1),
  amount        bigint not null check (amount >= 0),
  due_date      date not null,
  status        public.invoice_status not null default 'open',
  created_at    timestamptz not null default now(),
  unique (id, center_id),
  unique (enrollment_id, period),
  foreign key (student_id, center_id)    references public.students(id, center_id),
  foreign key (enrollment_id, center_id) references public.enrollments(id, center_id)
);
create index invoices_student_idx on public.invoices (student_id, period desc);

-- Append-only money ledger. Rows are never updated or deleted
-- (trigger in 0003). A refund is a new row of kind 'refund'.
create table public.payments (
  id              uuid primary key default gen_random_uuid(),
  center_id       uuid not null,
  student_id      uuid not null,
  invoice_id      uuid,
  kind            public.payment_kind not null default 'payment',
  amount          bigint not null check (amount > 0),
  method          public.payment_method not null,
  provider_txn_id text,                    -- Click / Payme / Uzum transaction id
  receipt_no      text not null,
  received_by     uuid,
  refund_of       uuid references public.payments(id),
  note            text,
  paid_at         timestamptz not null default now(),
  created_at      timestamptz not null default now(),
  unique (center_id, receipt_no),
  foreign key (student_id, center_id)  references public.students(id, center_id),
  foreign key (invoice_id, center_id)  references public.invoices(id, center_id),
  foreign key (received_by, center_id) references public.memberships(id, center_id),
  check ((kind = 'refund') = (refund_of is not null))
);
create unique index payments_provider_txn_unique
  on public.payments (method, provider_txn_id) where provider_txn_id is not null;
create index payments_invoice_idx on public.payments (invoice_id);
create index payments_student_idx on public.payments (student_id, paid_at desc);

-- ============================================================ homework
-- Reusable task. library_item_id points at the shared LinguABC Library
-- (content_items migrated from the previous product); FK added when the
-- library is imported.
create table public.assignments (
  id              uuid primary key default gen_random_uuid(),
  center_id       uuid not null references public.centers(id) on delete cascade,
  title           text not null,
  skill           public.skill not null,
  sub_skill       text,
  level           public.cefr_level,
  source          public.assignment_source not null,
  library_item_id text,
  content         jsonb not null default '{}'::jsonb,   -- {instructions, questions:[...], attachments:[...]}
  status          public.assignment_status not null default 'draft',
  created_by      uuid not null,
  approved_by     uuid,
  approved_at     timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (id, center_id),
  foreign key (created_by, center_id)  references public.memberships(id, center_id),
  foreign key (approved_by, center_id) references public.memberships(id, center_id),
  check ((status = 'approved') = (approved_by is not null) or status = 'archived')
);
create trigger assignments_updated_at before update on public.assignments
  for each row execute function app.set_updated_at();

-- An assignment given to a group with a deadline.
create table public.homework (
  id            uuid primary key default gen_random_uuid(),
  center_id     uuid not null,
  assignment_id uuid not null,
  group_id      uuid not null,
  assigned_by   uuid not null,
  assigned_at   timestamptz not null default now(),
  due_at        timestamptz not null,
  unique (id, center_id),
  foreign key (assignment_id, center_id) references public.assignments(id, center_id),
  foreign key (group_id, center_id)      references public.groups(id, center_id),
  foreign key (assigned_by, center_id)   references public.memberships(id, center_id)
);
create index homework_group_idx on public.homework (group_id, due_at);

create table public.submissions (
  id           uuid primary key default gen_random_uuid(),
  center_id    uuid not null,
  homework_id  uuid not null,
  student_id   uuid not null,
  status       public.submission_status not null default 'not_started',
  answers      jsonb not null default '{}'::jsonb,
  score        numeric(5,2) check (score between 0 and 100),
  feedback     text,
  started_at   timestamptz,
  submitted_at timestamptz,
  reviewed_by  uuid,
  reviewed_at  timestamptz,
  updated_at   timestamptz not null default now(),
  unique (homework_id, student_id),
  foreign key (homework_id, center_id) references public.homework(id, center_id) on delete cascade,
  foreign key (student_id, center_id)  references public.students(id, center_id),
  foreign key (reviewed_by, center_id) references public.memberships(id, center_id)
);
create index submissions_student_idx on public.submissions (student_id);
create trigger submissions_updated_at before update on public.submissions
  for each row execute function app.set_updated_at();

-- ================================================================ mocks
create table public.mock_sessions (
  id           uuid primary key default gen_random_uuid(),
  center_id    uuid not null,
  group_id     uuid,
  name         text not null,
  version      text,
  modules      public.skill[] not null default '{reading,listening,writing,speaking}',
  scheduled_at timestamptz not null,
  room_id      uuid,
  examiner_id  uuid,
  status       public.mock_status not null default 'scheduled',
  created_at   timestamptz not null default now(),
  unique (id, center_id),
  foreign key (center_id)              references public.centers(id) on delete cascade,
  foreign key (group_id, center_id)    references public.groups(id, center_id),
  foreign key (room_id, center_id)     references public.rooms(id, center_id),
  foreign key (examiner_id, center_id) references public.memberships(id, center_id)
);

create table public.mock_results (
  id              uuid primary key default gen_random_uuid(),
  center_id       uuid not null,
  mock_session_id uuid not null,
  student_id      uuid not null,
  status          public.mock_result_status not null default 'pending',
  reading_band    numeric(2,1) check (reading_band   between 0 and 9 and reading_band   * 2 = trunc(reading_band   * 2)),
  listening_band  numeric(2,1) check (listening_band between 0 and 9 and listening_band * 2 = trunc(listening_band * 2)),
  writing_band    numeric(2,1) check (writing_band   between 0 and 9 and writing_band   * 2 = trunc(writing_band   * 2)),
  speaking_band   numeric(2,1) check (speaking_band  between 0 and 9 and speaking_band  * 2 = trunc(speaking_band  * 2)),
  weaknesses      text[] not null default '{}',
  notes           text,
  updated_at      timestamptz not null default now(),
  unique (mock_session_id, student_id),
  foreign key (mock_session_id, center_id) references public.mock_sessions(id, center_id) on delete cascade,
  foreign key (student_id, center_id)      references public.students(id, center_id)
);
create trigger mock_results_updated_at before update on public.mock_results
  for each row execute function app.set_updated_at();

-- ====================================================== timeline & comms
-- Student 360 timeline. Written only by server functions/triggers.
create table public.activities (
  id          uuid primary key default gen_random_uuid(),
  center_id   uuid not null,
  student_id  uuid not null,
  type        public.activity_type not null,
  title       text not null,
  detail      text,
  actor_id    uuid,
  ref_id      uuid,
  occurred_at timestamptz not null default now(),
  foreign key (student_id, center_id) references public.students(id, center_id) on delete cascade,
  foreign key (actor_id, center_id)   references public.memberships(id, center_id)
);
create index activities_student_idx on public.activities (student_id, occurred_at desc);

create table public.notifications (
  id           uuid primary key default gen_random_uuid(),
  center_id    uuid not null,
  recipient_id uuid not null,     -- memberships.id
  channel      public.notification_channel not null default 'in_app',
  status       public.notification_status not null default 'queued',
  title        text not null,
  body         text,
  data         jsonb not null default '{}'::jsonb,
  read_at      timestamptz,
  sent_at      timestamptz,
  created_at   timestamptz not null default now(),
  foreign key (recipient_id, center_id) references public.memberships(id, center_id) on delete cascade
);
create index notifications_recipient_idx on public.notifications (recipient_id, created_at desc);

-- Who changed what. Written by triggers only; readable by the center owner.
create table public.audit_log (
  id            bigint generated always as identity primary key,
  center_id     uuid,
  actor_user_id uuid,
  table_name    text not null,
  row_id        uuid,
  action        text not null,
  old_data      jsonb,
  new_data      jsonb,
  at            timestamptz not null default now()
);
create index audit_log_center_idx on public.audit_log (center_id, at desc);
