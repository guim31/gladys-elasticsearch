// -----------------------------------------------------------------------------
// An in-memory Elasticsearch / OpenSearch cluster behind the `request` seam of
// the client (src/es/http.js): it serves the real answers recorded in
// test/fixtures/clusters/ (Elasticsearch 8.19.7 and OpenSearch 2.19.3, in
// Docker), which a test then edits (status, nodes, disks…) or breaks.
// -----------------------------------------------------------------------------

import { readFileSync } from 'node:fs';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { registerHandlers } from '../../src/app.js';
import { PATHS } from '../../src/es/client.js';
import { Store } from '../../src/store.js';

export const FIXTURES = {
  es8: 'elasticsearch-8-red',
  es8secure: 'elasticsearch-8-secured-yellow',
  os2: 'opensearch-2-secured-yellow',
};

export function readCluster(name) {
  return JSON.parse(
    readFileSync(new URL(`../fixtures/clusters/${name}.json`, import.meta.url), 'utf8'),
  );
}

/** Three nodes from the one of a fixture: es-1 (master), es-2, es-3. */
export function threeNodes(answers) {
  const [node] = answers.nodes;
  const [allocated] = answers.allocation;
  const ids = ['aAaAaAaAaAaAaAaAaAaAaA', 'bBbBbBbBbBbBbBbBbBbBbB', 'cCcCcCcCcCcCcCcCcCcCcC'];
  answers.nodes = ids.map((id, index) => ({
    ...node,
    id,
    name: `es-${index + 1}`,
    ip: `192.0.2.${21 + index}`,
    master: index === 0 ? '*' : '-',
    'disk.used_percent': String(40 + index * 10),
    'heap.percent': String(30 + index),
  }));
  answers.allocation = ids.map((_, index) => ({
    ...allocated,
    node: `es-${index + 1}`,
    shards: String(index + 2),
  }));
  answers.health = { ...answers.health, number_of_nodes: 3, number_of_data_nodes: 3 };
  return answers;
}

const PATH_KEYS = {
  [PATHS.INFO]: 'info',
  [PATHS.HEALTH]: 'health',
  [PATHS.STATS]: 'stats',
  [PATHS.NODES]: 'nodes',
  [PATHS.ALLOCATION]: 'allocation',
  [PATHS.RED_INDICES]: 'redIndices',
};

export class FakeCluster {
  /**
   * @param {object} [options]
   * @param {string} [options.fixture] a FIXTURES value
   * @param {string} [options.scheme] the scheme it serves: 'http' or 'https'
   * @param {string|null} [options.fingerprint] of its certificate (https)
   * @param {boolean} [options.trusted] its certificate verifies (https)
   * @param {string|null} [options.authorization] the header it requires
   */
  constructor({
    fixture = FIXTURES.es8secure,
    scheme = 'http',
    fingerprint = null,
    trusted = false,
    authorization = null,
  } = {}) {
    this.answers = readCluster(fixture);
    this.scheme = scheme;
    this.fingerprint = fingerprint;
    this.trusted = trusted;
    this.authorization = authorization;
    /** path → HTTP status forced for it */
    this.statusOf = {};
    /** Set: no answer at all (a stopped server). */
    this.down = false;
    this.requests = [];
  }

  setStatus(status, unassigned = status === 'green' ? 0 : 1) {
    this.answers.health = { ...this.answers.health, status, unassigned_shards: unassigned };
    this.answers.redIndices = status === 'red' ? [{ index: 'logs-broken' }] : [];
  }

  setDisk(name, percent) {
    const node = this.answers.nodes.find((n) => n.name === name);
    node['disk.used_percent'] = String(percent);
  }

  /** The `request` function of the client (src/es/http.js). */
  get request() {
    return async (url, options = {}) => {
      const target = new URL(url);
      const path = `${target.pathname}${target.search}`;
      this.requests.push({ url, options });
      const error = (code, extra = {}) => Object.assign(new Error(code), { code, ...extra });
      if (this.down) {
        throw error('ECONNREFUSED');
      }
      if (target.protocol !== `${this.scheme}:`) {
        throw this.scheme === 'http'
          ? error('EPROTO', { message: 'wrong version number' })
          : error('ECONNRESET');
      }
      if (this.scheme === 'https') {
        if (options.fingerprint && options.fingerprint !== this.fingerprint) {
          throw error('ERR_TLS_FINGERPRINT_MISMATCH', { fingerprint: this.fingerprint });
        }
        if (!options.fingerprint && !options.insecure && !this.trusted) {
          throw error('ERR_TLS_UNTRUSTED', { fingerprint: this.fingerprint });
        }
      }
      const respond = (status, body) => ({
        status,
        body: JSON.stringify(body),
        fingerprint: this.scheme === 'https' ? this.fingerprint : null,
      });
      if (this.authorization && options.headers?.authorization !== this.authorization) {
        return respond(401, { error: { type: 'security_exception' }, status: 401 });
      }
      if (this.statusOf[path]) {
        return respond(this.statusOf[path], { error: 'forced', status: this.statusOf[path] });
      }
      const key = PATH_KEYS[path];
      if (!key) {
        return respond(404, { error: 'no handler', status: 404 });
      }
      return respond(200, this.answers[key]);
    };
  }
}

/** A clock the test moves. */
export function createClock(start = Date.parse('2026-11-15T10:00:00Z')) {
  let now = start;
  return { now: () => now, advance: (ms) => (now += ms) };
}

/**
 * The integration against a fake Gladys and a fake cluster, without timers.
 * @param {object} [options]
 */
export async function createWorld({
  cluster = new FakeCluster(),
  config = {},
  devices = [],
  clock = createClock(),
  directory = mkdtempSync(join(tmpdir(), 'gladys-elasticsearch-')),
  timers = false,
  timings,
} = {}) {
  const gladys = createFakeGladys({
    config: { url: 'http://192.0.2.10:9200', language: 'en', ...config },
    devices,
  });
  const app = registerHandlers(gladys, {
    store: new Store(directory),
    request: cluster.request,
    timers,
    timings,
    now: clock.now,
  });
  await gladys.connect();
  await app.ready;
  return { gladys, app, hub: app.hub, cluster, clock, directory };
}

/** Add every discovered device to the fake Gladys, as the user would. */
export async function addAll(world) {
  for (const device of world.gladys.fake.discoveredDevices) {
    await world.gladys.fake.deviceCreated(device);
  }
}
