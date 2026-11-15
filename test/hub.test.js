// -----------------------------------------------------------------------------
// The integration end to end, against the SDK's fake Gladys and an in-memory
// cluster serving recorded answers (test/helpers/fakeCluster.js): discovery,
// states, transports, connection status, scene triggers, persistence, the
// own timer, the quiet logs.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEVICE_TRANSPORTS } from '@gladysassistant/integration-sdk';
import { DEVICE_TYPES, FEATURE_KEYS, nodePlatformId } from '../src/devices.js';
import { TRIGGERS } from '../src/hub.js';
import { CONNECTION_TEXT, ERROR_TEXT } from '../src/texts.js';
import { ERROR_KINDS } from '../src/es/client.js';
import { FIXTURES, FakeCluster, addAll, createWorld, threeNodes } from './helpers/fakeCluster.js';

process.env.LOG_LEVEL ??= 'silent';

const UUID = '75halD23RNmLr7hWxh9YLw'; // es8secure fixture
const ids = (gladys, type, platformId) => gladys.externalIds(type, platformId);
const clusterIds = (gladys) => ids(gladys, DEVICE_TYPES.CLUSTER, UUID);
const nodeIds = (gladys, nodeId) => ids(gladys, DEVICE_TYPES.NODE, nodePlatformId(UUID, nodeId));

test('discovers the cluster and its node, with should_poll false', async () => {
  const { gladys, app } = await createWorld();
  const devices = gladys.fake.discoveredDevices;
  assert.deepEqual(
    devices.map((device) => device.name),
    ['Elasticsearch home-cluster', 'es-node-1'],
  );
  assert.equal(devices[0].external_id, clusterIds(gladys).device);
  assert.equal(devices[1].external_id, nodeIds(gladys, 'uXeGC2wfSRKgB9WpRDq6zg').device);
  for (const device of devices) {
    assert.equal(device.should_poll, false);
    assert.equal(device.poll_frequency, undefined);
  }
  assert.deepEqual(gladys.fake.connectionStatus, { connected: true });
  await app.stop();
});

test('publishes the states of the added devices only, then only the changes', async () => {
  const world = await createWorld();
  const { gladys, hub, cluster } = world;
  assert.equal(gladys.fake.states.length, 0, 'nothing added yet');
  await addAll(world);
  const cluster_ = clusterIds(gladys);
  const node = nodeIds(gladys, 'uXeGC2wfSRKgB9WpRDq6zg');
  assert.equal(gladys.fake.lastState(cluster_.feature(FEATURE_KEYS.STATUS)), 1);
  assert.equal(gladys.fake.lastState(cluster_.feature(FEATURE_KEYS.UNASSIGNED_SHARDS)), 1);
  assert.equal(gladys.fake.lastState(cluster_.feature(FEATURE_KEYS.DOCUMENTS)), 39);
  assert.equal(gladys.fake.lastState(cluster_.feature(FEATURE_KEYS.STORE_SIZE)), 0);
  assert.equal(
    gladys.fake.lastState(cluster_.feature(FEATURE_KEYS.VERSION)),
    'Elasticsearch 8.19.7',
  );
  assert.equal(gladys.fake.lastState(node.feature(FEATURE_KEYS.DISK)), 96.8);
  assert.equal(gladys.fake.lastState(node.feature(FEATURE_KEYS.HEAP)), 52);
  assert.equal(gladys.fake.lastState(node.feature(FEATURE_KEYS.LOAD)), 2.72);
  assert.equal(gladys.fake.lastState(node.feature(FEATURE_KEYS.SHARDS)), 4);
  assert.equal(gladys.fake.lastState(node.feature(FEATURE_KEYS.IN_CLUSTER)), 1);

  const before = gladys.fake.states.length;
  await hub.poll();
  assert.equal(gladys.fake.states.length, before, 'nothing changed, nothing sent');

  cluster.setStatus('green', 0);
  await hub.poll();
  const sent = gladys.fake.states.slice(before);
  assert.deepEqual(
    sent.map((state) => state.device_feature_external_id).sort(),
    [
      cluster_.feature(FEATURE_KEYS.STATUS),
      cluster_.feature(FEATURE_KEYS.UNASSIGNED_SHARDS),
    ].sort(),
  );
  assert.equal(gladys.fake.lastState(cluster_.feature(FEATURE_KEYS.STATUS)), 0);
  await world.app.stop();
});

test('republishes every state when a device is added, and past the heartbeat', async (t) => {
  // publishChangedStates dates the heartbeat with the SDK clock.
  t.mock.timers.enable({ apis: ['Date'], now: Date.parse('2026-11-15T10:00:00Z') });
  const world = await createWorld();
  await addAll(world);
  const { gladys, hub } = world;
  const status = clusterIds(gladys).feature(FEATURE_KEYS.STATUS);
  const count = () =>
    gladys.fake.states.filter((s) => s.device_feature_external_id === status).length;
  assert.equal(count(), 1);
  await gladys.fake.deviceUpdated(gladys.fake.devices[0]);
  assert.equal(count(), 2, 'sent again after "Update"');
  await hub.poll();
  assert.equal(count(), 2);
  t.mock.timers.setTime(Date.parse('2026-11-15T16:00:01Z'));
  await hub.poll();
  assert.equal(count(), 3, 'heartbeat');
  await world.app.stop();
});

test('fires cluster_status_changed on a change only, and remembers across restarts', async () => {
  const cluster = new FakeCluster();
  const world = await createWorld({ cluster });
  const { gladys, hub } = world;
  assert.equal(gladys.fake.sceneEvents.length, 0, 'first status: recorded, no event');
  await hub.poll();
  assert.equal(gladys.fake.sceneEvents.length, 0);

  cluster.setStatus('red', 3);
  await hub.poll();
  const [event] = gladys.fake.sceneEvents;
  assert.equal(event.key, TRIGGERS.STATUS);
  assert.deepEqual(event.data, {
    status: 'red',
    cluster_name: 'home-cluster',
    previous_status: 'yellow',
    unassigned_shards: 3,
    red_indices: 'logs-broken',
  });
  await world.app.stop();

  // A restart with the same /data: no new event for the same status…
  const again = await createWorld({ cluster, directory: world.directory });
  assert.equal(again.gladys.fake.sceneEvents.length, 0);
  // …and a change while it was stopped is announced.
  cluster.setStatus('green');
  await again.hub.poll();
  assert.deepEqual(
    again.gladys.fake.sceneEvents.map((e) => [e.data.previous_status, e.data.status]),
    [['red', 'green']],
  );
  await again.app.stop();
});

test('fires disk_almost_full once per step crossed, again after 2 points below', async () => {
  const cluster = new FakeCluster();
  threeNodes(cluster.answers);
  const world = await createWorld({ cluster });
  const { gladys, hub } = world;
  const disks = () => gladys.fake.sceneEvents.filter((e) => e.key === TRIGGERS.DISK);

  cluster.setDisk('es-2', 86);
  await hub.poll();
  assert.deepEqual(
    disks().map((e) => [e.data.node_name, e.data.threshold]),
    [
      ['es-2', 80],
      ['es-2', 85],
    ],
  );
  const [first] = disks();
  assert.equal(first.data.node, nodeIds(gladys, 'bBbBbBbBbBbBbBbBbBbBbB').device);
  assert.equal(first.data.used_percent, 86);
  assert.equal(first.data.cluster_name, 'home-cluster');
  assert.equal(typeof first.data.free_gb, 'number');

  cluster.setDisk('es-2', 84);
  await hub.poll();
  cluster.setDisk('es-2', 85.5);
  await hub.poll();
  assert.equal(disks().length, 2, 'not 2 points below 85: no new event');
  cluster.setDisk('es-2', 82);
  await hub.poll();
  cluster.setDisk('es-2', 85);
  await hub.poll();
  assert.deepEqual(
    disks().map((e) => e.data.threshold),
    [80, 85, 85],
  );
  await world.app.stop();
});

test('a stopped cluster: one failure is retried, two make it unreachable', async () => {
  const cluster = new FakeCluster();
  const world = await createWorld({ cluster, config: { language: 'fr' } });
  await addAll(world);
  const { gladys, hub } = world;

  cluster.down = true;
  await hub.poll();
  assert.deepEqual(gladys.fake.connectionStatus, { connected: true }, 'a blip is not a failure');
  assert.equal(gladys.fake.sceneEvents.length, 0);

  await hub.poll();
  assert.deepEqual(gladys.fake.connectionStatus, {
    connected: false,
    message: ERROR_TEXT[ERROR_KINDS.UNREACHABLE],
  });
  assert.deepEqual(gladys.fake.sceneEvents, [
    {
      key: TRIGGERS.UNREACHABLE,
      // The name given in Gladys to the cluster device, once added.
      data: {
        cluster_name: 'Elasticsearch home-cluster',
        error: ERROR_TEXT[ERROR_KINDS.UNREACHABLE].fr,
      },
    },
  ]);
  const unreachable = gladys.fake.transports.slice(-2);
  assert.ok(unreachable.every((entry) => entry.transport === DEVICE_TRANSPORTS.UNREACHABLE));

  await hub.poll();
  assert.equal(gladys.fake.sceneEvents.length, 1, 'announced once');

  cluster.down = false;
  await hub.poll();
  assert.deepEqual(gladys.fake.connectionStatus, { connected: true });
  assert.ok(gladys.fake.transports.slice(-2).every((e) => e.transport === DEVICE_TRANSPORTS.LOCAL));
  await world.app.stop();
});

test('a cluster never reached is not announced unreachable (certificate to confirm)', async () => {
  const cluster = new FakeCluster({ scheme: 'https', fingerprint: 'F1' });
  const world = await createWorld({ cluster });
  await world.gladys.fake.action('test_connection');
  await world.hub.poll();
  assert.deepEqual(world.gladys.fake.sceneEvents, []);
  assert.equal(world.gladys.fake.connectionStatus.connected, false);
  await world.app.stop();
});

test('a node that leaves the cluster: in_cluster 0 and the unreachable badge', async () => {
  const cluster = new FakeCluster();
  threeNodes(cluster.answers);
  const world = await createWorld({ cluster });
  await addAll(world);
  const { gladys, hub } = world;
  const es3 = nodeIds(gladys, 'cCcCcCcCcCcCcCcCcCcCcC');
  assert.equal(gladys.fake.lastState(es3.feature(FEATURE_KEYS.IN_CLUSTER)), 1);

  cluster.answers.nodes.pop();
  await hub.poll();
  assert.equal(gladys.fake.lastState(es3.feature(FEATURE_KEYS.IN_CLUSTER)), 0);
  assert.deepEqual(gladys.fake.transports.at(-1), {
    device_external_id: es3.device,
    transport: DEVICE_TRANSPORTS.UNREACHABLE,
  });
  assert.equal(
    gladys.fake.discoveredDevices.length,
    3,
    'the Discovery tab lists the nodes present only',
  );
  await world.app.stop();
});

test('connection status explains a missing or wrong address, in four languages', async () => {
  const empty = await createWorld({ config: { url: '' } });
  assert.deepEqual(empty.gladys.fake.connectionStatus, {
    connected: false,
    message: CONNECTION_TEXT.noUrl,
  });
  await empty.gladys.fake.configUpdated({ url: 'ftp://nowhere' });
  assert.deepEqual(empty.gladys.fake.connectionStatus, {
    connected: false,
    message: CONNECTION_TEXT.invalidUrl,
  });
  const ack = await empty.gladys.fake.action('test_connection');
  assert.deepEqual(ack.data.message, CONNECTION_TEXT.invalidUrl);
  await empty.app.stop();
});

test('HTTPS: an untrusted certificate shows its fingerprint, pinning it connects', async () => {
  const fingerprint = Array(32).fill('C3').join(':');
  const cluster = new FakeCluster({ scheme: 'https', fingerprint });
  const world = await createWorld({ cluster, config: { url: 'es.lan' } });
  const { gladys } = world;
  assert.equal(gladys.fake.discoveredDevices.length, 0);
  assert.deepEqual(gladys.fake.connectionStatus, {
    connected: false,
    message: ERROR_TEXT[ERROR_KINDS.TLS_UNTRUSTED],
  });
  const ack = await gladys.fake.action('test_connection');
  assert.ok(ack.data.message.en.includes(fingerprint), ack.data.message.en);
  assert.ok(ack.data.message.fr.includes('Empreinte du certificat'));

  await gladys.fake.configUpdated({ url: 'es.lan', tls_fingerprint: fingerprint.toLowerCase() });
  assert.deepEqual(gladys.fake.connectionStatus, { connected: true });
  assert.equal(gladys.fake.discoveredDevices.length, 2);
  assert.ok(cluster.requests.at(-1).url.startsWith('https://es.lan:9200/'));

  // The certificate changes: refused, said so.
  cluster.fingerprint = Array(32).fill('D4').join(':');
  await world.hub.poll();
  await world.hub.poll();
  assert.deepEqual(gladys.fake.connectionStatus, {
    connected: false,
    message: ERROR_TEXT[ERROR_KINDS.TLS_CHANGED],
  });
  await world.app.stop();
});

test('an invalid fingerprint is reported, not silently ignored', async () => {
  const world = await createWorld({ config: { tls_fingerprint: 'not a fingerprint' } });
  assert.deepEqual(world.gladys.fake.connectionStatus, {
    connected: false,
    message: CONNECTION_TEXT.invalidFingerprint,
  });
  await world.app.stop();
});

test('credentials: API key first, else Basic; 401 and 403 explained', async () => {
  const cluster = new FakeCluster({ authorization: 'ApiKey c2VjcmV0' });
  const world = await createWorld({
    cluster,
    config: { api_key: 'c2VjcmV0', username: 'ignored', password: 'ignored' },
  });
  assert.deepEqual(world.gladys.fake.connectionStatus, { connected: true });

  const basic = `Basic ${Buffer.from('gladys:pa ss').toString('base64')}`;
  cluster.authorization = basic;
  await world.gladys.fake.configUpdated({
    url: 'http://192.0.2.10:9200',
    username: 'gladys',
    password: 'pa ss\n',
  });
  assert.deepEqual(world.gladys.fake.connectionStatus, { connected: true });

  await world.gladys.fake.configUpdated({ url: 'http://192.0.2.10:9200', username: 'gladys' });
  assert.deepEqual(world.gladys.fake.connectionStatus, {
    connected: false,
    message: ERROR_TEXT[ERROR_KINDS.AUTH],
  });
  await world.app.stop();
});

test('a key limited to the cluster health still gives the cluster device', async () => {
  const cluster = new FakeCluster();
  for (const path of ['NODES', 'ALLOCATION', 'STATS']) {
    const { PATHS } = await import('../src/es/client.js');
    cluster.statusOf[PATHS[path]] = 403;
  }
  const world = await createWorld({ cluster });
  const { gladys } = world;
  assert.deepEqual(
    gladys.fake.discoveredDevices.map((d) => d.model),
    ['Cluster'],
  );
  const ack = await gladys.fake.action('test_connection');
  assert.match(ack.data.message.en, /monitor/);
  await addAll(world);
  assert.equal(
    gladys.fake.lastState(clusterIds(gladys).feature(FEATURE_KEYS.DOCUMENTS)),
    undefined,
  );
  assert.equal(gladys.fake.lastState(clusterIds(gladys).feature(FEATURE_KEYS.STATUS)), 1);
  await world.app.stop();
});

test('OpenSearch is named as such, and its nodes are found', async () => {
  const cluster = new FakeCluster({ fixture: FIXTURES.os2 });
  const world = await createWorld({ cluster });
  assert.deepEqual(
    world.gladys.fake.discoveredDevices.map((d) => d.name),
    ['OpenSearch search-home', 'os-node-1'],
  );
  await world.app.stop();
});

test('the own timer reads the cluster and publishes without any poll from Gladys', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const cluster = new FakeCluster();
  const world = await createWorld({ cluster, timers: true });
  await addAll(world);
  const { gladys } = world;
  const status = clusterIds(gladys).feature(FEATURE_KEYS.STATUS);
  cluster.setStatus('red');
  t.mock.timers.tick(60_000);
  await world.hub.reading;
  assert.equal(gladys.fake.lastState(status), 2);
  await world.app.stop();
});

/** The lines written at `LOG_LEVEL=info` from now on (the SDK logger uses console). */
function captureLogs(t) {
  const previous = process.env.LOG_LEVEL;
  process.env.LOG_LEVEL = 'info';
  const lines = [];
  for (const stream of ['log', 'error']) {
    t.mock.method(console, stream, (...args) => lines.push(args.join(' ')));
  }
  t.after(() => {
    process.env.LOG_LEVEL = previous;
  });
  return lines;
}

test('a normal cycle writes nothing at the info level: reads, states, scene events', async (t) => {
  const cluster = new FakeCluster();
  threeNodes(cluster.answers);
  const world = await createWorld({ cluster });
  await addAll(world);
  const lines = captureLogs(t);
  for (let read = 0; read < 5; read += 1) {
    world.clock.advance(61_000);
    cluster.setDisk('es-1', 78 + read * 4);
    cluster.setStatus(read % 2 ? 'red' : 'yellow');
    await world.hub.poll();
  }
  assert.ok(world.gladys.fake.sceneEvents.length >= 5, 'scene events fired');
  assert.deepEqual(lines, []);
  await world.app.stop();
});

test('a cluster down for several reads: one line, then one when it answers again', async (t) => {
  const cluster = new FakeCluster();
  const world = await createWorld({ cluster });
  const lines = captureLogs(t);
  cluster.down = true;
  for (let read = 0; read < 4; read += 1) {
    await world.hub.poll();
  }
  cluster.down = false;
  await world.hub.poll();
  assert.equal(lines.length, 2, lines.join('\n'));
  assert.match(lines[0], /read failed/);
  assert.match(lines[1], /answers again/);
  assert.ok(!lines.join('').includes('192.0.2.10:9200@'), 'no credentials');
  await world.app.stop();
});
