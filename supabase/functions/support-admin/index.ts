// =====================================================================
// SmartCore — support-admin
// Staff-only control surface for the /issues pipeline.
// Verifies the caller is an active row in smartcore_staff, then performs
// privileged actions on their behalf. The browser never holds the service
// key; this function is the only thing that does.
//
//   revert  { attempt_id, force? }  restore the pre-change file backups
//   rerun   { ticket_id }           put the ticket back through the pipeline
//   reply   { ticket_id, content }  post a human reply as the assigned agent
//   close   { ticket_id }           mark resolved
//   reopen  { ticket_id }           back to triage
//   claim   { ticket_id }           take over from the AI — it stops replying
//   release { ticket_id }           hand back to the AI agent
// =====================================================================
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), {
    status: s,
    headers: { ...cors, "Content-Type": "application/json" },
  });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  try {
    const jwt = (req.headers.get("Authorization") ?? "").replace(
      /^Bearer\s+/i,
      "",
    );
    if (!jwt) return json({ error: "Not signed in." }, 401);

    const admin = createClient(SUPABASE_URL, SERVICE_KEY);
    const { data: userRes } = await admin.auth.getUser(jwt);
    const user = userRes?.user;
    if (!user) return json({ error: "Not signed in." }, 401);

    // ---- staff gate (server-side; the console's own check is cosmetic) ----
    const { data: staff } = await admin
      .from("smartcore_staff")
      .select("id, email, work_email, full_name, role, is_active")
      .eq("user_id", user.id)
      .maybeSingle();
    if (!staff || staff.is_active === false) {
      return json({ error: "SmartCore personnel only." }, 403);
    }

    const body = await req.json().catch(() => ({}));
    const action = body.action;

    const audit = (ticketId: string | null, detail: unknown) =>
      admin.from("support_events").insert({
        ticket_id: ticketId,
        kind: `staff_${action}`,
        detail: { by: staff.email, ...(detail as object) },
      });

    const callPipeline = (payload: unknown) =>
      fetch(`${SUPABASE_URL}/functions/v1/support-pipeline`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          Authorization: `Bearer ${SERVICE_KEY}`,
        },
        body: JSON.stringify(payload),
      });

    // ---------------------------------------------------------- revert
    if (action === "revert") {
      const r = await callPipeline({
        action: "revert",
        attempt_id: body.attempt_id,
        force: !!body.force,
      });
      const out = await r.json();

      const { data: att } = await admin
        .from("support_fix_attempts")
        .select("ticket_id")
        .eq("id", body.attempt_id)
        .maybeSingle();
      await audit(att?.ticket_id ?? null, {
        attempt_id: body.attempt_id,
        force: !!body.force,
        out,
      });

      return json(out, r.status);
    }

    // ---------------------------------------------------------- rerun
    if (action === "rerun") {
      await admin
        .from("support_tickets")
        .update({ status: "queued_for_fix" })
        .eq("id", body.ticket_id);
      await audit(body.ticket_id, {});

      callPipeline({ ticket_id: body.ticket_id }).catch(() => {});
      return json({ ok: true, queued: true });
    }

    // ---------------------------------------------------------- reply
    // Sending a manual reply is itself a take-over: if nobody has claimed
    // this ticket yet, claim it now so the AI doesn't answer over you.
    if (action === "reply") {
      const content = String(body.content ?? "").trim();
      if (!content) return json({ error: "Empty reply." }, 400);

      const { data: t } = await admin
        .from("support_tickets")
        .select("agent_name, claimed_by")
        .eq("id", body.ticket_id)
        .maybeSingle();

      await admin.from("support_messages").insert({
        ticket_id: body.ticket_id,
        role: "agent",
        author_name: t?.agent_name ?? "SmartCore Support",
        content,
        meta: { human: true, by: staff.email },
      });

      const patch: Record<string, unknown> = { status: "awaiting_user" };
      if (!t?.claimed_by) {
        patch.claimed_by = staff.id;
        patch.claimed_by_name = staff.full_name || staff.work_email || staff.email;
        patch.claimed_at = new Date().toISOString();
      }
      await admin.from("support_tickets").update(patch).eq("id", body.ticket_id);
      await audit(body.ticket_id, {});

      return json({ ok: true, claimed: !t?.claimed_by });
    }

    // ---------------------------------------------------------- close
    if (action === "close") {
      await admin
        .from("support_tickets")
        .update({ status: "resolved", resolved_at: new Date().toISOString() })
        .eq("id", body.ticket_id);
      await audit(body.ticket_id, {});
      return json({ ok: true });
    }

    // ---------------------------------------------------------- reopen
    if (action === "reopen") {
      await admin
        .from("support_tickets")
        .update({ status: "triage", resolved_at: null })
        .eq("id", body.ticket_id);
      await audit(body.ticket_id, {});
      return json({ ok: true });
    }

    // ---------------------------------------------------------- claim
    if (action === "claim") {
      await admin
        .from("support_tickets")
        .update({
          claimed_by: staff.id,
          claimed_by_name: staff.full_name || staff.work_email || staff.email,
          claimed_at: new Date().toISOString(),
        })
        .eq("id", body.ticket_id);
      await audit(body.ticket_id, {});
      return json({ ok: true });
    }

    // ---------------------------------------------------------- release
    if (action === "release") {
      await admin
        .from("support_tickets")
        .update({ claimed_by: null, claimed_by_name: null, claimed_at: null })
        .eq("id", body.ticket_id);
      await audit(body.ticket_id, {});
      return json({ ok: true });
    }

    return json({ error: "Unknown action." }, 400);
  } catch (e) {
    return json({ error: String((e as Error)?.message ?? e) }, 500);
  }
});
