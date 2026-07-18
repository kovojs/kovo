---
title: Outbound requests & egress
description: Call third-party APIs through Kovo's runtime egress surface, then narrow exactly which destinations are allowed.
order: 16.2
---

# Outbound requests & egress

Use this when app code needs to call Stripe, Resend, OpenAI, or another external HTTP service. The
useful Kovo default is that framework-owned outbound HTTP fails closed until you name the
destination.

## Call a third-party API

Use the framework-owned fetch in a task body:

```text
// Source-verified shape from packages/server/src/task.ts
import { s, task } from '@kovojs/server';

export const sendReceipt = task('email/send-receipt', {
  input: s.object({ orderId: s.string() }),
  async run({ orderId }, ctx) {
    await ctx.fetch('https://api.resend.com/emails', { method: 'POST', body: JSON.stringify({ orderId }) });
  },
});
```

Verified webhook handlers receive the same `ctx.fetch` capability. It is stricter than plain
process-global public egress because it requires an exact destination allowlist entry. A custom
task runner cannot replace it with another fetch implementation.

## Run it

With no allowlist, the call fails closed. The thrown error tells you what to add:

```text
Outbound egress to api.resend.com:443 was blocked by the Kovo private-network deny floor (public; SPEC §6.6 runtime defense-in-depth). Add the exact origin to createApp({ egress: { allowDestinations: [...] } }).
```

That is an `EgressBlockedError`.

## Scope the allowlist

Add only the origins and internal destinations you mean to trust:

```text
// Source-verified shape from packages/server/src/app-types.ts
import { createApp } from '@kovojs/server';

createApp({
  egress: {
    allowDestinations: ['https://api.resend.com', 'https://api.stripe.com'],
    allowInternal: ['127.0.0.1:11434'],
  },
});
```

`allowDestinations` is for framework-owned HTTP surfaces. `allowInternal` is the narrow
`host:port` escape hatch for private addresses such as a local sidecar.

Kovo normalizes each declared origin at boot. Hostname case, Unicode, IPv6 spelling, DNS trailing
dots, and default ports all produce one comparison value. A malformed entry stops boot with
`EgressConfigError`; Kovo does not ignore it.

The two lists do different jobs. Naming an origin does not reopen private IP ranges. If a
destination resolves to loopback, RFC1918, link-local, unique-local, or metadata space, the
private-network floor still applies.

Kovo checks the initial origin and every redirect before DNS. It then checks every DNS answer and
pins the answer set used by each new dial. A declared hostname can rotate between safe addresses
without widening the origin allowlist. One private or metadata answer closes the whole request.

## Declare a NAT64 prefix

Do this when your deployment uses DNS64/NAT64 with a Network-Specific Prefix. Copy the Pref64
from the network configuration into the app posture:

```text
createApp({
  egress: {
    nat64Prefixes: ['2001:db8:64::/96'],
  },
});
```

Kovo can now decode the IPv4 destination inside each synthesized IPv6 answer. A synthesized
metadata or private address stays blocked at every transport door.

Do not list `64:ff9b::/96`; Kovo already recognizes that well-known prefix. `nat64Prefixes`
accepts the six RFC 6052 layouts: `/32`, `/40`, `/48`, `/56`, `/64`, and `/96`. Kovo refuses to
boot on malformed, overlapping, or non-network CIDRs. It does not discover Pref64 automatically,
because a best-effort DNS answer is not stable process-wide policy.

## Add the production shape

Keep the posture tight:

- Prefer exact `https://host` entries in `allowDestinations`.
- Prefer exact `host:port` entries in `allowInternal`.
- Declare every deployment-specific DNS64/NAT64 Pref64 in `nat64Prefixes`.
- Do not try to allowlist cloud metadata. Kovo rejects that configuration with
  `EgressConfigError`.
- Remember that omitted `allowDestinations` means framework-owned HTTP stays blocked, even for
  public internet hosts.
- Keep HTTP proxies outside app config. `egress.proxy`, `egress.dispatcher`, and per-call custom
  dispatchers are not supported positive egress doors. Put a transparent proxy in deployment
  infrastructure when you need one.

## Handle failure

You will usually see one of two errors:

- `EgressBlockedError`: the request destination was not allowed at runtime.
- `EgressConfigError`: the boot-time config itself is invalid, such as a malformed origin or a
  forbidden metadata allowlist entry.

Treat both as posture problems, not retry problems. Fix the allowlist, then rerun the call.

## Next

- [Background tasks](/guides/background-tasks/) - the main place app-authored outbound HTTP runs today.
- [Security](/guides/security/) - see how the egress floor fits with the rest of Kovo's sink model.

<details>
<summary>Spec & diagnostics</summary>

Public egress API: `packages/server/src/index.ts`. Error and config types, allowlist semantics, and
the remediation strings: `packages/server/src/egress.ts`. Task and webhook `ctx.fetch` surfaces:
`packages/server/src/task.ts`, `packages/server/src/task-runner.ts`, and
`packages/server/src/webhook.ts`. App-facing egress config docs in code:
`packages/server/src/app-types.ts`. The positive origin capability and the ambient private-network
defense-in-depth floor are distinct; the authoritative contract is SPEC section 6.6.

API reference: [@kovojs/server](/api/server/).

</details>
