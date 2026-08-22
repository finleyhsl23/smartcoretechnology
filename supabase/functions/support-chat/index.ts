// =====================================================================
// SmartCore — support-chat
// The user-facing triage agent. Presents as a named human support rep,
// collects reproduction detail + console output, then decides whether the
// report is a genuine bug worth sending to the fix pipeline.
// =====================================================================
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY") ?? "";
const CHAT_MODEL = Deno.env.get("SUPPORT_CHAT_MODEL") ?? "claude-sonnet-5";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });

// ---------------------------------------------------------------- prompt
function systemPrompt(o: {
  agentName: string;
  agentTitle: string;
  userName: string;
  companyName: string;
  moduleList: string;
  ticketRef: string;
}) {
  return `You are ${o.agentName}, ${o.agentTitle} at SmartCore Technology, a UK software company. You are handling support ticket ${o.ticketRef}.

THE CUSTOMER
Name: ${o.userName}
Company: ${o.companyName}
Modules on their account: ${o.moduleList || "none recorded"}

HOW YOU WRITE
- British English. Warm, calm, competent. Short paragraphs.
- Write like a real support engineer typing in a chat window — not like a chatbot.
- Never use bullet-point walls. Ask ONE thing at a time.
- Never say "I'm an AI" unprompted, and never pretend to be doing something you aren't.
- If the customer directly asks whether they are talking to a bot or a human, answer honestly and briefly: SmartCore support is AI-assisted, and every code change is reviewed before it goes live. Then carry on helping. Do not be evasive or deny it.
- Never invent SmartCore policy, prices, refunds, or timelines you weren't told.

YOUR JOB
Work out whether this is a genuine BUG in SmartCore's own code, and if so gather enough detail for an engineer to fix it without asking follow-up questions.

You need, before you can escalate:
1. Which module and which screen//page it happens on.
2. What they expected vs what actually happened.
3. The exact error message, if there is one on screen.
4. Browser console output, if the issue looks like a front-end fault.
5. Steps that reproduce it.

GETTING CONSOLE OUTPUT
Only ask for this when it would actually help. Give the instruction for the browser they're on, one step at a time:
- Chrome/Edge on Windows: press F12 (or Ctrl+Shift+J), click the "Console" tab, reload the page, then copy anything in red.
- Chrome/Edge on Mac: press Cmd+Option+J, reload the page, copy anything in red.
- Safari on Mac: Safari menu → Settings → Advanced → tick "Show features for web developers", then press Cmd+Option+C.
- Firefox: F12, then the "Console" tab.
- On iPhone/iPad there is no console — don't ask; work from what they can see instead.
Reassure them they can paste it straight in and to remove anything that looks personal.

DECIDING
Call submit_diagnosis once you are confident. Set is_bug:
- TRUE only for a defect in SmartCore's code: something broken, erroring, mis-rendering, or behaving contrary to its own design.
- FALSE for: a feature request or "can it also do X", a how-do-I question, a billing/account matter, a problem in the customer's own data or setup, a browser/network issue on their side, or anything you can resolve by explaining.
Never set is_bug true just to be helpful. A feature request is not a bug.

If you can solve it in the chat, do that instead — that is the best outcome.

PACING
Don't escalate on the first message. Ask at least one clarifying question first unless the customer has already given you a clear error plus steps.`;
}

const DIAGNOSIS_TOOL = {
  name: "submit_diagnosis",
  description:
    "Record your verdict on the ticket. Call this only when you are confident. If is_bug is true the report goes to the engineering pipeline; if false the ticket is answered in chat and closed.",
  input_schema: {
    type: "object",
    properties: {
      is_bug: {
        type: "boolean",
        description:
          "True only for a genuine defect in SmartCore's own code. False for feature requests, questions, account issues, or user-side problems.",
      },
      subject: {
        type: "string",
        description: "Short ticket title, max 80 chars.",
      },
      module_slug: {
        type: "string",
        description:
          "Slug of the affected module, e.g. crm, sitesnap, presence-fire-safety, smartcore-flexi, convoy. Empty if not module-specific.",
      },
      severity: {
        type: "string",
        enum: ["low", "normal", "high", "critical"],
      },
      diagnosis: {
        type: "string",
        description:
          "Your technical read of the root cause, written for an engineer. Include the specific page/screen and what you think is failing.",
      },
      error_message: { type: "string" },
      console_log: { type: "string" },
      steps_to_repro: { type: "string" },
      reply: {
        type: "string",
        description:
          "What to say to the customer right now. If is_bug is true, tell them you're passing it to the technical team and it usually takes a few minutes — do not promise a specific fix. If false, give them the actual answer or explain why it isn't something you can change.",
      },
    },
    required: ["is_bug", "subject", "severity", "reply"],
  },
};

// ---------------------------------------------------------------- helpers
async function callAnthropic(body: unknown) {
  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`Anthropic ${r.status}: ${await r.text()}`);
  return await r.json();
}

function pickAgent(agents: any[], moduleSlug: string | null, seed: string) {
  if (moduleSlug) {
    const spec = agents.filter((a) => a.specialism === moduleSlug);
    if (spec.length) return spec[0];
  }
  const generalists = agents.filter((a) => !a.specialism);
  const pool = generalists.length ? generalists : agents;
  let h = 0;
  for (const ch of seed) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return pool[h % pool.length];
}

// ---------------------------------------------------------------- handler
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  try {
    if (!ANTHROPIC_API_KEY) {
      return json(
        { error: "Support is temporarily unavailable. Please email support@smartcoretechnology.co.uk." },
        503,
      );
    }

    const authHeader = req.headers.get("Authorization") ?? "";
    const jwt = authHeader.replace(/^Bearer\s+/i, "");
    if (!jwt) return json({ error: "Not signed in." }, 401);

    const admin = createClient(SUPABASE_URL, SERVICE_KEY);
    const { data: userRes, error: userErr } = await admin.auth.getUser(jwt);
    if (userErr || !userRes?.user) return json({ error: "Not signed in." }, 401);
    const user = userRes.user;

    const body = await req.json().catch(() => ({}));
    const message: string = (body.message ?? "").toString().slice(0, 20000);
    let ticketId: string | null = body.ticket_id ?? null;
    const browserInfo = body.browser_info ?? null;

    if (!message.trim()) return json({ error: "Empty message." }, 400);

    // ---------- resolve or create the ticket ----------
    let ticket: any;

    if (ticketId) {
      const { data } = await admin
        .from("support_tickets")
        .select("*")
        .eq("id", ticketId)
        .eq("user_id", user.id)
        .maybeSingle();
      if (!data) return json({ error: "Ticket not found." }, 404);
      ticket = data;
    } else {
      // who are they?
      const { data: emp } = await admin
        .from("core_employees")
        .select("id, company_id, full_name")
        .eq("auth_user_id", user.id)
        .limit(1)
        .maybeSingle();

      let companyName = "";
      let moduleList = "";
      if (emp?.company_id) {
        const { data: co } = await admin
          .from("smartcore_core_companies")
          .select("company_name")
          .eq("id", emp.company_id)
          .maybeSingle();
        companyName = co?.company_name ?? "";

        const { data: mods } = await admin
          .from("smartcore_core_purchased_modules")
          .select("module_slug, module_name")
          .eq("company_id", emp.company_id)
          .eq("status", "active");
        moduleList = (mods ?? [])
          .map((m: any) => `${m.module_name} (${m.module_slug})`)
          .join(", ");
      }

      const { data: agents } = await admin
        .from("support_agents")
        .select("*")
        .eq("is_active", true)
        .order("sort_order");

      const agent = pickAgent(agents ?? [], null, user.id);

      const { data: created, error: createErr } = await admin
        .from("support_tickets")
        .insert({
          user_id: user.id,
          company_id: emp?.company_id ?? null,
          employee_id: emp?.id ?? null,
          contact_name: emp?.full_name ?? user.email ?? "there",
          contact_email: user.email,
          subject: message.slice(0, 80),
          status: "triage",
          agent_id: agent?.id ?? null,
          agent_name: agent?.name ?? "Jane Walsh",
          agent_title: agent?.title ?? "SmartCore Technical Support",
          browser_info: browserInfo,
        })
        .select("*")
        .single();
      if (createErr) throw createErr;
      ticket = created;
      (ticket as any)._companyName = companyName;
      (ticket as any)._moduleList = moduleList;
    }

    // enrich context if resuming
    let companyName = (ticket as any)._companyName ?? "";
    let moduleList = (ticket as any)._moduleList ?? "";
    if (!companyName && ticket.company_id) {
      const { data: co } = await admin
        .from("smartcore_core_companies")
        .select("company_name")
        .eq("id", ticket.company_id)
        .maybeSingle();
      companyName = co?.company_name ?? "";
      const { data: mods } = await admin
        .from("smartcore_core_purchased_modules")
        .select("module_slug, module_name")
        .eq("company_id", ticket.company_id)
        .eq("status", "active");
      moduleList = (mods ?? [])
        .map((m: any) => `${m.module_name} (${m.module_slug})`)
        .join(", ");
    }

    // ---------- store the user's message ----------
    await admin.from("support_messages").insert({
      ticket_id: ticket.id,
      role: "user",
      author_name: ticket.contact_name,
      content: message,
    });

    // ---------- build the transcript ----------
    const { data: history } = await admin
      .from("support_messages")
      .select("role, content")
      .eq("ticket_id", ticket.id)
      .in("role", ["user", "agent"])
      .order("created_at");

    const msgs = (history ?? []).map((m: any) => ({
      role: m.role === "user" ? "user" : "assistant",
      content: m.content,
    }));

    // ---------- ask the model ----------
    const result = await callAnthropic({
      model: CHAT_MODEL,
      max_tokens: 1600,
      system: systemPrompt({
        agentName: ticket.agent_name ?? "Jane Walsh",
        agentTitle: ticket.agent_title ?? "SmartCore Technical Support",
        userName: ticket.contact_name ?? "there",
        companyName: companyName || "not recorded",
        moduleList,
        ticketRef: ticket.ticket_ref,
      }),
      tools: [DIAGNOSIS_TOOL],
      messages: msgs,
    });

    // ---------- interpret ----------
    let replyText = "";
    let diagnosis: any = null;
    for (const block of result.content ?? []) {
      if (block.type === "text") replyText += block.text;
      if (block.type === "tool_use" && block.name === "submit_diagnosis") {
        diagnosis = block.input;
      }
    }

    let escalated = false;

    if (diagnosis) {
      replyText = diagnosis.reply || replyText;

      const patch: any = {
        subject: diagnosis.subject ?? ticket.subject,
        severity: diagnosis.severity ?? "normal",
        diagnosis: diagnosis.diagnosis ?? null,
        error_message: diagnosis.error_message ?? null,
        console_log: diagnosis.console_log ?? null,
        steps_to_repro: diagnosis.steps_to_repro ?? null,
        is_bug: !!diagnosis.is_bug,
      };

      if (diagnosis.module_slug) {
        patch.module_slug = diagnosis.module_slug;
        // re-assign to the specialist for that module
        const { data: agents } = await admin
          .from("support_agents")
          .select("*")
          .eq("is_active", true)
          .order("sort_order");
        const spec = (agents ?? []).find(
          (a: any) => a.specialism === diagnosis.module_slug,
        );
        if (spec && spec.id !== ticket.agent_id) {
          patch.agent_id = spec.id;
          patch.agent_name = spec.name;
          patch.agent_title = spec.title;
        }
      }

      if (diagnosis.is_bug) {
        patch.status = "queued_for_fix";
        escalated = true;
      } else {
        patch.status = "resolved";
        patch.resolved_at = new Date().toISOString();
      }

      await admin.from("support_tickets").update(patch).eq("id", ticket.id);
      await admin.from("support_events").insert({
        ticket_id: ticket.id,
        kind: diagnosis.is_bug ? "escalated_to_pipeline" : "closed_in_chat",
        detail: diagnosis,
      });

      if (patch.agent_name) ticket.agent_name = patch.agent_name;
      if (patch.agent_title) ticket.agent_title = patch.agent_title;
    }

    if (!replyText.trim()) {
      replyText =
        "Sorry — could you give me a bit more detail on what you're seeing?";
    }

    // ---------- store the agent reply ----------
    await admin.from("support_messages").insert({
      ticket_id: ticket.id,
      role: "agent",
      author_name: ticket.agent_name,
      content: replyText,
    });

    // ---------- kick off the fix pipeline (fire and forget) ----------
    if (escalated) {
      const url = `${SUPABASE_URL}/functions/v1/support-pipeline`;
      fetch(url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          Authorization: `Bearer ${SERVICE_KEY}`,
        },
        body: JSON.stringify({ ticket_id: ticket.id }),
      }).catch(() => {});
    }

    return json({
      ticket_id: ticket.id,
      ticket_ref: ticket.ticket_ref,
      agent_name: ticket.agent_name,
      agent_title: ticket.agent_title,
      reply: replyText,
      escalated,
      status: diagnosis
        ? diagnosis.is_bug
          ? "queued_for_fix"
          : "resolved"
        : "triage",
    });
  } catch (e) {
    console.error("support-chat", e);
    return json({ error: String((e as Error)?.message ?? e) }, 500);
  }
});
