// -----------------------------------------------------------------------------
// Integration configuration: defaults (they mirror the `default` values of the
// manifest `config_schema`, see test/manifest.test.js) and normalization, so
// the rest of the code never deals with strings, blanks or `undefined`.
//
// One cluster, Elasticsearch or OpenSearch. The devices are keyed on the
// `cluster_uuid` the cluster reports, not on the address: typing a new IP or a
// host name keeps the devices and their history.
// -----------------------------------------------------------------------------

export const LANGUAGES = ['en', 'fr', 'de', 'es'];

// The HTTP port of Elasticsearch and OpenSearch.
export const DEFAULT_PORT = 9200;

// Refresh intervals offered in the configuration, in seconds.
export const POLL_INTERVALS = ['30', '60', '120', '300'];

export const DEFAULT_CONFIG = {
  url: '',
  api_key: '',
  username: '',
  password: '',
  tls_fingerprint: '',
  allow_insecure_tls: false,
  poll_interval: '60',
  language: 'fr',
};

/**
 * Parse the address typed by the user: a bare host or IP (`192.0.2.10`, port
 * 9200 added), `host:port`, or a full URL (`https://es.lan:9200`). A path is
 * kept (a cluster behind a reverse proxy sub-path), a query or fragment is
 * dropped. Without a scheme, `scheme` is null: the client tries HTTPS, then
 * HTTP (Elasticsearch 8 serves HTTPS by default, most home setups HTTP).
 * @param {unknown} raw
 * @returns {{ base: string, scheme: 'http'|'https'|null }|null} base without scheme
 */
export function parseUrl(raw) {
  if (typeof raw !== 'string') {
    return null;
  }
  const text = raw.trim();
  if (!text) {
    return null;
  }
  const hasScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(text);
  let url;
  try {
    url = new URL(hasScheme ? text : `http://${text}`);
  } catch {
    return null;
  }
  if (!['http:', 'https:'].includes(url.protocol) || !url.hostname) {
    return null;
  }
  // Credentials in the address would end up in the logs and the messages.
  if (url.username || url.password) {
    return null;
  }
  if (!hasScheme && !url.port) {
    url.port = String(DEFAULT_PORT);
  }
  const path = url.pathname.replace(/\/+$/, '');
  return {
    base: `${url.host}${path}`,
    scheme: hasScheme ? url.protocol.slice(0, -1) : null,
  };
}

/**
 * A SHA-256 certificate fingerprint as typed or pasted (`AB:CD:…`, spaces,
 * lower case, `sha256 Fingerprint=` prefix from openssl), in the form of
 * Node's `fingerprint256`; null when it is not 32 bytes of hexadecimal.
 * @param {unknown} raw
 * @returns {string|null}
 */
export function normalizeFingerprint(raw) {
  if (typeof raw !== 'string') {
    return null;
  }
  const hex = raw.replace(/^.*=/, '').replace(/[\s:]/g, '').toUpperCase();
  if (!/^[0-9A-F]{64}$/.test(hex)) {
    return null;
  }
  return hex.match(/../g).join(':');
}

/**
 * @param {Record<string, unknown>} raw the configuration returned by the SDK
 */
export function normalizeConfig(raw = {}) {
  const source = raw && typeof raw === 'object' ? raw : {};
  const text = (key) => (typeof source[key] === 'string' ? source[key].trim() : '');
  const pick = (key, list) => {
    const value = source[key] === undefined || source[key] === null ? '' : String(source[key]);
    return list.includes(value) ? value : DEFAULT_CONFIG[key];
  };
  // A pasted secret often carries a trailing new line; spaces inside are kept.
  const secret = (key) =>
    typeof source[key] === 'string' ? source[key].replace(/^[\r\n]+|[\r\n]+$/g, '') : '';

  const typed = text('url');
  const typedFingerprint = text('tls_fingerprint');
  const fingerprint = normalizeFingerprint(typedFingerprint);
  return {
    url: typed ? parseUrl(typed) : null,
    urlTyped: typed !== '',
    apiKey: text('api_key'),
    username: text('username'),
    password: secret('password'),
    fingerprint,
    fingerprintInvalid: typedFingerprint !== '' && fingerprint === null,
    insecure: source.allow_insecure_tls === true || source.allow_insecure_tls === 'true',
    pollIntervalMs: Number(pick('poll_interval', POLL_INTERVALS)) * 1000,
    language: LANGUAGES.includes(source.language) ? source.language : DEFAULT_CONFIG.language,
  };
}
