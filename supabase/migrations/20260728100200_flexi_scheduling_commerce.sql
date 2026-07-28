-- ============================================================================
-- SmartCore Flexi — Migration 3: Scheduling (1:1 bookings + group classes)
-- and commerce (packages, client packages, payments)
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Class sessions — a scheduled group class instance (Studio tier+).
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.smartcore_flexi_class_sessions (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id   uuid NOT NULL REFERENCES public.smartcore_core_companies(id) ON DELETE CASCADE,
  trainer_id   uuid REFERENCES public.core_employees(id) ON DELETE SET NULL,
  location_id  uuid REFERENCES public.smartcore_flexi_locations(id) ON DELETE SET NULL,
  name         text NOT NULL,
  description  text,
  starts_at    timestamptz NOT NULL,
  ends_at      timestamptz NOT NULL,
  capacity     integer NOT NULL DEFAULT 12,
  status       text NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled', 'cancelled', 'completed')),
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS smartcore_flexi_class_sessions_company_idx ON public.smartcore_flexi_class_sessions(company_id, starts_at);

ALTER TABLE public.smartcore_flexi_class_sessions ENABLE ROW LEVEL SECURITY;

CREATE POLICY smartcore_flexi_class_sessions_staff ON public.smartcore_flexi_class_sessions
  FOR ALL USING (public.flexi_has_permission(company_id, 'flexi.manage_classes'))
  WITH CHECK (public.flexi_has_permission(company_id, 'flexi.manage_classes'));

CREATE POLICY smartcore_flexi_class_sessions_client_read ON public.smartcore_flexi_class_sessions
  FOR SELECT USING (company_id = public.flexi_client_company_id());

-- ----------------------------------------------------------------------------
-- Bookings — either a 1:1 PT session (class_session_id NULL) or a seat in a
-- group class (class_session_id set; starts_at/ends_at denormalized from the
-- class for simple calendar queries).
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.smartcore_flexi_bookings (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id       uuid NOT NULL REFERENCES public.smartcore_core_companies(id) ON DELETE CASCADE,
  client_id        uuid NOT NULL REFERENCES public.smartcore_flexi_clients(id) ON DELETE CASCADE,
  trainer_id       uuid REFERENCES public.core_employees(id) ON DELETE SET NULL,
  location_id      uuid REFERENCES public.smartcore_flexi_locations(id) ON DELETE SET NULL,
  class_session_id uuid REFERENCES public.smartcore_flexi_class_sessions(id) ON DELETE CASCADE,
  session_type     text NOT NULL DEFAULT '1:1' CHECK (session_type IN ('1:1', 'class')),
  starts_at        timestamptz NOT NULL,
  ends_at          timestamptz NOT NULL,
  status           text NOT NULL DEFAULT 'confirmed' CHECK (status IN ('confirmed', 'cancelled', 'completed', 'no_show')),
  notes            text,
  created_by       uuid REFERENCES public.core_employees(id) ON DELETE SET NULL,
  created_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS smartcore_flexi_bookings_client_idx ON public.smartcore_flexi_bookings(client_id, starts_at);
CREATE INDEX IF NOT EXISTS smartcore_flexi_bookings_company_idx ON public.smartcore_flexi_bookings(company_id, starts_at);
CREATE INDEX IF NOT EXISTS smartcore_flexi_bookings_class_idx ON public.smartcore_flexi_bookings(class_session_id);

ALTER TABLE public.smartcore_flexi_bookings ENABLE ROW LEVEL SECURITY;

CREATE POLICY smartcore_flexi_bookings_staff ON public.smartcore_flexi_bookings
  FOR ALL USING (
    public.flexi_has_permission(company_id, 'flexi.manage_bookings')
    AND client_id IN (
      SELECT c.id FROM public.smartcore_flexi_clients c
      WHERE c.company_id = smartcore_flexi_bookings.company_id
        AND (public.flexi_is_admin(c.company_id) OR c.trainer_id IS NULL OR c.trainer_id = public.flexi_current_employee_id(c.company_id))
    )
  ) WITH CHECK (public.flexi_has_permission(company_id, 'flexi.manage_bookings'));

CREATE POLICY smartcore_flexi_bookings_client_read ON public.smartcore_flexi_bookings
  FOR SELECT USING (client_id = public.flexi_current_client_id());

CREATE POLICY smartcore_flexi_bookings_client_cancel ON public.smartcore_flexi_bookings
  FOR UPDATE USING (client_id = public.flexi_current_client_id())
  WITH CHECK (client_id = public.flexi_current_client_id() AND status IN ('confirmed', 'cancelled'));

-- Atomic class-booking RPC — prevents two clients racing the last seat.
-- Also used by the trainer UI (client_id passed explicitly there).
CREATE OR REPLACE FUNCTION public.flexi_book_class(p_class_session_id uuid, p_client_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_session public.smartcore_flexi_class_sessions;
  v_taken integer;
  v_booking_id uuid;
  v_caller_client_id uuid;
BEGIN
  SELECT * INTO v_session FROM public.smartcore_flexi_class_sessions WHERE id = p_class_session_id FOR UPDATE;
  IF v_session.id IS NULL THEN
    RAISE EXCEPTION 'Class not found';
  END IF;
  IF v_session.status != 'scheduled' THEN
    RAISE EXCEPTION 'Class is not open for booking';
  END IF;

  v_caller_client_id := public.flexi_current_client_id();
  IF v_caller_client_id IS NOT NULL AND v_caller_client_id != p_client_id THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;
  IF v_caller_client_id IS NULL AND NOT public.flexi_has_permission(v_session.company_id, 'flexi.manage_bookings') THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  SELECT count(*) INTO v_taken FROM public.smartcore_flexi_bookings
  WHERE class_session_id = p_class_session_id AND status = 'confirmed';

  IF v_taken >= v_session.capacity THEN
    RAISE EXCEPTION 'Class is full';
  END IF;

  INSERT INTO public.smartcore_flexi_bookings
    (company_id, client_id, trainer_id, location_id, class_session_id, session_type, starts_at, ends_at, status)
  VALUES
    (v_session.company_id, p_client_id, v_session.trainer_id, v_session.location_id, p_class_session_id, 'class', v_session.starts_at, v_session.ends_at, 'confirmed')
  RETURNING id INTO v_booking_id;

  RETURN v_booking_id;
END;
$$;
REVOKE ALL ON FUNCTION public.flexi_book_class(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.flexi_book_class(uuid, uuid) TO authenticated;

-- ----------------------------------------------------------------------------
-- Packages — session-credit bundles or recurring memberships a business
-- sells to its clients.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.smartcore_flexi_packages (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id     uuid NOT NULL REFERENCES public.smartcore_core_companies(id) ON DELETE CASCADE,
  name           text NOT NULL,
  description    text,
  session_count  integer,
  price_pence    integer NOT NULL,
  currency       text NOT NULL DEFAULT 'GBP',
  validity_days  integer,
  billing_type   text NOT NULL DEFAULT 'one_off' CHECK (billing_type IN ('one_off', 'recurring')),
  billing_interval text CHECK (billing_interval IN ('monthly', 'yearly')),
  active         boolean NOT NULL DEFAULT true,
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS smartcore_flexi_packages_company_idx ON public.smartcore_flexi_packages(company_id);

ALTER TABLE public.smartcore_flexi_packages ENABLE ROW LEVEL SECURITY;

CREATE POLICY smartcore_flexi_packages_staff ON public.smartcore_flexi_packages
  FOR ALL USING (public.flexi_has_permission(company_id, 'flexi.manage_packages'))
  WITH CHECK (public.flexi_has_permission(company_id, 'flexi.manage_packages'));

CREATE POLICY smartcore_flexi_packages_client_read ON public.smartcore_flexi_packages
  FOR SELECT USING (active AND company_id = public.flexi_client_company_id());

-- ----------------------------------------------------------------------------
-- Client packages — a client's purchased instance of a package.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.smartcore_flexi_client_packages (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id         uuid NOT NULL REFERENCES public.smartcore_core_companies(id) ON DELETE CASCADE,
  client_id          uuid NOT NULL REFERENCES public.smartcore_flexi_clients(id) ON DELETE CASCADE,
  package_id         uuid NOT NULL REFERENCES public.smartcore_flexi_packages(id) ON DELETE RESTRICT,
  purchased_at       timestamptz NOT NULL DEFAULT now(),
  sessions_remaining integer,
  expires_at         timestamptz,
  status             text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'expired', 'cancelled')),
  created_at         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS smartcore_flexi_client_packages_client_idx ON public.smartcore_flexi_client_packages(client_id);

ALTER TABLE public.smartcore_flexi_client_packages ENABLE ROW LEVEL SECURITY;

CREATE POLICY smartcore_flexi_client_packages_staff ON public.smartcore_flexi_client_packages
  FOR ALL USING (public.flexi_has_permission(company_id, 'flexi.manage_packages'))
  WITH CHECK (public.flexi_has_permission(company_id, 'flexi.manage_packages'));

CREATE POLICY smartcore_flexi_client_packages_client_read ON public.smartcore_flexi_client_packages
  FOR SELECT USING (client_id = public.flexi_current_client_id());

-- ----------------------------------------------------------------------------
-- Payments — manual record of money taken from a client (card/cash/bank
-- transfer). No live payment-gateway wiring in this build; stripe_payment_id
-- is left free for a future Stripe Checkout integration to populate.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.smartcore_flexi_payments (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id         uuid NOT NULL REFERENCES public.smartcore_core_companies(id) ON DELETE CASCADE,
  client_id          uuid NOT NULL REFERENCES public.smartcore_flexi_clients(id) ON DELETE CASCADE,
  client_package_id  uuid REFERENCES public.smartcore_flexi_client_packages(id) ON DELETE SET NULL,
  amount_pence       integer NOT NULL,
  currency           text NOT NULL DEFAULT 'GBP',
  method             text NOT NULL DEFAULT 'card' CHECK (method IN ('card', 'cash', 'bank_transfer', 'other')),
  status             text NOT NULL DEFAULT 'paid' CHECK (status IN ('paid', 'pending', 'failed', 'refunded')),
  stripe_payment_id  text,
  note               text,
  recorded_by        uuid REFERENCES public.core_employees(id) ON DELETE SET NULL,
  created_at         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS smartcore_flexi_payments_client_idx ON public.smartcore_flexi_payments(client_id, created_at DESC);
CREATE INDEX IF NOT EXISTS smartcore_flexi_payments_company_idx ON public.smartcore_flexi_payments(company_id, created_at DESC);

ALTER TABLE public.smartcore_flexi_payments ENABLE ROW LEVEL SECURITY;

CREATE POLICY smartcore_flexi_payments_staff ON public.smartcore_flexi_payments
  FOR ALL USING (public.flexi_has_permission(company_id, 'flexi.manage_packages'))
  WITH CHECK (public.flexi_has_permission(company_id, 'flexi.manage_packages'));

CREATE POLICY smartcore_flexi_payments_client_read ON public.smartcore_flexi_payments
  FOR SELECT USING (client_id = public.flexi_current_client_id());
