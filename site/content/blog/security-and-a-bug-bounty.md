---
title: Our security claims, and $500 to break them
description: Kovo's threat matrix is green with no open cell — a self-graded claim, so we are paying the first three people who prove a specific one wrong.
date: 2026-07-07
---

# Our security claims, and $500 to break them

Run `kovo explain` on a Kovo app and it prints every intentional security hole in the
project — every `trustedSql`, every `unsafeRegex`, every `crossOwnerRead` — with the line
that opened it. That is the shape of the whole security model: not "trust us," but a
specific, enumerated, testable set of properties, and a way to see exactly where they stop.

Two artifacts define what Kovo claims:

- **`docs/security-threat-matrix.md`** — a coverage map of seven surfaces × four threat
  categories. Every cell names a control with its test/gate, an audited escape hatch, or an
  explicit out-of-scope note. As of today it has **no open cell**.
- **`SECURITY.md`** — a narrower, normative guarantee register. Each entry is backed by an
  enrolled trusted-computing-base choke and a `KOVO_PARANOID` production-artifact proof, and
  passes `pnpm run check:security-guarantee`. Today the register formally guarantees two
  things: **secret-value confidentiality at the query-wire egress**, and **owner-scope
  confinement** — a cross-owner read returns nothing and a cross-owner write is refused by the
  engine's row-level-security floor, proven against a real Postgres cluster in a built
  artifact.

"No open cell" is a real milestone. It is also a claim we graded ourselves. So we are doing
the honest thing next: **paying people to prove a specific claim wrong.**

## The bounty

**$500 to each of the first three reporters with a verified, distinct finding.** A finding is
verified when we reproduce it. It has to be reproducible against the latest release, in a
**default** `create-kovo` app with no escape hatches enabled, and it has to violate a stated
claim — a formal guarantee id, a threat-matrix cell, or a `KV###` code.

We are not paying for a feeling that something is unsafe. We are paying for a counterexample
to a claim we made.

## What counts

In scope is a default-path violation of a stated property:

- **Cross-owner reads or writes** — one user reaching another's row through the managed
  database API. Row-level security is the sole owner-scope door; get past it. _(Formal
  guarantee.)_
- **Secret disclosure** — a value from a secret column reaching the client wire, a header, a
  redirect, a log, or an error. _(Formal guarantee.)_
- **Injection** — XSS in any render position, SQL injection through the managed query API,
  header/cookie/CRLF injection, open redirect, or SSRF past the egress floor.
- **Cross-origin request forgery** on a state-changing mutation.
- **Session or principal forgery** — becoming another principal.
- **Reading an unboxed cross-user credential** on a request-reachable path.
- **An escape hatch that `kovo explain` does not show.** The guarantee is that every hole is
  visible; find one that isn't.

The full, precise terms — the two confidence tiers, the exact in-scope and out-of-scope lists,
and the reporting process — are in
[`SECURITY.md`](https://github.com/kovojs/kovo/blob/main/SECURITY.md).

## What does not count (candor is part of the model)

Kovo is blunt about where its guarantees end, and the bounty is scoped to match:

- **Dependency internals.** Better Auth, Drizzle, node-pg, PGlite, and argon2 are declared
  _trusted dependency surfaces_, not Kovo code. A weak reset-token in Better Auth is a Better
  Auth report.
- **Denial of service.** Rate limits, pool sizing, and query cost are the deploy's job. Kovo
  ships a default load-shed posture but makes no availability guarantee.
- **Using an escape hatch unsafely.** `trustedSql`, `unsafeRegex`, `crossOwnerRead`,
  `csrf: false` and the rest are documented, `kovo explain`-visible doors you opened on
  purpose. Walking through one is not a framework bug — _hiding_ one is.
- **Deploy and operator responsibilities** — TLS, secret storage, per-tenant log isolation,
  running dev PGlite in production.
- **Your own server code.** Kovo does not sandbox an author from their own filesystem, child
  processes, or network calls.

## Why we think this is fair — and why we still want you to try

The matrix did not get green by asserting it. It got green through twenty-two rounds of
adversarial self-review: each round attacked a surface, and — until recently — each round
found the next axis. A `?` missing from a ReDoS analyzer. An octal IP literal the classifier
read one way and the socket read another. An authorization label that could disagree with the
guard that actually ran. Every one is now a closed class with a regression test.

But "we ran out of findings" is not a proof, and we know it. A hand-rolled security model is
exactly as complete as the people who stared at it — and we have stared at it a lot, which is
its own blind spot. Three sets of fresh, adversarial eyes are worth more than one more
internal round.

If you break a stated claim in a default app:
[tell us](https://github.com/kovojs/kovo/blob/main/SECURITY.md), and collect.
