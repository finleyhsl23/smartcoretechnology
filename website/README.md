# The Travelling Taverna | Greek Dehli

This is a full front-end demo for an ecommerce website with:

- Product shop
- Basket
- Delivery postcode check
- Minimum order amount
- Test checkout
- Admin dashboard
- Product add/edit/delete
- Stock management
- Test order management
- Wholesale enquiry form demo

## Demo admin login

Open `admin.html`.

Use any email and password for this demo.

## Payment

The payment is a fake Stripe-style test checkout.
It does not collect card details and does not charge anything.
When you click complete test payment, a test order is saved into the admin dashboard using browser localStorage.

## Important

This is a demo/static version.

Before going live, connect:

- Supabase database
- Supabase Auth for admin login
- Supabase Storage for product images
- Stripe Checkout
- Email sending for orders and wholesale forms
- Proper postcode/distance API
