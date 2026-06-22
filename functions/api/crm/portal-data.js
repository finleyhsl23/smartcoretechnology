import { verifyJWT } from "./_portal_crypto.js";

export async function onRequest(context) {
  try {
    const SUPABASE_URL = context.env.SUPABASE_URL;
    const SERVICE_ROLE = context.env.SUPABASE_SERVICE_ROLE;
    const JWT_SECRET   = context.env.PORTAL_JWT_SECRET || "smartcore-portal-default-secret-change-me";

    // Verify JWT from Authorization header
    const auth = context.request.headers.get("Authorization") || "";
    const token = auth.replace(/^Bearer\s+/i, "");
    const claims = await verifyJWT(token, JWT_SECRET);
    if (!claims) return json({ ok: false, error: "Unauthorized" }, 401);

    const { sub: portalUserId, tid: tenantId } = claims;
    const url = new URL(context.request.url);
    const section = url.searchParams.get("section");

    const headers = {
      apikey: SERVICE_ROLE,
      Authorization: `Bearer ${SERVICE_ROLE}`,
      "Content-Type": "application/json",
    };

    const db = (path) => fetch(`${SUPABASE_URL}/rest/v1/${path}`, { headers }).then(r => r.json());

    // Portal user profile
    const userRows = await db(`crm_portal_users?id=eq.${portalUserId}&select=id,email,name,status,crm_contact_id,crm_company_id,crm_contacts(first_name,last_name,job_title,crm_companies(name))&limit=1`);
    const user = userRows?.[0];
    if (!user || user.status === "suspended") return json({ ok: false, error: "Access denied" }, 403);

    const companyId = user.crm_company_id;

    if (section === "messages") {
      if (!companyId) return json({ ok: true, messages: [] });
      const msgs = await db(`crm_messages?crm_company_id=eq.${companyId}&tenant_id=eq.${tenantId}&order=created_at.asc`);
      // Mark staff messages as read
      fetch(`${SUPABASE_URL}/rest/v1/crm_messages?crm_company_id=eq.${companyId}&sender_type=eq.staff&read_at=is.null`, {
        method: "PATCH", headers, body: JSON.stringify({ read_at: new Date().toISOString() }),
      });
      return json({ ok: true, messages: msgs || [] });
    }

    if (section === "projects") {
      const projects = await db(`crm_projects?tenant_id=eq.${tenantId}&visible_to_portal=eq.true&select=id,name,description,status,created_at,crm_project_milestones(id,name,status,due_date,sort_order)&order=created_at.desc`);
      return json({ ok: true, projects: projects || [] });
    }

    if (section === "documents") {
      const docs = await db(`crm_documents?tenant_id=eq.${tenantId}&is_portal_visible=eq.true&order=created_at.desc`);
      return json({ ok: true, documents: docs || [] });
    }

    if (section === "signatures") {
      if (!contactId) return json({ ok: true, signatures: [] });
      const sigs = await db(`crm_signature_requests?crm_contact_id=eq.${contactId}&tenant_id=eq.${tenantId}&order=created_at.desc`);
      return json({ ok: true, signatures: sigs || [] });
    }

    // Default: return profile
    return json({ ok: true, user });
  } catch (err) {
    return json({ ok: false, error: err.message || String(err) }, 400);
  }
}

// POST: send a message
export async function onRequestPost(context) {
  try {
    const SUPABASE_URL = context.env.SUPABASE_URL;
    const SERVICE_ROLE = context.env.SUPABASE_SERVICE_ROLE;
    const JWT_SECRET   = context.env.PORTAL_JWT_SECRET || "smartcore-portal-default-secret-change-me";

    const auth = context.request.headers.get("Authorization") || "";
    const token = auth.replace(/^Bearer\s+/i, "");
    const claims = await verifyJWT(token, JWT_SECRET);
    if (!claims) return json({ ok: false, error: "Unauthorized" }, 401);

    const { sub: portalUserId, tid: tenantId, name } = claims;

    const { body } = await context.request.json();
    if (!body?.trim()) return json({ ok: false, error: "Message body required" }, 400);

    const headers = {
      apikey: SERVICE_ROLE,
      Authorization: `Bearer ${SERVICE_ROLE}`,
      "Content-Type": "application/json",
      Prefer: "return=representation",
    };

    // Look up portal user to get company_id
    const userRows = await fetch(
      `${SUPABASE_URL}/rest/v1/crm_portal_users?id=eq.${portalUserId}&select=crm_company_id,crm_contact_id&limit=1`,
      { headers }
    ).then(r => r.json());
    const companyId = userRows?.[0]?.crm_company_id;
    const contactId = userRows?.[0]?.crm_contact_id;
    if (!companyId) return json({ ok: false, error: "No company linked to your account" }, 400);

    const res = await fetch(`${SUPABASE_URL}/rest/v1/crm_messages`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        tenant_id: tenantId,
        crm_company_id: companyId,
        crm_contact_id: contactId || null,
        sender_type: "customer",
        sender_id: portalUserId,
        sender_name: name,
        body: body.trim(),
      }),
    });

    if (!res.ok) throw new Error(await res.text());
    const msg = await res.json();
    return json({ ok: true, message: Array.isArray(msg) ? msg[0] : msg });
  } catch (err) {
    return json({ ok: false, error: err.message || String(err) }, 400);
  }
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } });
}
