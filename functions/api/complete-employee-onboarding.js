export async function onRequestPost(context) {
  try {
    const { request, env } = context;
    const body = await request.json();

    const {
      token,
      personal_email,
      password,
      employee_name,
      payload
    } = body;

    if (!token || !personal_email || !password || !payload) {
      return Response.json(
        { error: 'Missing onboarding details.' },
        { status: 400 }
      );
    }

    if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
      return Response.json(
        { error: 'Supabase service credentials are missing in Cloudflare.' },
        { status: 500 }
      );
    }

    const createUserResponse = await fetch(`${env.SUPABASE_URL}/auth/v1/admin/users`, {
      method: 'POST',
      headers: {
        apikey: env.SUPABASE_SERVICE_ROLE_KEY,
        Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        email: personal_email,
        password,
        email_confirm: true,
        user_metadata: {
          full_name: employee_name || '',
          source: 'smartfits_onboarding'
        }
      })
    });

    const userResult = await createUserResponse.json();

    if (!createUserResponse.ok) {
      return Response.json(
        { error: userResult.msg || userResult.message || 'Could not create login user.', details: userResult },
        { status: createUserResponse.status }
      );
    }

    const userId = userResult.id;

    const completeResponse = await fetch(`${env.SUPABASE_URL}/rest/v1/rpc/complete_employee_onboarding_with_user`, {
      method: 'POST',
      headers: {
        apikey: env.SUPABASE_SERVICE_ROLE_KEY,
        Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        invite_token: token,
        auth_user_id: userId,
        payload
      })
    });

    const completeResult = await completeResponse.json().catch(() => ({}));

    if (!completeResponse.ok) {
      return Response.json(
        { error: completeResult.message || 'Employee record could not be linked.', details: completeResult },
        { status: completeResponse.status }
      );
    }

    return Response.json({
      ok: true,
      user_id: userId
    });
  } catch (error) {
    return Response.json(
      { error: error.message || 'Unable to complete onboarding.' },
      { status: 500 }
    );
  }
}
