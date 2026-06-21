import { json, options, getCallerProfile, sbGet, sbPost, sbPatch } from './_auth.js';

export const onRequestOptions = () => options();

// Map all fields from smartcore_core_employees signup record → core_employees HR record
function buildOwnerPayload(p, company = {}) {
  const firstName = p.first_name?.trim() || '';
  const lastName = p.last_name?.trim() || '';
  const fullName = [firstName, lastName].filter(Boolean).join(' ')
    || p.auth_email || company.company_email || 'Owner';

  const rawPhone = p.mobile_number?.trim() || '';
  const phone = /^\+\d+\s*$/.test(rawPhone) ? null : rawPhone || company.company_phone || null;

  return {
    full_name:                       fullName,
    work_email:                      p.email || p.auth_email || company.company_email || null,
    personal_email:                  p.personal_email || null,
    personal_phone:                  phone,
    job_title:                       p.job_title || null,
    start_date:                      p.start_date || null,
    date_of_birth:                   p.date_of_birth || null,
    gender:                          p.gender || null,
    pronouns:                        p.pronouns || null,
    address_line_1:                  p.address_line_1 || null,
    address_line_2:                  p.address_line_2 || null,
    city:                            p.city || null,
    county:                          p.county || null,
    postcode:                        p.postcode || null,
    country:                         p.country || null,
    emergency_contact_1_name:        p.emergency_contact || null,
    emergency_contact_1_phone:       p.emergency_contact_number || null,
    emergency_contact_1_relationship:p.emergency_contact_relationship || null,
    emergency_contact_2_name:        p.emergency_contact_2_name || null,
    emergency_contact_2_phone:       p.emergency_contact_2_phone || null,
    emergency_contact_2_relationship:p.emergency_contact_2_relationship || null,
    national_insurance:              p.national_insurance || null,
    tax_code:                        p.tax_code || null,
    student_loan_status:             p.student_loan_status || null,
    bank_account_name:               p.bank_account_name || null,
    bank_sort_code:                  p.bank_sort_code || null,
    bank_account_number:             p.bank_account_number || null,
    dietary_requirements:            p.dietary_requirements || null,
    accessibility_needs:             p.accessibility_needs || null,
    role:                            p.role || 'owner',
    onboarding_completed:            true,
  };
}

export async function onRequestGet(context) {
  const { request, env } = context;
  try {
    const profile = await getCallerProfile(request, env);
    if (!profile) return json({ error: 'Unauthorised' }, 401);

    // Ensure the caller has a core_employees record (owners who signed up may not have one)
    if (profile.auth_id) {
      const [existing, companyRes] = await Promise.all([
        sbGet(env, `/core_employees?auth_user_id=eq.${profile.auth_id}&company_id=eq.${profile.company_id}&limit=1`),
        sbGet(env, `/smartcore_core_companies?id=eq.${profile.company_id}&select=company_name,company_email,company_phone&limit=1`),
      ]);
      const company = companyRes?.[0] || {};
      const payload = buildOwnerPayload(profile, company);

      if (!existing?.length) {
        // No HR record at all — create one from signup data
        const prefix = (company.company_name || 'EMP').replace(/[^A-Za-z]/g, '').slice(0, 3).toUpperCase().padEnd(3, 'X');
        const employee_id = `${prefix}${String(Math.floor(Math.random() * 1e9)).padStart(9, '0')}`;
        await sbPost(env, '/core_employees', {
          company_id: profile.company_id,
          auth_user_id: profile.auth_id,
          employee_id,
          ...payload,
        });
      } else {
        // Record exists — fill in any null fields from signup data (non-destructive sync)
        const rec = existing[0];
        const updates = {};
        for (const [k, v] of Object.entries(payload)) {
          if (v !== null && v !== undefined && (rec[k] === null || rec[k] === undefined || rec[k] === '' || rec[k] === 'Owner')) {
            updates[k] = v;
          }
        }
        if (Object.keys(updates).length) {
          await sbPatch(env, `/core_employees?auth_user_id=eq.${profile.auth_id}&company_id=eq.${profile.company_id}`, updates);
        }
      }
    }

    const [employees, departments, shiftPatterns, authorizers] = await Promise.all([
      sbGet(env, `/core_employees?company_id=eq.${profile.company_id}&order=full_name.asc`),
      sbGet(env, `/core_departments?company_id=eq.${profile.company_id}&order=name.asc`),
      sbGet(env, `/core_shift_patterns?company_id=eq.${profile.company_id}&order=name.asc`),
      sbGet(env, `/core_employee_authorizers?select=*,authorizer:authorizer_employee_id(id,full_name,role)`),
    ]);

    const deptMap = Object.fromEntries((departments || []).map(d => [d.id, d]));
    const shiftMap = Object.fromEntries((shiftPatterns || []).map(s => [s.id, s]));
    const authMap = {};
    for (const a of (authorizers || [])) {
      if (!authMap[a.employee_id]) authMap[a.employee_id] = [];
      authMap[a.employee_id].push(a.authorizer);
    }

    const enriched = (employees || []).map(e => ({
      ...e,
      department: e.department_id ? deptMap[e.department_id] : null,
      shift_pattern: e.shift_pattern_id ? shiftMap[e.shift_pattern_id] : null,
      authorizers: authMap[e.id] || [],
    }));

    return json(enriched);
  } catch (e) {
    return json({ error: e.message }, 500);
  }
}
