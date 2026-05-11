# The Travelling Taverna | Greek Deli

Full project files.

## Pages

- `index.html` home page
- `shop.html` full shop page
- `product.html` individual product page
- `admin.html` admin dashboard

## Supabase

The project uses the schema:

```text
thetravellingtavernagreekdeli
```

In Supabase Dashboard, go to Data API and expose this schema.

## Setup

1. Run `supabase-schema.sql`
2. Replace the encryption secret inside the SQL before running it
3. Add the schema to Supabase Data API exposed schemas
4. Put your real Supabase URL and publishable anon key inside `config.js`
5. Create an admin user in Supabase Auth
6. Add the admin user ID into `thetravellingtavernagreekdeli.admin_users`
7. Deploy all files to Cloudflare Pages

## Email enquiries

This includes a Supabase Edge Function:

```text
supabase/functions/send-enquiry-email/index.ts
```

Deploy it:

```bash
supabase functions deploy send-enquiry-email
```

Set Resend secrets:

```bash
supabase secrets set RESEND_API_KEY=your_resend_api_key
supabase secrets set FROM_EMAIL="The Travelling Taverna <noreply@yourdomain.co.uk>"
```

## Payments

The checkout is still a test Stripe-style checkout. It does not collect card details. It saves a test order to Supabase.
