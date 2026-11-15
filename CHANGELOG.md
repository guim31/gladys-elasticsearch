# Changelog

All notable changes to this integration are documented in this file. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project
uses [semantic versioning](https://semver.org/).

Describe each change under `## [Unreleased]` as you make it. The Release
workflow moves that section under the version it ships, and the section becomes
the notes of the version's GitHub Release.

## [Unreleased]

## [1.0.0] - 2026-11-15

### Added

- Health of an Elasticsearch or OpenSearch cluster: a cluster device (status
  0 green / 1 yellow / 2 red, nodes, data nodes, active and unassigned shards,
  indices, documents, size of the indices, version) and one device per node
  (disk used, JVM heap used, CPU, load, shards, in the cluster).
- Scene triggers: cluster status changes, node disk almost full (80 to 95 %),
  cluster unreachable.
- Scene action "Health of the cluster", with a ready-made summary.
- Dashboard widget "Search cluster", with a Refresh button.
- Authentication by API key or user and password; HTTPS with the fingerprint
  of a self-signed certificate confirmed by the user; "Test the connection"
  action.
- Texts and documentation in English, French, German and Spanish.

[Unreleased]: https://github.com/guim31/gladys-elasticsearch/compare/v1.0.0...HEAD
[1.0.0]: https://github.com/guim31/gladys-elasticsearch/releases/tag/v1.0.0
