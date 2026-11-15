// -----------------------------------------------------------------------------
// The client against the recorded answers, and every error it can meet: the
// kinds the hub turns into messages, the scheme found when none was typed.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeConfig } from '../src/config.js';
import { ERROR_KINDS, EsClient, PATHS } from '../src/es/client.js';
import { parseSnapshot, toNumber } from '../src/es/model.js';
import { FIXTURES, FakeCluster, readCluster } from './helpers/fakeCluster.js';

const client = (cluster, config = {}) =>
  new EsClient(normalizeConfig({ url: '192.0.2.10', ...config }), { request: cluster.request });

const failure = async (promise) => {
  try {
    await promise;
  } catch (err) {
    return err;
  }
  assert.fail('expected a failure');
};

test('reads Elasticsearch 8 (red) from the recorded answers', async () => {
  const snapshot = await client(new FakeCluster({ fixture: FIXTURES.es8 })).read();
  assert.equal(snapshot.product, 'Elasticsearch');
  assert.equal(snapshot.status, 'red');
  assert.equal(snapshot.statusCode, 2);
  assert.deepEqual(snapshot.redIndices, ['broken']);
  assert.equal(snapshot.unassignedShards, 1);
  assert.equal(snapshot.docCount, 3);
  assert.equal(snapshot.storeBytes, 9908);
  assert.deepEqual(snapshot.nodes, [
    {
      id: 'vfb2zX8_S2yIcglcifq--g',
      name: 'es-plain-1',
      ip: '192.0.2.12',
      roles: 'cdfhilmrstw',
      master: true,
      version: '8.19.7',
      heap: 48,
      cpu: 38,
      load: 2.72,
      disk: 96.83,
      diskFree: 15904727040,
      shards: 1,
    },
  ]);
  assert.deepEqual(snapshot.partial, []);
});

test('reads OpenSearch 2: distribution, unassigned allocation row ignored', async () => {
  const snapshot = await client(new FakeCluster({ fixture: FIXTURES.os2 })).read();
  assert.equal(snapshot.product, 'OpenSearch');
  assert.equal(snapshot.version, '2.19.3');
  assert.equal(snapshot.status, 'yellow');
  assert.equal(snapshot.nodes.length, 1);
  assert.equal(snapshot.nodes[0].shards, 6);
  assert.equal(snapshot.redIndices, null, 'not read when not red');
});

test('the disk falls back on _cat/allocation when _cat/nodes has none', () => {
  const answers = readCluster(FIXTURES.es8secure);
  delete answers.nodes[0]['disk.used_percent'];
  const snapshot = parseSnapshot(answers);
  assert.equal(snapshot.nodes[0].disk, 96);
});

test('toNumber: _cat strings, nulls, garbage', () => {
  assert.equal(toNumber('2.72'), 2.72);
  assert.equal(toNumber('45%'), 45);
  assert.equal(toNumber(12), 12);
  assert.equal(toNumber(null), null);
  assert.equal(toNumber(''), null);
  assert.equal(toNumber('n/a'), null);
  assert.equal(toNumber(Number.NaN), null);
});

test('no scheme typed: HTTPS first, HTTP when the server speaks plain HTTP', async () => {
  const plain = new FakeCluster();
  const c = client(plain);
  await c.read();
  assert.equal(c.scheme, 'http');
  assert.ok(plain.requests[0].url.startsWith('https://192.0.2.10:9200/'));
  const count = plain.requests.length;
  await c.read();
  assert.ok(plain.requests.slice(count).every((r) => r.url.startsWith('http://')));

  const secure = new FakeCluster({ scheme: 'https', trusted: true, fingerprint: 'AA' });
  const s = client(secure);
  await s.read();
  assert.equal(s.scheme, 'https');
  assert.equal(s.fingerprint, 'AA');
});

test('error kinds: down, 401, 403, 503, not Elasticsearch, other HTTP', async () => {
  const cluster = new FakeCluster();
  cluster.down = true;
  assert.equal((await failure(client(cluster).read())).kind, ERROR_KINDS.UNREACHABLE);
  cluster.down = false;

  cluster.authorization = 'ApiKey x';
  assert.equal((await failure(client(cluster).read())).kind, ERROR_KINDS.AUTH);
  cluster.authorization = null;

  for (const [status, kind] of [
    [403, ERROR_KINDS.FORBIDDEN],
    [500, ERROR_KINDS.HTTP],
  ]) {
    cluster.statusOf[PATHS.INFO] = status;
    assert.equal((await failure(client(cluster).read())).kind, kind);
  }
  delete cluster.statusOf[PATHS.INFO];

  cluster.statusOf[PATHS.HEALTH] = 503;
  assert.equal((await failure(client(cluster).read())).kind, ERROR_KINDS.NO_MASTER);
  delete cluster.statusOf[PATHS.HEALTH];

  cluster.answers.info = { hello: 'world' };
  assert.equal((await failure(client(cluster).read())).kind, ERROR_KINDS.NOT_ELASTIC);
});

test('TLS: untrusted and changed certificates carry the fingerprint', async () => {
  const cluster = new FakeCluster({ scheme: 'https', fingerprint: 'F1' });
  const untrusted = await failure(client(cluster, { url: 'https://es.lan' }).read());
  assert.equal(untrusted.kind, ERROR_KINDS.TLS_UNTRUSTED);
  assert.equal(untrusted.fingerprint, 'F1');

  const pinned = Array(32).fill('AB').join(':');
  const changed = await failure(
    client(cluster, { url: 'https://es.lan', tls_fingerprint: pinned }).read(),
  );
  assert.equal(changed.kind, ERROR_KINDS.TLS_CHANGED);

  const insecure = client(cluster, { url: 'https://es.lan', allow_insecure_tls: true });
  assert.equal((await insecure.read()).status, 'yellow');
});

test('never a credential in an error message', async () => {
  const cluster = new FakeCluster({ authorization: 'Basic other' });
  const err = await failure(client(cluster, { username: 'gladys', password: 's3cret' }).read());
  assert.ok(!err.message.includes('s3cret'));
  cluster.down = true;
  const down = await failure(client(cluster, { api_key: 'k3y' }).read());
  assert.ok(!down.message.includes('k3y'));
});
