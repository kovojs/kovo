# Agent Docs Injection And Refresh Plan

## Purpose

Kovo apps should carry a compact, framework-owned agent rules table of contents in
`AGENTS.md`, derived from the same agent-facing documentation family as
`llms.txt`, while preserving app-local instructions around it. New apps should
start with the block, and existing apps should be able to refresh it with a Kovo
CLI command that also mirrors the latest docs into `./.kovo/docs/`.

`SPEC.md` remains normative for framework behavior. This plan concerns app
scaffolding and documentation distribution, not a new framework runtime contract.

## Decisions

- The injected app-local section is delimited exactly by
  `<!-- BEGIN:kovo-rules -->` and `<!-- END:kovo-rules -->`.
- `create-kovo` includes `AGENTS.md` in the app template, and `CLAUDE.md` is a
  symlink pointing to `AGENTS.md` where the host filesystem supports symlinks.
- The generated block records package version provenance only. Same-version docs
  may still change; `update-docs` is the explicit refresh path for that case.
- App creation must not require network access. It uses the docs bundled in the
  installed `create-kovo` package.
- `kovo update-docs` should fetch the latest canonical docs when network access
  is available, replace only the marked rules block, and write the fetched docs
  into `./.kovo/docs/`.
- If fetching fails, `update-docs` falls back to bundled docs and reports the
  fallback in command output.
- The injected block should stay concise: first name the most important Kovo
  commands, then instruct agents to read the local docs under `./.kovo/docs/`,
  then provide a condensed table of contents. It should not restate broad
  framework policy already covered by the mirrored docs.

## Completion Standard

This plan is complete when a new scaffold contains `AGENTS.md`, `CLAUDE.md`
resolves to it, the marked Kovo rules block is replaceable without disturbing
user-authored content, `kovo update-docs` refreshes the block and local
`./.kovo/docs/` mirror from latest docs with a bundled fallback, and focused CLI
and scaffold tests prove those behaviors.

## Implementation Checklist

- [ ] **Define the canonical condensed rules source.**
  - Deliverable: add a checked-in condensed agent rules document suitable for
    inclusion between the `kovo-rules` markers, plus any small helper needed to
    read it from both `create-kovo` and the CLI package. The document should be
    mostly table-of-contents links into `./.kovo/docs/`, with a short command
    list for `kovo check`, `kovo explain`, and `kovo update-docs`.
  - Evidence needed: source file path, generated/bundled package inclusion check,
    and a test proving the rendered block contains the required markers and
    version provenance, command list, local docs instruction, and condensed ToC.

- [ ] **Add `AGENTS.md` and `CLAUDE.md` to the create-kovo template.**
  - Deliverable: scaffolded apps include `AGENTS.md` with app-editable space
    outside the generated block; `CLAUDE.md` points to `AGENTS.md` as a symlink
    when possible, with a documented fallback for platforms or package
    transports that cannot preserve symlinks.
  - Evidence needed: focused create-kovo scaffold test showing `AGENTS.md`
    exists, contains one marked block, preserves expected app-local headings,
    and `CLAUDE.md` resolves to the same content or accepted fallback.

- [ ] **Implement marked-block replacement.**
  - Deliverable: shared logic that replaces exactly one
    `<!-- BEGIN:kovo-rules --> ... <!-- END:kovo-rules -->` block, inserts a
    block into an existing `AGENTS.md` when missing, and fails clearly for
    malformed or duplicate marker pairs.
  - Evidence needed: unit tests for replacement, insertion, duplicate markers,
    unterminated markers, and preservation of user content before and after the
    generated block.

- [ ] **Add `kovo update-docs`.**
  - Deliverable: a CLI command that fetches latest canonical docs, refreshes the
    marked block in `AGENTS.md`, mirrors docs into `./.kovo/docs/`, and falls
    back to bundled docs with explicit command output when fetching fails.
  - Evidence needed: CLI tests using mocked successful fetch and fetch-failure
    paths, verifying both `AGENTS.md` replacement and `./.kovo/docs/` writes.

- [ ] **Define the docs mirror shape under `./.kovo/docs/`.**
  - Deliverable: choose stable filenames for mirrored docs, including the
    condensed rules source and the broader agent docs source such as `llms.txt`,
    with metadata recording the Kovo package version and whether the source was
    fetched or bundled.
  - Evidence needed: fixture or CLI test asserting the mirror filenames,
    metadata, and overwrite/idempotency behavior.

- [ ] **Document version freshness semantics.**
  - Deliverable: update the relevant CLI, starter, or docs-site material to say
    package version metadata is provenance only, same-version docs can change,
    and `kovo update-docs` is the supported refresh command.
  - Evidence needed: docs/source file references plus a docs link or build check
    appropriate to the touched surface.

- [ ] **Run focused and package-level verification.**
  - Deliverable: run the narrowest useful create-kovo and CLI tests first, then
    broaden to the package checks affected by shared docs assets or packaging.
  - Evidence needed: exact commands and pass/fail results recorded here before
    marking implementation items complete.

## Open Questions

- [ ] **Canonical latest-docs URL.**
  - Current assumption: use a stable docs-site URL, preferably a dedicated
    condensed rules endpoint plus `llms.txt`, instead of minifying full
    `llms.txt` at command runtime.

- [ ] **Symlink fallback policy.**
  - Current assumption: prefer a real symlink for `CLAUDE.md`; if a package
    manager, archive, or platform cannot preserve one, generate a tiny file that
    points readers to `AGENTS.md` and keep tests explicit about the accepted
    fallback.
