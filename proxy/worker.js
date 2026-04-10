/**
 * Henry AI — Cloudflare Worker API Proxy
 *
 * Proxies AI provider calls from mobile Capacitor apps (iOS/Android)
 * where a local Vite dev server isn't available.
 *
 * Deploy:
 *   cd proxy
 *   npx wrangler deploy
 *
 * Supported routes:
 *   /proxy/openai/*      → api.openai.com
 *   /proxy/anthropic/*   → api.anthropic.com
 *   /proxy/google/*      → generativelanguage.googleapis.com
 *   /proxy/groq/*        → api.groq.com
 *   /proxy/openrouter/*  → openrouter.ai
 *   /proxy/ddg/*         → api.duckduckgo.com
 */

const ROUTES = {
  '/proxy/openai':     'https://api.openai.com',
  '/proxy/anthropic':  'https://api.anthropic.com',
  '/proxy/google':     'https://generativelanguage.googleapis.com',
  '/proxy/groq':       'https://api.groq.com',
  '/proxy/openrouter': 'https://openrouter.ai',
  '/proxy/ddg':        'https://api.duckduckgo.com',
};

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': '*',
  'Access-Control-Max-Age': '86400',
};

export default {
  async fetch(request, env, ctx) {
    // Handle CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    const url = new URL(request.url);
    const path = url.pathname;

    // Find matching route prefix
    const entry = Object.entries(ROUTES).find(([prefix]) => path.startsWith(prefix));
    if (!entry) {
      return new Response(JSON.stringify({ error: 'Unknown proxy route' }), {
        status: 404,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      });
    }

    const [prefix, targetBase] = entry;
    const upstreamPath = path.slice(prefix.length) || '/';
    const targetUrl = `${targetBase}${upstreamPath}${url.search}`;

    // Build forwarded headers — strip browser-only headers
    const forwardHeaders = new Headers(request.headers);
    forwardHeaders.delete('host');
    forwardHeaders.delete('origin');
    forwardHeaders.delete('referer');
    forwardHeaders.delete('cf-connecting-ip');
    forwardHeaders.delete('cf-ray');
    forwardHeaders.delete('cf-visitor');
    forwardHeaders.delete('cf-ipcountry');
    forwardHeaders.delete('x-forwarded-for');
    forwardHeaders.delete('x-forwarded-proto');

    let response;
    try {
      response = await fetch(targetUrl, {
        method: request.method,
        headers: forwardHeaders,
        body: request.method !== 'GET' && request.method !== 'HEAD' ? request.body : undefined,
      });
    } catch (err) {
      return new Response(JSON.stringify({ error: String(err) }), {
        status: 502,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      });
    }

    // Build response headers — add CORS, strip hop-by-hop headers
    const responseHeaders = new Headers(response.headers);
    Object.entries(CORS_HEADERS).forEach(([k, v]) => responseHeaders.set(k, v));
    responseHeaders.delete('transfer-encoding');
    responseHeaders.delete('content-encoding'); // Cloudflare handles encoding

    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers: responseHeaders,
    });
  },
};
