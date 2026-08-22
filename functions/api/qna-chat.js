export async function onRequestPost(context) {
  const { request, env } = context;

  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json',
  };

  try {
    const { message, history } = await request.json();
    if (!message || typeof message !== 'string') {
      return new Response(JSON.stringify({ error: 'Message required' }), { status: 400, headers: corsHeaders });
    }

    const ANTHROPIC_API_KEY = env.ANTHROPIC_API_KEY;
    if (!ANTHROPIC_API_KEY) {
      return new Response(JSON.stringify({ error: 'AI support is not configured' }), { status: 503, headers: corsHeaders });
    }

    const systemPrompt = `You are a helpful support assistant for SmartCore Technology, a cloud-based business management platform. SmartCore provides modules including:
- SmartCore Core (base platform, HR, employee management)
- CRM (client management, pipeline, quotes, projects)
- Flexi (client management, bookings, training plans for fitness/service businesses)
- Presence & Fire Safety (roll call, attendance, fire safety records)
- SiteSnap (digital site inspections and audit forms)
- Convoy (fleet management, vehicle checks, driver logs)
- Holiday Management (staff leave requests, approvals)
- Nova AI Assistant
- Custom modules built for specific businesses

Key details:
- Website: smartcoretechnology.co.uk
- Support email: support@smartcoretechnology.co.uk
- Download app: /download
- Manage subscription: /manage-plans
- Cancel subscription: /cancel-subscriptions
- Shop/pricing: /shop
- Q&A page: /qna
- Terms of Service: /terms-of-service
- Privacy Policy: /privacy-policy

Be concise, friendly, and helpful. If you don't know something specific, direct them to support@smartcoretechnology.co.uk. Don't make up pricing — tell them to check /shop for current pricing.`;

    const messages = [];
    if (Array.isArray(history)) {
      for (const m of history.slice(-8)) {
        if (m.role && m.content) messages.push({ role: m.role, content: m.content });
      }
    }
    messages.push({ role: 'user', content: message.slice(0, 2000) });

    const resp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'anthropic-version': '2023-06-01',
        'x-api-key': ANTHROPIC_API_KEY,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 512,
        system: systemPrompt,
        messages,
      }),
    });

    if (!resp.ok) {
      const err = await resp.text();
      console.error('Anthropic error:', err);
      return new Response(JSON.stringify({ error: 'AI unavailable, please try again shortly' }), { status: 503, headers: corsHeaders });
    }

    const data = await resp.json();
    const reply = data?.content?.[0]?.text || 'Sorry, I couldn\'t generate a response.';

    return new Response(JSON.stringify({ reply }), { headers: corsHeaders });
  } catch (e) {
    console.error('qna-chat error:', e);
    return new Response(JSON.stringify({ error: 'Something went wrong' }), { status: 500, headers: corsHeaders });
  }
}

export async function onRequestOptions() {
  return new Response(null, {
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    },
  });
}
