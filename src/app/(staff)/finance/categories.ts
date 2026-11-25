// Same list as the check constraint on public.expenses (migration 0034).
export const EXPENSE_CATEGORIES = ["rent", "salaries", "utilities", "marketing", "supplies", "maintenance", "taxes_fees", "other"] as const;
export type ExpenseCategory = (typeof EXPENSE_CATEGORIES)[number];
export const CATEGORY_LABEL: Record<ExpenseCategory, string> = {
  rent: "Rent", salaries: "Salaries", utilities: "Utilities", marketing: "Marketing",
  supplies: "Supplies", maintenance: "Maintenance", taxes_fees: "Taxes and fees", other: "Other",
};
