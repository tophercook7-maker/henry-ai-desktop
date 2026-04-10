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
  '/proxy/openai':     'api.openai.com',
  '/proxy/anthropic':  'api.anthropic.com',
  '/proxy/google':     'generativelanguage.googleapis.com',
  '/proxy/ddg':        'api.duckduckgo.com',
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
            },
          };

          const upstream = https.request(options, (upRes) => {
            // Strip hop-by-hop headers that cause the browser to see raw
            // chunked-encoding framing (the "0\r\n\r\n" terminator shows up
            // as a stray "0" at the end of streamed AI responses).
            const outHeaders = { ...upRes.headers };
            delete outHeaders['transfer-encoding'];
            delete outHeaders['content-encoding'];
            delete outHeaders['content-length'];
            res.writeHead(upRes.statusCode ?? 200, outHeaders);
            upRes.pipe(res);
          });

          upstream.on('error', (err) => {
            console.error('[henry-ai-proxy] upstream error:', err.message);
            if (!res.headersSent) {
              res.writeHead(502);
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

// ─────────────────────────────────────────────────────────────────────────────

export default defineConfig({
  plugins: [react(), aiProxyPlugin()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    host: '0.0.0.0',
    port: 5000,
    allowedHosts: true,
  },
});
