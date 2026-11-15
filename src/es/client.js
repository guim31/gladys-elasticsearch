// -----------------------------------------------------------------------------
// Read-only client of one Elasticsearch or OpenSearch cluster. Every read is a
// GET of the monitoring APIs, which the `monitor` cluster privilege allows:
//
//   /                     name, cluster_uuid, version, distribution
//   /_cluster/health      status, nodes, shards
//   /_cluster/stats       indices, documents, size (filtered to these)
//   /_cat/nodes           per node: heap, CPU, load, disk
//   /_cat/allocation      per node: shards (and disk when _cat/nodes has none)
//   /_cat/indices         only when red: the names of the red indices
//
// Errors are thrown as EsError with a `kind`, the hub turns a kind into a
// message in four languages (src/texts.js). Never a credential in a message.
// -----------------------------------------------------------------------------

import { httpRequest } from './http.js';
import { parseSnapshot } from './model.js';

export const ERROR_KINDS = Object.freeze({
  UNREACHABLE: 'unreachable', // nothing answers at this address
  TLS_UNTRUSTED: 'tls_untrusted', // HTTPS certificate not trusted, fingerprint to confirm
  TLS_CHANGED: 'tls_changed', // the certificate is not the confirmed fingerprint
  AUTH: 'auth', // 401: credentials missing or refused
  FORBIDDEN: 'forbidden', // 403: the user or key lacks the monitor privilege
  NO_MASTER: 'no_master', // 503: no elected master, the cluster cannot answer
  NOT_ELASTIC: 'not_elastic', // an answer, but not from Elasticsearch / OpenSearch
  HTTP: 'http', // any other HTTP error
});

export class EsError extends Error {
  /**
   * @param {string} kind one of ERROR_KINDS
   * @param {string} message English, for the logs
   * @param {{ fingerprint?: string|null, status?: number }} [details]
   */
  constructor(kind, message, details = {}) {
    super(message);
    this.name = 'EsError';
    this.kind = kind;
    this.fingerprint = details.fingerprint ?? null;
    this.status = details.status ?? null;
  }
}

const NETWORK_CODES = new Set([
  'ECONNREFUSED',
  'ECONNRESET',
  'EHOSTUNREACH',
  'ENETUNREACH',
  'ENOTFOUND',
  'EAI_AGAIN',
  'ETIMEDOUT',
  'EPIPE',
  'ECONNABORTED',
]);

// What a plain HTTP server answers to a TLS handshake: try HTTP instead.
const isNotTls = (err) =>
  err?.code === 'EPROTO' ||
  err?.code === 'ERR_SSL_WRONG_VERSION_NUMBER' ||
  /wrong version number|packet length too long|unexpected eof/i.test(err?.message ?? '');

const NODES_COLUMNS = [
  'id',
  'name',
  'ip',
  'node.role',
  'master',
  'version',
  'heap.percent',
  'ram.percent',
  'cpu',
  'load_1m',
  'disk.used_percent',
  'disk.avail',
  'disk.total',
].join(',');

const STATS_FILTER = [
  'cluster_uuid',
  'indices.count',
  'indices.docs.count',
  'indices.store.size_in_bytes',
].join(',');

export const PATHS = Object.freeze({
  INFO: '/',
  HEALTH: '/_cluster/health',
  STATS: `/_cluster/stats?filter_path=${STATS_FILTER}`,
  NODES: `/_cat/nodes?format=json&full_id=true&bytes=b&h=${NODES_COLUMNS}`,
  ALLOCATION: '/_cat/allocation?format=json&bytes=b',
  RED_INDICES: '/_cat/indices?format=json&health=red&h=index&s=index',
});

export class EsClient {
  /**
   * @param {object} config normalized configuration (src/config.js)
   * @param {object} [options]
   * @param {Function} [options.request] httpRequest, replaced in the tests
   * @param {number} [options.timeoutMs]
   */
  constructor(config, { request = httpRequest, timeoutMs = 10_000 } = {}) {
    this.url = config.url;
    this.request = request;
    this.timeoutMs = timeoutMs;
    this.tls = { insecure: config.insecure, fingerprint: config.fingerprint };
    this.headers = { accept: 'application/json' };
    if (config.apiKey) {
      this.headers.authorization = `ApiKey ${config.apiKey}`;
    } else if (config.username) {
      const token = Buffer.from(`${config.username}:${config.password}`).toString('base64');
      this.headers.authorization = `Basic ${token}`;
    }
    // Known once a scheme answered (typed, or found by the first read).
    this.scheme = config.url?.scheme ?? null;
    /** The fingerprint of the certificate last presented, for the Test action. */
    this.fingerprint = null;
  }

  /** The address shown to the user: scheme when known, never credentials. */
  get address() {
    return `${this.scheme ?? 'http'}://${this.url.base}`;
  }

  async send(scheme, path) {
    try {
      return await this.request(`${scheme}://${this.url.base}${path}`, {
        headers: this.headers,
        insecure: this.tls.insecure,
        fingerprint: this.tls.fingerprint,
        timeoutMs: this.timeoutMs,
      });
    } catch (err) {
      if (err?.code === 'ERR_TLS_UNTRUSTED') {
        this.fingerprint = err.fingerprint ?? null;
        throw new EsError(ERROR_KINDS.TLS_UNTRUSTED, err.message, { fingerprint: err.fingerprint });
      }
      if (err?.code === 'ERR_TLS_FINGERPRINT_MISMATCH') {
        this.fingerprint = err.fingerprint ?? null;
        throw new EsError(ERROR_KINDS.TLS_CHANGED, err.message, { fingerprint: err.fingerprint });
      }
      err.network = NETWORK_CODES.has(err?.code) || isNotTls(err);
      throw err;
    }
  }

  /** One GET, the scheme found on the first call when the user typed none. */
  async raw(path) {
    // A pinned or waived certificate means HTTPS: never a fallback to HTTP.
    if (!this.scheme && (this.tls.fingerprint || this.tls.insecure)) {
      this.scheme = 'https';
    }
    if (this.scheme) {
      return this.send(this.scheme, path);
    }
    try {
      const response = await this.send('https', path);
      this.scheme = 'https';
      return response;
    } catch (err) {
      if (err instanceof EsError) {
        // A certificate to confirm: HTTPS it is.
        this.scheme = 'https';
        throw err;
      }
      // Plain HTTP only when the server answered the handshake in plain
      // HTTP: a reset or a timeout must not send the credentials in clear.
      if (!isNotTls(err)) {
        throw err;
      }
    }
    const response = await this.send('http', path);
    this.scheme = 'http';
    return response;
  }

  /**
   * @param {string} path
   * @returns {Promise<unknown>} the parsed JSON body
   */
  async get(path) {
    let response;
    try {
      response = await this.raw(path);
    } catch (err) {
      if (err instanceof EsError) {
        throw err;
      }
      throw new EsError(ERROR_KINDS.UNREACHABLE, `${this.address}: ${err.code ?? err.message}`);
    }
    if (response.fingerprint) {
      this.fingerprint = response.fingerprint;
    }
    const { status } = response;
    let body;
    try {
      body = JSON.parse(response.body);
    } catch {
      body = null;
    }
    if (status === 401) {
      throw new EsError(ERROR_KINDS.AUTH, `${path}: HTTP 401`, { status });
    }
    if (status === 403) {
      throw new EsError(ERROR_KINDS.FORBIDDEN, `${path}: HTTP 403`, { status });
    }
    if (status === 503 && path.startsWith(PATHS.HEALTH)) {
      throw new EsError(ERROR_KINDS.NO_MASTER, `${path}: HTTP 503`, { status });
    }
    if (status < 200 || status >= 300) {
      throw new EsError(ERROR_KINDS.HTTP, `${path}: HTTP ${status}`, { status });
    }
    if (body === null || typeof body !== 'object') {
      throw new EsError(ERROR_KINDS.NOT_ELASTIC, `${path}: not a JSON answer`, { status });
    }
    return body;
  }

  /** `/` alone: is this Elasticsearch or OpenSearch, which version. */
  async info() {
    const info = await this.get(PATHS.INFO);
    if (typeof info.cluster_uuid !== 'string' || typeof info.version?.number !== 'string') {
      throw new EsError(ERROR_KINDS.NOT_ELASTIC, 'No cluster_uuid or version in /');
    }
    return info;
  }

  /**
   * Everything the devices, triggers and widget show, in one snapshot.
   * The node and allocation lists are best effort: a cluster that refuses
   * them (a key limited to cluster health) still gives its cluster device.
   */
  async read() {
    const [info, health] = await Promise.all([this.info(), this.get(PATHS.HEALTH)]);
    const optional = (path) => this.get(path).catch((err) => ({ error: err }));
    const [stats, nodes, allocation] = await Promise.all([
      optional(PATHS.STATS),
      optional(PATHS.NODES),
      optional(PATHS.ALLOCATION),
    ]);
    const redIndices =
      health.status === 'red' ? await optional(PATHS.RED_INDICES) : { error: null };
    return parseSnapshot({ info, health, stats, nodes, allocation, redIndices });
  }
}
