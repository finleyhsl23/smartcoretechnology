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
  if (client.status === 'paused' || client.status === 'archived') {
    return json({ error: 'Sorry, Your trainer has paused your account, please contact them if you think this is a mistake.' }, 403);
  }

  let body;
  try { body = await request.json(); } catch { return json({ error: 'Invalid request body' }, 400); }
  const { action } = body;
  const cid = client.id;
  const companyId = client.company_id;

  const [settingsRow] = await sb(env, `/smartcore_flexi_settings?company_id=eq.${companyId}&select=disabled_features,background_media_url,background_media_type`);
  const disabledFeatures = settingsRow?.disabled_features || [];

  // Actions that belong to a feature the trainer can switch off in Settings.
  // Blocked here too (not just hidden client-side) so a disabled feature
  // can't be reached by calling the API directly.
  const ACTION_FEATURE = {
    active_programs: 'programs', workout_exercises: 'programs', log_workout: 'programs',
    available_classes: 'classes', book_class: 'classes',
    messages: 'messages', send_message: 'messages',
    nutrition_plan: 'nutrition', meal_library_list: 'nutrition', food_logs_today: 'nutrition', log_food: 'nutrition',
    habits_today: 'checkins', toggle_habit: 'checkins', checkins_list: 'checkins', submit_checkin: 'checkins',
    waivers_list: 'waivers', sign_waiver: 'waivers',
    challenges_list: 'community', update_challenge_entry: 'community', community_posts: 'community', post_community: 'community',
  };
  if (ACTION_FEATURE[action] && disabledFeatures.includes(ACTION_FEATURE[action])) {
    return json({ error: 'This feature has been turned off by your trainer.' }, 403);
  }

  // ── Identity ────────────────────────────────────────────────────────────
  if (action === 'me') {
    return json({
      client: {
        id: client.id, company_id: client.company_id, trainer_id: client.trainer_id,
        full_name: client.full_name, email: client.email, status: client.status,
        disabled_features: disabledFeatures,
        background_media_url: settingsRow?.background_media_url || null,
        background_media_type: settingsRow?.background_media_type || null,
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

  // ── Progression (gamified dashboard stats) ─────────────────────────────
  if (action === 'progression_summary') {
    const period = ['week', 'month'].includes(body.period) ? body.period : 'day';
    const now = new Date();
    let start;
    if (period === 'day') {
      start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    } else if (period === 'week') {
      start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      start.setDate(start.getDate() - ((start.getDay() + 6) % 7));
    } else {
      start = new Date(now.getFullYear(), now.getMonth(), 1);
    }
    const daysElapsed = Math.max(1, Math.ceil((now - start) / 86400000));
    const startIso = start.toISOString();
    const startDate = start.toISOString().slice(0, 10);

    const [periodLogs, recentLogs, activePrograms, planRows, foodLogs] = await Promise.all([
      sb(env, `/smartcore_flexi_workout_logs?client_id=eq.${cid}&completed_at=gte.${startIso}&select=id,completed_at`),
      sb(env, `/smartcore_flexi_workout_logs?client_id=eq.${cid}&order=completed_at.desc&limit=200&select=completed_at`),
      sb(env, `/smartcore_flexi_programs?client_id=eq.${cid}&status=eq.active&order=created_at.desc&limit=1&select=id`),
      sb(env, `/smartcore_flexi_nutrition_plans?client_id=eq.${cid}&active=eq.true&order=created_at.desc&limit=1&select=daily_calories,protein_g,carbs_g,fat_g`),
      sb(env, `/smartcore_flexi_food_logs?client_id=eq.${cid}&logged_at=gte.${startDate}&select=logged_at,calories,protein_g,carbs_g,fat_g`),
    ]);

    let weeklyGoal = 4;
    if (activePrograms?.[0]) {
      const workouts = await sb(env, `/smartcore_flexi_workouts?program_id=eq.${activePrograms[0].id}&is_rest_day=eq.false&select=id`);
      if (workouts?.length) weeklyGoal = workouts.length;
    }
    const goal = period === 'day' ? 1 : period === 'week' ? weeklyGoal : Math.round(weeklyGoal * 4.345);

    const loggedDates = new Set((recentLogs || []).map(l => l.completed_at.slice(0, 10)));
    let streak = 0;
    const cursor = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    if (!loggedDates.has(cursor.toISOString().slice(0, 10))) cursor.setDate(cursor.getDate() - 1);
    while (loggedDates.has(cursor.toISOString().slice(0, 10))) { streak++; cursor.setDate(cursor.getDate() - 1); }

    const plan = planRows?.[0] || null;
    const dayKeys = new Set();
    let calSum = 0, proSum = 0, carbSum = 0, fatSum = 0;
    (foodLogs || []).forEach(f => {
      dayKeys.add(f.logged_at);
      calSum += f.calories || 0; proSum += f.protein_g || 0; carbSum += f.carbs_g || 0; fatSum += f.fat_g || 0;
    });

    return json({
      period,
      workout: { done: periodLogs?.length || 0, goal, streak_days: streak },
      nutrition: plan ? {
        cal_done: calSum, cal_goal: (plan.daily_calories || 0) * daysElapsed,
        protein_done: proSum, protein_goal: (plan.protein_g || 0) * daysElapsed,
        carbs_done: carbSum, carbs_goal: (plan.carbs_g || 0) * daysElapsed,
        fat_done: fatSum, fat_goal: (plan.fat_g || 0) * daysElapsed,
        days_logged: dayKeys.size, days_total: daysElapsed,
      } : null,
    });
  }

  // ── Training ────────────────────────────────────────────────────────────
  if (action === 'active_programs') {
    const programs = await sb(env, `/smartcore_flexi_programs?client_id=eq.${cid}&status=eq.active&order=created_at.desc&select=id,name`);
    const withWorkouts = await Promise.all((programs || []).map(async p => {
      const workouts = await sb(env, `/smartcore_flexi_workouts?program_id=eq.${p.id}&order=order_index.asc&select=id,name,day_label`);
      const withMeta = await Promise.all((workouts || []).map(async w => {
        const [exercises, lastLog] = await Promise.all([
          sb(env, `/smartcore_flexi_workout_exercises?workout_id=eq.${w.id}&select=id`),
          sb(env, `/smartcore_flexi_workout_logs?client_id=eq.${cid}&workout_id=eq.${w.id}&order=completed_at.desc&limit=1&select=completed_at`),
        ]);
        return { ...w, exercise_count: exercises?.length || 0, last_completed_at: lastLog?.[0]?.completed_at || null };
      }));
      return { ...p, workouts: withMeta };
    }));
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
    const rows = await sb(env, `/smartcore_flexi_progress_entries?client_id=eq.${cid}&order=logged_at.desc&select=logged_at,weight_kg,notes,photo_urls,measurements`);
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
        notes: body.notes || null, photo_urls, measurements: body.measurements || null, logged_by: 'client',
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
    const plan = rows?.[0] || null;
    let meal_plan = null;
    if (plan?.meal_plan_id) {
      const [mpRows, slotTargets, items] = await Promise.all([
        sb(env, `/smartcore_flexi_meal_plans?id=eq.${plan.meal_plan_id}&select=*`),
        sb(env, `/smartcore_flexi_meal_plan_slot_targets?meal_plan_id=eq.${plan.meal_plan_id}&select=*`),
        sb(env, `/smartcore_flexi_meal_plan_items?meal_plan_id=eq.${plan.meal_plan_id}&select=*,smartcore_flexi_meals(*)&order=order_index.asc`),
      ]);
      if (mpRows?.[0]) meal_plan = { ...mpRows[0], slot_targets: slotTargets || [], items: items || [] };
    }
    return json({ plan, meal_plan });
  }

  if (action === 'meal_library_list') {
    const meals = await sb(env, `/smartcore_flexi_meals?company_id=eq.${companyId}&order=name.asc&select=*`);
    return json({ meals: meals || [] });
  }

  if (action === 'food_logs_today') {
    const today = new Date().toISOString().slice(0, 10);
    const rows = await sb(env, `/smartcore_flexi_food_logs?client_id=eq.${cid}&logged_at=eq.${today}&order=created_at.asc&select=*`);
    return json({ logs: rows });
  }

  if (action === 'log_food') {
    if (body.meal_id) {
      const [meal] = await sb(env, `/smartcore_flexi_meals?id=eq.${body.meal_id}&company_id=eq.${companyId}&select=*`);
      if (!meal) return json({ error: 'Meal not found.' }, 404);
      await sb(env, `/smartcore_flexi_food_logs`, {
        method: 'POST',
        body: {
          company_id: companyId, client_id: cid, meal: body.meal || 'snack', description: meal.name,
          calories: meal.calories, protein_g: meal.protein_g, carbs_g: meal.carbs_g, fat_g: meal.fat_g, meal_id: meal.id,
        },
      });
      return json({ success: true });
    }
    if (!body.description?.trim()) return json({ error: 'Description required.' }, 400);
    await sb(env, `/smartcore_flexi_food_logs`, {
      method: 'POST',
      body: {
        company_id: companyId, client_id: cid, meal: body.meal || 'snack', description: body.description.trim(),
        calories: body.calories ?? null, protein_g: body.protein_g ?? null, carbs_g: body.carbs_g ?? null, fat_g: body.fat_g ?? null,
      },
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
    const [challenge] = await sb(env, `/smartcore_flexi_challenges?id=eq.${body.challenge_id}&company_id=eq.${companyId}&select=id,requires_media`);
    if (!challenge) return json({ error: 'Challenge not found.' }, 404);
    const [existing] = await sb(env, `/smartcore_flexi_challenge_entries?challenge_id=eq.${body.challenge_id}&client_id=eq.${cid}&select=media_url,media_type`);

    let media_url = existing?.media_url || null;
    let media_type = existing?.media_type || null;
    if (body.media_base64) {
      const ext = (body.media_type || '').startsWith('video/') ? 'mp4' : 'jpg';
      const path = `${companyId}/${cid}/challenges/${body.challenge_id}-${Date.now()}.${ext}`;
      media_url = await uploadToStorage(env, path, body.media_base64, body.media_type || 'image/jpeg');
      media_type = (body.media_type || '').startsWith('video/') ? 'video' : 'image';
    }
    if (challenge.requires_media && !media_url) {
      return json({ error: 'Attach a photo or video to submit.' }, 400);
    }

    await sb(env, `/smartcore_flexi_challenge_entries`, {
      method: 'POST',
      body: { challenge_id: body.challenge_id, client_id: cid, value: body.value || 0, media_url, media_type, updated_at: new Date().toISOString() },
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
