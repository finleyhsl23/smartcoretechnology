export async function onRequestPost(context) {
  try {
    const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = context.env;

    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
      return json({ error: 'Missing Supabase environment variables.' }, 500);
    }

    const body = await context.request.json().catch(() => ({}));
    const employeeId = body.employee_id;

    if (!employeeId) {
      return json({ error: 'Missing employee_id.' }, 400);
    }

    const headers = {
      apikey: SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      'Content-Type': 'application/json'
    };

    // 1. Get employee so we can find the linked auth.users id
    const employeeRes = await fetch(
      `${SUPABASE_URL}/rest/v1/employees?id=eq.${encodeURIComponent(employeeId)}&select=id,user_id&limit=1`,
      {
        method: 'GET',
        headers: {
          ...headers,
          Accept: 'application/json',
          'Content-Profile': 'smartfitsinstallationsltd'
        }
      }
    );

    const employees = await employeeRes.json().catch(() => []);

    if (!employeeRes.ok) {
      return json({ error: 'Could not find employee.', details: employees }, 500);
    }

    const employee = employees?.[0];

    if (!employee) {
      return json({ error: 'Employee not found.' }, 404);
    }

    // 2. Delete employee row
    const deleteEmployeeRes = await fetch(
      `${SUPABASE_URL}/rest/v1/employees?id=eq.${encodeURIComponent(employeeId)}`,
      {
        method: 'DELETE',
        headers: {
          ...headers,
          'Content-Profile': 'smartfitsinstallationsltd',
          Prefer: 'return=minimal'
        }
      }
    );

    if (!deleteEmployeeRes.ok) {
      const err = await deleteEmployeeRes.text();
      return json({ error: 'Could not delete employee row.', details: err }, 500);
    }

    // 3. Delete auth user if linked
    if (employee.user_id) {
      const deleteAuthRes = await fetch(
        `${SUPABASE_URL}/auth/v1/admin/users/${employee.user_id}`,
        {
          method: 'DELETE',
          headers
        }
      );

      if (!deleteAuthRes.ok) {
        const err = await deleteAuthRes.text();

        return json({
          success: true,
          employee_deleted: true,
          auth_user_deleted: false,
          warning: 'Employee was deleted, but auth user could not be deleted.',
          details: err
        });
      }
    }

    return json({
      success: true,
      employee_deleted: true,
      auth_user_deleted: Boolean(employee.user_id)
    });
  } catch (error) {
    return json({ error: error.message || 'Delete failed.' }, 500);
  }
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json'
    }
  });
}
