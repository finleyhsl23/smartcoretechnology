export async function onRequestPost(context) {
  try {
    const body = await context.request.json();

    const RESEND_API_KEY = context.env.RESEND_API_KEY;

    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${RESEND_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        from: "The Travelling Taverna <onboarding@resend.dev>",
        to: [body.to || "support@smartcoretechnology.co.uk"],
        subject: body.subject || "New enquiry",
        html: body.html || "<p>No content</p>"
      })
    });

    const data = await response.json();

    return new Response(JSON.stringify(data), {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*"
      }
    });

  } catch (error) {
    return new Response(JSON.stringify({
      error: error.message
    }), {
      status: 500,
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*"
      }
    });
  }
}
