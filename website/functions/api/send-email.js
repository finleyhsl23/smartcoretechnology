export async function onRequestPost(context) {
  try {
    const body = await context.request.json();

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
        html: body.html || "<p>No content supplied.</p>"
      })
    });

    const data = await resendResponse.json();

    return new Response(JSON.stringify(data), {
      status: resendResponse.ok ? 200 : 500,
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
