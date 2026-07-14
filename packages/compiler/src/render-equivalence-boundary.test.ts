import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { crossPackageOracleFixture } from '../../conformance-fixtures/src/oracle-fixtures.js';
import { compileComponentModule } from './index.js';
import {
  authoredStaticTextEquivalenceCheck,
  semanticRenderEquivalenceCheck,
} from './emit/render-equivalence.js';
import { emitServerModule } from './emit/server-render.js';
import { parseComponentModule } from './scan/parse.js';

const compilerSrcDir = dirname(fileURLToPath(import.meta.url));
const repoPackagesDir = dirname(dirname(compilerSrcDir));

function productionTypescriptFiles(root: string): string[] {
  const entries = readdirSync(root, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) {
      files.push(...productionTypescriptFiles(path));
      continue;
    }

    if (
      entry.isFile() &&
      entry.name.endsWith('.ts') &&
      !entry.name.endsWith('.test.ts') &&
      entry.name !== 'test-support.ts'
    ) {
      files.push(path);
    }
  }

  return files.sort();
}

describe('render-equivalence production boundary', () => {
  it('uses SPEC §5.2 semantic render equivalence, not source-normalization evidence', () => {
    const roots = [compilerSrcDir, join(repoPackagesDir, 'cli/src')];
    const files = roots.flatMap(productionTypescriptFiles);
    const forbidden = [
      /\brenderEquivalenceSourceCheck\b/,
      /\brenderEquivalenceCheck\s*\(/,
      /\bnormalizeRenderEquivalenceSource\b/,
      /\bexpectedIgnoredSpans\b/,
      /\bremoveIgnoredSpans\b/,
    ];
    const violations = files.flatMap((file) => {
      const source = readFileSync(file, 'utf8');
      return forbidden
        .filter((pattern) => pattern.test(source))
        .map((pattern) => `${relative(repoPackagesDir, file)}: ${pattern}`);
    });

    expect(violations).toEqual([]);

    const compileSource = readFileSync(join(compilerSrcDir, 'compile.ts'), 'utf8');
    // Leg 1: the lowered round-trip is wired against the lowered model plus the exact statically
    // decoded and validated generated render source.
    expect(compileSource).toMatch(
      /semanticRenderEquivalenceCheck\(\s*registryFileName\(parsed\),\s*lowered\.model,\s*server\.serverModule\.executableSource,/,
    );
    // bugz-3 L5 — Leg 2: the authored→lowered static-text leg must be engaged from the AUTHORED model
    // (parsed.originalModel), not a second lowered baseline, and folded into the gate.
    expect(compileSource).toMatch(
      /authoredStaticTextEquivalenceCheck\(\s*registryFileName\(parsed\),\s*parsed\.originalModel,\s*lowered\.model,/,
    );
    expect(compileSource).toContain(
      'combineRenderEquivalenceChecks(loweredRoundTrip, authoredStaticText)',
    );
  });
});

// bugz-3 L5 (SPEC §5.2 rule 3, authored→lowered leg): the gate must catch a lowering pass that
// drops author-written visible text — a divergence the lowered-baseline leg cannot see because both
// of its sides are already lowered.
describe('authored→lowered static-text equivalence leg', () => {
  const authoredSource = `
import { component } from '@kovojs/core';

export const Pipeline = component({
  queries: { q: {} },
  render: ({ q }) => (
    <section>
      <h1>Sales pipeline</h1>
      <h2>By stage</h2>
      <p>{q.summary}</p>
    </section>
  ),
});
`;

  it('passes when a faithful lowering preserves authored literal text', () => {
    const result = compileComponentModule({
      fileName: 'components/pipeline.tsx',
      source: authoredSource,
    });
    const authored = parseComponentModule('components/pipeline.tsx', authoredSource);
    const lowered = parseComponentModule('components/pipeline.tsx', result.loweredSource ?? '');
    const check = authoredStaticTextEquivalenceCheck('components/pipeline.tsx', authored, lowered);
    expect(check.ok).toBe(true);
    // The real combined gate (leg1 + leg2) is also green for this component.
    expect(result.renderEquivalenceChecks).toHaveLength(1);
    expect(result.renderEquivalenceChecks[0]?.ok).toBe(true);
  });

  it('fails closed when a lowering pass drops authored literal text (synthetic divergence)', () => {
    const authored = parseComponentModule('components/pipeline.tsx', authoredSource);
    // Synthetic buggy lowering: the "By stage" heading was dropped during lowering.
    const divergentLowered = parseComponentModule(
      'components/pipeline.tsx',
      authoredSource.replace('<h2>By stage</h2>', ''),
    );
    const check = authoredStaticTextEquivalenceCheck(
      'components/pipeline.tsx',
      authored,
      divergentLowered,
    );
    expect(check.ok).toBe(false);
    expect(check.detail).toContain('dropped or reordered');
    expect(check.detail).toContain('By');
  });

  it('ignores dynamic expressions (escapeText/binding) — only literal author text is compared', () => {
    const authored = parseComponentModule(
      'components/pipeline.tsx',
      `import { component } from '@kovojs/core';
export const X = component({ queries: { q: {} }, render: ({ q }) => (<p>Hello {q.name}</p>) });`,
    );
    // The lowered form wraps the dynamic part in a generated span + escapeText; literal "Hello" stays.
    const lowered = parseComponentModule(
      'components/pipeline.tsx',
      `import { component } from '@kovojs/core';
export const X = component({ queries: { q: {} }, render: ({ q }) => (<p>Hello <span data-bind="q.name">{escapeText(q.name)}</span></p>) });`,
    );
    expect(
      authoredStaticTextEquivalenceCheck('components/pipeline.tsx', authored, lowered).ok,
    ).toBe(true);
  });

  it('keeps the shared cross-package oracle fixture render-equivalent', () => {
    const oracle = crossPackageOracleFixture();
    const result = compileComponentModule({
      fileName: oracle.component.fileName,
      queryShapes: oracle.component.queryShapes,
      registryFacts: oracle.component.registryFacts,
      source: oracle.component.source,
    });

    expect(result.diagnostics).toEqual([]);
    expect(result.renderEquivalenceChecks).toHaveLength(1);
    expect(result.renderEquivalenceChecks[0]?.ok).toBe(true);
  });
});

describe('render-equivalence generated semantic attributes', () => {
  it('ignores generated data-bind-list stamps in semantic render comparisons', () => {
    const source = `
import { component } from '@kovojs/core';

export const CartList = component({
  render: () => (
    <ul data-bind-list="cart.items" kovo-key="id">
      <li>Milk</li>
    </ul>
  ),
});
`;
    const executableSource = emitServerModule(
      source.replace(' data-bind-list="cart.items"', ''),
    ).executableSource;
    const check = semanticRenderEquivalenceCheck(
      'components/cart-list.server.js',
      parseComponentModule('components/cart-list.tsx', source),
      executableSource,
    );

    expect(check).toMatchObject({
      actual: '<ul><li>Milk</li></ul>',
      expected: '<ul><li>Milk</li></ul>',
      ok: true,
    });
  });
});
