/**
 * Henry VPN — SOCKS5 + HTTP CONNECT proxy server
 * Pure Node.js, zero external dependencies.
 * Routes iPhone traffic through the Mac's internet connection.
 */

import * as net from 'net';
import * as http from 'http';
import * as https from 'https';

let _proxyServer: net.Server | null = null;
let _proxyPort = 0;
let _proxyRunning = false;

export function getProxyPort(): number { return _proxyPort; }
export function isProxyRunning(): boolean { return _proxyRunning; }

// ── SOCKS5 proxy implementation ────────────────────────────────────────────
export function startProxy(port = 1080): Promise<number> {
  return new Promise((resolve, reject) => {
    if (_proxyServer) { resolve(_proxyPort); return; }

    _proxyServer = net.createServer((client) => {
      handleSocks5(client);
    });

    _proxyServer.on('error', (err) => {
      console.error('[Proxy] Error:', err.message);
      if (!_proxyRunning) reject(err);
    });

    _proxyServer.listen(port, '0.0.0.0', () => {
      _proxyPort = (_proxyServer!.address() as net.AddressInfo).port;
      _proxyRunning = true;
      console.log(`[Proxy] SOCKS5 proxy listening on port ${_proxyPort}`);
      resolve(_proxyPort);
    });
  });
}

export function stopProxy(): void {
  _proxyServer?.close();
  _proxyServer = null;
  _proxyRunning = false;
  _proxyPort = 0;
}

function handleSocks5(client: net.Socket): void {
  client.once('data', (greeting) => {
    // SOCKS5 greeting: VER NMETHODS METHODS...
    if (greeting[0] !== 0x05) { client.destroy(); return; }
    // Reply: no auth required (0x00)
    client.write(Buffer.from([0x05, 0x00]));

    client.once('data', (request) => {
      // Request: VER CMD RSV ATYP DST.ADDR DST.PORT
      if (request[0] !== 0x05 || request[1] !== 0x01) { // Only CONNECT
        client.write(Buffer.from([0x05, 0x07, 0x00, 0x01, 0,0,0,0, 0,0]));
        client.destroy(); return;
      }

      const atyp = request[3];
      let host = '';
      let portOffset = 4;

      if (atyp === 0x01) {
        // IPv4
        host = `${request[4]}.${request[5]}.${request[6]}.${request[7]}`;
        portOffset = 8;
      } else if (atyp === 0x03) {
        // Domain name
        const len = Number(request[4]);
        host = request.slice(5, 5 + len).toString('utf8');
        portOffset = 5 + len;
      } else if (atyp === 0x04) {
        // IPv6
        const parts: string[] = [];
        for (let i = 0; i < 16; i += 2) parts.push(request.slice(4+i,6+i).toString('hex'));
        host = parts.join(':');
        portOffset = 20;
      } else {
        client.write(Buffer.from([0x05, 0x08, 0x00, 0x01, 0,0,0,0, 0,0]));
        client.destroy(); return;
      }

      const port = (Number(request[portOffset]) << 8) | Number(request[portOffset + 1]);

      // Connect to destination
      const remote = net.createConnection({ host, port }, () => {
        // Success response
        const resp = Buffer.alloc(10);
        resp[0] = 0x05; resp[1] = 0x00; resp[2] = 0x00; resp[3] = 0x01;
        const addr = remote.localAddress?.split('.').map(Number) || [0,0,0,0];
        resp[4] = addr[0]; resp[5] = addr[1]; resp[6] = addr[2]; resp[7] = addr[3];
        const lport = remote.localPort || 0;
        resp[8] = (lport >> 8) & 0xff; resp[9] = lport & 0xff;
        client.write(resp);
        // Pipe bidirectionally
        remote.pipe(client);
        client.pipe(remote);
      });

      remote.on('error', () => {
        client.write(Buffer.from([0x05, 0x05, 0x00, 0x01, 0,0,0,0, 0,0]));
        client.destroy();
      });
      client.on('error', () => remote.destroy());
      remote.on('close', () => client.destroy());
      client.on('close', () => remote.destroy());
    });
  });

  client.on('error', () => {});
}
