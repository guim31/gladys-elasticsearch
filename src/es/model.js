// -----------------------------------------------------------------------------
// From the raw answers of the cluster to one snapshot, the only shape the
// rest of the code reads. The `_cat` APIs answer strings ("45", "0.12", null
// for a value the node does not report): everything becomes a number or null.
//
// Elasticsearch and OpenSearch answer the same, apart from `/`
// (`version.distribution: "opensearch"`) and the `master` column of
// `_cat/nodes`, `*` for the elected one in both.
// -----------------------------------------------------------------------------

export const STATUS_CODES = Object.freeze({ green: 0, yellow: 1, red: 2 });

// Names of the red indices kept, at most (the rest is counted).
export const MAX_RED_INDICES = 20;

/** A number from a JSON number or a `_cat` string, null otherwise. */
export function toNumber(value) {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value !== 'string' || value.trim() === '') {
    return null;
  }
  const number = Number(value.trim().replace(/%$/, ''));
  return Number.isFinite(number) ? number : null;
}

const list = (answer) => (Array.isArray(answer) ? answer : null);

/** `Elasticsearch 8.19.7` or `OpenSearch 2.15.0`. */
export function productOf(info) {
  const distribution = String(info?.version?.distribution ?? '').toLowerCase();
  return distribution === 'opensearch' ? 'OpenSearch' : 'Elasticsearch';
}

function parseNodes(nodes, allocation) {
  const rows = list(nodes);
  if (!rows) {
    return null;
  }
  // _cat/allocation names nodes, it has no id in every version.
  const byName = new Map();
  for (const row of list(allocation) ?? []) {
    if (row && typeof row.node === 'string') {
      byName.set(row.node, row);
    }
  }
  return rows
    .filter((row) => row && typeof row.id === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(row.id))
    .map((row) => {
      const allocated = byName.get(row.name) ?? null;
      const disk = toNumber(row['disk.used_percent']) ?? toNumber(allocated?.['disk.percent']);
      return {
        id: row.id,
        name: typeof row.name === 'string' && row.name ? row.name : row.id,
        ip: typeof row.ip === 'string' ? row.ip : null,
        roles: typeof row['node.role'] === 'string' ? row['node.role'] : '',
        master: row.master === '*',
        version: typeof row.version === 'string' ? row.version : null,
        heap: toNumber(row['heap.percent']),
        cpu: toNumber(row.cpu),
        load: toNumber(row.load_1m),
        disk,
        diskFree: toNumber(row['disk.avail']) ?? toNumber(allocated?.['disk.avail']),
        shards: allocated ? toNumber(allocated.shards) : null,
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * @param {object} answers
 * @param {object} answers.info `/`
 * @param {object} answers.health `_cluster/health`
 * @param {object} answers.stats `_cluster/stats` or `{ error }`
 * @param {Array|object} answers.nodes `_cat/nodes` or `{ error }`
 * @param {Array|object} answers.allocation `_cat/allocation` or `{ error }`
 * @param {Array|object} answers.redIndices `_cat/indices?health=red` or `{ error }`
 */
export function parseSnapshot({ info, health, stats, nodes, allocation, redIndices }) {
  const status = Object.hasOwn(STATUS_CODES, health?.status) ? health.status : null;
  const indices = stats?.indices ?? {};
  const red = list(redIndices)
    ?.map((row) => row?.index)
    .filter((name) => typeof name === 'string');
  return {
    uuid: info.cluster_uuid,
    clusterName: String(health?.cluster_name ?? info.cluster_name ?? ''),
    product: productOf(info),
    version: info.version.number,
    status,
    statusCode: status === null ? null : STATUS_CODES[status],
    nodeCount: toNumber(health?.number_of_nodes),
    dataNodeCount: toNumber(health?.number_of_data_nodes),
    activeShards: toNumber(health?.active_shards),
    unassignedShards: toNumber(health?.unassigned_shards),
    activeShardsPercent: toNumber(health?.active_shards_percent_as_number),
    indexCount: toNumber(indices.count),
    docCount: toNumber(indices.docs?.count),
    storeBytes: toNumber(indices.store?.size_in_bytes),
    nodes: parseNodes(nodes, allocation),
    redIndices: red ?? null,
    // Errors of the optional reads, for the logs and the Test action.
    partial: [stats, nodes, allocation, redIndices]
      .map((answer) => answer?.error)
      .filter((error) => error instanceof Error),
  };
}
