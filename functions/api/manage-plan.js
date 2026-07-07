/**
 * GET/PATCH /api/manage-plan
 *
 * Token-authenticated plan management endpoint.
 *
 * GET  ?token=XXX
 *   Returns: { order, modules (all available), employee_count, company }
 *
 * PATCH ?token=XXX
 *   Body: { action: 'change_size', new_tier_id }
 *       | { action: 'change_crm_tier', new_crm_slug }
 *       | { action: 'generate_token', order_id }  (requires Authorization header)
 *
 * Required env: SUPABASE_URL, SUPABASE_SERVICE_KEY,
 *               STRIPE_SECRET_KEY
 */

import { updateStripeSubscription } from './_stripe.js';

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Content-Type':                 'application/json',
};

const SIZE_TIERS = [
  { id: 'micro',      label: 'Micro',      range: '1–10',        multiplier: 1.00,  maxEmployees: 10   },
  { id: 'small',      label: 'Small',      range: '11–15',       multiplier: 0.71,  maxEmployees: 15   },
  { id: 'growing',    label: 'Growing',    range: '16–50',       multiplier: 1.43,  maxEmployees: 50   },
  { id: 'medium',     label: 'Medium',     range: '51–100',      multiplier: 2.86,  maxEmployees: 100  },
  { id: 'large',      label: 'Large',      range: '101–250',     multiplier: 6.72,  maxEmployees: 250  },
  { id: 'corporate',  label: 'Corporate',  range: '251–500',     multiplier: 14.44, maxEmployees: 500  },
  { id: 'enterprise', label: 'Enterprise', range: '501–999',     multiplier: 28.92, maxEmployees: 999  },
  { id: 'global',     label: 'Global',     range: '1,000–1,500', multiplier: 38.57, maxEmployees: 1500 },
];

const CRM_SLUGS = [
  'smartcore-crm-lite',
  'smartcore-crm-professional',
  'smartcore-crm-business',
  'smartcore-crm-enterprise',
];

// ---------------------------------------------------------------------------
// Resolve order from either manage_token param or Bearer JWT
// ---------------------------------------------------------------------------
async function resolveOrder(env, request, url) {
  const token = url.searchParams.get('token');
  if (token) {
    const orders = await dbGet(env, `/marketplace_orders?manage_token=eq.${enc(token)}&select=*&limit=1`);
    if (!orders?.[0]) return { error: 'Invalid or expired link', status: 404 };
    return { order: orders[0] };
  }
  // Fall back to Bearer JWT auth
  const jwt = (request.headers.get('Authorization') || '').replace('Bearer ', '').trim();
  if (!jwt) return { error: 'token or Authorization required', status: 401 };
  // Verify JWT with Supabase
  const userRes = await fetch(`${env.SUPABASE_URL}/auth/v1/user`, {
    headers: { Authorization: `Bearer ${jwt}`, apikey: env.SUPABASE_SERVICE_KEY },
  });
  if (!userRes.ok) return { error: 'Unauthorised', status: 401 };
  const user = await userRes.json();
  // Find company via core_employees (user_id column)
  let companyId = null;
  const empRows = await dbGet(env, `/core_employees?auth_user_id=eq.${enc(user.id)}&select=company_id&limit=1`);
  if (empRows?.[0]?.company_id) companyId = empRows[0].company_id;
  if (!companyId) return { error: 'No company found for this user', status: 404 };
  const coRows = await dbGet(env, `/smartcore_core_companies?id=eq.${enc(companyId)}&select=order_id&limit=1`);
  const orderId = coRows?.[0]?.order_id;
  if (!orderId) return { error: 'No active subscription found', status: 404 };
  const orders = await dbGet(env, `/marketplace_orders?id=eq.${enc(orderId)}&select=*&limit=1`);
  if (!orders?.[0]) return { error: 'Order not found', status: 404 };
  return { order: orders[0] };
}

// ---------------------------------------------------------------------------
// GET
// ---------------------------------------------------------------------------
export async function onRequestGet(context) {
  const { request, env } = context;
  const url = new URL(request.url);

  try {
    const resolved = await resolveOrder(env, request, url);
    if (resolved.error) return json({ error: resolved.error }, resolved.status, CORS);
    const order = resolved.order;

    // Get company
    const companies = await dbGet(env, `/smartcore_core_companies?order_id=eq.${enc(order.id)}&select=*&limit=1`);
    const company   = companies?.[0] || null;

    // Get all available modules
    const modules = await dbGet(env, `/marketplace_modules?select=*&order=monthly_price.asc`);

    // Get employee count
    let employee_count = 0;
    if (company?.id) {
      const empRows = await dbGet(env, `/core_employees?company_id=eq.${enc(company.id)}&select=id`);
      employee_count = empRows?.length || 0;
    }

    // Get purchased modules
    let purchased_modules = [];
    if (company?.id) {
      purchased_modules = await dbGet(env, `/smartcore_core_purchased_modules?company_id=eq.${enc(company.id)}&select=*`);
    }

    // Parse pending_plan_change if stored as a string
    if (order.pending_plan_change && typeof order.pending_plan_change === 'string') {
      try { order.pending_plan_change = JSON.parse(order.pending_plan_change); } catch (_) {}
    }

    return json({ order, modules: modules || [], employee_count, company, purchased_modules: purchased_modules || [] }, 200, CORS);
  } catch (err) {
    console.error('manage-plan GET:', err);
    return json({ error: err.message || 'Internal error' }, 500, CORS);
  }
}

// ---------------------------------------------------------------------------
// PATCH
// ---------------------------------------------------------------------------
export async function onRequestPatch(context) {
  const { request, env } = context;
  const url   = new URL(request.url);
  const token = url.searchParams.get('token');

  try {
    const body = await request.json();
    const { action } = body;

    // generate_token requires auth — no token needed on URL
    if (action === 'generate_token') {
      return handleGenerateToken(env, request, body);
    }

    const resolved = await resolveOrder(env, request, url);
    if (resolved.error) return json({ error: resolved.error }, resolved.status, CORS);
    const order = resolved.order;

    if (action === 'change_size')           return handleChangeSize(env, order, body);
    if (action === 'change_crm_tier')       return handleChangeCrmTier(env, order, body);
    if (action === 'cancel_pending_change') return handleCancelPendingChange(env, order);
    if (action === 'cancel_subscription')   return handleCancelSubscription(env, order);
    if (action === 'cancel_module')         return handleCancelModule(env, order, body);

    return json({ error: `Unknown action: ${action}` }, 400, CORS);
  } catch (err) {
    console.error('manage-plan PATCH:', err);
    return json({ error: err.message || 'Internal error' }, 500, CORS);
  }
}

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: {
    'Access-Control-Allow-Origin':  '*',
    'Access-Control-Allow-Methods': 'GET, PATCH, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  }});
}

// ---------------------------------------------------------------------------
// Action: cancel_subscription
// ---------------------------------------------------------------------------
async function handleCancelSubscription(env, order) {
  // Cancel in Stripe at period end so access continues until next billing date
  if (order.stripe_subscription_id) {
    try {
      await stripeRequest(env, 'POST', `/subscriptions/${enc(order.stripe_subscription_id)}`, {
        cancel_at_period_end: 'true',
      });
    } catch (e) {
      console.error('Stripe cancel error:', e);
      return json({ error: `Stripe error: ${e.message}` }, 500, CORS);
    }
  }

  // Mark order as cancelling in DB
  await dbPatch(env, `/marketplace_orders?id=eq.${enc(order.id)}`, {
    status:       'cancelling',
    cancelled_at: new Date().toISOString(),
  });

  return json({ success: true }, 200, CORS);
}

// ---------------------------------------------------------------------------
// Action: cancel_module
// ---------------------------------------------------------------------------
async function handleCancelModule(env, order, body) {
  const { module_slug } = body;
  if (!module_slug || module_slug === 'smartcore-core') {
    return json({ error: 'Cannot cancel this module' }, 400, CORS);
  }

  // Get company
  const companies = await dbGet(env, `/smartcore_core_companies?order_id=eq.${enc(order.id)}&select=id&limit=1`);
  const company   = companies?.[0];
  if (!company?.id) return json({ error: 'Company not found' }, 404, CORS);

  // Mark the module as cancelling in purchased_modules
  await dbPatch(env, `/smartcore_core_purchased_modules?company_id=eq.${enc(company.id)}&module_slug=eq.${enc(module_slug)}`, {
    status:       'cancelling',
    cancelled_at: new Date().toISOString(),
  });

  // Remove module from order's modules array and recalculate total
  const allModules = await dbGet(env, `/marketplace_modules?select=*`);
  const moduleMap  = Object.fromEntries((allModules || []).map(m => [m.slug, m]));
  const modules    = parseModules(order.modules).filter(m => m.slug !== module_slug);
  const multiplier = order.size_multiplier || 1;
  const { subtotal, discount, total } = calcTotal(modules, moduleMap, multiplier, order.billing_type, order.discount_percent || 0);

  await dbPatch(env, `/marketplace_orders?id=eq.${enc(order.id)}`, {
    modules:  JSON.stringify(modules),
    subtotal, total, discount_amount: discount,
  });

  // Update Stripe subscription price
  if (order.stripe_subscription_id) {
    try {
      await updateStripeSubscription(env, order.stripe_subscription_id, total, order.billing_type,
        `SmartCore — ${order.company_name}`);
    } catch (e) {
      console.error('Stripe update error on cancel_module:', e);
    }
  }

  return json({ success: true, new_total: total }, 200, CORS);
}

// ---------------------------------------------------------------------------
// Action: cancel_pending_change
// ---------------------------------------------------------------------------
async function handleCancelPendingChange(env, order) {
  await dbPatch(env, `/marketplace_orders?id=eq.${enc(order.id)}`, { pending_plan_change: null });
  return json({ success: true }, 200, CORS);
}

// ---------------------------------------------------------------------------
// Action: change_size
// ---------------------------------------------------------------------------
async function handleChangeSize(env, order, body) {
  const { new_tier_id, apply_immediately = true } = body;
  const tier = SIZE_TIERS.find(t => t.id === new_tier_id);
  if (!tier) return json({ error: `Invalid tier: ${new_tier_id}` }, 400, CORS);

  // Get company + employee count
  const companies = await dbGet(env, `/smartcore_core_companies?order_id=eq.${enc(order.id)}&select=*&limit=1`);
  const company   = companies?.[0];
  let employee_count = 0;
  if (company?.id) {
    const empRows = await dbGet(env, `/core_employees?company_id=eq.${enc(company.id)}&select=id`);
    employee_count = empRows?.length || 0;
  }

  // Enforce employee limit (applies regardless of timing)
  if (employee_count > tier.maxEmployees) {
    return json({
      error:             'employee_limit',
      current_employees: employee_count,
      tier_max:          tier.maxEmployees,
      tier_label:        tier.label,
      manage_url:        'https://smartcoretechnology.co.uk/systems/core',
    }, 422, CORS);
  }

  // Fetch current module details from DB for pricing
  const modules     = parseModules(order.modules);
  const allModules  = await dbGet(env, `/marketplace_modules?select=*`);
  const moduleMap   = Object.fromEntries((allModules || []).map(m => [m.slug, m]));

  // Recalculate totals with new multiplier
  const { subtotal, discount, total } = calcTotal(modules, moduleMap, tier.multiplier, order.billing_type, order.discount_percent || 0);

  if (!apply_immediately) {
    // Queue the change — store it on the order, don't touch pricing or PayPal yet
    await dbPatch(env, `/marketplace_orders?id=eq.${enc(order.id)}`, {
      pending_plan_change: JSON.stringify({
        type:        'change_size',
        new_tier_id: tier.id,
        new_total:   total,
        queued_at:   new Date().toISOString(),
      }),
    });
    return json({ success: true, scheduled: true, new_total: total, new_tier: tier }, 200, CORS);
  }

  // Apply immediately
  await dbPatch(env, `/marketplace_orders?id=eq.${enc(order.id)}`, {
    size_tier:           tier.id,
    size_multiplier:     tier.multiplier,
    subtotal,
    total,
    discount_amount:     discount,
    pending_plan_change: null,
  });

  // Update company employee_limit
  if (company?.id) {
    await dbPatch(env, `/smartcore_core_companies?id=eq.${enc(company.id)}`, {
      employee_limit: tier.maxEmployees,
    });
  }

  // Update Stripe subscription if present
  if (order.stripe_subscription_id) {
    try {
      await updateStripeSubscription(env, order.stripe_subscription_id, total, order.billing_type,
        `SmartCore ${tier.label} — ${order.company_name}`);
    } catch (e) {
      console.error('Stripe revise error:', e);
      // Non-fatal — DB already updated
    }
  }

  return json({ success: true, scheduled: false, new_total: total, new_tier: tier }, 200, CORS);
}

// ---------------------------------------------------------------------------
// Action: change_crm_tier
// ---------------------------------------------------------------------------
async function handleChangeCrmTier(env, order, body) {
  const { new_crm_slug, apply_immediately = true } = body;
  if (!CRM_SLUGS.includes(new_crm_slug)) {
    return json({ error: `Invalid CRM slug: ${new_crm_slug}` }, 400, CORS);
  }

  // Get new module details
  const newModRows = await dbGet(env, `/marketplace_modules?slug=eq.${enc(new_crm_slug)}&select=*&limit=1`);
  if (!newModRows?.[0]) return json({ error: 'CRM module not found' }, 404, CORS);
  const newMod = newModRows[0];

  // Fetch all module DB records for pricing
  const allModules = await dbGet(env, `/marketplace_modules?select=*`);
  const moduleMap  = Object.fromEntries((allModules || []).map(m => [m.slug, m]));
  const multiplier = order.size_multiplier || 1;

  // Update modules array: remove old CRM, add new one
  const modules    = parseModules(order.modules);
  const nonCrm     = modules.filter(m => !CRM_SLUGS.includes(m.slug));
  const newModules = [...nonCrm, { slug: newMod.slug, name: newMod.name, monthly_price: newMod.monthly_price, yearly_price: newMod.yearly_price, price: newMod.monthly_price }];

  const { subtotal, discount, total } = calcTotal(newModules, moduleMap, multiplier, order.billing_type, order.discount_percent || 0);

  if (!apply_immediately) {
    // Queue the change
    await dbPatch(env, `/marketplace_orders?id=eq.${enc(order.id)}`, {
      pending_plan_change: JSON.stringify({
        type:         'change_crm_tier',
        new_crm_slug: newMod.slug,
        new_crm_name: newMod.name,
        new_total:    total,
        queued_at:    new Date().toISOString(),
      }),
    });
    return json({ success: true, scheduled: true, new_total: total, new_module: newMod }, 200, CORS);
  }

  // Apply immediately
  await dbPatch(env, `/marketplace_orders?id=eq.${enc(order.id)}`, {
    modules:             JSON.stringify(newModules),
    subtotal,
    total,
    discount_amount:     discount,
    pending_plan_change: null,
  });

  // Update purchased_modules: delete old CRM row(s), insert new
  const companies = await dbGet(env, `/smartcore_core_companies?order_id=eq.${enc(order.id)}&select=id&limit=1`);
  const company   = companies?.[0];
  if (company?.id) {
    for (const slug of CRM_SLUGS) {
      try {
        await dbDelete(env, `/smartcore_core_purchased_modules?company_id=eq.${enc(company.id)}&module_slug=eq.${enc(slug)}`);
      } catch (_) { /* ignore if not present */ }
    }
    await dbPost(env, '/smartcore_core_purchased_modules', {
      company_id:   company.id,
      order_id:     order.id,
      module_slug:  newMod.slug,
      module_name:  newMod.name,
      billing_type: order.billing_type,
      price:        order.billing_type === 'yearly' ? (newMod.yearly_price || newMod.monthly_price) : newMod.monthly_price,
      status:       'active',
      activated_at: new Date().toISOString(),
    });
  }

  // Update Stripe subscription if present
  if (order.stripe_subscription_id) {
    try {
      await updateStripeSubscription(env, order.stripe_subscription_id, total, order.billing_type,
        `SmartCore CRM — ${order.company_name}`);
    } catch (e) {
      console.error('Stripe revise error:', e);
    }
  }

  return json({ success: true, scheduled: false, new_total: total, new_module: newMod }, 200, CORS);
}

// ---------------------------------------------------------------------------
// Action: generate_token
// ---------------------------------------------------------------------------
async function handleGenerateToken(env, request, body) {
  const { order_id } = body;
  if (!order_id) return json({ error: 'order_id required' }, 400, CORS);

  // Require auth
  const authHeader = request.headers.get('Authorization') || '';
  const bearerToken = authHeader.replace(/^Bearer\s+/i, '').trim();
  if (!bearerToken) return json({ error: 'Unauthorized' }, 401, CORS);

  // Verify user with Supabase
  const userRes = await fetch(`${env.SUPABASE_URL}/auth/v1/user`, {
    headers: { apikey: env.SUPABASE_SERVICE_KEY, Authorization: `Bearer ${bearerToken}` },
  });
  if (!userRes.ok) return json({ error: 'Unauthorized' }, 401, CORS);
  const userData = await userRes.json();
  const userId   = userData?.id;
  if (!userId) return json({ error: 'Unauthorized' }, 401, CORS);

  // Verify order belongs to this user or is accessible
  const orders = await dbGet(env, `/marketplace_orders?id=eq.${enc(order_id)}&select=*&limit=1`);
  if (!orders?.[0]) return json({ error: 'Order not found' }, 404, CORS);
  const order = orders[0];

  // Check user is owner/admin of this company
  const companies = await dbGet(env, `/smartcore_core_companies?order_id=eq.${enc(order.id)}&select=id&limit=1`);
  const company   = companies?.[0];
  if (company?.id) {
    const empRows = await dbGet(env, `/core_employees?company_id=eq.${enc(company.id)}&auth_user_id=eq.${enc(userId)}&select=role&limit=1`);
    const emp = empRows?.[0];
    if (!emp || !['owner', 'admin'].includes(emp.role)) {
      return json({ error: 'Forbidden — owner or admin access required' }, 403, CORS);
    }
  } else if (order.auth_user_id && order.auth_user_id !== userId) {
    return json({ error: 'Forbidden' }, 403, CORS);
  }

  // Generate token
  const arr   = new Uint8Array(16);
  crypto.getRandomValues(arr);
  const token = Array.from(arr).map(b => b.toString(16).padStart(2, '0')).join('');

  await dbPatch(env, `/marketplace_orders?id=eq.${enc(order_id)}`, { manage_token: token });

  const url = `https://smartcoretechnology.co.uk/shop/manage-plan.html?token=${token}`;
  return json({ token, url }, 200, CORS);
}

// ---------------------------------------------------------------------------
// Pricing calculation
// ---------------------------------------------------------------------------
function calcTotal(modules, moduleMap, sizeMultiplier, billingType, discountPct) {
  let subtotal = 0;
  for (const m of modules) {
    if (m.slug === 'smartcore-core') continue;
    const dbMod  = moduleMap[m.slug] || m;
    const isCrm  = CRM_SLUGS.includes(m.slug);
    const base   = billingType === 'yearly'
      ? (dbMod.yearly_price || dbMod.monthly_price || m.yearly_price || m.monthly_price || 0)
      : (dbMod.monthly_price || m.monthly_price || 0);
    subtotal += isCrm ? base : base * sizeMultiplier;
  }
  const discount = subtotal * (discountPct || 0) / 100;
  return { subtotal, discount, total: Math.max(0, subtotal - discount) };
}

// ---------------------------------------------------------------------------
// DB helpers
// ---------------------------------------------------------------------------
function enc(v) { return encodeURIComponent(v); }

async function dbGet(env, path) {
  const r = await fetch(`${env.SUPABASE_URL}/rest/v1${path}`, {
    headers: { apikey: env.SUPABASE_SERVICE_KEY, Authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}` },
  });
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}

async function dbPatch(env, path, body) {
  const r = await fetch(`${env.SUPABASE_URL}/rest/v1${path}`, {
    method: 'PATCH',
    headers: {
      apikey:         env.SUPABASE_SERVICE_KEY,
      Authorization:  `Bearer ${env.SUPABASE_SERVICE_KEY}`,
      'Content-Type': 'application/json',
      Prefer:         'return=minimal',
    },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(await r.text());
}

async function dbPost(env, path, body, returning = false) {
  const r = await fetch(`${env.SUPABASE_URL}/rest/v1${path}`, {
    method: 'POST',
    headers: {
      apikey:         env.SUPABASE_SERVICE_KEY,
      Authorization:  `Bearer ${env.SUPABASE_SERVICE_KEY}`,
      'Content-Type': 'application/json',
      Prefer:         returning ? 'return=representation' : 'return=minimal',
    },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(await r.text());
  if (returning) return r.json();
}

async function dbDelete(env, path) {
  const r = await fetch(`${env.SUPABASE_URL}/rest/v1${path}`, {
    method: 'DELETE',
    headers: {
      apikey:        env.SUPABASE_SERVICE_KEY,
      Authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}`,
      Prefer:        'return=minimal',
    },
  });
  if (!r.ok) throw new Error(await r.text());
}

function parseModules(m) {
  if (!m) return [];
  if (Array.isArray(m)) return m;
  try { return JSON.parse(m); } catch { return []; }
}

function json(data, status = 200, extra = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...extra },
  });
}
