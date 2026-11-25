#!/usr/bin/env bash
# Local QA stack for browser tests: local Postgres + GoTrue + PostgREST +
# a tiny gateway, all on this machine, synthetic data only. Never uses
# production keys. Run as root from the repo root:  bash supabase/local/up.sh
# Then: npm run dev -- -p 3100 with the env printed at the end (.env.qa).
set -euo pipefail
cd "$(dirname "$0")"
DB=linguabc_local
SECRET=${LOCAL_JWT_SECRET:-local-qa-jwt-secret-not-for-production-000}
service postgresql start >/dev/null
docker rm -f lg-gotrue lg-postgrest >/dev/null 2>&1 || true
su postgres -c "psql -q -d postgres -c 'set client_min_messages=warning' -c 'drop database if exists $DB' -c 'create database $DB'"
su postgres -c "psql -q -v ON_ERROR_STOP=1 -d $DB -f bootstrap.sql" >/dev/null

docker run -d --name lg-gotrue --network host \
  -e GOTRUE_API_HOST=127.0.0.1 -e PORT=9999 -e API_EXTERNAL_URL=http://localhost:54321/auth/v1 \
  -e GOTRUE_DB_DRIVER=postgres -e DATABASE_URL="postgres://supabase_auth_admin:local-only@127.0.0.1:5432/$DB" \
  -e GOTRUE_SITE_URL=http://localhost:3100 -e GOTRUE_URI_ALLOW_LIST="http://localhost:3100/**" \
  -e GOTRUE_JWT_SECRET="$SECRET" -e GOTRUE_JWT_EXP=3600 -e GOTRUE_JWT_AUD=authenticated \
  -e GOTRUE_JWT_ADMIN_ROLES=service_role -e GOTRUE_JWT_DEFAULT_GROUP_NAME=authenticated \
  -e GOTRUE_DISABLE_SIGNUP=false -e GOTRUE_EXTERNAL_EMAIL_ENABLED=true -e GOTRUE_MAILER_AUTOCONFIRM=true \
  -e GOTRUE_EXTERNAL_PHONE_ENABLED=false -e GOTRUE_RATE_LIMIT_EMAIL_SENT=1000 \
  supabase/gotrue:v2.170.0 >/dev/null
for i in $(seq 1 60); do curl -fs http://127.0.0.1:9999/health >/dev/null 2>&1 && break; sleep 1; done
curl -fs http://127.0.0.1:9999/health >/dev/null || { docker logs lg-gotrue | tail -20; exit 1; }

for f in ../migrations/*.sql; do if [ -n "${SKIP_MIGRATIONS:-}" ] && [[ "$(basename "$f")" =~ $SKIP_MIGRATIONS ]]; then echo "skip $(basename "$f")"; continue; fi; su postgres -c "psql -q -v ON_ERROR_STOP=1 -d $DB -f $f" >/dev/null; done
su postgres -c "psql -q -v ON_ERROR_STOP=1 -d $DB -f seed.sql" >/dev/null
su postgres -c "psql -q -d $DB -c \"notify pgrst, 'reload schema'\""

docker run -d --name lg-postgrest --network host \
  -e PGRST_DB_URI="postgres://authenticator:local-only@127.0.0.1:5432/$DB" -e PGRST_DB_SCHEMAS=public \
  -e PGRST_DB_ANON_ROLE=anon -e PGRST_JWT_SECRET="$SECRET" -e PGRST_SERVER_PORT=3000 -e PGRST_SERVER_HOST=127.0.0.1 \
  postgrest/postgrest:v12.2.3 >/dev/null
for i in $(seq 1 30); do curl -fs http://127.0.0.1:3000/ >/dev/null 2>&1 && break; sleep 1; done

pkill -f "supabase/local/gateway.mjs" 2>/dev/null || true
nohup node "$(pwd)/gateway.mjs" > /tmp/lg-gateway.log 2>&1 &
eval "$(node keys.mjs "$SECRET" | sed 's/^/export /')"
cat > ../../.env.qa <<ENV
NEXT_PUBLIC_SUPABASE_URL=http://localhost:54321
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=$ANON
SUPABASE_SECRET_KEY=$SERVICE
NEXT_PUBLIC_SITE_URL=http://localhost:3100
ENV
echo "local stack up: gateway :54321, GoTrue :9999, PostgREST :3000; env in .env.qa"
