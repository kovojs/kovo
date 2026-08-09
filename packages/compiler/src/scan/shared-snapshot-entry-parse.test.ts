// plans/good-perf.md O7: the quadratic term in `kovo check`/`kovo build` closure analysis was
// N×(N-1) `ts.createSourceFile` calls — every module's compilation re-parsed every other closure
// file as a framework-identity extra, from at least three call sites (compile.ts registration,
// parse.ts identity loop, structural-jsx project construction). `parseSharedSnapshotEntry` bounds
// that to one AST per snapshot entry object per run, with byte-exact revalidation as the reuse
// proof (SPEC §5.2 exact-snapshot rule). These tests pin the reuse, the revalidation, and the
// behavioral equivalence of shared-AST compilation against per-compile fresh parses.
import { describe, expect, it } from 'vitest';

import { compileComponentModule, type CompileComponentOptions } from '../index.js';
import {
  parseSharedSnapshotEntry,
  parseSourceFileConstructionsForTesting,
  shareSnapshotEntryParseOrigin,
} from './parse.js';

interface SnapshotEntry {
  fileName: string;
  source: string;
}

function componentSource(index: number, importIndexes: readonly number[]): string {
  const imports = importIndexes
    .map((child) => `import { C${String(child)} } from './c${String(child)}.tsx';`)
    .join('\n');
  const children = importIndexes.map((child) => `      <C${String(child)} />`).join('\n');
  return `/** @jsxImportSource @kovojs/server */
${imports ? `${imports}\n` : ''}
export function C${String(index)}() {
  return (
    <section data-module="c${String(index)}">
      <h3>Module ${String(index)}</h3>
${children ? `${children}\n` : ''}    </section>
  );
}
`;
}

/** The build-export closure shape: N files, each compiled with the other N-1 as extras. */
function projectSnapshot(moduleCount: number): SnapshotEntry[] {
  const entries: SnapshotEntry[] = [];
  for (let index = 0; index < moduleCount; index += 1) {
    const imports = index === 0 ? [1, 2].filter((child) => child < moduleCount) : [];
    entries.push({
      fileName: `c${String(index)}.tsx`,
      source: componentSource(index, imports),
    });
  }
  return entries;
}

function compileAll(
  entries: readonly SnapshotEntry[],
  extrasFor: (index: number) => readonly SnapshotEntry[],
) {
  return entries.map((entry, index) =>
    compileComponentModule({
      extraFiles: extrasFor(index),
      fileName: entry.fileName,
      source: entry.source,
      sourceProvenance: 'app',
    } as CompileComponentOptions),
  );
}

function comparableResult(result: ReturnType<typeof compileComponentModule>) {
  return {
    diagnostics: result.diagnostics,
    files: result.files,
  };
}

describe('parseSharedSnapshotEntry (plans/good-perf.md O7)', () => {
  it('returns one identical AST per snapshot entry object', () => {
    const entry: SnapshotEntry = { fileName: 'shared.tsx', source: 'export const shared = 1;\n' };
    const first = parseSharedSnapshotEntry(entry);
    expect(parseSharedSnapshotEntry(entry)).toBe(first);
    expect(first.fileName).toBe('shared.tsx');
    expect(first.text).toBe(entry.source);
  });

  it('revalidates bytes on every reuse: a mutated entry re-parses instead of serving stale facts', () => {
    const entry: SnapshotEntry = { fileName: 'mutable.tsx', source: 'export const before = 1;\n' };
    const before = parseSharedSnapshotEntry(entry);
    entry.source = 'export const after = 2;\n';
    const after = parseSharedSnapshotEntry(entry);
    expect(after).not.toBe(before);
    expect(after.text).toBe('export const after = 2;\n');
    // The refreshed parse replaces the stale AST for subsequent reuse.
    expect(parseSharedSnapshotEntry(entry)).toBe(after);
  });

  it('distinct entry objects do not share by content — the memo is object-keyed, never content-keyed', () => {
    // packages/drizzle/src/static/project-setup.ts records the OOM history of process-global
    // content-keyed memos; identical bytes in two runs must not alias through a global table.
    const runA = parseSharedSnapshotEntry({
      fileName: 'same.tsx',
      source: 'export const x = 1;\n',
    });
    const runB = parseSharedSnapshotEntry({
      fileName: 'same.tsx',
      source: 'export const x = 1;\n',
    });
    expect(runB).not.toBe(runA);
  });

  it('a defensive clone aliased to its origin shares the origin parse, still byte-exactly', () => {
    const origin: SnapshotEntry = { fileName: 'origin.tsx', source: 'export const o = 1;\n' };
    const clone: SnapshotEntry = { fileName: origin.fileName, source: origin.source };
    shareSnapshotEntryParseOrigin(origin, clone);
    const parsed = parseSharedSnapshotEntry(origin);
    expect(parseSharedSnapshotEntry(clone)).toBe(parsed);

    // A clone whose bytes diverge from the origin's cached AST must re-parse, not reuse.
    const divergent: SnapshotEntry = { fileName: origin.fileName, source: 'export const o = 2;\n' };
    shareSnapshotEntryParseOrigin(origin, divergent);
    const reparsed = parseSharedSnapshotEntry(divergent);
    expect(reparsed).not.toBe(parsed);
    expect(reparsed.text).toBe('export const o = 2;\n');
  });

  it('compiles a closure with O(N) extra-file parses instead of O(N^2), byte-identically', () => {
    const moduleCount = 8;
    const shared = projectSnapshot(moduleCount);
    const fresh = projectSnapshot(moduleCount);

    // Old behavior's shape: every compile receives freshly constructed entry OBJECTS, so no
    // object-keyed reuse is possible and every compile re-parses its N-1 extras per phase.
    const beforeFresh = parseSourceFileConstructionsForTesting();
    const freshResults = compileAll(fresh, (index) =>
      fresh
        .filter((_, candidate) => candidate !== index)
        .map((entry) => ({ fileName: entry.fileName, source: entry.source })),
    );
    const freshParses = parseSourceFileConstructionsForTesting() - beforeFresh;

    // build-export's actual shape: one snapshot, the same entry objects re-supplied per compile.
    const sharedExtras = shared.map((_, index) =>
      shared.filter((_, candidate) => candidate !== index),
    );
    const beforeShared = parseSourceFileConstructionsForTesting();
    const sharedResults = compileAll(shared, (index) => sharedExtras[index]!);
    const sharedParses = parseSourceFileConstructionsForTesting() - beforeShared;

    // Equivalence: shared-AST compilation must be fact-for-fact identical to fresh parses.
    expect(sharedResults.map(comparableResult)).toEqual(freshResults.map(comparableResult));

    // The quadratic floor for fresh objects is N×(N-1) extras parses (each compile parses its
    // 7 extras at least once) — measured, it re-parses them per phase. The shared snapshot must
    // parse each of the N extras at most once overall; everything else is per-root work that does
    // not grow with closure size.
    expect(freshParses).toBeGreaterThanOrEqual(moduleCount * (moduleCount - 1));
    expect(sharedParses).toBeLessThanOrEqual(
      freshParses - moduleCount * (moduleCount - 1) + moduleCount,
    );
  });
});
