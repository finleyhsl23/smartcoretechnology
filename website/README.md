# The Travelling Taverna | Greek Deli

This version uses Supabase for products, stock, settings, admin login, orders and enquiries.

Private order/enquiry details are encrypted in Supabase using PostgreSQL pgcrypto functions.

## Setup

1. Run `supabase-schema.sql` in Supabase SQL Editor.
2. Replace the encryption key before running the SQL.
3. Create an admin user in Supabase Authentication.
4. Add that user to `thetravellingtavernagreekdeli.admin_users` using the commented SQL at the bottom of the SQL file.
5. Add your Supabase URL and anon key into `config.js`.
6. Upload all files to Cloudflare Pages, Netlify or your hosting.

## Payment

The checkout is still a fake Stripe-style test payment. It does not collect card details. It creates an encrypted test order in Supabase.
