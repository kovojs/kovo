---
title: Verify release artifacts
description: Check a Kovo certificate against independently reviewed policy and exact packed modules.
---

# Verify release artifacts

Use `kovo-verify` when you need to decide whether an unpacked Kovo release matches
the certificate and authority posture you reviewed. It runs without Kovo's
compiler, server, or application runtime.

## Obtain the policy separately

Get `kovo.certificate-policy/v1` through an independently authenticated channel.
Do not download the policy, certificate, and packages from one mutable location
and treat their agreement as independent review.

Unpack the package tarballs below one root. Keep the package layout:

```text
unpacked-packages/
└── @kovojs/
    ├── core/
    ├── server/
    └── …
```

## Run the check

Install the standalone verifier, then point it at the three inputs:

```sh
pnpm add -D @kovojs/verify

pnpm exec kovo-verify \
  ./kovo-certificate-v1.json \
  --policy ./kovo-certificate-policy-v1.json \
  --artifacts ./unpacked-packages
```

A clean check prints one versioned summary and exits `0`:

```text
kovo-verify/v1 PASS artifacts=199 edges=913 roots=96 doors=24 opaque=0 capabilities=41 findings=0
```

The exact counts depend on the release. `PASS` and `findings=0` are the decision.

## Feed findings to another tool

Use JSON for CI or a release-review service. Flag groups can appear in any
order:

```sh
pnpm exec kovo-verify \
  --format json \
  --artifacts ./unpacked-packages \
  ./kovo-certificate-v1.json \
  --policy ./kovo-certificate-policy-v1.json
```

The JSON envelope is `kovo-diagnostic/v1`. Its result has
`schema: "kovo.verify-report/v1"`, `status`, `ok`, the same stats, and the exact
ordered `{ obligation, code, message }` findings. `result.text` preserves the
unchanged human proof report, while the shared diagnostic records make the same
finding codes and messages available to generic tooling.

Use `--format github` in GitHub Actions. It renders those same records as
workflow annotations and then prints the unchanged human proof report:

```sh
pnpm exec kovo-verify \
  --format github \
  --artifacts ./unpacked-packages \
  ./kovo-certificate-v1.json \
  --policy ./kovo-certificate-policy-v1.json
```

## Handle the exit code

- `0` means the certificate verified.
- `1` means the verifier completed and reported certificate findings.
- `2` means usage, I/O, or parsing prevented a decision.

Do not turn exit `2` into a passing check. Fix the invocation or evidence input
and run it again.

## Embed the API

Reach for the package API when your review system already owns authenticated,
bounded certificate and policy bytes. The runnable
[`examples/verifier/check-release.mjs`](https://github.com/kovojs/kovo/blob/main/examples/verifier/check-release.mjs)
shows `verifyCertificateDirectory()` and `formatCertificateVerification()`
together. The [API reference](/api/verify/) lists the complete 11-declaration
certificate family.

## Next

- [Deploy an app](/guides/deployment/) — build the package tree that a release review checks.
- [Inspect Kovo's security model](/guides/security/) — understand the authority closures behind the certificate.

<details>
<summary>Spec & diagnostics</summary>

SPEC §6.6 defines the certificate and policy schemas, packed-tree census,
finite budgets, independent-policy requirement, and standalone CLI contract.
Certificate findings use the `closure`, `coverage`, `schema`, and `stability`
obligations rather than KV app-build diagnostics.

</details>
