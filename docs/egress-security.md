# Egress Security Boundary

Kovo's server egress guard is a runtime defense-in-depth floor, not a by-construction
proof. SPEC §6.6 classifies outbound egress this way because the final IP address is
known only after runtime URL parsing and DNS resolution.

The floor denies private, loopback, link-local, special-use, and cloud metadata
destinations by default. Public destinations are unrestricted. Intentional internal
services must be listed in `createApp({ egress: { allowInternal } })` as exact
`host:port` entries. IPv4 CIDR entries are accepted for infrastructure exceptions,
but Kovo emits KV438 because a broad entry is provenance-blind: any server code path
that can choose a URL can reach every matching private host at that port.

Blocked connections throw `EgressBlockedError` with status `502`. The error logs the
blocked destination and the operational fix: add the exact `host:port` to
`egress.allowInternal` when the destination is intentional.

Cloud metadata endpoints are not enabled through `allowInternal`. AWS, GCP, and Azure
metadata access is available only inside the framework-owned credential-provider frame
created by `awsCredential`, `gcpCredential`, or `azureCredential`. SDKs that are not
constructed with those wrappers may still try raw metadata requests; those requests
fail closed with `EgressBlockedError`. Prefer workload identity, environment
credentials, sidecar credentials, or framework-wrapped providers so SDK refresh paths
do not depend on ambient metadata fetches.

Residual limits are explicit:

- This is not an external data-exfiltration allowlist; public egress remains open.
- Same-process privileged code can deliberately remove or replace global Node hooks.
  Kovo detects unsafe re-patching of its installed Node egress guard where feasible,
  but it cannot prove hostile same-process code is contained.
- Non-HTTP native clients are governed at the `net.connect` layer only. They still
  need exact `allowInternal` entries for private hosts, but Kovo does not understand
  their higher-level protocol semantics.
- Confused-deputy proxying is out of scope. App routes, queries, mutations, and
  endpoints still need their normal access and input-validation boundaries.
