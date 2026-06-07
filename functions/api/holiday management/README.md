# SmartCore Holiday Management Functions

Put this folder into:

functions/api/holidaymanagement/

Also copy the included `_utils.js` into:

functions/api/_utils.js

Endpoints:

/api/holidaymanagement/add-company
/api/holidaymanagement/send-company-invite
/api/holidaymanagement/resend-company-invite
/api/holidaymanagement/lookup-invite
/api/holidaymanagement/complete-company-onboarding
/api/holidaymanagement/complete-employee-onboarding
/api/holidaymanagement/employee-invite
/api/holidaymanagement/import-bank-holidays
/api/holidaymanagement/send-leave-request-notification
/api/holidaymanagement/send-leave-decision-notification
/api/holidaymanagement/send-leave-cancel-notification

Cloudflare variables needed:

SUPABASE_URL
SUPABASE_ANON
SUPABASE_SERVICE_ROLE
RESEND_API_KEY
RESEND_FROM
PUBLIC_APP_URL

Example:

RESEND_FROM = SmartCore Technology <noreply@smartcoretechnology.co.uk>
PUBLIC_APP_URL = https://smartcoretechnology.co.uk

Frontend fetch URLs need to use `/api/holidaymanagement/...`.
