# SmartCore Holiday Management SaaS

Route intended for Cloudflare Pages:

`smartcoretechnology.co.uk/systems/holidaymanagement`

## Cloudflare variables needed

Already shown in your screenshot or needed:

- `SUPABASE_URL`
- `SUPABASE_ANON` as plaintext for the frontend build/runtime
- `SUPABASE_SERVICE_ROLE` or `SUPABASE_SERVICE_ROLE_KEY` as secret
- `RESEND_API_KEY` as secret
- `RESEND_FROM` or `RESEND_FROM_EMAIL`
- `PUBLIC_APP_URL` as `https://smartcoretechnology.co.uk/systems/holidaymanagement`

Your current screenshot shows `SUPABASE_URL`, service role and Resend variables. If there is no `SUPABASE_ANON` variable, add the public anon key as plaintext.

## Supabase setup

1. Run `sql/001_schema.sql` in Supabase SQL Editor.
2. Run `sql/002_seed_bank_holidays.sql`.
3. Add yourself as a SmartCore admin:

```sql
insert into holidaymanagement.smartcore_admins (user_id, role, active)
values ('YOUR_AUTH_USER_ID_HERE', 'super_admin', true)
on conflict (user_id) do update set active = true, role = 'super_admin';
```

## Deployment

Upload this folder to GitHub and connect it to Cloudflare Pages, or upload directly.

The app is static HTML/CSS/JS with Cloudflare Pages Functions under `/functions/api`.

## Important notes

This is the SmartCore multi-company version. It does not require a separate folder per customer.

Data isolation is based on:

- `company_id`
- `company_users`
- Supabase RLS policies

Manual absence is blocked until an employee has completed onboarding and has a linked `user_id`.

Developer mode is only shown to users listed in `holidaymanagement.smartcore_admins`.
