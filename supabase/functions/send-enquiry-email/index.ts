import { serve } from "https://deno.land/std@0.224.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS"
};

function escapeHtml(value: unknown) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { type, payload, managementEmail } = await req.json();

    const resendApiKey = Deno.env.get("RESEND_API_KEY");
    const fromEmail = Deno.env.get("FROM_EMAIL") || "The Travelling Taverna <onboarding@resend.dev>";

    if (!resendApiKey) {
      return new Response(JSON.stringify({ error: "RESEND_API_KEY is not set" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    const title = type === "wholesale" ? "New wholesale enquiry" : "New contact enquiry";
    const toEmail = managementEmail || "support@smartcoretechnology.co.uk";

    const html = `
      <div style="font-family:Arial,sans-serif;max-width:680px;margin:auto">
        <h2>${escapeHtml(title)}</h2>
        <p>A new enquiry has been submitted on The Travelling Taverna | Greek Deli website.</p>
        <table style="width:100%;border-collapse:collapse">
          ${Object.entries(payload || {}).map(([key, value]) => `
            <tr>
              <td style="padding:10px;border:1px solid #ddd;font-weight:bold;text-transform:capitalize">${escapeHtml(key)}</td>
              <td style="padding:10px;border:1px solid #ddd">${escapeHtml(value)}</td>
            </tr>
          `).join("")}
        </table>
      </div>
    `;

    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${resendApiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        from: fromEmail,
        to: [toEmail],
        subject: title,
        html
      })
    });

    const result = await response.json();

    if (!response.ok) {
      return new Response(JSON.stringify({ error: result }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    return new Response(JSON.stringify({ ok: true, result }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" }
    });
  } catch (error) {
    return new Response(JSON.stringify({ error: String(error) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" }
    });
  }
});
