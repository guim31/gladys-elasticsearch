# Security policy

## Reporting a vulnerability

Please do **not** report a security problem in a public issue, pull request or
forum post.

Report it privately through GitHub instead: open the **Security** tab of this
repository, then **Report a vulnerability**.

No such button? Private reporting is not enabled yet: open an issue that only
asks the maintainers for a private contact, without any detail of the problem,
and send the report there.

Include, when you can:

- the version of the integration and of Gladys;
- what an attacker can do, and the steps to reproduce it;
- the log lines that help (remove tokens, passwords and addresses first).

The fix ships as a new version of the integration, and the advisory is
published once users can update.

## Supported versions

Only the latest release receives security fixes: update the integration from
Gladys before reporting a problem.

## Scope

In scope: the code of this repository and the Docker image it publishes.

What the integration handles:

- **Secrets**: the API key or the password of the cluster, kept by Gladys in
  the configuration of the integration. They are sent only to the configured
  cluster, in the `Authorization` header, and never written to the logs nor to
  `/data`. Over HTTPS, the certificate is checked (or matched against the
  confirmed fingerprint) before any request, and so before any credential,
  leaves the container.
- **`/data`**: one file, `elasticsearch-state.json`: the last health status
  of the cluster and the disk steps already announced per node. No credential,
  no document of the cluster.
- **Network**: GET requests to the monitoring APIs of the configured cluster
  only, on the local network. Read only: the integration never writes to the
  cluster, and a key limited to the `monitor` privilege is enough.
- **"Accept any certificate"** disables the certificate check: anyone on the
  network could then pose as the cluster and receive the credentials. The
  documentation recommends the fingerprint instead.

Out of scope: Gladys Assistant itself (see its
[security policy](https://github.com/GladysAssistant/Gladys/security/policy)),
and Elasticsearch or OpenSearch themselves.
