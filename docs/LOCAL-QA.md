# Local browser QA (no production)

A local copy of the backend so every role can be clicked through in a real browser with synthetic data, before the founder's checks on production.

```
bash supabase/local/up.sh                       # as root: fresh DB, GoTrue, PostgREST, gateway; writes .env.qa
set -a; . ./.env.qa; set +a; npx next dev -p 3100   # the app against the local stack
node tests/e2e/pilot-qa.mjs                     # 25 steps, screenshots in /tmp/lg-qa
QA_ADMIN_OPS=1 node tests/e2e/pilot-qa.mjs      # + 8 steps for PR #38 (student edit, transfer, timetable, lessons)
QA_TELEGRAM=1 TELEGRAM_BOT_USERNAME=x ...       # + Telegram link steps for PR #36 (set the env for next dev too)
QA_KPI=1 node tests/e2e/pilot-qa.mjs            # + mentor KPI steps for PR #39
```

- **Stack:** local Postgres 16 (all migrations in `supabase/migrations`), `supabase/gotrue:v2.170.0` and `postgrest/postgrest:v12.2.3` from Docker Hub, `supabase/local/gateway.mjs` in place of Kong. `up.sh` drops and recreates the `linguabc_local` database each run.
- **Keys:** a local-only JWT secret; `.env.qa` is git-ignored and holds no production value. The script refuses any base URL that is not localhost.
- **Seed:** one synthetic library article (`supabase/local/seed.sql`); production's library is not copied.
- **Not covered locally:** Storage (listening audio), Realtime (live bell), pg_cron, AI and Fish Audio (no keys), email/SMS, Telegram.
- **What it proves:** the pages, server actions, RLS and RPCs work together for owner, admin, mentor and student on this code. It does not prove production config (Vercel env, Supabase Auth settings, domain).
