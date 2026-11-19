# LinguABC OS

@AGENTS.md

**What it is:** a multi-tenant platform for language learning centres in Uzbekistan (IELTS-focused). One deployment serves many centres. Staff run operations and teaching; students and parents get their own portals.

**Direction now:** finishing V1 (target: 15 January). Next up are AI listening sections with audio (Fish Audio), then online mocks, then settings, Excel import, the parents page and reports. Details: `docs/V1-ROADMAP.md`.

## Stack
- Next.js 16.4 (App Router, `src/proxy.ts` instead of middleware), React 19.3, Tailwind 4, TypeScript, zod
- Supabase: Postgres + Auth + RLS. One project, `qycffcuuavtlojkxrkiz` (eu-central-1), and **it is production**
- Vercel, region `fra1`
- AI drafts through OpenRouter or the Gemini API (`src/lib/ai/`)
- i18n: English keys, `src/i18n/uz.ts` and `ru.ts` (owner panel and parent portal)

## Rules
- Read `AGENTS.md`: this Next.js has breaking changes. Check `node_modules/next/dist/docs/` before writing Next code.
- Authorisation lives in the database (RLS plus `security definer` RPCs that re-check the role). The UI only hides things. Never rely on the client for access or marking.
- Every business row carries `center_id`, and child tables use composite `(id, center_id)` foreign keys. Keep both in new tables.
- Answer keys stay server-side (`library_answer_keys`, `assignment_keys`). Marking happens in Postgres.
- Money is whole UZS in `bigint`. Payments are append-only.
- Schema changes go in a new numbered file in `supabase/migrations/`, with a test section in `supabase/tests/10_access_and_flows.sql`.
- One branch per feature, a PR into `main`, squash-merge.

## Commands
```bash
npm ci
npx next typegen && npx tsc --noEmit   # typegen creates the PageProps/LayoutProps globals
npx eslint src
npm run build
su postgres -c "bash supabase/tests/run.sh"   # SQL suite; needs local Postgres 15+ (Linux)
```

## Production safety
- Supabase is live data and there is no staging. Applying a migration changes production.
- Don't deploy, apply migrations, or write or delete live data unless the user asks. Look before deleting.
- QA happens in throwaway centres (`qa-*` slug, users `qa.*@linguabc.test`) that are deleted afterwards. Never touch real centres.
- Agents don't sign in to the production site. Verify through SQL as the role (see `docs/SECURITY.md`), and ask the user for UI checks.
- Never commit secrets. `.env.example` lists the variables.

## Deeper context
- `docs/CURRENT-STATE.md`: where things stand and the exact next task. **Read first.**
- `docs/PRODUCT.md`: product, roles, V1 scope
- `docs/ARCHITECTURE.md`: how it's built
- `docs/SECURITY.md`: isolation, RLS, privacy, QA rules
- `docs/V1-ROADMAP.md`: done, now, next
