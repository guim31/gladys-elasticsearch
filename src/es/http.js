// -----------------------------------------------------------------------------
// The one function that talks to the network: an HTTP(S) GET on node:http /
// node:https. Not on fetch: fetch cannot trust the self-signed certificate of
// one server only, and Elasticsearch 8 serves one by default.
//
// HTTPS: the TLS handshake is done first, on its own socket, and the
// certificate checked before the request (and its credentials) is written:
//   - a pinned SHA-256 fingerprint must match exactly (the certificate the
//     user confirmed, even self-signed or for another name);
//   - otherwise, `insecure` accepts anything (the user ticked it);
//   - otherwise, the chain and the name must verify, as a browser does.
// A refused certificate rejects with `code` ERR_TLS_UNTRUSTED or
// ERR_TLS_FINGERPRINT_MISMATCH and its `fingerprint`, which the
// "Test the connection" action shows for the user to confirm.
//
// The client takes this function as a parameter: the tests replace it with an
// in-memory cluster (test/helpers/fakeCluster.js).
// -----------------------------------------------------------------------------

import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import tls from 'node:tls';

// The largest answer is `_cat/nodes` of a big cluster: about 300 bytes a node.
export const MAX_BODY_BYTES = 4 * 1024 * 1024;

const tlsError = (code, message, fingerprint) => {
  const error = new Error(message);
  error.code = code;
  error.fingerprint = fingerprint ?? null;
  return error;
};

/**
 * Open a TLS socket and check its certificate before handing it over.
 * @param {URL} target
 * @param {{ insecure: boolean, fingerprint: string|null, timeoutMs: number }} options
 * @returns {Promise<tls.TLSSocket>}
 */
export function secureSocket(target, { insecure, fingerprint, timeoutMs }) {
  const host = target.hostname.replace(/^\[|\]$/g, '');
  return new Promise((resolve, reject) => {
    const socket = tls.connect({
      host,
      port: Number(target.port) || 443,
      // SNI: a name only, never an IP address.
      ...(net.isIP(host) ? {} : { servername: host }),
      // Checked below, before any byte of the request leaves.
      rejectUnauthorized: false,
      ALPNProtocols: ['http/1.1'],
    });
    const timer = setTimeout(() => {
      socket.destroy();
      const error = new Error(`Timed out after ${timeoutMs} ms`);
      error.code = 'ETIMEDOUT';
      reject(error);
    }, timeoutMs);
    socket.once('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
    socket.once('secureConnect', () => {
      clearTimeout(timer);
      const presented = socket.getPeerCertificate()?.fingerprint256 ?? null;
      let refusal = null;
      if (fingerprint) {
        if (presented !== fingerprint) {
          refusal = tlsError(
            'ERR_TLS_FINGERPRINT_MISMATCH',
            'The certificate is not the confirmed one',
            presented,
          );
        }
      } else if (!insecure && !socket.authorized) {
        refusal = tlsError(
          'ERR_TLS_UNTRUSTED',
          `Certificate not trusted (${socket.authorizationError})`,
          presented,
        );
      }
      if (refusal) {
        socket.destroy();
        reject(refusal);
        return;
      }
      socket.removeAllListeners('error');
      resolve(socket);
    });
  });
}

/**
 * @param {string} url absolute URL
 * @param {object} [options]
 * @param {Record<string, string>} [options.headers]
 * @param {boolean} [options.insecure] accept any certificate (HTTPS only)
 * @param {string|null} [options.fingerprint] the only certificate accepted (HTTPS only)
 * @param {number} [options.timeoutMs]
 * @returns {Promise<{ status: number, body: string, fingerprint: string|null }>}
 */
export async function httpRequest(
  url,
  { headers = {}, insecure = false, fingerprint = null, timeoutMs = 10_000 } = {},
) {
  const target = new URL(url);
  const isHttps = target.protocol === 'https:';
  const socket = isHttps ? await secureSocket(target, { insecure, fingerprint, timeoutMs }) : null;
  const presented = socket?.getPeerCertificate()?.fingerprint256 ?? null;

  return new Promise((resolve, reject) => {
    const request = (isHttps ? https : http).request(
      target,
      {
        method: 'GET',
        headers,
        timeout: timeoutMs,
        // The checked socket, or a fresh connection: no keep-alive pool.
        // (With `agent: false`, Node opens its own connection and ignores
        // createConnection.)
        ...(socket ? { createConnection: () => socket } : { agent: false }),
      },
      (response) => {
        const chunks = [];
        let size = 0;
        response.on('data', (chunk) => {
          size += chunk.length;
          if (size > MAX_BODY_BYTES) {
            const error = new Error('Response too large');
            error.code = 'ERESPONSETOOLARGE';
            request.destroy(error);
            return;
          }
          chunks.push(chunk);
        });
        response.on('end', () =>
          resolve({
            status: response.statusCode ?? 0,
            body: Buffer.concat(chunks).toString('utf8'),
            fingerprint: presented,
          }),
        );
        response.on('error', reject);
      },
    );
    request.on('timeout', () => {
      const error = new Error(`Timed out after ${timeoutMs} ms`);
      error.code = 'ETIMEDOUT';
      request.destroy(error);
    });
    request.on('error', reject);
    request.end();
  });
}
