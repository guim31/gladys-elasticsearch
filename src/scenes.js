// -----------------------------------------------------------------------------
// Scene action handlers (manifest `scene_actions`, Gladys 5.1+).
//
// "Is the cluster red?" is already a scene condition on the status feature.
// What a condition cannot do is put the state of the cluster in a message
// ("Cluster logs: yellow, 3 nodes, 5 unassigned shards, disk of es-1 87 %"),
// with the figures as outputs too, without adding any device. It reads the
// cluster again when the last read is older than 15 seconds. An unreachable
// cluster is an answer, not a failure: `online` false, and the summary says
// so — the scene can still send it.
// -----------------------------------------------------------------------------

import { summarize } from './texts.js';

export const SCENE_ACTIONS = {
  async get_cluster_health(hub) {
    await hub.refreshIfStale();
    const view = hub.view();
    const language = hub.config?.language ?? 'en';
    const outputs = {
      cluster_name: view.name,
      online: view.snapshot !== null,
      summary: summarize(view, language),
    };
    const { snapshot } = view;
    if (!snapshot) {
      return outputs;
    }
    const disks = (snapshot.nodes ?? []).map((node) => node.disk).filter((v) => v !== null);
    const all = {
      ...outputs,
      status: snapshot.status,
      status_code: snapshot.statusCode,
      nodes: snapshot.nodeCount,
      unassigned_shards: snapshot.unassignedShards,
      documents: snapshot.docCount,
      max_disk_used: disks.length ? Math.max(...disks) : null,
    };
    // Scalars only: a value the cluster did not give is left out.
    return Object.fromEntries(Object.entries(all).filter(([, value]) => value !== null));
  },
};
