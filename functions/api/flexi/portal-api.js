// Authenticated client-portal data API — used by every page under
// systems/flexi/portal/. All requests: POST with
// Authorization: Bearer <session_token> and JSON body { action, ...params }.
// Mirrors functions/api/crm/portal-api.js: the client has no Supabase Auth
// session, so every query runs with the service key and is scoped in JS by
// the verified session's client_id/company_id rather than by RLS.

import { json, handleOptions, sb, verifyClientSession, uploadToStorage } from './_utils.js';

export async function onRequestOptions() {
  return handleOptions();
}

export async function onRequestPost(context) {
  try {
    return await handleAction(context);
  } catch (err) {
    return json({ error: err.message || 'Unexpected server error' }, 500);
  }
}

async function handleAction({ request, env }) {
  const client = await verifyClientSession(request, env);
  if (!client) return json({ error: 'Session expired — please sign in again.' }, 401);

  let body;
  try { body = await request.json(); } catch { return json({ error: 'Invalid request body' }, 400); }
  const { action } = body;
  const cid = client.id;
  const companyId = client.company_id;

  // ── Identity ────────────────────────────────────────────────────────────
  if (action === 'me') {
    return json({
      client: {
        id: client.id, company_id: client.company_id, trainer_id: client.trainer_id,
        full_name: client.full_name, email: client.email, status: client.status,
      },
    });
  }

  // ── Dashboard ───────────────────────────────────────────────────────────
  if (action === 'dashboard_summary') {
    const [nextBooking, latestProgress, workoutLogs, dueCheckins] = await Promise.all([
      sb(env, `/smartcore_flexi_bookings?client_id=eq.${cid}&status=eq.confirmed&starts_at=gte.${new Date().toISOString()}&order=starts_at.asc&limit=1&select=starts_at`),
      sb(env, `/smartcore_flexi_progress_entries?client_id=eq.${cid}&order=logged_at.desc&limit=1&select=weight_kg`),
      sb(env, `/smartcore_flexi_workout_logs?client_id=eq.${cid}&select=id`),
      sb(env, `/smartcore_flexi_checkins?client_id=eq.${cid}&submitted_at=is.null&select=id`),
    ]);
    return json({
      next_booking: nextBooking?.[0] || null,
      latest_weight: latestProgress?.[0]?.weight_kg ?? null,
      workout_count: workoutLogs?.length || 0,
      due_checkins: dueCheckins?.length || 0,
    });
  }

  // ── Training ────────────────────────────────────────────────────────────
  if (action === 'active_programs') {
    const programs = await sb(env, `/smartcore_flexi_programs?client_id=eq.${cid}&status=eq.active&order=created_at.desc&select=id,name`);
    const withWorkouts = await Promise.all((programs || []).map(async p => ({
      ...p,
      workouts: await sb(env, `/smartcore_flexi_workouts?program_id=eq.${p.id}&order=order_index.asc&select=id,name`),
    })));
    return json({ programs: withWorkouts });
  }

  if (action === 'workout_exercises') {
    const rows = await sb(env, `/smartcore_flexi_workout_exercises?workout_id=eq.${body.workout_id}&order=order_index.asc&select=*,smartcore_flexi_exercises(name,video_url,instructions)`);
    return json({ exercises: rows });
  }

  if (action === 'log_workout') {
    const [log] = await sb(env, `/smartcore_flexi_workout_logs`, {
      method: 'POST', body: { client_id: cid, workout_id: body.workout_id, company_id: companyId },
    });
    const sets = (body.sets || []).map(s => ({ ...s, workout_log_id: log.id }));
    if (sets.length) await sb(env, `/smartcore_flexi_exercise_logs`, { method: 'POST', body: sets });
    return json({ success: true });
  }

  // ── Bookings & classes ──────────────────────────────────────────────────
  if (action === 'my_bookings') {
    const cutoff = new Date(Date.now() - 3600000).toISOString();
    const rows = await sb(env, `/smartcore_flexi_bookings?client_id=eq.${cid}&status=neq.cancelled&starts_at=gte.${cutoff}&order=starts_at.asc&select=id,starts_at,session_type,status`);
    return json({ bookings: rows });
  }

  if (action === 'cancel_booking') {
    const [existing] = await sb(env, `/smartcore_flexi_bookings?id=eq.${body.booking_id}&client_id=eq.${cid}&select=id`);
    if (!existing) return json({ error: 'Booking not found.' }, 404);
    await sb(env, `/smartcore_flexi_bookings?id=eq.${body.booking_id}`, { method: 'PATCH', body: { status: 'cancelled' } });
    return json({ success: true });
  }

  if (action === 'available_classes') {
    const classes = await sb(env, `/smartcore_flexi_class_sessions?company_id=eq.${companyId}&status=eq.scheduled&starts_at=gte.${new Date().toISOString()}&order=starts_at.asc&select=id,name,starts_at,capacity`);
    const myBookings = await sb(env, `/smartcore_flexi_bookings?client_id=eq.${cid}&status=eq.confirmed&class_session_id=not.is.null&select=class_session_id`);
    const bookedIds = new Set((myBookings || []).map(b => b.class_session_id));
    const withCounts = await Promise.all((classes || []).map(async c => {
      const bookings = await sb(env, `/smartcore_flexi_bookings?class_session_id=eq.${c.id}&status=eq.confirmed&select=id`);
      return { ...c, booked_count: bookings?.length || 0, is_booked: bookedIds.has(c.id) };
    }));
    return json({ classes: withCounts });
  }

  if (action === 'book_class') {
    const [cls] = await sb(env, `/smartcore_flexi_class_sessions?id=eq.${body.class_session_id}&select=*`);
    if (!cls || cls.status !== 'scheduled') return json({ error: 'This class is not open for booking.' }, 400);
    const existingBookings = await sb(env, `/smartcore_flexi_bookings?class_session_id=eq.${cls.id}&status=eq.confirmed&select=id`);
    if ((existingBookings?.length || 0) >= cls.capacity) return json({ error: 'This class is full.' }, 409);
    await sb(env, `/smartcore_flexi_bookings`, {
      method: 'POST',
      body: {
        company_id: cls.company_id, client_id: cid, trainer_id: cls.trainer_id, location_id: cls.location_id,
        class_session_id: cls.id, session_type: 'class', starts_at: cls.starts_at, ends_at: cls.ends_at, status: 'confirmed',
      },
    });
    return json({ success: true });
  }

  // ── Progress ────────────────────────────────────────────────────────────
  if (action === 'progress_entries') {
    const rows = await sb(env, `/smartcore_flexi_progress_entries?client_id=eq.${cid}&order=logged_at.desc&select=logged_at,weight_kg,notes,photo_urls`);
    return json({ entries: rows });
  }

  if (action === 'log_progress') {
    const photo_urls = [];
    if (body.photo_base64) {
      const path = `${companyId}/${cid}/progress/${Date.now()}.jpg`;
      const url = await uploadToStorage(env, path, body.photo_base64, body.photo_type || 'image/jpeg');
      if (url) photo_urls.push(url);
    }
    await sb(env, `/smartcore_flexi_progress_entries`, {
      method: 'POST',
      body: {
        company_id: companyId, client_id: cid,
        weight_kg: body.weight_kg ?? null, body_fat_pct: body.body_fat_pct ?? null,
        notes: body.notes || null, photo_urls, logged_by: 'client',
      },
    });
    return json({ success: true });
  }

  // ── Messages ────────────────────────────────────────────────────────────
  if (action === 'messages') {
    const rows = await sb(env, `/smartcore_flexi_messages?client_id=eq.${cid}&order=created_at.asc&select=*`);
    sb(env, `/smartcore_flexi_messages?client_id=eq.${cid}&sender_type=eq.trainer&read_at=is.null`, {
      method: 'PATCH', body: { read_at: new Date().toISOString() },
    }).catch(() => {});
    return json({ messages: rows });
  }

  if (action === 'send_message') {
    if (!body.body?.trim()) return json({ error: 'Message required.' }, 400);
    await sb(env, `/smartcore_flexi_messages`, {
      method: 'POST', body: { company_id: companyId, client_id: cid, sender_type: 'client', body: body.body.trim() },
    });
    return json({ success: true });
  }

  // ── Nutrition ───────────────────────────────────────────────────────────
  if (action === 'nutrition_plan') {
    const rows = await sb(env, `/smartcore_flexi_nutrition_plans?client_id=eq.${cid}&active=eq.true&order=created_at.desc&limit=1&select=*`);
    return json({ plan: rows?.[0] || null });
  }

  if (action === 'food_logs_today') {
    const today = new Date().toISOString().slice(0, 10);
    const rows = await sb(env, `/smartcore_flexi_food_logs?client_id=eq.${cid}&logged_at=eq.${today}&order=created_at.asc&select=*`);
    return json({ logs: rows });
  }

  if (action === 'log_food') {
    if (!body.description?.trim()) return json({ error: 'Description required.' }, 400);
    await sb(env, `/smartcore_flexi_food_logs`, {
      method: 'POST',
      body: { company_id: companyId, client_id: cid, meal: body.meal || 'snack', description: body.description.trim(), calories: body.calories ?? null },
    });
    return json({ success: true });
  }

  // ── Habits & check-ins ──────────────────────────────────────────────────
  if (action === 'habits_today') {
    const today = new Date().toISOString().slice(0, 10);
    const habits = await sb(env, `/smartcore_flexi_habits?client_id=eq.${cid}&active=eq.true&select=*`);
    const ids = (habits || []).map(h => h.id);
    const logs = ids.length
      ? await sb(env, `/smartcore_flexi_habit_logs?logged_date=eq.${today}&habit_id=in.(${ids.join(',')})&select=habit_id`)
      : [];
    return json({ habits, done_ids: (logs || []).map(l => l.habit_id) });
  }

  if (action === 'toggle_habit') {
    const today = new Date().toISOString().slice(0, 10);
    const [owned] = await sb(env, `/smartcore_flexi_habits?id=eq.${body.habit_id}&client_id=eq.${cid}&select=id`);
    if (!owned) return json({ error: 'Not found.' }, 404);
    if (body.completed) {
      await sb(env, `/smartcore_flexi_habit_logs`, {
        method: 'POST', body: { habit_id: body.habit_id, logged_date: today, completed: true },
        extraHeaders: { Prefer: 'resolution=merge-duplicates,return=representation' },
      });
    } else {
      await sb(env, `/smartcore_flexi_habit_logs?habit_id=eq.${body.habit_id}&logged_date=eq.${today}`, { method: 'DELETE' });
    }
    return json({ success: true });
  }

  if (action === 'checkins_list') {
    const rows = await sb(env, `/smartcore_flexi_checkins?client_id=eq.${cid}&order=due_date.desc&select=*`);
    return json({ checkins: rows });
  }

  if (action === 'submit_checkin') {
    const [owned] = await sb(env, `/smartcore_flexi_checkins?id=eq.${body.checkin_id}&client_id=eq.${cid}&select=id`);
    if (!owned) return json({ error: 'Not found.' }, 404);
    const photo_urls = [];
    for (const [i, photo_base64] of (body.photos || []).entries()) {
      const path = `${companyId}/${cid}/checkins/${Date.now()}-${i}.jpg`;
      const url = await uploadToStorage(env, path, photo_base64, 'image/jpeg');
      if (url) photo_urls.push(url);
    }
    await sb(env, `/smartcore_flexi_checkins?id=eq.${body.checkin_id}`, {
      method: 'PATCH',
      body: {
        submitted_at: new Date().toISOString(),
        responses: body.responses || {},
        notes: body.notes || null,
        photo_urls,
      },
    });
    return json({ success: true });
  }

  // ── Waivers ─────────────────────────────────────────────────────────────
  if (action === 'waivers_list') {
    const [waivers, sigs] = await Promise.all([
      sb(env, `/smartcore_flexi_waivers?company_id=eq.${companyId}&active=eq.true&select=*`),
      sb(env, `/smartcore_flexi_waiver_signatures?client_id=eq.${cid}&select=*`),
    ]);
    return json({ waivers, signatures: sigs });
  }

  if (action === 'sign_waiver') {
    if (!body.signature_name?.trim()) return json({ error: 'Type your name to sign.' }, 400);
    let signature_image_url = null;
    if (body.signature_base64) {
      const path = `${companyId}/${cid}/signatures/${body.waiver_id}-${Date.now()}.png`;
      signature_image_url = await uploadToStorage(env, path, body.signature_base64, 'image/png');
    }
    await sb(env, `/smartcore_flexi_waiver_signatures`, {
      method: 'POST',
      body: { waiver_id: body.waiver_id, client_id: cid, company_id: companyId, signature_name: body.signature_name.trim(), signature_image_url },
    });
    return json({ success: true });
  }

  // ── Community & challenges ──────────────────────────────────────────────
  if (action === 'challenges_list') {
    const challenges = await sb(env, `/smartcore_flexi_challenges?company_id=eq.${companyId}&order=start_date.desc&select=*`);
    const withEntries = await Promise.all((challenges || []).map(async ch => ({
      ...ch,
      entries: await sb(env, `/smartcore_flexi_challenge_entries?challenge_id=eq.${ch.id}&order=value.desc&limit=10&select=*,smartcore_flexi_clients(full_name)`),
    })));
    return json({ challenges: withEntries });
  }

  if (action === 'update_challenge_entry') {
    await sb(env, `/smartcore_flexi_challenge_entries`, {
      method: 'POST',
      body: { challenge_id: body.challenge_id, client_id: cid, value: body.value || 0, updated_at: new Date().toISOString() },
      extraHeaders: { Prefer: 'resolution=merge-duplicates,return=representation' },
    });
    return json({ success: true });
  }

  if (action === 'community_posts') {
    const rows = await sb(env, `/smartcore_flexi_community_posts?company_id=eq.${companyId}&order=created_at.desc&limit=20&select=*,core_employees(full_name),smartcore_flexi_clients(full_name)`);
    return json({ posts: rows });
  }

  if (action === 'post_community') {
    if (!body.body?.trim()) return json({ error: 'Message required.' }, 400);
    await sb(env, `/smartcore_flexi_community_posts`, {
      method: 'POST', body: { company_id: companyId, author_client_id: cid, body: body.body.trim() },
    });
    return json({ success: true });
  }

  return json({ error: `Unknown action: ${action}` }, 400);
}
