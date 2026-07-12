// POST /api/presence-fire-safety/export-csv
// Generates a CSV export for one of the module's report types. This has to
// be a server-side endpoint because supabase-js in the browser has no way
// to stream/assemble a downloadable text/csv attachment with a
// Content-Disposition header — the report ROWS themselves are still fetched
// with the caller's OWN bearer token (so RLS naturally scopes them to the
// caller's company/site/permissions exactly as it would in the browser);
// only the metadata (company/site display names for the header block) uses
// the service-role key, since those are simple name lookups, not the
// authorised data set itself.
import { json, options, getCallerProfile, hasPermission, selectAsUser, sb } from './_auth.js';

export const onRequestOptions = () => options();

const REPORT_TYPES = ['live_register', 'presence_history', 'visitor_history', 'contractor_history', 'evacuation_history'];
const MAX_ROWS = 10000;

function csvEscape(value) {
  if (value === null || value === undefined) return '';
  const s = String(value);
  if (/[",\n\r]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

function csvRow(values) {
  return values.map(csvEscape).join(',') + '\r\n';
}

function fmt(dt) {
  if (!dt) return '';
  return dt;
}

async function fetchSiteName(env, companyId, siteId) {
  if (!siteId) return 'All accessible sites';
  const res = await sb(env, `/sites?id=eq.${siteId}&company_id=eq.${companyId}&select=name&limit=1`);
  const [site] = await res.json();
  return site?.name || siteId;
}

async function fetchCompanyName(env, companyId) {
  const res = await sb(env, `/smartcore_core_companies?id=eq.${companyId}&select=company_name&limit=1`);
  const [company] = await res.json();
  return company?.company_name || companyId;
}

function buildQuery({ reportType, companyId, siteId, from, to, departmentId }) {
  const params = [`company_id=eq.${companyId}`];
  let table;
  let select;
  let dateColumn;

  switch (reportType) {
    case 'live_register':
      table = 'presence_fire_safety_current_presence';
      select = 'id,subject_type,current_status,last_seen_at,site_id,sites(name),' +
        'core_employees(full_name,employee_id,job_title,core_departments(name)),' +
        'presence_fire_safety_visitor_visits(host_employee_id,presence_fire_safety_visitors(first_name,last_name,organisation)),' +
        'presence_fire_safety_contractor_visits(host_employee_id,presence_fire_safety_contractors(business_name,contact_name))';
      params.push('current_status=eq.in');
      dateColumn = null;
      break;
    case 'presence_history':
      table = 'presence_fire_safety_events';
      select = 'id,subject_type,direction,method,occurred_at,site_id,sites(name),' +
        'employee_id,core_employees(full_name,employee_id,department_id,core_departments(name)),notes';
      dateColumn = 'occurred_at';
      if (departmentId) {
        // Force an inner join so the embedded-resource filter actually restricts rows.
        select = select.replace('core_employees(', 'core_employees!inner(');
        params.push(`core_employees.department_id=eq.${departmentId}`);
      }
      break;
    case 'visitor_history':
      table = 'presence_fire_safety_visitor_visits';
      select = 'id,visit_reason,signed_in_at,signed_out_at,status,site_id,sites(name),' +
        'host_employee_id,core_employees(full_name),' +
        'presence_fire_safety_visitors(first_name,last_name,organisation,phone)';
      dateColumn = 'created_at';
      break;
    case 'contractor_history':
      table = 'presence_fire_safety_contractor_visits';
      select = 'id,work_purpose,permit_reference,signed_in_at,signed_out_at,status,site_id,sites(name),' +
        'host_employee_id,core_employees(full_name),' +
        'presence_fire_safety_contractors(business_name,contact_name,phone)';
      dateColumn = 'created_at';
      break;
    case 'evacuation_history':
      table = 'presence_fire_safety_evacuation_sessions';
      select = 'id,started_at,completed_at,status,assembly_point,snapshot_count,safe_count,missing_count,unaccounted_count,site_id,sites(name)';
      dateColumn = 'started_at';
      break;
    default:
      throw new Error('Unknown report_type');
  }

  if (siteId) params.push(`site_id=eq.${siteId}`);
  if (dateColumn && from) params.push(`${dateColumn}=gte.${encodeURIComponent(from)}`);
  if (dateColumn && to) params.push(`${dateColumn}=lte.${encodeURIComponent(to)}`);

  const orderCol = dateColumn || 'last_seen_at';
  params.push(`order=${orderCol}.desc`);
  params.push(`limit=${MAX_ROWS}`);
  params.push(`select=${select}`);

  return `/${table}?${params.join('&')}`;
}

function rowToCsv(reportType, row) {
  switch (reportType) {
    case 'live_register': {
      const who = row.subject_type === 'employee'
        ? row.core_employees?.full_name
        : row.subject_type === 'visitor'
          ? [row.presence_fire_safety_visitor_visits?.presence_fire_safety_visitors?.first_name, row.presence_fire_safety_visitor_visits?.presence_fire_safety_visitors?.last_name].filter(Boolean).join(' ')
          : row.presence_fire_safety_contractor_visits?.presence_fire_safety_contractors?.business_name;
      const org = row.subject_type === 'visitor'
        ? row.presence_fire_safety_visitor_visits?.presence_fire_safety_visitors?.organisation
        : row.subject_type === 'contractor'
          ? row.presence_fire_safety_contractor_visits?.presence_fire_safety_contractors?.contact_name
          : row.core_employees?.job_title;
      return [row.subject_type, who || '', row.core_employees?.employee_id || '', org || '',
        row.core_employees?.core_departments?.name || '', row.sites?.name || '', row.current_status, fmt(row.last_seen_at)];
    }
    case 'presence_history':
      return [row.subject_type, row.core_employees?.full_name || '', row.core_employees?.employee_id || '',
        row.core_employees?.core_departments?.name || '', row.sites?.name || '', row.direction, row.method,
        fmt(row.occurred_at), row.notes || ''];
    case 'visitor_history': {
      const v = row.presence_fire_safety_visitors || {};
      return [[v.first_name, v.last_name].filter(Boolean).join(' '), v.organisation || '', v.phone || '',
        row.core_employees?.full_name || '', row.visit_reason || '', row.sites?.name || '', row.status,
        fmt(row.signed_in_at), fmt(row.signed_out_at)];
    }
    case 'contractor_history': {
      const c = row.presence_fire_safety_contractors || {};
      return [c.business_name || '', c.contact_name || '', c.phone || '', row.core_employees?.full_name || '',
        row.work_purpose || '', row.permit_reference || '', row.sites?.name || '', row.status,
        fmt(row.signed_in_at), fmt(row.signed_out_at)];
    }
    case 'evacuation_history':
      return [row.sites?.name || '', row.status, fmt(row.started_at), fmt(row.completed_at), row.assembly_point || '',
        row.snapshot_count, row.safe_count, row.missing_count, row.unaccounted_count];
    default:
      return [];
  }
}

const HEADERS = {
  live_register: ['Type', 'Name', 'Employee ID', 'Organisation/Role', 'Department', 'Site', 'Status', 'Last seen'],
  presence_history: ['Type', 'Name', 'Employee ID', 'Department', 'Site', 'Direction', 'Method', 'Occurred at', 'Notes'],
  visitor_history: ['Name', 'Organisation', 'Phone', 'Host', 'Visit reason', 'Site', 'Status', 'Signed in', 'Signed out'],
  contractor_history: ['Business', 'Contact', 'Phone', 'Host', 'Work purpose', 'Permit reference', 'Site', 'Status', 'Signed in', 'Signed out'],
  evacuation_history: ['Site', 'Status', 'Started at', 'Completed at', 'Assembly point', 'Snapshot count', 'Safe', 'Missing', 'Unaccounted'],
};

export async function onRequestPost({ request, env }) {
  try {
    const profile = await getCallerProfile(request, env);
    if (!profile) return json({ error: 'Unauthorized' }, 401);

    const allowed = await hasPermission(env, profile.token, profile.company_id, 'presence.export_reports');
    if (!allowed) return json({ error: 'Missing permission: presence.export_reports' }, 403);

    const body = await request.json().catch(() => ({}));
    const reportType = body.report_type;
    if (!REPORT_TYPES.includes(reportType)) {
      return json({ error: `report_type must be one of: ${REPORT_TYPES.join(', ')}` }, 400);
    }
    const { site_id: siteId, from, to, department_id: departmentId } = body;

    const path = buildQuery({ reportType, companyId: profile.company_id, siteId, from, to, departmentId });

    // The report rows themselves are fetched with the CALLER'S OWN token so
    // RLS scopes them exactly as it would for a direct supabase-js call —
    // no service-role bypass of row-level security for the actual data.
    const rows = await selectAsUser(env, profile.token, path);

    const [companyName, siteName] = await Promise.all([
      fetchCompanyName(env, profile.company_id),
      fetchSiteName(env, profile.company_id, siteId),
    ]);

    const filterParts = [];
    if (from) filterParts.push(`from ${from}`);
    if (to) filterParts.push(`to ${to}`);
    if (departmentId) filterParts.push(`department ${departmentId}`);

    let csv = '';
    csv += csvRow([`# Presence & Fire Safety export: ${reportType}`]);
    csv += csvRow([`# Generated at: ${new Date().toISOString()}`]);
    csv += csvRow([`# Company: ${companyName}`]);
    csv += csvRow([`# Site: ${siteName}`]);
    csv += csvRow([`# Filters applied: ${filterParts.length ? filterParts.join('; ') : 'none'}`]);
    csv += csvRow([`# Exported by: ${profile.full_name || profile.auth_email || profile.id}`]);
    csv += csvRow([]);
    csv += csvRow(HEADERS[reportType]);
    for (const row of rows || []) {
      csv += csvRow(rowToCsv(reportType, row));
    }

    // Best-effort audit trail entry — never block the download on this.
    sb(env, '/presence_fire_safety_audit_logs', 'POST', {
      company_id: profile.company_id,
      site_id: siteId || null,
      actor_employee_id: profile.id,
      action: 'report_exported',
      entity_type: reportType,
      new_values: { row_count: (rows || []).length, filters: { site_id: siteId, from, to, department_id: departmentId } },
    }).catch(() => {});

    const filename = `presence-fire-safety-${reportType}-${new Date().toISOString().slice(0, 10)}.csv`;
    return new Response(csv, {
      status: 200,
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      },
    });
  } catch (e) {
    return json({ error: e.message || 'Could not generate export' }, 500);
  }
}
