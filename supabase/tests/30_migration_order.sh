#!/usr/bin/env bash
# Production deploy checks for migrations applied out of number order.
# Production has 0001-0028; 0029/0030 are merged but stay unapplied.
#  1. 0031 + 0032 apply on production's shape, and 0029/0030 still apply
#     after them later.
#  2. The rollback scripts bring the schema back exactly to 0001-0028,
#     and 0031/0032 can be applied again afterwards.
set -euo pipefail
cd "$(dirname "$0")/.."
apply() { psql -q -v ON_ERROR_STOP=1 -d "$1" -f "$2" >/dev/null; }
fresh() {
  psql -q -d postgres -c "set client_min_messages = warning" -c "drop database if exists $1" -c "create database $1" >/dev/null
  apply "$1" tests/00_supabase_stub.sql
  for f in migrations/00{01..28}_*.sql; do apply "$1" "$f"; done
}
fresh lg_order
apply lg_order migrations/0031_telegram_parents.sql
apply lg_order migrations/0032_telegram_views.sql
apply lg_order migrations/0033_telegram_dispatch.sql
apply lg_order migrations/0029_audio_segments.sql
apply lg_order migrations/0030_audio_jobs.sql
echo "35. order 0028 -> 0031 -> 0032 -> 0033 -> 0029 -> 0030 applies"

fresh lg_base
pg_dump -s -d lg_base | grep -v -e '^--' -e '^\\restrict' -e '^\\unrestrict' > /tmp/lg_base.sql
fresh lg_rb
apply lg_rb migrations/0031_telegram_parents.sql
apply lg_rb migrations/0032_telegram_views.sql
apply lg_rb migrations/0033_telegram_dispatch.sql
apply lg_rb migrations/0039_telegram_queue_health.sql
apply lg_rb rollback/0039_telegram_queue_health.down.sql
apply lg_rb rollback/0033_telegram_dispatch.down.sql
apply lg_rb rollback/0032_telegram_views.down.sql
apply lg_rb rollback/0031_telegram_parents.down.sql
pg_dump -s -d lg_rb | grep -v -e '^--' -e '^\\restrict' -e '^\\unrestrict' > /tmp/lg_rb.sql
if ! diff -q /tmp/lg_base.sql /tmp/lg_rb.sql >/dev/null; then
  diff /tmp/lg_base.sql /tmp/lg_rb.sql | head -40; echo "FAIL: rollback leaves schema differences"; exit 1
fi
apply lg_rb migrations/0031_telegram_parents.sql
apply lg_rb migrations/0032_telegram_views.sql
apply lg_rb migrations/0033_telegram_dispatch.sql
echo "36. rollback restores the 0028 schema exactly; re-apply works"
psql -q -d postgres -c "drop database lg_order" -c "drop database lg_base" -c "drop database lg_rb" >/dev/null
rm -f /tmp/lg_base.sql /tmp/lg_rb.sql
