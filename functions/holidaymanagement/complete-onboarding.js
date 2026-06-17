const SCHEMA = 'holidaymanagement';

function db(supabaseUrl, serviceKey) {
  const base = `${supabaseUrl}/rest/v1`;
  const h = {
    'apikey': serviceKey,
    'Authorization': `Bearer ${serviceKey}`,
    'Content-Type': 'application/json',
    'Accept-Profile': SCHEMA,
    'Content-Profile': SCHEMA,
    'Prefer': 'return=representation'
  };
  return {
    async select(table, query = '') {
      const res = await fetch(`${base}/${table}?${query}`, { headers: h });
      const text = await res.text();
      if (!res.ok) throw new Error(text);
      return JSON.parse(text);
    },
    async update(table, query, data) {
      const res = await fetch(`${base}/${table}?${query}`, {
        method: 'PATCH', headers: h,
        body: JSON.stringify(data)
      });
      const text = await res.text();
      if (!res.ok) throw new Error(text);
      return text ? JSON.parse(text) : [];
    }
  };
}

export async function onRequestPost({ request, env }) {
  const { SUPABASE_URL, SUPABASE_SERVICE_KEY } = env;
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) return new Response('Missing environment variables', { status: 500 });

  let body;
  try { body = await request.json(); }
  catch { return new Response('Invalid JSON', { status: 400 }); }

  const {
    token, user_id,
    // Personal
    title, full_name, preferred_name, pronouns, gender,
    personal_email, personal_phone_country_code, personal_phone_number,
    date_of_birth,
    national_insurance_number,
    // Address
    address_line_1, address_line_2, city, county, postcode, country,
    // Emergency 1
    emergency_contact_1_name, emergency_contact_1_relationship,
    emergency_contact_1_email, emergency_contact_1_phone,
    // Emergency 2
    emergency_contact_2_name, emergency_contact_2_relationship,
    emergency_contact_2_email, emergency_contact_2_phone,
    // Financial / employment
    student_loan_status, tax_code,
    bank_account_name, bank_account_sort_code, bank_account_number,
    dietary_requirements, accessibility_needs
  } = body;

  if (!token || !user_id) return new Response('token and user_id are required', { status: 400 });

  const client = db(SUPABASE_URL, SUPABASE_SERVICE_KEY);

  // Verify token
  const invites = await client.select('onboarding_invites', `token=eq.${token}&used_at=is.null`);
  const invite = invites?.[0];

  if (!invite) return new Response('Invalid or expired invite token', { status: 400 });
  if (invite.expires_at && new Date(invite.expires_at) < new Date()) {
    return new Response('Invite token has expired', { status: 400 });
  }

  const personal_phone = personal_phone_country_code && personal_phone_number
    ? `${personal_phone_country_code}${personal_phone_number}`
    : (personal_phone_number || null);

  // Update employee record with all profile data
  await client.update(
    'employees',
    `company_id=eq.${invite.company_id}&work_email=eq.${encodeURIComponent(invite.email)}`,
    {
      user_id,
      title: title || null,
      full_name: full_name || invite.full_name || null,
      preferred_name: preferred_name || null,
      pronouns: pronouns || null,
      gender: gender || null,
      personal_email: personal_email || null,
      personal_phone: personal_phone || null,
      dob: date_of_birth || null,
      national_insurance_number: national_insurance_number || null,
      address_line_1: address_line_1 || null,
      address_line_2: address_line_2 || null,
      city: city || null,
      county: county || null,
      postcode: postcode || null,
      country: country || 'United Kingdom',
      emergency_contact_1_name: emergency_contact_1_name || null,
      emergency_contact_1_relationship: emergency_contact_1_relationship || null,
      emergency_contact_1_email: emergency_contact_1_email || null,
      emergency_contact_1_phone: emergency_contact_1_phone || null,
      emergency_contact_2_name: emergency_contact_2_name || null,
      emergency_contact_2_relationship: emergency_contact_2_relationship || null,
      emergency_contact_2_email: emergency_contact_2_email || null,
      emergency_contact_2_phone: emergency_contact_2_phone || null,
      student_loan_status: student_loan_status || null,
      tax_code: tax_code || null,
      bank_account_name: bank_account_name || null,
      bank_account_sort_code: bank_account_sort_code || null,
      bank_account_number: bank_account_number || null,
      dietary_requirements: dietary_requirements || null,
      accessibility_needs: accessibility_needs || null,
      employment_status: 'active',
      onboarding_status: 'completed',
      first_login_at: new Date().toISOString(),
      profile_updated_at: new Date().toISOString()
    }
  );

  // Mark invite as used
  await client.update(
    'onboarding_invites',
    `token=eq.${token}`,
    { used_at: new Date().toISOString(), used_by: user_id }
  );

  return Response.json({ success: true });
}
