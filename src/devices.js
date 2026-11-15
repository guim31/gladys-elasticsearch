// -----------------------------------------------------------------------------
// The devices offered in the Discovery tab, built from a snapshot:
//
//   - the cluster, keyed on its `cluster_uuid`: health status as a number
//     (0 green, 1 yellow, 2 red, the name says it), nodes, shards, indices,
//     documents, size of the indices, product and version;
//   - one device per node, keyed on the cluster and the node id (kept by the
//     node in its data path, stable across restarts and renames): disk used,
//     JVM heap, CPU, load, shards, and whether it is in the cluster.
//
// Couples: usage percentages are `level-sensor/liquid-level-percent` (a fill
// level, gauge 0-100, as Glances and Brother do), counts
// `counter-sensor/integer`, the size `data/size` in GB, load averages have
// no category (`unknown/unknown`, as Glances). Every feature is read only.
//
// should_poll is false: the hub reads the cluster on its own timer (intervals
// up to 5 minutes, beyond the poll frequencies Gladys offers).
// -----------------------------------------------------------------------------

import {
  DEVICE_FEATURE_CATEGORIES as CATEGORY,
  DEVICE_FEATURE_TYPES as TYPE,
  DEVICE_FEATURE_UNITS as UNIT,
} from '@gladysassistant/integration-sdk';

export const DEVICE_TYPES = Object.freeze({ CLUSTER: 'cluster', NODE: 'node' });

// Feature keys: part of the external ids, permanent once published.
export const FEATURE_KEYS = Object.freeze({
  STATUS: 'status',
  NODES: 'nodes',
  DATA_NODES: 'data_nodes',
  ACTIVE_SHARDS: 'active_shards',
  UNASSIGNED_SHARDS: 'unassigned_shards',
  INDICES: 'indices',
  DOCUMENTS: 'documents',
  STORE_SIZE: 'store_size',
  VERSION: 'version',
  DISK: 'disk_used',
  HEAP: 'heap_used',
  CPU: 'cpu',
  LOAD: 'load_1m',
  SHARDS: 'shards',
  IN_CLUSTER: 'in_cluster',
});

const K = FEATURE_KEYS;

// Feature names, frozen by Gladys at creation: 40 characters at most.
export const NAMES = {
  en: {
    [K.STATUS]: 'Status (0 green, 1 yellow, 2 red)',
    [K.NODES]: 'Nodes',
    [K.DATA_NODES]: 'Data nodes',
    [K.ACTIVE_SHARDS]: 'Active shards',
    [K.UNASSIGNED_SHARDS]: 'Unassigned shards',
    [K.INDICES]: 'Indices',
    [K.DOCUMENTS]: 'Documents',
    [K.STORE_SIZE]: 'Size of the indices',
    [K.VERSION]: 'Version',
    [K.DISK]: 'Disk used',
    [K.HEAP]: 'JVM heap used',
    [K.CPU]: 'CPU',
    [K.LOAD]: 'Load (1 min)',
    [K.SHARDS]: 'Shards',
    [K.IN_CLUSTER]: 'In the cluster',
  },
  fr: {
    [K.STATUS]: 'État (0 vert, 1 jaune, 2 rouge)',
    [K.NODES]: 'Nœuds',
    [K.DATA_NODES]: 'Nœuds de données',
    [K.ACTIVE_SHARDS]: 'Shards actifs',
    [K.UNASSIGNED_SHARDS]: 'Shards non assignés',
    [K.INDICES]: 'Index',
    [K.DOCUMENTS]: 'Documents',
    [K.STORE_SIZE]: 'Taille des index',
    [K.VERSION]: 'Version',
    [K.DISK]: 'Disque utilisé',
    [K.HEAP]: 'Tas JVM utilisé',
    [K.CPU]: 'Processeur',
    [K.LOAD]: 'Charge (1 min)',
    [K.SHARDS]: 'Shards',
    [K.IN_CLUSTER]: 'Dans le cluster',
  },
  de: {
    [K.STATUS]: 'Status (0 grün, 1 gelb, 2 rot)',
    [K.NODES]: 'Knoten',
    [K.DATA_NODES]: 'Datenknoten',
    [K.ACTIVE_SHARDS]: 'Aktive Shards',
    [K.UNASSIGNED_SHARDS]: 'Nicht zugewiesene Shards',
    [K.INDICES]: 'Indizes',
    [K.DOCUMENTS]: 'Dokumente',
    [K.STORE_SIZE]: 'Größe der Indizes',
    [K.VERSION]: 'Version',
    [K.DISK]: 'Belegter Datenträger',
    [K.HEAP]: 'Belegter JVM-Heap',
    [K.CPU]: 'Prozessor',
    [K.LOAD]: 'Last (1 min)',
    [K.SHARDS]: 'Shards',
    [K.IN_CLUSTER]: 'Im Cluster',
  },
  es: {
    [K.STATUS]: 'Estado (0 verde, 1 amarillo, 2 rojo)',
    [K.NODES]: 'Nodos',
    [K.DATA_NODES]: 'Nodos de datos',
    [K.ACTIVE_SHARDS]: 'Shards activos',
    [K.UNASSIGNED_SHARDS]: 'Shards sin asignar',
    [K.INDICES]: 'Índices',
    [K.DOCUMENTS]: 'Documentos',
    [K.STORE_SIZE]: 'Tamaño de los índices',
    [K.VERSION]: 'Versión',
    [K.DISK]: 'Disco usado',
    [K.HEAP]: 'Montón JVM usado',
    [K.CPU]: 'Procesador',
    [K.LOAD]: 'Carga (1 min)',
    [K.SHARDS]: 'Shards',
    [K.IN_CLUSTER]: 'En el clúster',
  },
};

// Display bounds (the core never applies them on write).
export const BOUNDS = Object.freeze({
  COUNT_MAX: 1_000_000,
  DOCUMENTS_MAX: 1e15,
  SIZE_MAX_GB: 1_000_000,
  LOAD_MAX: 1000,
});

const GB = 1e9;

const round = (value, digits) => {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return null;
  }
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
};

const percent = () => ({
  category: CATEGORY.LEVEL_SENSOR,
  type: TYPE.LEVEL_SENSOR.LIQUID_LEVEL_PERCENT,
  unit: UNIT.PERCENT,
  min: 0,
  max: 100,
});
const count = (max = BOUNDS.COUNT_MAX) => ({
  category: CATEGORY.COUNTER_SENSOR,
  type: TYPE.SENSOR.INTEGER,
  min: 0,
  max,
});

/**
 * Per device type: the features, their shape and their value from the item
 * (the snapshot for the cluster, a node of it for a node; null for a node
 * that left the cluster: only `in_cluster` has a value then).
 */
const BLUEPRINTS = {
  [DEVICE_TYPES.CLUSTER]: [
    {
      key: K.STATUS,
      definition: { ...count(), max: 2 },
      value: (s) => s.statusCode,
    },
    { key: K.NODES, definition: count(), value: (s) => s.nodeCount },
    { key: K.DATA_NODES, definition: count(), value: (s) => s.dataNodeCount },
    { key: K.ACTIVE_SHARDS, definition: count(), value: (s) => s.activeShards },
    { key: K.UNASSIGNED_SHARDS, definition: count(), value: (s) => s.unassignedShards },
    { key: K.INDICES, definition: count(), value: (s) => s.indexCount },
    {
      key: K.DOCUMENTS,
      definition: count(BOUNDS.DOCUMENTS_MAX),
      value: (s) => s.docCount,
    },
    {
      key: K.STORE_SIZE,
      definition: {
        category: CATEGORY.DATA,
        type: TYPE.DATA.SIZE,
        unit: UNIT.GIGABYTE,
        min: 0,
        max: BOUNDS.SIZE_MAX_GB,
      },
      digits: 2,
      value: (s) => (s.storeBytes === null ? null : s.storeBytes / GB),
    },
    {
      key: K.VERSION,
      definition: { category: CATEGORY.TEXT, type: TYPE.TEXT.TEXT, min: 0, max: 0 },
      text: (s) => `${s.product} ${s.version}`,
    },
  ],
  [DEVICE_TYPES.NODE]: [
    { key: K.DISK, definition: percent(), digits: 1, value: (n) => n?.disk ?? null },
    { key: K.HEAP, definition: percent(), value: (n) => n?.heap ?? null },
    { key: K.CPU, definition: percent(), value: (n) => n?.cpu ?? null },
    {
      key: K.LOAD,
      definition: {
        category: CATEGORY.UNKNOWN,
        type: TYPE.UNKNOWN.UNKNOWN,
        min: 0,
        max: BOUNDS.LOAD_MAX,
      },
      digits: 2,
      value: (n) => n?.load ?? null,
    },
    { key: K.SHARDS, definition: count(), value: (n) => n?.shards ?? null },
    {
      key: K.IN_CLUSTER,
      definition: { category: CATEGORY.INPUT, type: TYPE.SENSOR.BINARY, min: 0, max: 1 },
      value: (n) => (n ? 1 : 0),
    },
  ],
};

export const featureKeys = (type) => BLUEPRINTS[type].map((feature) => feature.key);

/** The platform id of a node device: the cluster and the node id. */
export const nodePlatformId = (uuid, nodeId) => `${uuid}-${nodeId}`;

/** External ids of a device. */
export function deviceIds(gladys, type, platformId) {
  return gladys.externalIds(type, platformId);
}

/**
 * The type of a device external id of ours, and its platform id; null when
 * not ours.
 * @returns {{ type: string, platformId: string }|null}
 */
export function parseDeviceId(gladys, externalId) {
  if (typeof externalId !== 'string') {
    return null;
  }
  for (const type of Object.values(DEVICE_TYPES)) {
    const prefix = gladys.externalIds(type, '').device;
    if (externalId.startsWith(prefix) && externalId.length > prefix.length) {
      const platformId = externalId.slice(prefix.length);
      if (/^[A-Za-z0-9_-]+$/.test(platformId)) {
        return { type, platformId };
      }
    }
  }
  return null;
}

/**
 * The discovery payload of a device.
 * @param {object} gladys SDK client
 * @param {object} options
 * @param {string} options.type one of DEVICE_TYPES
 * @param {string} options.platformId cluster uuid, or nodePlatformId()
 * @param {string} options.name device name
 * @param {string} [options.language] feature names language
 * @param {Array<{name: string, value: string}>} [options.params]
 */
export function buildDevice(gladys, { type, platformId, name, language = 'en', params = [] }) {
  const ids = deviceIds(gladys, type, platformId);
  const names = NAMES[language] ?? NAMES.en;
  return {
    name: name.slice(0, 255),
    external_id: ids.device,
    model: type === DEVICE_TYPES.CLUSTER ? 'Cluster' : 'Node',
    should_poll: false,
    params: params
      .filter((param) => param.value !== null && param.value !== undefined && param.value !== '')
      .map((param) => ({ name: param.name, value: String(param.value).slice(0, 255) })),
    features: BLUEPRINTS[type].map((feature) => ({
      name: names[feature.key],
      external_id: ids.feature(feature.key),
      ...feature.definition,
      read_only: true,
      has_feedback: false,
      keep_history: feature.definition.category !== CATEGORY.TEXT,
    })),
  };
}

/**
 * The states of every feature of a device, in the publishStates format;
 * features without a value are left out.
 * @param {object} gladys
 * @param {string} type
 * @param {string} platformId
 * @param {object|null} item
 */
export function featureStates(gladys, type, platformId, item) {
  const ids = deviceIds(gladys, type, platformId);
  const states = [];
  for (const feature of BLUEPRINTS[type]) {
    const externalId = ids.feature(feature.key);
    if (feature.text) {
      const text = item ? feature.text(item) : '';
      if (text) {
        states.push({ device_feature_external_id: externalId, text: text.slice(0, 255) });
      }
      continue;
    }
    if (type === DEVICE_TYPES.CLUSTER && !item) {
      continue;
    }
    const value = round(feature.value(item), feature.digits ?? 0);
    if (value !== null) {
      states.push({ device_feature_external_id: externalId, state: value });
    }
  }
  return states;
}
