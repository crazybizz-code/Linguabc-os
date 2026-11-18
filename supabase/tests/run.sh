#!/usr/bin/env bash
# Applies every migration to a throwaway local Postgres database and runs
# the end-to-end access/flow test suite. Needs Postgres 15+ with
# btree_gist and pgcrypto (standard contrib). Run as a Postgres superuser:
#   ./supabase/tests/run.sh
set -euo pipefail
cd "$(dirname "$0")/.."
DB=${DB:-linguabc_test}

psql -q -d postgres -c "drop database if exists $DB" -c "create database $DB" >/dev/null
for r in anon authenticated service_role; do
  psql -q -d postgres -c "drop role if exists $r" >/dev/null 2>&1 || true
done

for f in tests/00_supabase_stub.sql migrations/*.sql tests/10_access_and_flows.sql; do
  psql -q -v ON_ERROR_STOP=1 -d "$DB" -f "$f"
done
