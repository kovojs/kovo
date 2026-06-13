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
