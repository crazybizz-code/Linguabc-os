#!/usr/bin/env bash
# Two admins transfer the same enrolment at the same moment. Exactly one
# move may happen and the student is billed once for the month.
set -euo pipefail
DB=${DB:-linguabc_test}
q() { psql -qtA -v ON_ERROR_STOP=1 -d "$DB" -c "$1"; }
E=$(q "select e.id from enrollments e join students s on s.id = e.student_id where s.full_name = 'Transfer Race' and e.status = 'active'")
B=$(q "select id from groups where name = 'T-B'")
C=$(q "select id from groups where name = 'T-C'")
S=$(q "select student_id from enrollments where id = '$E'")
move() {
  psql -qtA -d "$DB" <<SQL 2>&1
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a2","role":"authenticated"}', false);
set role authenticated;
begin;
select transfer_student('$E', '$1', current_date, true) is not null;
select pg_sleep(1.5);
commit;
SQL
}
move "$B" > /tmp/tr_a.out & A=$!
sleep 0.3
move "$C" > /tmp/tr_b.out & Bp=$!
wait $A $Bp || true
OK=$(cat /tmp/tr_a.out /tmp/tr_b.out | grep -c '^t$' || true)
REFUSED=$(cat /tmp/tr_a.out /tmp/tr_b.out | grep -c 'not active' || true)
ACTIVE=$(q "select count(*) from enrollments where student_id = '$S' and status = 'active'")
INV=$(q "select count(*) from invoices where student_id = '$S' and status = 'open' and period = date_trunc('month', current_date)")
rm -f /tmp/tr_a.out /tmp/tr_b.out
if [ "$OK" != 1 ] || [ "$REFUSED" != 1 ] || [ "$ACTIVE" != 1 ] || [ "$INV" != 1 ]; then
  echo "FAIL: concurrent transfers: ok=$OK refused=$REFUSED active=$ACTIVE invoices=$INV"; exit 1
fi
echo "43b. concurrent transfers: one move, one refusal, billed once"
