import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

// FN7 (plans/compiler-refactoring.md): widen the rule-9 boundary to cover SOURCE REPARSES.
//
// SPEC.md §5.2 rule 9 makes the scanner/parser the sole boundary that reads app source text
// into typed facts; post-parse phases must decide from typed model facts, not re-read source.
// The conformance rule-9 guard (postParseSourceStringProjectFact) scans lower/validate/analyze/
// emit for raw-source DECISIONS, but it does not catch a phase spinning up its OWN TypeScript
// program via `ts.createSourceFile` to re-read source — the structural form of the same debt.
//
// This guard enumerates every `ts.createSourceFile` site in the compiler outside `scan/` and
// pins them to an explicit allowlist. A NEW reparse fails this test loudly (you must either put
// the extraction in `scan/` or justify + allowlist it); a removed one must be deleted from the
// list. The allowlist is the FN7 Step-2 worklist: each entry is a known reparse whose fact
// extraction should migrate into `scan/parse.ts`.

const here = dirname(fileURLToPath(import.meta.url));

/**
 * `ts.createSourceFile` sites outside `scan/` that are rule-9 PERMITTED: each operates on
 * COMPILER-EMITTED output (a lowered module), not app source, which §5.2 rule 9 explicitly
 * allows (generated-artifact verification/transform). App-source parsers all live under `scan/`.
 * Keep sorted; do not add a new entry without a real generated-artifact justification.
 */
const ALLOWED_REPARSE_FILES: ReadonlyMap<string, string> = new Map([
  [
    'emit/dead-imports.ts',
    'generated-artifact: prunes dead imports over the EMITTED lowered module, not app source',
  ],
  [
    'emit/live-target-renderers.ts',
    'generated-artifact: renderer-export synthesis over the EMITTED lowered module, not app source',
  ],
  ['mutation-inputs.ts', 'FN7 pending: inline mutation input-field extraction (migrate to scan/)'],
  ['style.ts', 'FN7 pending: StyleX extraction component re-parses (collapse onto scan SourceFile)'],
]);

function compilerSourceFiles(): string[] {
  const out: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === 'scan' || entry.name === 'generated' || entry.name === 'node_modules') {
          continue;
        }
        walk(full);
      } else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts')) {
        out.push(full);
      }
    }
  };
  walk(here);
  return out;
}

describe('FN7: source-reparse boundary', () => {
  it('every ts.createSourceFile outside scan/ is on the documented allowlist', () => {
    const offenders = new Set<string>();
    for (const file of compilerSourceFiles()) {
      if (/\bcreateSourceFile\s*\(/.test(readFileSync(file, 'utf8'))) {
        offenders.add(relative(here, file));
      }
    }

    const allowed = new Set(ALLOWED_REPARSE_FILES.keys());
    const unexpected = [...offenders].filter((f) => !allowed.has(f)).sort();
    const stale = [...allowed].filter((f) => !offenders.has(f)).sort();

    // A new reparse outside scan/ must move its extraction into scan/parse.ts (or be justified
    // and added here). A stale entry means a site was migrated/removed — delete it from the list.
    expect({ unexpected, stale }).toEqual({ unexpected: [], stale: [] });
  });
});
