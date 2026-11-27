// Rows for the Parents page. Pure (unit-tested in tests/ts/families.test.mjs).
//
// Identity rule: two guardian records are the same person ONLY when they
// point to the same parent membership (a login or Telegram account the
// centre created and the admin linked on purpose). Equal names or phone
// numbers prove nothing — siblings' parents can share a phone, different
// parents can share a name. So:
//   * guardians with the same membership_id  -> one row, all their children;
//   * every guardian without a membership     -> its own row, one child.
// Joining more children to a parent is an explicit admin action
// (attach_guardian_to_parent), never inferred here.

export type GuardianIn = {
  id: string; student_id: string; full_name: string; phone: string | null; relationship: string | null;
  membership_id: string | null;
  membership: { id: string; status: string; invite_code: string | null; invite_expires_at: string | null } | null;
};
export type StudentIn = { id: string; full_name: string | null; open_balance: number | null; overdue_count: number | null };

export type FamilyRow = {
  key: string;                       // "m:<membership id>" or "g:<guardian id>"
  name: string; phone: string | null; relationship: string | null;
  guardianId: string;                // the guardian row used for actions on this row
  guardianIds: string[];
  membership: GuardianIn["membership"];
  children: { id: string; name: string; balance: number; overdue: number }[];
};

export function groupFamilies(guardians: GuardianIn[], students: StudentIn[]): FamilyRow[] {
  const byId = new Map(students.map((s) => [s.id, s]));
  const rows = new Map<string, FamilyRow>();
  for (const g of guardians) {
    const key = g.membership_id ? `m:${g.membership_id}` : `g:${g.id}`;
    const row = rows.get(key) ?? {
      key, name: g.full_name, phone: g.phone, relationship: g.relationship,
      guardianId: g.id, guardianIds: [], membership: g.membership_id ? g.membership : null, children: [],
    };
    row.guardianIds.push(g.id);
    if (!row.phone && g.phone) row.phone = g.phone;
    const s = byId.get(g.student_id);
    if (s && !row.children.some((c) => c.id === s.id)) {
      row.children.push({ id: s.id, name: s.full_name ?? "—", balance: Number(s.open_balance ?? 0), overdue: Number(s.overdue_count ?? 0) });
    }
    rows.set(key, row);
  }
  return [...rows.values()];
}

/**
 * Guardians that an admin may add to a parent account: not yet linked to any
 * account, and not for a child this parent already has. Same-phone matches
 * are listed first and marked, as a hint for the admin to check — never
 * linked automatically.
 */
export function attachCandidates(row: FamilyRow, guardians: GuardianIn[], students: StudentIn[]) {
  if (!row.membership) return [];
  const mine = new Set(row.children.map((c) => c.id));
  const digits = (p: string | null) => (p ?? "").replace(/\D/g, "");
  const myPhone = digits(row.phone);
  const name = new Map(students.map((s) => [s.id, s.full_name ?? "—"]));
  return guardians
    .filter((g) => !g.membership_id && !mine.has(g.student_id))
    .map((g) => ({
      guardianId: g.id, guardianName: g.full_name, phone: g.phone, child: name.get(g.student_id) ?? "—",
      samePhone: myPhone.length >= 7 && digits(g.phone) === myPhone,
    }))
    .sort((a, b) => Number(b.samePhone) - Number(a.samePhone) || a.child.localeCompare(b.child));
}
