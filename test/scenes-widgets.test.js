// -----------------------------------------------------------------------------
// The widget and the scene action, through the fake Gladys: content within the
// budget of the core (validateWidgetContent), every language, the settings
// that hide a block, an unreachable cluster said in words.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateWidgetContent } from '@gladysassistant/integration-sdk';
import { MAX_ROWS } from '../src/widgets.js';
import { FIXTURES, FakeCluster, createWorld, threeNodes } from './helpers/fakeCluster.js';

process.env.LOG_LEVEL ??= 'silent';

const LANGS = ['en', 'fr', 'de', 'es'];

async function widget(world, options = {}) {
  const ack = await world.gladys.fake.widgetGet('cluster', options);
  assert.equal(ack.success, true, ack.error);
  validateWidgetContent(ack.data.content);
  return ack.data.content;
}

test('the widget shows status, figures and the nodes, in every language', async () => {
  const cluster = new FakeCluster();
  threeNodes(cluster.answers);
  cluster.setStatus('red', 2);
  const world = await createWorld({ cluster });
  for (const language of LANGS) {
    const content = await widget(world, { language });
    const types = content.components.map((c) => c.type);
    assert.deepEqual(types, [
      'text',
      'value',
      'value',
      'value',
      'value',
      'value',
      'status',
      'button',
    ]);
    const [, status] = content.components;
    assert.equal(status.color, 'danger');
    const rows = content.components[6].items;
    assert.equal(rows[0].label, 'logs-broken', 'the red index first');
    assert.match(rows[1].label, /^es-3/, 'then the fullest disk');
    assert.match(rows[3].label, /^es-1 ★/, 'the elected master is starred');
  }
  // An added node shows under the name given in Gladys.
  const node = world.gladys.fake.discoveredDevices.find((d) => d.name === 'es-3');
  await world.gladys.fake.deviceCreated({ ...node, name: 'Rack node' });
  const rows = (await widget(world)).components[6].items;
  assert.equal(rows[1].label, 'Rack node');
  await world.app.stop();
});

test('the status list is capped, and both blocks can be hidden', async () => {
  const cluster = new FakeCluster({ fixture: FIXTURES.os2 });
  const [node] = cluster.answers.nodes;
  cluster.answers.nodes = Array.from({ length: 12 }, (_, i) => ({
    ...node,
    id: `node${String(i).padStart(18, '0')}`,
    name: `os-${i}`,
  }));
  const world = await createWorld({ cluster });
  const full = await widget(world);
  const rows = full.components.find((c) => c.type === 'status').items;
  assert.equal(rows.length, MAX_ROWS);
  assert.equal(rows.at(-1).value, '+5');

  const bare = await widget(world, { settings: { show_nodes: false, show_refresh: false } });
  assert.deepEqual(
    bare.components.map((c) => c.type),
    ['text', 'value', 'value', 'value', 'value', 'value'],
  );
  await world.app.stop();
});

test('an unreachable cluster is said in words; Refresh reads it again', async () => {
  const cluster = new FakeCluster();
  const world = await createWorld({ cluster, config: { language: 'fr' } });
  cluster.down = true;
  await world.hub.poll();
  await world.hub.poll();
  const content = await widget(world, { language: 'fr' });
  assert.deepEqual(
    content.components.map((c) => c.type),
    ['text', 'text', 'button'],
  );
  assert.match(content.components[1].text, /ne répond pas/);

  cluster.down = false;
  const ack = await world.gladys.fake.widgetAction('cluster', 'refresh');
  assert.equal(ack.success, true, ack.error);
  assert.equal((await widget(world)).components.length, 8);
  await world.app.stop();
});

test('without address, the widget says what to do', async () => {
  const world = await createWorld({ config: { url: '' } });
  const content = await widget(world, { language: 'de' });
  assert.match(content.components[0].text, /Adresse des Clusters/);
  await world.app.stop();
});

test('the scene action gives the figures and a ready-made summary', async () => {
  const cluster = new FakeCluster();
  threeNodes(cluster.answers);
  cluster.setStatus('yellow', 4);
  const world = await createWorld({ cluster, config: { language: 'fr' } });
  const ack = await world.gladys.fake.sceneAction('get_cluster_health');
  assert.equal(ack.success, true, ack.error);
  assert.deepEqual(ack.data.outputs, {
    cluster_name: 'home-cluster',
    online: true,
    summary:
      'Cluster home-cluster : jaune, 3 nœuds, 4 shards non assignés, disque de es-3 60 %, disque de es-2 50 %, disque de es-1 40 %',
    status: 'yellow',
    status_code: 1,
    nodes: 3,
    unassigned_shards: 4,
    documents: 39,
    max_disk_used: 60,
  });

  cluster.down = true;
  await world.hub.poll();
  await world.hub.poll();
  const down = await world.gladys.fake.sceneAction('get_cluster_health');
  assert.deepEqual(down.data.outputs, {
    cluster_name: 'home-cluster',
    online: false,
    summary: 'Cluster home-cluster : le cluster ne répond pas à cette adresse',
  });
  await world.app.stop();
});
