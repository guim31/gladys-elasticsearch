import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_CONFIG, normalizeConfig, normalizeFingerprint, parseUrl } from '../src/config.js';

test('parseUrl: bare host, port, scheme, path; credentials refused', () => {
  assert.deepEqual(parseUrl('192.0.2.10'), { base: '192.0.2.10:9200', scheme: null });
  assert.deepEqual(parseUrl(' es.lan:9201 '), { base: 'es.lan:9201', scheme: null });
  assert.deepEqual(parseUrl('https://es.lan'), { base: 'es.lan', scheme: 'https' });
  assert.deepEqual(parseUrl('http://192.0.2.10:9200/'), {
    base: '192.0.2.10:9200',
    scheme: 'http',
  });
  assert.deepEqual(parseUrl('https://proxy.lan/es/?pretty#x'), {
    base: 'proxy.lan/es',
    scheme: 'https',
  });
  assert.deepEqual(parseUrl('[2001:db8::1]'), { base: '[2001:db8::1]:9200', scheme: null });
  for (const bad of ['', '   ', 'ftp://es.lan', 'https://user:pw@es.lan', 'http://', 42]) {
    assert.equal(parseUrl(bad), null, String(bad));
  }
});

test('normalizeFingerprint: colons, spaces, case and openssl prefix', () => {
  const canonical = Array(32).fill('AB').join(':');
  assert.equal(normalizeFingerprint(canonical.toLowerCase()), canonical);
  assert.equal(normalizeFingerprint('ab'.repeat(32)), canonical);
  assert.equal(normalizeFingerprint(`sha256 Fingerprint=${canonical}`), canonical);
  assert.equal(normalizeFingerprint(Array(32).fill('AB').join(' ')), canonical);
  assert.equal(normalizeFingerprint('AB:CD'), null);
  assert.equal(normalizeFingerprint('ZZ'.repeat(32)), null);
});

test('normalizeConfig: defaults, trimmed values, unknown choices', () => {
  const config = normalizeConfig({});
  assert.equal(config.url, null);
  assert.equal(config.urlTyped, false);
  assert.equal(config.pollIntervalMs, Number(DEFAULT_CONFIG.poll_interval) * 1000);
  assert.equal(config.language, 'fr');
  assert.equal(config.insecure, false);

  const typed = normalizeConfig({
    url: ' es.lan ',
    api_key: ' key ',
    username: ' gladys ',
    password: ' pa ss \n',
    poll_interval: 300,
    language: 'it',
    allow_insecure_tls: 'true',
    tls_fingerprint: 'nope',
  });
  assert.deepEqual(typed.url, { base: 'es.lan:9200', scheme: null });
  assert.equal(typed.apiKey, 'key');
  assert.equal(typed.username, 'gladys');
  assert.equal(typed.password, ' pa ss ');
  assert.equal(typed.pollIntervalMs, 300_000);
  assert.equal(typed.language, 'fr');
  assert.equal(typed.insecure, true);
  assert.equal(typed.fingerprint, null);
  assert.equal(typed.fingerprintInvalid, true);
  assert.equal(normalizeConfig({ poll_interval: '7' }).pollIntervalMs, 60_000);
});
