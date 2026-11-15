// -----------------------------------------------------------------------------
// The integration itself: reads the cluster on its own timer, offers the
// devices in the Discovery tab, publishes the states of the devices the user
// added, the connection status and the per-device transport badge, fires the
// scene triggers, and serves the widget, the scene action and the
// "Test the connection" action.
//
// Every device is published with should_poll: false and read here, by a timer
// (intervals up to 5 minutes, beyond the poll frequencies of Gladys, and
// devices created without should_poll are never polled by Gladys 5.2).
// States go through publishChangedStates: only the changes, and every value
// again past the heartbeat so the dashboard never says "no recent value".
// -----------------------------------------------------------------------------

import { DEVICE_TRANSPORTS, createLogger } from '@gladysassistant/integration-sdk';
import { EsClient, EsError, ERROR_KINDS } from './es/client.js';
import {
  DEVICE_TYPES,
  buildDevice,
  deviceIds,
  featureStates,
  nodePlatformId,
  parseDeviceId,
} from './devices.js';
import { FailureLog } from './logs.js';
import { CONNECTION_TEXT, ERROR_TEXT, pick, shortList, testReport } from './texts.js';
import { Watcher } from './watcher.js';

const logger = createLogger({ name: 'elasticsearch' });

export const WIDGET_KEY = 'cluster';

// Scene trigger keys: permanent once published.
export const TRIGGERS = Object.freeze({
  STATUS: 'cluster_status_changed',
  DISK: 'disk_almost_full',
  UNREACHABLE: 'cluster_unreachable',
});

export const DEFAULT_TIMINGS = Object.freeze({
  // Unchanged values are published again this often (the front says
  // "no recent value" past 48 h).
  heartbeatMs: 6 * 3600_000,
  // Failed reads in a row before the cluster is said unreachable: a restart
  // of a single node cluster takes about a minute.
  downAfterFailures: 2,
  // A failed read is retried this soon, so that a blip is confirmed or
  // cleared before the next regular read.
  retryMs: 20_000,
  // A scene action or widget refresh reads again past this age.
  staleMs: 15_000,
});

export class ElasticsearchHub {
  /**
   * @param {object} options
   * @param {object} options.gladys SDK client
   * @param {object} options.store src/store.js
   * @param {Function} [options.request] httpRequest, replaced in the tests
   * @param {boolean} [options.timers] false in the tests: reads on demand only
   * @param {object} [options.timings]
   * @param {() => number} [options.now]
   */
  constructor({ gladys, store, request, timers = true, timings = {}, now = () => Date.now() }) {
    this.gladys = gladys;
    this.store = store;
    this.request = request;
    this.timersEnabled = timers;
    this.timings = { ...DEFAULT_TIMINGS, ...timings };
    this.now = now;
    this.issues = new FailureLog(logger);
    this.config = null;
    this.client = null;
    this.watcher = new Watcher();
    this.reset();
  }

  reset() {
    clearTimeout(this.timer);
    this.timer = null;
    this.snapshot = null;
    this.error = null;
    this.readAt = 0;
    this.failures = 0;
    this.down = false;
    this.discovered = null;
    this.connection = null;
    this.transports = new Map();
    this.reading = null;
  }

  // --- Life cycle --------------------------------------------------------------

  async start(config) {
    const saved = await this.store.load();
    this.watcher = new Watcher(saved.watcher);
    await this.configure(config);
  }

  async configure(config) {
    this.config = config;
    this.reset();
    this.client = config.url ? new EsClient(config, { request: this.request }) : null;
    if (!this.client) {
      await this.publishConnectionStatus();
      return;
    }
    await this.poll();
    this.schedule();
  }

  async reconfigure(config) {
    logger.info('Configuration updated');
    await this.configure(config);
  }

  /** A reconnection to Gladys: send again what Gladys may have lost. */
  async resync(config) {
    if (JSON.stringify(config) !== JSON.stringify(this.config)) {
      await this.configure(config);
      return;
    }
    this.gladys.forgetPublishedStates?.();
    this.connection = null;
    this.transports.clear();
    this.discovered = null;
    await this.poll();
  }

  async stop() {
    this.stopped = true;
    clearTimeout(this.timer);
    await this.reading?.catch(() => {});
    await this.store.flush();
  }

  schedule(delay = this.config.pollIntervalMs) {
    clearTimeout(this.timer);
    if (!this.timersEnabled || this.stopped || !this.client) {
      return;
    }
    this.timer = setTimeout(() => {
      this.poll()
        .catch((err) => this.issues.fail('loop', `Reading loop failed: ${err.message}`, 'error'))
        .finally(() => this.schedule());
    }, delay);
    this.timer.unref?.();
  }

  // --- Reading -----------------------------------------------------------------

  /** One read of the cluster, then everything that follows from it. */
  poll() {
    if (!this.client) {
      return Promise.resolve();
    }
    // A read in progress is shared (timer, widget, scene action at once).
    this.reading ??= this.readAndPublish().finally(() => {
      this.reading = null;
    });
    return this.reading;
  }

  async readAndPublish() {
    const client = this.client;
    let snapshot = null;
    let error = null;
    try {
      snapshot = await client.read();
    } catch (err) {
      if (!(err instanceof EsError)) {
        throw err;
      }
      error = err;
    }
    if (client !== this.client) {
      return; // reconfigured meanwhile
    }
    this.readAt = this.now();
    if (snapshot) {
      await this.onSuccess(snapshot);
    } else {
      await this.onFailure(error);
    }
    await this.publishDevices();
    await this.publishStates();
    await this.publishTransports();
    await this.publishConnectionStatus();
    await this.store.save({ watcher: this.watcher.toJSON() });
  }

  async onSuccess(snapshot) {
    const wasDown = this.down || this.error !== null;
    const changed = wasDown || this.snapshot?.status !== snapshot.status;
    this.snapshot = snapshot;
    this.error = null;
    this.failures = 0;
    this.down = false;
    if (wasDown) {
      logger.info(`Cluster ${snapshot.clusterName} answers again`);
    }
    for (const err of snapshot.partial) {
      this.issues.fail(`partial-${err.kind}`, `Optional read refused: ${err.message}`);
    }
    if (snapshot.partial.length === 0) {
      for (const kind of Object.values(ERROR_KINDS)) {
        this.issues.recover(`partial-${kind}`, 'Optional reads work again');
      }
    }
    await this.fireEvents(snapshot);
    if (changed) {
      // Otherwise the widget TTL is enough.
      this.gladys.requestWidgetRefresh(WIDGET_KEY);
    }
  }

  async onFailure(error) {
    const first = this.error === null;
    this.error = error;
    this.failures += 1;
    if (first) {
      logger.warn(`Cluster read failed: ${error.message}`);
      this.gladys.requestWidgetRefresh(WIDGET_KEY);
    } else {
      logger.debug(`Cluster read failed again: ${error.message}`);
    }
    if (this.failures === 1) {
      // Confirm or clear the failure before the next regular read.
      this.schedule(Math.min(this.timings.retryMs, this.config.pollIntervalMs));
    }
    if (!this.down && this.failures >= this.timings.downAfterFailures) {
      this.down = true;
      this.gladys.requestWidgetRefresh(WIDGET_KEY);
      await this.fireEvent(TRIGGERS.UNREACHABLE, {
        cluster_name: this.clusterName(),
        error: pick(ERROR_TEXT[error.kind], this.config.language),
      });
    }
  }

  /** Read again when the last read is older than `staleMs`. */
  async refreshIfStale() {
    if (this.now() - this.readAt >= this.timings.staleMs) {
      await this.poll();
    }
  }

  /** "Search" in the Discovery tab: read the cluster, publish the list again. */
  async rediscover() {
    await this.poll();
    await this.publishDevices({ force: true });
  }

  /** "Test the connection": a fresh read with the saved configuration. */
  async testConnection() {
    if (!this.client) {
      return this.config?.urlTyped ? CONNECTION_TEXT.invalidUrl : CONNECTION_TEXT.noUrl;
    }
    logger.info('Test the connection');
    await this.poll();
    return testReport({
      snapshot: this.error ? null : this.snapshot,
      error: this.error,
      fingerprint: this.client.fingerprint,
    });
  }

  // --- Scene triggers ----------------------------------------------------------

  async fireEvents(snapshot) {
    const change = this.watcher.status(snapshot.uuid, snapshot.status);
    if (change) {
      await this.fireEvent(TRIGGERS.STATUS, {
        status: change.status,
        cluster_name: this.clusterName(),
        previous_status: change.previous,
        unassigned_shards: snapshot.unassignedShards,
        red_indices: shortList(snapshot.redIndices ?? [], 20),
      });
    }
    for (const { node, threshold } of this.watcher.disks(snapshot.uuid, snapshot.nodes ?? [])) {
      await this.fireEvent(TRIGGERS.DISK, {
        node: deviceIds(this.gladys, DEVICE_TYPES.NODE, nodePlatformId(snapshot.uuid, node.id))
          .device,
        threshold,
        node_name: node.name,
        cluster_name: this.clusterName(),
        used_percent: node.disk,
        free_gb: node.diskFree === null ? null : Math.round(node.diskFree / 1e8) / 10,
      });
    }
  }

  async fireEvent(key, data) {
    logger.debug(`Scene trigger ${key}`);
    try {
      await this.gladys.publishSceneEvent(key, data);
      this.issues.recover('scene', 'Scene events accepted again');
    } catch (err) {
      this.issues.fail('scene', `Scene event ${key} refused: ${err.message}`);
    }
  }

  // --- Devices -----------------------------------------------------------------

  /** The device external id of the cluster last read, '' before any. */
  clusterDeviceId() {
    return this.snapshot
      ? deviceIds(this.gladys, DEVICE_TYPES.CLUSTER, this.snapshot.uuid).device
      : '';
  }

  /** The name given in Gladys to the cluster device, else the cluster name. */
  clusterName() {
    const id = this.clusterDeviceId();
    const added = this.gladys.devices?.find((device) => device.external_id === id);
    return added?.name || this.snapshot?.clusterName || this.client?.url.base || '';
  }

  discoveredDevices() {
    const snapshot = this.snapshot;
    if (!snapshot) {
      return null;
    }
    const language = this.config.language;
    const devices = [
      buildDevice(this.gladys, {
        type: DEVICE_TYPES.CLUSTER,
        platformId: snapshot.uuid,
        name: `${snapshot.product} ${snapshot.clusterName}`,
        language,
        params: [{ name: 'cluster_uuid', value: snapshot.uuid }],
      }),
    ];
    for (const node of snapshot.nodes ?? []) {
      devices.push(
        buildDevice(this.gladys, {
          type: DEVICE_TYPES.NODE,
          platformId: nodePlatformId(snapshot.uuid, node.id),
          name: node.name,
          language,
          params: [
            { name: 'node_id', value: node.id },
            { name: 'roles', value: node.roles },
          ],
        }),
      );
    }
    return devices;
  }

  /** Publish the Discovery list when it changed (a node joined…). */
  async publishDevices({ force = false } = {}) {
    const devices = this.discoveredDevices();
    if (devices === null) {
      return;
    }
    const key = JSON.stringify(devices);
    if (!force && key === this.discovered) {
      return;
    }
    try {
      await this.gladys.publishDiscoveredDevices(devices);
      this.discovered = key;
      this.issues.recover('discovery', 'Discovered devices accepted again');
    } catch (err) {
      this.issues.fail('discovery', `Discovered devices refused: ${err.message}`);
    }
  }

  /**
   * The devices of ours the user added, with what they stand for.
   * @returns {Array<{ device: object, type: string, platformId: string }>}
   */
  createdDevices() {
    const found = [];
    for (const device of this.gladys.devices ?? []) {
      const parsed = parseDeviceId(this.gladys, device.external_id);
      if (parsed) {
        found.push({ device, ...parsed });
      }
    }
    return found;
  }

  /** The cluster or node a created device stands for in the last snapshot. */
  itemFor(type, platformId) {
    const snapshot = this.snapshot;
    if (!snapshot) {
      return undefined;
    }
    if (type === DEVICE_TYPES.CLUSTER) {
      return platformId === snapshot.uuid ? snapshot : undefined;
    }
    const prefix = `${snapshot.uuid}-`;
    if (!platformId.startsWith(prefix) || snapshot.nodes === null) {
      return undefined; // another cluster, or no node list in this read
    }
    const id = platformId.slice(prefix.length);
    return snapshot.nodes.find((node) => node.id === id) ?? null;
  }

  /** The states of the added devices (or of one of them). */
  async publishStates({ only = null } = {}) {
    if (!this.snapshot || this.error) {
      return; // nothing new to say: the transport badge says unreachable
    }
    const states = [];
    for (const { device, type, platformId } of this.createdDevices()) {
      if (only && device.external_id !== only) {
        continue;
      }
      const item = this.itemFor(type, platformId);
      if (item === undefined) {
        continue;
      }
      states.push(...featureStates(this.gladys, type, platformId, item));
    }
    if (states.length === 0) {
      return;
    }
    try {
      await this.gladys.publishChangedStates(states, { heartbeat: this.timings.heartbeatMs });
      this.issues.recover('states', 'States accepted again');
    } catch (err) {
      this.issues.fail('states', `States refused: ${err.message}`);
    }
  }

  /** The badge of the added devices: local, or unreachable. */
  async publishTransports() {
    if (this.readAt === 0) {
      return;
    }
    const entries = [];
    for (const { device, type, platformId } of this.createdDevices()) {
      const item = this.itemFor(type, platformId);
      const reachable = !this.down && this.snapshot !== null && item !== null;
      const transport = reachable ? DEVICE_TRANSPORTS.LOCAL : DEVICE_TRANSPORTS.UNREACHABLE;
      if (this.transports.get(device.external_id) !== transport) {
        entries.push({ external_id: device.external_id, transport });
      }
    }
    for (let at = 0; at < entries.length; at += 100) {
      const batch = entries.slice(at, at + 100);
      try {
        await this.gladys.publishTransports(batch);
        for (const { external_id: id, transport } of batch) {
          this.transports.set(id, transport);
        }
        this.issues.recover('transports', 'Transports accepted again');
      } catch (err) {
        this.issues.fail('transports', `Transports refused: ${err.message}`);
      }
    }
  }

  /** The integration card: connected, or why not (four languages). */
  async publishConnectionStatus() {
    let status;
    if (!this.client) {
      status = {
        connected: false,
        message: this.config?.urlTyped ? CONNECTION_TEXT.invalidUrl : CONNECTION_TEXT.noUrl,
      };
    } else if (this.config.fingerprintInvalid) {
      status = { connected: false, message: CONNECTION_TEXT.invalidFingerprint };
    } else if (this.error && (this.down || !this.snapshot)) {
      status = { connected: false, message: ERROR_TEXT[this.error.kind] };
    } else if (this.snapshot) {
      status = { connected: true };
    } else {
      return;
    }
    const key = JSON.stringify(status);
    if (key === this.connection) {
      return;
    }
    try {
      await this.gladys.setConnectionStatus(status.connected, status.message);
      this.connection = key;
      this.issues.recover('connection', 'Connection status accepted again');
    } catch (err) {
      this.issues.fail('connection', `Connection status refused: ${err.message}`);
    }
  }

  // --- Gladys events -----------------------------------------------------------

  /** The user added (or updated) a device: send all its states again. */
  async onDeviceCreated(device) {
    if (!parseDeviceId(this.gladys, device?.external_id)) {
      return;
    }
    this.gladys.forgetPublishedStates?.(device.external_id);
    this.transports.delete(device.external_id);
    await this.publishStates({ only: device.external_id });
    await this.publishTransports();
    this.gladys.requestWidgetRefresh(WIDGET_KEY);
  }

  onDeviceDeleted(device) {
    this.transports.delete(device?.external_id);
    this.gladys.requestWidgetRefresh(WIDGET_KEY);
  }

  /** Fallback for a Gladys that polls anyway: the states of that device. */
  async pollDevice(device) {
    await this.refreshIfStale();
    await this.publishStates({ only: device.external_id });
  }

  // --- Widget and scene action ---------------------------------------------------

  /** What the widget and the scene action show. */
  view() {
    return {
      name: this.clusterName(),
      snapshot: this.down || (this.error && !this.snapshot) ? null : this.snapshot,
      error: this.error,
      configured: this.client !== null,
    };
  }
}
