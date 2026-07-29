# @kovojs/verify

Check a packed Kovo release without importing Kovo's compiler, server, or runtime.
Use this after you obtain the reviewer policy through an independently
authenticated channel.

```sh
pnpm add -D @kovojs/verify

pnpm exec kovo-verify \
  ./kovo-certificate-v1.json \
  --policy ./kovo-certificate-policy-v1.json \
  --artifacts ./unpacked-packages
```

A verified certificate exits `0`. Certificate findings exit `1`. A usage, I/O,
or parse error means the check was indeterminate and exits `2`.

## Read the result as JSON

Add `--format json` when another tool will consume the report:

```sh
pnpm exec kovo-verify \
  --artifacts ./unpacked-packages \
  --format json \
  ./kovo-certificate-v1.json \
  --policy ./kovo-certificate-policy-v1.json
```

The certificate argument and the `--policy`, `--artifacts`, and `--format` flag
groups may appear in any order. Human output is `kovo-verify/v1`. JSON uses the
shared `kovo-diagnostic/v1` envelope. Its result has
`schema: "kovo.verify-report/v1"`, `status`, `ok`, stats, and the exact ordered
`{ obligation, code, message }` findings; `result.text` preserves the unchanged
human report. A JSON indeterminate error instead uses
`kovo.verify-command-error/v1` and has no completed-verification fields.
Use `--format github` to emit the same records as GitHub workflow annotations
followed by the unchanged human report.

Run `kovo-verify --help` for the complete command contract or
`kovo-verify --version` for the installed version. `-h`, `--help`, and
`--version` write to stdout and exit `0`.

## Embed the verifier

The package root keeps the complete 11-declaration certificate family together.
The common directory-checking path is:

```js
import { readFile } from 'node:fs/promises';
import { formatCertificateVerification, verifyCertificateDirectory } from '@kovojs/verify';

const certificate = JSON.parse(await readFile('./certificate.json', 'utf8'));
const policy = new Uint8Array(await readFile('./reviewer-policy.json'));
const result = await verifyCertificateDirectory(certificate, policy, './packages');

process.stdout.write(formatCertificateVerification(result));
```

The full runnable version lives in
[`examples/verifier/check-release.mjs`](../../examples/verifier/check-release.mjs).
Embedding code owns how it authenticates and bounds its certificate and policy
inputs. The CLI already supplies bounded, no-follow file reads.

## Reference

- API: `/api/verify/`
- Guide: `/guides/verifying-release-artifacts/`
- Normative behavior: `SPEC.md` §6.6
