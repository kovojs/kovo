# GitHub Workflow Rules

## Toolchain-provided binaries

When a workflow uses a setup action for a toolchain, do not assume every
underlying binary that setup action used internally is available as a bare
command in later steps.

Prefer invoking project package-manager commands through the toolchain command
that the setup action explicitly installs. In this repository, workflows using
`voidzero-dev/setup-vp` should run pnpm commands as `vp exec pnpm ...` unless
the workflow also explicitly installs and exposes pnpm itself.

This keeps local and CI command resolution aligned: `vp install` may install
dependencies with pnpm, but a later `run: pnpm ...` step can still fail on
GitHub Actions with `pnpm: command not found`.

Release producer jobs are the deliberate exception. They use the repository's
`kovo-release-pnpm` action, which authenticates an exact Node archive checksum,
prepares the exact integrity-qualified pnpm 10.12.1 CLI in a new cache, and then
disables Corepack networking and project-spec selection. Top-level producer
commands invoke that cached CLI through the authenticated Node binary. Nested
scripts may use the generated shim only with the same locked `COREPACK_HOME`,
`COREPACK_ENABLE_NETWORK=0`, and `COREPACK_ENABLE_PROJECT_SPEC=0` environment.

No-install release jobs, especially jobs with `id-token: write`, use the separate
`kovo-release-node` action. That action has no package-manager input or branch.
The fresh `seal-release` job downloads only the manifest and package tarballs,
enforces their exact bounded regular-file census, rehashes and parses their bytes,
and creates the single immutable archive later attested and published.

## Release authority honesty boundary

Repository-local workflow tests and source scanners are accidental-drift and
change-review gates. They do not prove safety against a malicious commit that can
edit a workflow and its tests together. Actual npm publish authority depends on
external GitHub controls: the `release` environment's required review,
`prevent_self_review`, its main-branch deployment policy, and trusted hosted
runners plus pinned third-party actions. Keep those settings outside repository
control and review them independently. Administrator bypass of the external
environment remains an explicit residual trust assumption.

## Browser automation

When a workflow runs Playwright-backed checks, install the required browser
binary and system dependencies in the workflow before that check. A package
install makes the Playwright library available, but GitHub-hosted runners do
not reliably have the matching browser executable cached for the current
package version.

For Chromium-only smoke checks in this repository, run
`vp exec playwright install --with-deps chromium` before invoking the browser
gate. For the root browser matrix gate, install every configured engine with
`vp exec playwright install --with-deps chromium firefox webkit`.
