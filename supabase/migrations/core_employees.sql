-- SmartCore Core — Employee Management Tables
-- Run once per environment

CREATE TABLE IF NOT EXISTS core_departments (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  company_id UUID NOT NULL,
  name TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS core_shift_patterns (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  company_id UUID NOT NULL,
  name TEXT NOT NULL,
  schedule JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS core_employees (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  company_id UUID NOT NULL,
  employee_id TEXT UNIQUE NOT NULL,
  full_name TEXT NOT NULL,
  job_title TEXT,
  department_id UUID REFERENCES core_departments(id),
  work_email TEXT,
  personal_email TEXT,
  personal_phone TEXT,
  employment_type TEXT DEFAULT 'full_time',
  employment_type_custom TEXT,
  notice_period TEXT,
  role TEXT DEFAULT 'employee',
  annual_leave_allowance INTEGER DEFAULT 28,
  executive_allowance_override NUMERIC(4,1),
  start_date DATE,
  shift_pattern_id UUID REFERENCES core_shift_patterns(id),
  auth_user_id UUID,
  onboarding_completed BOOLEAN DEFAULT false,
  title TEXT,
  preferred_name TEXT,
  pronouns TEXT,
  date_of_birth DATE,
  national_insurance TEXT,
  bank_account_number TEXT,
  bank_sort_code TEXT,
  bank_account_name TEXT,
  address_line_1 TEXT,
  address_line_2 TEXT,
  city TEXT,
  county TEXT,
  postcode TEXT,
  country TEXT DEFAULT 'United Kingdom',
  emergency_contact_1_name TEXT,
  emergency_contact_1_relationship TEXT,
  emergency_contact_1_email TEXT,
  emergency_contact_1_phone TEXT,
  emergency_contact_2_name TEXT,
  emergency_contact_2_relationship TEXT,
  emergency_contact_2_email TEXT,
  emergency_contact_2_phone TEXT,
  student_loan_status TEXT,
  tax_code TEXT,
  gender TEXT,
  dietary_requirements TEXT,
  accessibility_needs TEXT,
  country_code TEXT DEFAULT '+44',
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS core_employee_authorizers (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  employee_id UUID REFERENCES core_employees(id) ON DELETE CASCADE,
  authorizer_employee_id UUID REFERENCES core_employees(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(employee_id, authorizer_employee_id)
);

CREATE TABLE IF NOT EXISTS core_onboarding_tokens (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  employee_id UUID REFERENCES core_employees(id) ON DELETE CASCADE,
  token TEXT UNIQUE NOT NULL,
  email TEXT NOT NULL,
  expires_at TIMESTAMPTZ DEFAULT (now() + interval '7 days'),
  used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS core_onboarding_config (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  company_id UUID UNIQUE NOT NULL,
  required_fields JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);
