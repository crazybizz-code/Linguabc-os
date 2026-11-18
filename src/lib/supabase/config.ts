/**
 * Supabase connection settings.
 *
 * The URL and publishable key are public by design (they ship to every
 * browser), so the production project's values are the defaults and the
 * app runs without any env setup. Env vars still win — including the names
 * the Supabase ↔ Vercel integration creates — so a preview or local
 * project can point elsewhere.
 */
export const SUPABASE_URL =
  process.env.NEXT_PUBLIC_SUPABASE_URL ?? "https://qycffcuuavtlojkxrkiz.supabase.co";

export const SUPABASE_PUBLISHABLE_KEY =
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??
  "sb_publishable_tNly7XWNt77Ygp010EPBvw_7K3aUEa0";

/** Public origin of this app, used in auth email links. */
export function siteUrl(): string {
  if (process.env.NEXT_PUBLIC_SITE_URL) return process.env.NEXT_PUBLIC_SITE_URL;
  if (process.env.VERCEL_ENV === "production" && process.env.VERCEL_PROJECT_PRODUCTION_URL) {
    return `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`;
  }
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;
  return "http://localhost:3000";
}
