# Editor transport decision

Decision: ship `kovojs.kovo-diagnostics` as an installable VSIX that watches one
`kovo-diagnostic/v1` JSON artifact per workspace folder.

## Why this arm

| Option             | Benefit                                                                                                                  | Risk and cost                                                                                                                                                                                                  | Decision                                                                                                  |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| Thin `kovo lsp`    | Push diagnostics and future semantic requests over a standard editor protocol.                                           | Adds a long-lived transport, document synchronization, cancellation, lifecycle, and marketplace/runtime testing before Kovo has an editor-only semantic request. Those seams can drift into a second analyzer. | Defer until an editor feature needs more than the versioned diagnostic record.                            |
| JSON-watch adapter | Reuses the exact CLI/MCP producer facts, is editor-agnostic at the artifact boundary, and has a small auditable runtime. | File production is a separate concern; source-less facts need an output surface; an incomplete write must not leave stale Problems entries.                                                                    | Selected. Validate one bounded complete envelope, clear on failure/delete, and never infer missing facts. |

The adapter follows SPEC §5.2 rule 13 and §11.4:

- `code`, semantic `severity`, `help`, and `source { file, start, end }` come from the record.
- UTF-16 offsets are converted with the opened VS Code document; an out-of-bounds or
  workspace-escaping anchor rejects the refresh.
- `error`, `warn`, `lint`, and `notice` map mechanically to VS Code Error, Warning, Information,
  and Hint while the exact Kovo severity remains in the adapter projection.
- no source parser, diagnostic definition table, or message parser is packaged.
- safe source changes are delegated to `kovo fix`; the extension never authors a `WorkspaceEdit`.

## Distribution

The package uses a dependency-free, deterministic VSIX writer rather than adding the hundreds of
publish/auth dependencies pulled in by a marketplace CLI to every framework install.
`package:check` creates two clean temporary VSIX files, byte-compares them, and verifies the archive
has the Open Packaging content types, extension manifest, README, package manifest, and the two
runtime modules while excluding tests, scripts, `node_modules`, and prior build output.
`package:vsix` creates the installable artifact under `dist/`. Its six-entry shape and generated
manifest were cross-checked against `@vscode/vsce` 3.9.2 during the decision review.

Marketplace publication is deliberately not automatic: it requires the `kovojs` publisher
identity, release credentials, listing assets, and release approval. The package identifier and
VSIX contract are fixed now, so publication does not require an editor/runtime redesign.

References:

- <https://code.visualstudio.com/api/references/extension-manifest>
- <https://code.visualstudio.com/api/working-with-extensions/publishing-extension>
- <https://code.visualstudio.com/api/references/vscode-api>
