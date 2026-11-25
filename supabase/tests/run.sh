#!/usr/bin/env bash
# Applies every migration to a throwaway local Postgres database and runs
# the end-to-end access/flow test suite. Needs Postgres 15+ with
# btree_gist and pgcrypto (standard contrib). Run as a Postgres superuser:
#   ./supabase/tests/run.sh
# PROD_SHAPE=1 leaves out the migrations that are merged but not applied to
# production (0029, 0030), to prove newer ones apply on production's shape.
set -euo pipefail
cd "$(dirname "$0")/.."
DB=${DB:-linguabc_test}
export DB
NOT_ON_PROD='0029_audio_segments.sql|0030_audio_jobs.sql'

psql -q -d postgres -c "drop database if exists $DB" -c "create database $DB" >/dev/null
for r in anon authenticated service_role; do
  psql -q -d postgres -c "drop role if exists $r" >/dev/null 2>&1 || true
done

WITH_AUDIO=true
files=(tests/00_supabase_stub.sql)
for f in migrations/*.sql; do
  if [ "${PROD_SHAPE:-0}" = 1 ] && [[ "$(basename "$f")" =~ ^($NOT_ON_PROD)$ ]]; then
    WITH_AUDIO=false; echo "(production shape: skipping $(basename "$f"))"; continue
  fi
  files+=("$f")
done
for f in "${files[@]}"; do
  psql -q -v ON_ERROR_STOP=1 -d "$DB" -f "$f"
done
psql -q -v ON_ERROR_STOP=1 -v with_audio=$WITH_AUDIO -d "$DB" -f tests/10_access_and_flows.sql
bash tests/20_telegram_concurrency.sh
bash tests/30_migration_order.sh
bash tests/21_transfer_concurrency.sh
