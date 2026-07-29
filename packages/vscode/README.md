# Kovo Diagnostics for VS Code

This extension presents Kovo's existing `kovo-diagnostic/v1` facts in VS Code. It does not parse
app source, derive severity, invent locations, or run a second analyzer.

## Use it

1. Produce `.kovo/diagnostics.json` from a Kovo command's `--format json` output. For a one-shot
   source proof on a POSIX shell:

   ```sh
   mkdir -p .kovo
   pnpm exec kovo check --format json > .kovo/diagnostics.json 2>&1
   ```

   JSON is the command's only output on either success or failure; merging stdout/stderr handles
   the exit-dependent destination without parsing terminal prose.

2. Install the packaged VSIX and open the app workspace.
3. Run **Kovo: Reload Diagnostic File** if the producer wrote the file before the extension
   started.

The extension watches `.kovo/diagnostics.json` by default. Change
`kovo.diagnostics.file` to another workspace-relative path when your producer uses a different
location. Each file must be a complete JSON envelope, not terminal prose:

```json
{
  "diagnostics": [
    {
      "category": "proof",
      "code": "KV436",
      "help": "Add one explicit access decision and rerun kovo check.",
      "message": "Missing explicit access decision.",
      "severity": "error",
      "source": { "end": 27, "file": "src/app.tsx", "start": 14 },
      "version": "kovo-diagnostic/v1"
    }
  ],
  "version": "kovo-diagnostic/v1"
}
```

The Problems panel preserves `code`, semantic severity, help, and the exact zero-based UTF-16
source span. Source-less facts remain source-less and are reported in the **Kovo Diagnostics**
output channel instead of being attached to an invented file.

## Safe fixes

**Kovo: Apply Compiler-Proven Safe Fix** delegates to:

```text
pnpm exec kovo fix <workspace-relative-file>
```

The extension supplies no edit and keeps no diagnostic-to-fix table. The Kovo compiler owns the
closed safe-rewrite recipes and re-proves the complete file before writing it (SPEC §11.4).
Dirty files, files outside the workspace, non-TSX/JSX files, untrusted workspaces, and concurrent
fix attempts are refused. The extension never inserts a waiver, trusted escape, `csrf: false`, raw
SQL declaration, or suppression. `kovo.diagnostics.pnpmPath` changes the `pnpm` executable path
when it is not available through the extension host's `PATH`.

## Package

From the repository root:

```sh
pnpm --filter kovo-diagnostics run package:check
pnpm --filter kovo-diagnostics run package:vsix
```

The second command writes `packages/vscode/dist/kovo-diagnostics.vsix`. Marketplace publication is
a release action and is intentionally separate from building the installable artifact.
