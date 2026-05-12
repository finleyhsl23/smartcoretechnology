export async function onRequestPost(context) {
  try {
    const { request, env } = context;
    const body = await request.json();

    const employeeId = body.employee_id;

    if (!employeeId) {
      return Response.json(
        { error: 'Missing employee_id.' },
        { status: 400 }
      );
    }

    if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
      return Response.json(
        { error: 'Supabase service credentials are missing.' },
        { status: 500 }
      );
    }

    const headers = {
      apikey: env.SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation'
    };

    const findResponse = await fetch(
      `${env.SUPABASE_URL}/rest/v1/employees?id=eq.${employeeId}&select=id,user_id,full_name_enc`,
      {
        method: 'GET',
        headers: {
          ...headers,
          Accept: 'application/json',
          'Accept-Profile': 'smartfitsinstallationsltd'
        }
      }
    );

    const found = await findResponse.json().catch(() => []);

    if (!findResponse.ok) {
      return Response.json(
        { error: 'Employee lookup failed.', details: found },
        { status: findResponse.status }
      );
    }

    const employee = Array.isArray(found) ? found[0] : null;

    if (!employee) {
      return Response.json(
        { error: 'Could not find employee.', employee_id: employeeId },
        { status: 404 }
      );
    }

    const deleteEmployeeResponse = await fetch(
      `${env.SUPABASE_URL}/rest/v1/employees?id=eq.${employeeId}`,
      {
        method: 'DELETE',
        headers: {
          ...headers,
          'Content-Profile': 'smartfitsinstallationsltd',
          'Accept-Profile': 'smartfitsinstallationsltd'
        }
      }
    );

    const deleteEmployeeResult = await deleteEmployeeResponse.text();

    if (!deleteEmployeeResponse.ok) {
      return Response.json(
        { error: 'Employee record could not be deleted.', details: deleteEmployeeResult },
        { status: deleteEmployeeResponse.status }
      );
    }

    if (employee.user_id) {
      const deleteAuthResponse = await fetch(
        `${env.SUPABASE_URL}/auth/v1/admin/users/${employee.user_id}`,
        {
          method: 'DELETE',
          headers: {
            apikey: env.SUPABASE_SERVICE_ROLE_KEY,
            Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`
          }
        }
      );

      const deleteAuthResult = await deleteAuthResponse.json().catch(() => ({}));

      if (!deleteAuthResponse.ok) {
        return Response.json(
          {
            ok: true,
            warning: 'Employee was deleted, but auth user could not be deleted.',
            auth_error: deleteAuthResult
          },
          { status: 200 }
        );
      }
    }

    return Response.json({
      ok: true,
      deleted_employee_id: employeeId,
      deleted_auth_user_id: employee.user_id || null
    });
  } catch (error) {
    return Response.json(
      { error: error.message || 'Employee could not be deleted.' },
      { status: 500 }
    );
  }
}
