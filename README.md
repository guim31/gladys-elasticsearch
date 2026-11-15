# Elasticsearch / OpenSearch for Gladys Assistant

An external integration for [Gladys Assistant](https://gladysassistant.com) that
follows the **health of an Elasticsearch or OpenSearch cluster**: status
(green, yellow, red), nodes, shards, indices, documents, size, and per node
the disk, JVM heap, CPU and load. It reads the monitoring APIs of the cluster
over the local network, read only. No cloud, no account.

The cluster behind a log stack, a full-text search (Nextcloud, Paperless…) or
[Graylog](https://github.com/guim31/gladys-graylog) — which follows Graylog's
own view of its storage, where this integration follows the cluster itself.

> Tested against real Elasticsearch 8.19.7 and OpenSearch 2.19.3 single-node
> clusters (Docker), with and without security, green, yellow and red, and
> stopped; the Docker image in the Gladys sandbox constraints against the
> SDK's fake Gladys. Not yet in a real Gladys nor on a multi-node cluster:
> feedback welcome in the [issues](https://github.com/guim31/gladys-elasticsearch/issues).

## Features

- **Cluster device**: _Status (0 green, 1 yellow, 2 red)_, _Nodes_, _Data
  nodes_, _Active shards_, _Unassigned shards_, _Indices_, _Documents_, _Size
  of the indices_ (GB) and _Version_.
- **One device per node**: _Disk used_, _JVM heap used_, _CPU_, _Load (1 min)_,
  _Shards_ and _In the cluster_ (0 once the node left). Keyed on the node id,
  which survives restarts and renames.
- **Scene triggers**, without adding any device: _Cluster status changes_
  (filter on the new status; variables: previous status, unassigned shards,
  red indices), _Node disk almost full_ (80, 85, 90, 95 %: the disk
  watermarks of Elasticsearch) and _Cluster unreachable_.
- **Scene action** _Health of the cluster_: the figures as outputs, and a
  ready-made summary for a message.
- **Dashboard widget** "Search cluster": status, nodes, unassigned shards,
  documents, size, red indices and one row per node, a **Refresh** button.
- **Authentication**: none, Basic (user and password) or an Elasticsearch API
  key. **HTTPS** with a self-signed certificate: _Test the connection_ shows
  its SHA-256 fingerprint, which the user confirms by copying it into the
  configuration; only that certificate is then accepted, checked before any
  credential is sent. Without a scheme, HTTPS is tried first, then HTTP.
- Texts in English, French, German and Spanish.

## Requirements

- Gladys Assistant 5.1.0 or later.
- Elasticsearch or OpenSearch reachable from Gladys (port 9200 by default).
- With security enabled: an API key or a user with the `monitor` cluster
  privilege (and `monitor` on the indices to name the red ones). See
  [docs/en.md](docs/en.md).

## Installation

In Gladys: **Integrations → Install from GitHub**, then enter
`https://github.com/guim31/gladys-elasticsearch`. Fill in the configuration,
click **Test the connection**, and add the devices from the **Discover** tab.

User documentation: [English](docs/en.md), [Français](docs/fr.md),
[Deutsch](docs/de.md), [Español](docs/es.md).

## How it works

Every refresh interval (1 minute by default, 30 s to 5 min), five GET
requests: `/`, `/_cluster/health`, `/_cluster/stats` (filtered),
`/_cat/nodes` and `/_cat/allocation`; `/_cat/indices?health=red` too when the
cluster is red. Only the changed values are sent to Gladys, every value again
every 6 hours. The integration reads the cluster on its own timer
(`should_poll: false`). A small state file in `/data` remembers the last
status and the disk steps already announced, so a restart neither repeats nor
misses a scene event.

## Limits

- One cluster per installation.
- No per-index monitoring beyond the names of the red indices.
- Elasticsearch 7 and OpenSearch 1 answer the same APIs but were not tested.

## Development

```bash
npm ci
npm run format:check && npm run lint && npm test
npx -y github:GladysAssistant/integration-store --skip-image-check .
```

The tests run against the SDK's fake Gladys and an in-memory cluster serving
answers recorded from real Elasticsearch 8.19.7 and OpenSearch 2.19.3
(`test/fixtures/clusters/`, addresses anonymized). See `CLAUDE.md`.

## Credits and license

Built on the official
[integration template](https://github.com/GladysAssistant/integration-template-js)
and [SDK](https://github.com/GladysAssistant/integration-sdk-js) of Gladys
Assistant. Home Assistant has no Elasticsearch monitoring integration to start
from; the APIs are documented by Elastic and the OpenSearch project.

The cover shows the official logos of Elasticsearch and OpenSearch, from
Wikimedia Commons
([Elasticsearch logo.svg](https://commons.wikimedia.org/wiki/File:Elasticsearch_logo.svg),
[Opensearch Logo.svg](https://commons.wikimedia.org/wiki/File:Opensearch_Logo.svg)).

Apache License 2.0, see [LICENSE](LICENSE).

Elasticsearch is a trademark of Elasticsearch B.V., OpenSearch of LF
Projects, LLC. This project is not affiliated with Elastic, the OpenSearch
project or Amazon.
