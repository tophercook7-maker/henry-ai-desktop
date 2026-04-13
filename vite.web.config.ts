import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import https from 'https';
import http from 'http';
import type { IncomingMessage, ServerResponse } from 'http';

// ── AI Proxy Plugin ──────────────────────────────────────────────────────────
// Manually proxies /proxy/{provider}/* → external API server-side.
// This avoids browser CORS/mixed-content blocks and Vite proxy streaming issues.
const routes: Record<string, string> = {
  '/proxy/openai':      'api.openai.com',
  '/proxy/anthropic':   'api.anthropic.com',
  '/proxy/google':      'generativelanguage.googleapis.com',
  '/proxy/groq':        'api.groq.com',
  '/proxy/openrouter':  'openrouter.ai',
  '/proxy/ddg':         'api.duckduckgo.com',
  // Dev & productivity services (user-token-based)
  '/proxy/github':      'api.github.com',
  '/proxy/linear':      'api.linear.app',
  '/proxy/notion':      'api.notion.com',
  '/proxy/stripe':      'api.stripe.com',
  '/proxy/gcal':        'www.googleapis.com',
  '/proxy/gmail':       'gmail.googleapis.com',
  '/proxy/slack':       'slack.com',
};

function aiProxyPlugin(): Plugin {
  return {
    name: 'henry-ai-proxy',
    configureServer(server) {
      server.middlewares.use((req: IncomingMessage, res: ServerResponse, next: () => void) => {
        const url = req.url ?? '';
        const entry = Object.entries(routes).find(([prefix]) => url.startsWith(prefix));
        if (!entry) return next();

        const [prefix, host] = entry;
        const upstreamPath = url.slice(prefix.length) || '/';

        const chunks: Buffer[] = [];
        req.on('data', (chunk: Buffer) => chunks.push(chunk));
        req.on('end', () => {
          const body = Buffer.concat(chunks);
          console.log(`[henry-proxy] ${req.method} ${url} → ${host} (body: ${body.length}b)`);

          // Forward all original headers except host
          const forwardHeaders: Record<string, string | string[] | undefined> = {};
          for (const [k, v] of Object.entries(req.headers)) {
            if (k.toLowerCase() !== 'host') forwardHeaders[k] = v as string;
          }
          // Remove browser-level CORS hints that upset some APIs
          delete forwardHeaders['origin'];
          delete forwardHeaders['referer'];

          const options: https.RequestOptions = {
            hostname: host,
            port: 443,
            path: upstreamPath,
            method: req.method,
            headers: {
              ...forwardHeaders,
              host,
              'content-length': body.length,
              // Force plain uncompressed responses — the proxy pipes the raw
              // bytes straight to the browser, so gzip would arrive garbled.
              'accept-encoding': 'identity',
            },
          };

          // Handle CORS preflight from sandboxed iframes
          if (req.method === 'OPTIONS') {
            res.writeHead(204, {
              'Access-Control-Allow-Origin': '*',
              'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
              'Access-Control-Allow-Headers': '*',
              'Access-Control-Max-Age': '86400',
            });
            res.end();
            return;
          }

          const upstream = https.request(options, (upRes) => {
            const status = upRes.statusCode ?? 200;
            console.log(`[henry-proxy] ← ${status} ${upRes.headers['content-type'] ?? ''}`);

            const outHeaders: Record<string, string | string[]> = {};
            // Copy safe headers — skip hop-by-hop and encoding headers that
            // would confuse the browser or the Replit proxy layer.
            const skipHeaders = new Set([
              'content-encoding',   // prevent gzip garbling
              'content-length',     // length is invalid after re-framing
              'connection',
              'keep-alive',
              'proxy-authenticate',
              'proxy-authorization',
              'te',
              'trailers',
              'upgrade',
            ]);
            for (const [k, v] of Object.entries(upRes.headers)) {
              if (!skipHeaders.has(k.toLowerCase()) && v !== undefined) {
                outHeaders[k] = v as string | string[];
              }
            }
            // Always allow cross-origin access (Replit workspace iframes run
            // with opaque origins so every request looks cross-origin)
            outHeaders['access-control-allow-origin'] = '*';
            outHeaders['access-control-allow-headers'] = '*';
            // Keep transfer-encoding: chunked so Replit's reverse proxy knows
            // to stream each chunk rather than buffer the whole response.
            if (!outHeaders['transfer-encoding']) {
              outHeaders['transfer-encoding'] = 'chunked';
            }

            res.writeHead(status, outHeaders);

            // Pipe upstream → response; handle errors gracefully so an
            // upstream drop doesn't leave the client hanging forever.
            upRes.pipe(res);
            upRes.on('error', (pipeErr) => {
              console.error('[henry-proxy] upstream pipe error:', pipeErr.message);
              try { res.end(); } catch { /* already closed */ }
            });
          });

          upstream.on('error', (err) => {
            console.error('[henry-proxy] upstream connect error:', err.message);
            if (!res.headersSent) {
              res.writeHead(502, { 'Access-Control-Allow-Origin': '*' });
              res.end(JSON.stringify({ error: err.message }));
            }
          });

          upstream.write(body);
          upstream.end();
        });
      });
    },
  };
}

// ── Replit Connector Proxy Plugin ────────────────────────────────────────────
// Routes /connector/{service}/* → Replit OAuth-managed connector via @replit/connectors-sdk
// Used for: Slack (OAuth managed by Replit, no manual token needed)
function connectorProxyPlugin(): Plugin {
  return {
    name: 'henry-connector-proxy',
    configureServer(server) {
      server.middlewares.use((req: IncomingMessage, res: ServerResponse, next: () => void) => {
        const url = req.url ?? '';
        const match = url.match(/^\/connector\/([^/?]+)(.*)/);
        if (!match) return next();

        const [, service, apiPath] = match;

        const chunks: Buffer[] = [];
        req.on('data', (chunk: Buffer) => chunks.push(chunk));
        req.on('end', async () => {
          const body = Buffer.concat(chunks);
          const CORS = {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
            'Access-Control-Allow-Headers': '*',
          };
          try {
            // Dynamic import keeps the Vite config tree-shakeable
            const { ReplitConnectors } = await import('@replit/connectors-sdk');
            const connectors = new ReplitConnectors();

            const fetchOpts: Record<string, unknown> = { method: req.method || 'GET' };
            if (body.length > 0) {
              fetchOpts.body = body;
              fetchOpts.headers = { 'content-type': req.headers['content-type'] || 'application/json' };
            }

            const upstream = await connectors.proxy(service, apiPath || '/', fetchOpts as any);
            const data = await upstream.text();

            const contentType = upstream.headers.get('content-type') || 'application/json';
            res.writeHead(upstream.status, { ...CORS, 'Content-Type': contentType });
            res.end(data);
          } catch (err: any) {
            console.error(`[henry-connector-proxy] ${service}${apiPath} error:`, err.message);
            if (!res.headersSent) {
              res.writeHead(502, { ...CORS, 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ error: err.message }));
            }
          }
        });
      });
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────────

export default defineConfig({
  plugins: [react(), aiProxyPlugin(), connectorProxyPlugin()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  define: {
    // Expose GROQ_API_KEY from server env into browser bundle so Henry can
    // auto-bootstrap the Groq provider without the setup wizard.
    __GROQ_API_KEY__: JSON.stringify(process.env.GROQ_API_KEY || ''),
  },
  server: {
    host: '0.0.0.0',
    port: 5000,
    allowedHosts: true,
    hmr: true,
    headers: {
      'Cache-Control': 'no-store, no-cache, must-revalidate',
      'Pragma': 'no-cache',
    },
  },
});
