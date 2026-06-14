// SmartCore Holiday Management — Configuration
// IMPORTANT: Only the anon (public) key goes here. Never the service role key.

const SUPABASE_URL = 'https://hjdpcfhozhoyeqevnupm.supabase.co';

// Paste your anon/public key here from: Supabase Dashboard → Settings → API → anon public
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhqZHBjZmhvemhveWVxZXZudXBtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjY5MTk3MzYsImV4cCI6MjA4MjQ5NTczNn0.BXosJO4NmEZOe73GXSGPa3z-i_4ZzF9zBAMBIf6Mkts';

const HM_SCHEMA = 'holidaymanagement';

// Base path for the app
const APP_BASE = '/systems/holidaymanagement';

// Department colours for calendar
const DEPT_COLOURS = {
  'Engineering':  '#3b82f6',
  'Accounts':     '#22c55e',
  'HR':           '#a855f7',
  'Management':   '#f59e0b',
  'IT':           '#06b6d4',
  'Sales':        '#ec4899',
  'Operations':   '#ef4444',
  'Finance':      '#8b5cf6',
  'Marketing':    '#14b8a6',
  'Logistics':    '#f97316',
};
const DEPT_COLOUR_PALETTE = [
  '#3b82f6','#22c55e','#a855f7','#f59e0b','#06b6d4',
  '#ec4899','#ef4444','#8b5cf6','#14b8a6','#f97316',
  '#84cc16','#e879f9','#fb7185','#34d399','#60a5fa',
];

function getDeptColour(dept) {
  if (!dept) return '#6366f1';
  if (DEPT_COLOURS[dept]) return DEPT_COLOURS[dept];
  // Deterministic colour from name hash
  let hash = 0;
  for (let i = 0; i < dept.length; i++) hash = dept.charCodeAt(i) + ((hash << 5) - hash);
  return DEPT_COLOUR_PALETTE[Math.abs(hash) % DEPT_COLOUR_PALETTE.length];
}

// Supabase client (schema-aware)
let _supabase = null;
function getSupabase() {
  if (!_supabase) {
    _supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      db: { schema: HM_SCHEMA },
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
      },
    });
  }
  return _supabase;
}

// Cloudflare Functions base URL (same origin on Pages)
const API_BASE = '/api';

// Leave type labels
const LEAVE_TYPES = {
  annual:    'Annual Leave',
  sick:      'Sick Leave',
  unpaid:    'Unpaid Leave',
  compassionate: 'Compassionate Leave',
  maternity: 'Maternity Leave',
  paternity: 'Paternity Leave',
  other:     'Other',
};

// Day type labels
const DAY_TYPES = {
  full:     'Full Day',
  half_am:  'Half Day (AM)',
  half_pm:  'Half Day (PM)',
};

// Status colours
const STATUS_BADGE = {
  pending:   'badge-warning',
  approved:  'badge-success',
  rejected:  'badge-danger',
  cancelled: 'badge-muted',
  cancellation_requested: 'badge-info',
};

// UK Bank Holiday regions
const BH_REGIONS = [
  { value: 'england-and-wales', label: 'England & Wales' },
  { value: 'scotland',          label: 'Scotland' },
  { value: 'northern-ireland',  label: 'Northern Ireland' },
];

// Employment types
const EMPLOYMENT_TYPES = ['Full Time','Part Time','Fixed Term','Zero Hours','Contractor','Apprentice'];

// Notice periods
const NOTICE_PERIODS = ['1 Week','2 Weeks','1 Month','3 Months','6 Months'];

// Months
const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];
