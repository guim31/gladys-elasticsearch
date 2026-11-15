// -----------------------------------------------------------------------------
// What the scene triggers compare with, read after read. Pure bookkeeping, no
// I/O: the hub (src/hub.js) feeds it every successful read and fires the
// events it returns. The tables live in /data (src/store.js), so a restart
// neither repeats an announcement nor misses a change.
//
//   - status: one event per change of the health status (green, yellow,
//     red), with the previous one. The first status ever seen is recorded
//     without event: nothing changed.
//   - disks: the scene filters of Gladys only compare for equality, so the
//     trigger carries a `threshold` filter among fixed steps, and one event
//     is fired per step crossed. The steps follow the disk watermarks of
//     Elasticsearch (85 % low: no new shard on the node, 90 % high: shards
//     move away, 95 % flood stage: indices turn read only). A step is
//     announced again only once the disk went 2 points below it.
// -----------------------------------------------------------------------------

export const DISK_THRESHOLDS = Object.freeze([80, 85, 90, 95]);
export const DISK_REARM_POINTS = 2;

const object = (value) =>
  value && typeof value === 'object' && !Array.isArray(value) ? value : {};
const numbers = (value) => (Array.isArray(value) ? value.filter(Number.isFinite) : []);

export class Watcher {
  /** @param {object} [saved] the tables saved by toJSON() */
  constructor(saved = {}) {
    const tables = object(saved);
    this.saved = {
      status: object(tables.status),
      disks: object(tables.disks),
    };
  }

  /**
   * @param {string} uuid the cluster
   * @param {string|null} status green, yellow or red
   * @returns {{ status: string, previous: string }|null} the change, if any
   */
  status(uuid, status) {
    if (!status) {
      return null;
    }
    const previous = this.saved.status[uuid] ?? null;
    this.saved.status[uuid] = status;
    return previous && previous !== status ? { status, previous } : null;
  }

  /**
   * @param {string} uuid the cluster
   * @param {Array<{ id: string, disk: number|null }>} nodes
   * @returns {Array<{ node: object, threshold: number }>} the steps crossed
   */
  disks(uuid, nodes) {
    const crossed = [];
    for (const node of nodes) {
      if (node.disk === null) {
        continue;
      }
      const id = `${uuid}-${node.id}`;
      const entry = this.saved.disks[id];
      if (!entry) {
        this.saved.disks[id] = DISK_THRESHOLDS.filter((step) => node.disk >= step);
        continue;
      }
      const above = new Set(numbers(entry));
      for (const step of DISK_THRESHOLDS) {
        if (node.disk >= step && !above.has(step)) {
          above.add(step);
          crossed.push({ node, threshold: step });
        } else if (node.disk < step - DISK_REARM_POINTS) {
          above.delete(step);
        }
      }
      this.saved.disks[id] = [...above].sort((a, b) => a - b);
    }
    return crossed;
  }

  toJSON() {
    return this.saved;
  }
}
