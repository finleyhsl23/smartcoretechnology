  # SmartCore Holiday Management

Upload this folder to the root of your Cloudflare Pages project so the app lives at:

`/systems/holidaymanagement`

Run SQL in order:

1. `systems/holidaymanagement/sql/001_full_schema.sql`
2. `systems/holidaymanagement/sql/002_seed_bank_holidays_2026.sql`

Then add your own user to `holidaymanagement.smartcore_admins` after signing up/signing in once:

```sql
insert into holidaymanagement.smartcore_admins(user_id, full_name, active)
select id, email, true from auth.users where email = 'YOUR_EMAIL_HERE';
```

Pages included:

- dashboard.html
- calendar.html
- request-leave.html
- my-leave.html
- employee-management.html
- company-holidays.html
- admin.html
- smartcore-admin.html
- onboarding.html
- select-company.html
- login.html

Department filtering is included on the Calendar page and the Employee Management form includes Department.
