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
      return Response.json({ ok: true, version: '1.0.0', service: 'henry-proxy' }, { headers: corsHeaders });
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
      if (licenseData?.active) {
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
            message: `Henry free tier limit reached (${dailyLimit} requests/day). Upgrade to Pro at henry.ai for unlimited access, or add your own Groq key in Settings.`,
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
