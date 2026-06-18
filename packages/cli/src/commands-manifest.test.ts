import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  ADD_USAGE,
  AUDIT_USAGE,
  CHECK_USAGE,
  COMPILE_USAGE,
  COMPILE_USAGE_LINE,
  COMMANDS_MANIFEST,
  EXPLAIN_USAGE,
  EXPLAIN_USAGE_LINE,
  EXPORT_USAGE,
  MCP_USAGE,
} from './commands-manifest.js';

/**
 * Drift guard for the shared CLI command manifest. The manifest is the single
 * source of truth for the `kovo` bin's command surface and usage strings, and is
 * also consumed by the docs generator (`site/scripts/cli-ref.mjs`). These tests
 * mechanically tie the manifest to the binary so the docs cannot drift:
 *   (a) the manifest covers every command `main`/`mainAsync` dispatches; and
 *   (b) each manifest usage string is the literal the CLI actually emits.
 */
describe('commands manifest', () => {
  const indexSource = readFileSync(fileURLToPath(new URL('./index.ts', import.meta.url)), 'utf8');

  it('covers exactly the commands the bin dispatches', () => {
    // Commands dispatched in main()/mainAsync() are matched on `args[0] === '<cmd>'`.
    const dispatched = new Set(
      [...indexSource.matchAll(/args\[0\]\s*===\s*'([a-z]+)'/g)].map((m) => m[1]),
    );
    const manifestNames = new Set(COMMANDS_MANIFEST.map((entry) => entry.name));

    // Every dispatched command must be documented in the manifest.
    for (const command of dispatched) {
      expect(manifestNames, `manifest missing dispatched command "${command}"`).toContain(command);
    }
    // And the manifest must not document commands the bin does not dispatch.
    for (const name of manifestNames) {
      expect(dispatched, `manifest documents undispatched command "${name}"`).toContain(name);
    }
    // Explicit belt-and-suspenders: the full known command surface.
    expect([...manifestNames].sort()).toEqual(
      ['add', 'audit', 'check', 'compile', 'explain', 'export', 'mcp'].sort(),
    );
  });

  it('marks the async-dispatched commands (compile, export, mcp) as async', () => {
    const asyncNames = COMMANDS_MANIFEST.filter((entry) => entry.async).map((entry) => entry.name);
    expect(asyncNames.sort()).toEqual(['compile', 'export', 'mcp'].sort());
  });

  it('exposes every usage constant the bin references', () => {
    // The bin imports these usage constants from the manifest; assert the literal
    // text matches what the CLI emits in its usage/error paths.
    expect(CHECK_USAGE).toBe('usage: kovo check [optimistic|coverage] [graph.json]');
    expect(AUDIT_USAGE).toBe('usage: kovo audit [--fail-on-findings] [graph.json]');
    expect(ADD_USAGE).toBe('usage: kovo add <component...> [--out <dir>]');
    expect(COMPILE_USAGE[0]).toBe(
      'usage: kovo compile component <source.tsx> --out <artifact.tsx> [--file-name <name>] [--check] [--fixpoint] [--render-equivalence] [--registry-facts <json>] [--query-shape-facts <json>] [--facts-out <json>] [--emit-client-files] [--allow-diagnostic <code>]',
    );
    expect(COMPILE_USAGE).toContain(
      '       kovo compile mutation-inputs <source.ts> --out <facts.json> [--file-name <name>] [--check]',
    );
    expect(COMPILE_USAGE).toContain(
      '       kovo compile drizzle-optimistic <input.json> --out <artifact.ts> [--facts-out <json>] [--check]',
    );
    expect(COMPILE_USAGE_LINE).toContain('kovo compile component <source.tsx>');
    expect(EXPORT_USAGE).toBe(
      'usage: kovo export <app-module> [--out <dir>] [--origin <url>] [--skip-non-exportable]',
    );
    expect(MCP_USAGE).toBe('usage: kovo mcp');
    expect(EXPLAIN_USAGE_LINE).toContain(
      'kovo explain component|mutation|query|page|context <target>',
    );
  });

  it('each manifest usage is consistent with the bin imports', () => {
    const byName = Object.fromEntries(COMMANDS_MANIFEST.map((e) => [e.name, e]));
    expect(byName.check?.usage).toBe(CHECK_USAGE);
    expect(byName.audit?.usage).toBe(AUDIT_USAGE);
    expect(byName.add?.usage).toBe(ADD_USAGE);
    expect(byName.compile?.usage).toBe(COMPILE_USAGE);
    expect(byName.export?.usage).toBe(EXPORT_USAGE);
    expect(byName.mcp?.usage).toBe(MCP_USAGE);
    expect(byName.explain?.usage).toBe(EXPLAIN_USAGE);
  });

  it('the bin references the manifest usage constants (no inline drift)', () => {
    // The bin must import the usage constants from the manifest rather than
    // hard-coding the usage literals, so they cannot diverge.
    expect(indexSource).toMatch(/from '\.\/commands-manifest\.js'/);
    for (const constant of [
      'CHECK_USAGE',
      'AUDIT_USAGE',
      'ADD_USAGE',
      'COMPILE_USAGE',
      'EXPORT_USAGE',
      'MCP_USAGE',
    ]) {
      expect(indexSource, `index.ts should reference ${constant}`).toContain(constant);
    }
  });
});
