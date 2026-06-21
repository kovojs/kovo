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
 * Known `ts.createSourceFile` reparse sites outside `scan/`, each a rule-9 debt FN7 Step 2 will
 * migrate into the parser. Keep sorted; do not add a new entry without a real justification.
 */
const ALLOWED_REPARSE_FILES: ReadonlyMap<string, string> = new Map([
  ['app-graph.ts', 'query-refresh expression re-parse for live-target query bindings'],
  ['emit/dead-imports.ts', 'terminal dead-import pruning over the emitted lowered module'],
  ['emit/live-target-renderers.ts', 'live-target renderer export synthesis over emitted source'],
  ['emit/server-render.ts', 'server render-equivalence gate evaluates the emitted server module'],
  ['mutation-inputs.ts', 'mutation input-field fact extraction from a mutation module'],
  ['optimistic-inline.ts', 'inline/standalone optimistic-plan IR extraction'],
  ['route-pages.ts', 'route-module grammar parse'],
  ['style.ts', 'StyleX object-literal extraction (5 sites)'],
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
