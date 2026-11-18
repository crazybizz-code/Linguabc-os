# Auth email templates

Paste into **Supabase → Authentication → Emails → Templates**.

| Template | Subject | File |
|---|---|---|
| Confirm signup | `Confirm your LinguABC account` | `confirm-signup.html` |
| Reset password | `Reset your LinguABC password` | `reset-password.html` |
| Change email address | `Confirm your new email` | `change-email.html` |

Links point to `{{ .SiteURL }}/auth/confirm` (handled by `src/app/auth/confirm/route.ts`),
so the link domain matches the sender domain `linguabc.xyz` — this keeps the
emails out of spam. `{{ .SiteURL }}` is the Site URL set in
Authentication → URL Configuration (`https://app.linguabc.xyz`).
