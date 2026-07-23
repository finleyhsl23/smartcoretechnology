-- ============================================================================
-- SmartCore Presence & Fire Safety — Migration 16: ID card print orders
-- "Send to SmartCore to print" on the ID Cards page: pick employees, pay via
-- Stripe, SmartCore prints and posts the physical PVC cards. The card
-- images themselves are rendered client-side (canvas) at order-creation time
-- and uploaded here so processing never depends on the browser staying open
-- after payment — only the Cloudflare Functions (service role) ever touch
-- this table/bucket; there is no direct client write path.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.presence_fire_safety_card_orders (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id              uuid NOT NULL REFERENCES public.smartcore_core_companies(id) ON DELETE CASCADE,
  created_by              uuid REFERENCES public.core_employees(id) ON DELETE SET NULL,
  status                  text NOT NULL DEFAULT 'pending_payment'
    CHECK (status IN ('pending_payment', 'paid', 'failed', 'cancelled')),
  employee_ids            uuid[] NOT NULL CHECK (array_length(employee_ids, 1) >= 1),
  quantity                integer NOT NULL CHECK (quantity >= 1),
  unit_price_pence        integer NOT NULL DEFAULT 300,
  minimum_order_pence     integer NOT NULL DEFAULT 1500,
  amount_pence            integer NOT NULL CHECK (amount_pence >= 0),
  shipping_name           text NOT NULL,
  shipping_phone          text,
  shipping_address_line1  text NOT NULL,
  shipping_address_line2  text,
  shipping_city           text NOT NULL,
  shipping_county         text,
  shipping_postcode       text NOT NULL,
  shipping_country        text NOT NULL DEFAULT 'United Kingdom',
  stripe_payment_intent_id text UNIQUE,
  paid_at                 timestamptz,
  emailed_at              timestamptz,
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS pfs_card_orders_company_idx ON public.presence_fire_safety_card_orders(company_id);
CREATE INDEX IF NOT EXISTS pfs_card_orders_pi_idx ON public.presence_fire_safety_card_orders(stripe_payment_intent_id);

DROP TRIGGER IF EXISTS pfs_card_orders_set_updated_at ON public.presence_fire_safety_card_orders;
CREATE TRIGGER pfs_card_orders_set_updated_at BEFORE UPDATE ON public.presence_fire_safety_card_orders
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.presence_fire_safety_card_orders ENABLE ROW LEVEL SECURITY;

-- Read-only for badge managers (order history); all writes go through the
-- Cloudflare Functions using the service role key (Stripe calls can't happen
-- client-side), so no authenticated-role insert/update policy is needed.
CREATE POLICY pfs_card_orders_select ON public.presence_fire_safety_card_orders
  FOR SELECT USING (public.presence_fire_safety_has_permission(company_id, 'presence.manage_badges'));

-- Private bucket holding the per-employee front/back PNGs generated at order
-- creation time. Only the service role ever reads/writes it (no storage RLS
-- policy is added, so authenticated/anon get no access at all).
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'presence-fire-safety-card-print-orders',
  'presence-fire-safety-card-print-orders',
  false,
  10485760,
  ARRAY['image/png']
)
ON CONFLICT (id) DO NOTHING;
