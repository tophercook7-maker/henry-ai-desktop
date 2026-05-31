/**
 * Henry AI Cloud Proxy — Cloudflare Worker
 * 
 * Provides shared Groq access so Henry works immediately on install.
 * No API key needed for the free tier.
 * 
 * Rate limits:
 *   Free tier: 50 requests/day per device
 *   Pro tier (license key): 2000 requests/day
 *   Unlimited: custom enterprise
 * 
 * Deploy: wrangler deploy
 * Test:   wrangler dev
 */

const GROQ_API = 'https://api.groq.com/openai/v1/chat/completions';
const FREE_DAILY_LIMIT = 50;
const PRO_DAILY_LIMIT = 2000;
const PRO_MAX_TOKENS = 8192;   // cap output to bound per-request cost on the hosted paid tier

// Pricing — single source of truth. Surfaced at GET /v1/pricing so the desktop
// app and the website can read one canonical set of numbers instead of drifting.
// Cost basis (2026): Groq 8B $0.05/$0.08 per 1M in/out, 70B $0.59/$0.79; a typical
// Henry request (~1.5k in + 0.4k out) costs ~$0.0001 (8B) to ~$0.0012 (70B).
// Loaded cost to serve a hosted user is ~$1–4/mo; monthly price clears it 4–15x.
const PRICING = {
  currency: 'USD',
  plans: {
    free:     { price: 0,     period: 'forever',  label: 'Free (BYOK / Local)', note: 'Bring your own Groq/OpenAI key or run Ollama. Unlimited, fully local.' },
    monthly:  { price: 14.99, period: 'month',    label: 'Henry Pro',           note: 'Hosted AI included — no API key needed.' },
    annual:   { price: 149,   period: 'year',     label: 'Henry Pro (Annual)',  note: '~2 months free vs monthly.' },
    lifetime: { price: 299,   period: 'one-time', label: 'Henry Pro Lifetime',  note: 'Never pay again.' },
    setup:    { price: 129,   period: 'one-time', label: 'Setup Help',          note: '30-minute white-glove setup call.' },
  },
};

// KV namespace bound as HENRY_KV in wrangler.toml
// License keys stored as KV entries: license:KEY → { tier, owner, created }
// Rate counts stored as: rate:DEVICE:DATE → count

export default {
  async fetch(request, env) {
    // CORS
    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, X-Henry-Device, X-Henry-License, X-Henry-Version',
    };
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }

    const url = new URL(request.url);

    // Health check
    if (url.pathname === '/health') {
      return Response.json({ ok: true, version: '1.1.0', service: 'henry-proxy' }, { headers: corsHeaders });
    }

    // Pricing — canonical source of truth for app + website
    if (url.pathname === '/v1/pricing') {
      return Response.json(PRICING, { headers: corsHeaders });
    }

    // Chat completions proxy
    if (url.pathname === '/v1/chat' && request.method === 'POST') {
      return handleChat(request, env, corsHeaders);
    }

    // License validation
    if (url.pathname === '/v1/license' && request.method === 'GET') {
      return handleLicense(request, env, corsHeaders);
    }

    // Usage stats
    if (url.pathname === '/v1/usage' && request.method === 'GET') {
      return handleUsage(request, env, corsHeaders);
    }

    return Response.json({ error: 'Not found' }, { status: 404, headers: corsHeaders });
  }
};

async function handleChat(request, env, corsHeaders) {
  const deviceId = request.headers.get('X-Henry-Device') || 'unknown';
  const licenseKey = request.headers.get('X-Henry-License') || '';
  const today = new Date().toISOString().slice(0, 10);

  // Determine tier
  let tier = 'free';
  let dailyLimit = FREE_DAILY_LIMIT;
  
  if (licenseKey && env.HENRY_KV) {
    try {
      const licenseData = await env.HENRY_KV.get(`license:${licenseKey}`, { type: 'json' });
      // For monthly/annual plans the license carries an `expires` ISO date.
      // Lifetime licenses omit it. A lapsed subscription silently falls back to free.
      const notExpired = !licenseData?.expires || Date.now() < new Date(licenseData.expires).getTime();
      if (licenseData?.active && notExpired) {
        tier = licenseData.tier || 'pro';
        dailyLimit = tier === 'pro' ? PRO_DAILY_LIMIT : FREE_DAILY_LIMIT;
      }
    } catch { /* invalid license, stay on free */ }
  }

  // Rate limiting
  const rateKey = `rate:${deviceId}:${today}`;
  let count = 0;
  
  if (env.HENRY_KV) {
    try {
      count = parseInt(await env.HENRY_KV.get(rateKey) || '0');
      if (count >= dailyLimit) {
        return Response.json({
          error: {
            message: `Henry free tier limit reached (${dailyLimit} requests/day). Upgrade to Henry Pro at henrysworkshop.app, or add your own Groq key in Settings for unlimited local use.`,
            type: 'rate_limit',
            tier,
            limit: dailyLimit,
            count,
          }
        }, { status: 429, headers: corsHeaders });
      }
    } catch { /* KV unavailable, allow request */ }
  }

  // Parse and validate request
  let body;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: 'Invalid JSON' }, { status: 400, headers: corsHeaders });
  }

  // Safety: cap max_tokens for free tier
  if (tier === 'free') {
    body.max_tokens = Math.min(body.max_tokens || 1024, 1024);
  } else {
    // Bound per-request output cost on the hosted paid tier (fair use).
    body.max_tokens = Math.min(body.max_tokens || PRO_MAX_TOKENS, PRO_MAX_TOKENS);
  }

  // Force fast model on free tier to manage costs
  if (tier === 'free') {
    body.model = 'llama-3.1-8b-instant';
  }

  // Forward to Groq
  const groqKey = env.GROQ_API_KEY;
  if (!groqKey) {
    return Response.json({ error: { message: 'Proxy misconfigured' } }, { status: 500, headers: corsHeaders });
  }

  try {
    const groqResp = await fetch(GROQ_API, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${groqKey}`,
      },
      body: JSON.stringify(body),
    });

    // Increment rate counter on success
    if (groqResp.ok && env.HENRY_KV) {
      env.HENRY_KV.put(rateKey, String(count + 1), { expirationTtl: 86400 }).catch(() => {});
    }

    // Stream or return response
    const respHeaders = {
      ...corsHeaders,
      'Content-Type': groqResp.headers.get('Content-Type') || 'application/json',
      'X-Henry-Tier': tier,
      'X-Henry-Usage': `${count + 1}/${dailyLimit}`,
    };

    return new Response(groqResp.body, {
      status: groqResp.status,
      headers: respHeaders,
    });
  } catch (e) {
    return Response.json({
      error: { message: 'Proxy error: ' + (e.message || 'unknown') }
    }, { status: 502, headers: corsHeaders });
  }
}

async function handleLicense(request, env, corsHeaders) {
  const licenseKey = request.headers.get('X-Henry-License') || '';
  if (!licenseKey || !env.HENRY_KV) {
    return Response.json({ valid: false, tier: 'free' }, { headers: corsHeaders });
  }
  try {
    const data = await env.HENRY_KV.get(`license:${licenseKey}`, { type: 'json' });
    if (data?.active) {
      return Response.json({ valid: true, tier: data.tier, owner: data.owner }, { headers: corsHeaders });
    }
  } catch { }
  return Response.json({ valid: false, tier: 'free' }, { headers: corsHeaders });
}

async function handleUsage(request, env, corsHeaders) {
  const deviceId = request.headers.get('X-Henry-Device') || 'unknown';
  const today = new Date().toISOString().slice(0, 10);
  const rateKey = `rate:${deviceId}:${today}`;
  let count = 0;
  if (env.HENRY_KV) {
    count = parseInt(await env.HENRY_KV.get(rateKey).catch(() => '0') || '0');
  }
  return Response.json({
    date: today,
    used: count,
    limit: FREE_DAILY_LIMIT,
    remaining: Math.max(0, FREE_DAILY_LIMIT - count),
  }, { headers: corsHeaders });
}
