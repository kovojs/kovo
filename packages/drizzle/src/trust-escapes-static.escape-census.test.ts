import { describe, expect, it } from 'vitest';

import { collectTrustEscapesFromProject } from './trust-escapes-static.js';

describe('escape-census trust facts (C13 anchor)', () => {
  it('records exact framework csrf:false, analyzer-summary, and raw-control escape roots', () => {
    const facts = collectTrustEscapesFromProject({
      files: [
        {
          fileName: 'app.ts',
          source: [
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
          ].join('\n'),
        },
      ],
    });

    expect(
      facts
        .filter((fact) =>
          ['allowControlChars', 'csrfFalse', 'kovoAnalyzerSummary'].includes(fact.kind),
        )
        .map((fact) => ({ kind: fact.kind, root: fact.root, source: fact.source })),
    ).toEqual([
      {
        kind: 'allowControlChars',
        root: 'app.ts:10',
        source: 'schema.string().allowControlChars()',
      },
      { kind: 'csrfFalse', root: 'mutation:machineWrite', source: 'machineWrite' },
      { kind: 'kovoAnalyzerSummary', root: 'app.ts:6', source: 'principal' },
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
            'const localSummary = () => undefined;',
            'const localMutation = () => undefined;',
            'function principal(context: { request: { session: { id: string } } }) {',
            '  return context.request.session.id;',
            '}',
            "analyzerSummary(principal, { returns: { kind: 'session', path: 'id' } });",
            "machineMutation('machine/write', {",
            '  csrf: false,',
            "  csrfJustification: 'signed machine request',",
            '  input: schema.object({ payload: schema.string().allowControlChars() }),',
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
