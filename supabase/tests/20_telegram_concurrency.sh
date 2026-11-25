#!/usr/bin/env bash
# Two parents redeem the same Telegram link token at the same moment.
# Exactly one may win. Runs after 10_access_and_flows.sql on the same DB.
set -euo pipefail
DB=${DB:-linguabc_test}
q() { psql -qtA -v ON_ERROR_STOP=1 -d "$DB" -c "$1"; }

M=$(q "select id from memberships where role = 'parent' order by created_at limit 1")
C=$(q "select center_id from memberships where id = '$M'")
TOKEN=concurrency-test-token-0000000001
q "insert into telegram_link_tokens (center_id, membership_id, token_hash, expires_at)
   values ('$C', '$M', app.tg_hash('$TOKEN'), now() + interval '1 hour')" >/dev/null

redeem() {
  psql -qtA -v ON_ERROR_STOP=1 -d "$DB" <<SQL
begin;
set local role service_role;
select tg_redeem_link('$TOKEN', $1, $1, null)->>'ok';
select pg_sleep(1.5);
commit;
SQL
}
redeem 7001 > /tmp/tg_conc_a.out & A=$!
sleep 0.3
redeem 7002 > /tmp/tg_conc_b.out & B=$!
wait $A $B
WINS=$(cat /tmp/tg_conc_a.out /tmp/tg_conc_b.out | grep -c '^true$' || true)
LIVE=$(q "select count(*) from telegram_links where membership_id = '$M' and revoked_at is null and telegram_user_id in (7001, 7002)")
rm -f /tmp/tg_conc_a.out /tmp/tg_conc_b.out
if [ "$WINS" != 1 ] || [ "$LIVE" != 1 ]; then
  echo "FAIL: concurrent redemption: $WINS winners, $LIVE live links"; exit 1
fi
echo "34. concurrent token redemption: one winner"
