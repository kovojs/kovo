import { createHash } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { collectTrustEscapesFromProject } from './trust-escapes-static.js';

describe('escape-census trust facts (C13 anchor)', () => {
  it('records exact framework csrf:false, analyzer-summary, and raw-control escape roots', () => {
    const source = [
      "import { mutation as defineMutation, s as schema } from '@kovojs/server';",
      "import { kovoAnalyzerSummary as summarize } from '@kovojs/drizzle';",
      'function principal(context: { request: { session: { id: string } } }) {',
      '  return context.request.session.id;',
      '}',
      "summarize(principal, { returns: { kind: 'session', path: 'id' } });",
      'export const machineWrite = defineMutation({',
      '  csrf: false,',
      "  csrfJustification: 'signed machine request',",
      '  input: schema.object({ payload: schema.string().allowControlChars() }),',
      '  handler(input) { return input; },',
      '});',
    ].join('\n');
    const facts = collectTrustEscapesFromProject({
      files: [
        {
          fileName: 'app.ts',
          source,
        },
      ],
    });

    const sourceHash = `sha256:${createHash('sha256').update(source, 'utf16le').digest('hex')}`;
    const exactRoot = (slice: string): string => {
      const start = source.indexOf(slice);
      expect(start).toBeGreaterThanOrEqual(0);
      return `app.ts:${start}:${start + slice.length}`;
    };
    for (const fact of facts) {
      const { end, start } = fact.sourceBinding.span;
      expect(fact.sourceBinding.sourceHash).toBe(sourceHash);
      expect(fact.sourceBinding.sliceHash).toBe(
        `sha256:${createHash('sha256').update(source.slice(start, end), 'utf16le').digest('hex')}`,
      );
    }

    expect(
      facts
        .filter((fact) =>
          ['allowControlChars', 'csrfFalse', 'kovoAnalyzerSummary'].includes(fact.kind),
        )
        .map((fact) => ({ kind: fact.kind, root: fact.root, source: fact.source })),
    ).toEqual([
      {
        kind: 'allowControlChars',
        root: exactRoot('schema.string().allowControlChars()'),
        source: 'schema.string().allowControlChars()',
      },
      { kind: 'csrfFalse', root: 'mutation:machineWrite', source: 'machineWrite' },
      {
        kind: 'kovoAnalyzerSummary',
        root: exactRoot("summarize(principal, { returns: { kind: 'session', path: 'id' } })"),
        source: 'principal',
      },
    ]);
  });

  it('follows exact local re-exports while rejecting local lookalikes', () => {
    const facts = collectTrustEscapesFromProject({
      files: [
        {
          fileName: 'framework.ts',
          source: [
            "export { mutation as machineMutation, s as schema } from '@kovojs/server';",
            "export { kovoAnalyzerSummary as analyzerSummary } from '@kovojs/drizzle';",
          ].join('\n'),
        },
        {
          fileName: 'app.ts',
          source: [
            "import { analyzerSummary, machineMutation, schema } from './framework.js';",
            'const local = { string: () => ({ allowControlChars() {} }) };',
            'const rawText = schema.string();',
            'const localSummary = () => undefined;',
            'const localMutation = () => undefined;',
            'function principal(context: { request: { session: { id: string } } }) {',
            '  return context.request.session.id;',
            '}',
            "analyzerSummary(principal, { returns: { kind: 'session', path: 'id' } });",
            "machineMutation('machine/write', {",
            '  csrf: false,',
            "  csrfJustification: 'signed machine request',",
            '  input: schema.object({ payload: rawText.allowControlChars() }),',
            '  handler(input) { return input; },',
            '});',
            'local.string().allowControlChars();',
            'localSummary(principal, {});',
            'localMutation({ csrf: false });',
          ].join('\n'),
        },
      ],
    });

    expect(
      facts
        .filter((fact) =>
          ['allowControlChars', 'csrfFalse', 'kovoAnalyzerSummary'].includes(fact.kind),
        )
        .map((fact) => fact.kind),
    ).toEqual(['allowControlChars', 'csrfFalse', 'kovoAnalyzerSummary']);
  });
});
