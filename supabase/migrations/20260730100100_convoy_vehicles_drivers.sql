-- ============================================================================
-- SmartCore Convoy — Migration 2: Vehicles, depot geofence, driver licences
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.convoy_vehicles (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id            uuid NOT NULL REFERENCES public.smartcore_core_companies(id) ON DELETE CASCADE,
  registration          text NOT NULL,
  make                  text,
  model                 text,
  vehicle_type          text NOT NULL DEFAULT 'van' CHECK (vehicle_type IN ('car','van','minibus','hgv','plant','other')),
  status                text NOT NULL DEFAULT 'active' CHECK (status IN ('active','vor','retired')),
  assigned_driver_id    uuid REFERENCES public.core_employees(id) ON DELETE SET NULL,
  current_mileage       integer,
  -- Depot/home location + geofence tolerance used to flag checks performed
  -- somewhere implausible for this vehicle. NULL location = no geofence check.
  depot_latitude        numeric(9,6),
  depot_longitude       numeric(9,6),
  geofence_radius_m     integer,
  mot_due               date,
  tax_due               date,
  insurance_due         date,
  service_due           date,
  photo_storage_path    text,
  notes                 text,
  created_by            uuid REFERENCES public.core_employees(id) ON DELETE SET NULL,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  UNIQUE(company_id, registration)
);
CREATE INDEX IF NOT EXISTS convoy_vehicles_company_idx ON public.convoy_vehicles(company_id);
CREATE INDEX IF NOT EXISTS convoy_vehicles_driver_idx ON public.convoy_vehicles(assigned_driver_id);

DROP TRIGGER IF EXISTS convoy_vehicles_set_updated_at ON public.convoy_vehicles;
CREATE TRIGGER convoy_vehicles_set_updated_at BEFORE UPDATE ON public.convoy_vehicles
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.convoy_vehicles ENABLE ROW LEVEL SECURITY;

CREATE POLICY convoy_vehicles_select ON public.convoy_vehicles
  FOR SELECT USING (public.convoy_has_permission(company_id, 'convoy.view_vehicles'));

CREATE POLICY convoy_vehicles_write ON public.convoy_vehicles
  FOR ALL USING (public.convoy_has_permission(company_id, 'convoy.manage_vehicles'))
  WITH CHECK (public.convoy_has_permission(company_id, 'convoy.manage_vehicles'));

-- ----------------------------------------------------------------------------
-- Driver licence checks
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.convoy_driver_licences (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id         uuid NOT NULL REFERENCES public.smartcore_core_companies(id) ON DELETE CASCADE,
  employee_id        uuid NOT NULL REFERENCES public.core_employees(id) ON DELETE CASCADE,
  licence_number     text,
  licence_categories text[] NOT NULL DEFAULT '{}',
  points             integer NOT NULL DEFAULT 0,
  expiry_date        date,
  last_checked_at    timestamptz,
  last_checked_by    uuid REFERENCES public.core_employees(id) ON DELETE SET NULL,
  notes              text,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  UNIQUE(company_id, employee_id)
);
CREATE INDEX IF NOT EXISTS convoy_driver_licences_company_idx ON public.convoy_driver_licences(company_id);

DROP TRIGGER IF EXISTS convoy_driver_licences_set_updated_at ON public.convoy_driver_licences;
CREATE TRIGGER convoy_driver_licences_set_updated_at BEFORE UPDATE ON public.convoy_driver_licences
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.convoy_driver_licences ENABLE ROW LEVEL SECURITY;

CREATE POLICY convoy_driver_licences_select ON public.convoy_driver_licences
  FOR SELECT USING (
    public.convoy_has_permission(company_id, 'convoy.manage_drivers')
    OR employee_id = public.convoy_current_employee_id(company_id)
  );

CREATE POLICY convoy_driver_licences_write ON public.convoy_driver_licences
  FOR ALL USING (public.convoy_has_permission(company_id, 'convoy.manage_drivers'))
  WITH CHECK (public.convoy_has_permission(company_id, 'convoy.manage_drivers'));
