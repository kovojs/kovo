#!/usr/bin/env bash
# Canonical throwaway-worktree repro harness for a find-bugz audit.
#
# Creates a detached (or branch) worktree off a base commit, wires node_modules via
# symlinks so the REAL vite.config.ts test suite runs, and drops a minimal vitest
# config that aliases @kovojs/<pkg>[/sub] -> packages/<pkg>/src for ad-hoc function drives.
#
# Usage:   setup-bugz-worktree.sh <worktree-dir> [base-ref] [branch-name]
#   <worktree-dir>  unique path, e.g. /private/tmp/bugz-<label>-$$
#   [base-ref]      commit/ref to fork from (default: HEAD)
#   [branch-name]   create this branch (default: detached worktree)
#
# Run from inside the repo (it derives the repo root via git), or set KOVO_REPO.
# Clean up afterward:  git -C "$(git rev-parse --show-toplevel)" worktree remove --force <worktree-dir>
set -euo pipefail

MAIN="${KOVO_REPO:-$(git rev-parse --show-toplevel 2>/dev/null)}"
[ -n "$MAIN" ] || { echo "error: run inside the repo or set KOVO_REPO" >&2; exit 1; }

WT="${1:?usage: setup-bugz-worktree.sh <worktree-dir> [base-ref] [branch-name]}"
BASE="${2:-HEAD}"
BRANCH="${3:-}"

if [ -n "$BRANCH" ]; then
  git -C "$MAIN" worktree add -b "$BRANCH" "$WT" "$BASE" >/dev/null
else
  git -C "$MAIN" worktree add --detach "$WT" "$BASE" >/dev/null
fi

# Root node_modules (hoisted) + per-package nested node_modules (transitive deps like @material/*).
ln -s "$MAIN/node_modules" "$WT/node_modules"
for d in "$MAIN"/packages/*/node_modules; do
  pkg="$(basename "$(dirname "$d")")"
  ln -s "$d" "$WT/packages/$pkg/node_modules"
done
# examples/site/integration node_modules too (the real root vite.config loads example plugins).
for d in "$MAIN"/examples/*/node_modules "$MAIN"/site/node_modules "$MAIN"/tests/integration/node_modules; do
  [ -e "$d" ] || continue
  rel="${d#"$MAIN"/}"; mkdir -p "$WT/$(dirname "$rel")"; ln -s "$d" "$WT/$rel" 2>/dev/null || true
done

# Minimal config for ad-hoc function drives WITHOUT the heavy example-compiler plugins.
# (Existing package *.test.ts run fine against the real config; use this only for __bugz_*.test.ts.)
cat > "$WT/vitest.bugz.config.ts" <<'EOF'
import { defineConfig } from 'vitest/config';
import { readdirSync } from 'node:fs';
import { resolve } from 'node:path';
const root = __dirname;
const pkgs = readdirSync(resolve(root, 'packages'), { withFileTypes: true })
  .filter((e) => e.isDirectory() && e.name !== 'node_modules')
  .map((e) => e.name);
const alias = pkgs.flatMap((p) => [
  { find: new RegExp(`^@kovojs/${p}/(.*)$`), replacement: resolve(root, `packages/${p}/src/$1`) },
  { find: new RegExp(`^@kovojs/${p}$`), replacement: resolve(root, `packages/${p}/src/index.ts`) },
]);
export default defineConfig({ resolve: { alias }, test: { include: ['packages/**/src/__bugz_*.test.ts'] } });
EOF

echo "BUGZ_WORKTREE_READY $WT (base $BASE${BRANCH:+, branch $BRANCH})"
