export async function onRequest(context) {
  const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type"
  };

  if (context.request.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: corsHeaders
    });
  }

  if (context.request.method !== "POST") {
    return new Response("Method Not Allowed", {
      status: 405,
      headers: corsHeaders
    });
  }

  try {
    const body = await context.request.json();

    if (!context.env.RESEND_API_KEY) {
      return new Response(JSON.stringify({
        error: "Missing RESEND_API_KEY environment variable"
      }), {
        status: 500,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json"
        }
      });
    }

    const resendResponse = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${context.env.RESEND_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        from: "The Travelling Taverna <onboarding@resend.dev>",
        to: [body.to || "support@smartcoretechnology.co.uk"],
        subject: body.subject || "New website enquiry",
        html: body.html || "<p>No email content supplied.</p>"
      })
    });

    const resendData = await resendResponse.json();

    return new Response(JSON.stringify(resendData), {
      status: resendResponse.ok ? 200 : 500,
      headers: {
        ...corsHeaders,
        "Content-Type": "application/json"
      }
    });
  } catch (error) {
    return new Response(JSON.stringify({
      error: error.message
    }), {
      status: 500,
      headers: {
        ...corsHeaders,
        "Content-Type": "application/json"
      }
    });
  }
}
