import { describe, expect, it } from 'vitest';

import {
  createKovoCheckDiagnosticSourceCatalog,
  kovoCheckWithDiagnosticSourceCatalog,
  type KovoCheckDiagnosticSourceCatalog,
} from './graph-output.js';

describe('kovo check parser-source catalog', () => {
  const graph = {
    access: [
      {
        decision: 'missing' as const,
        detail: 'missing access fact',
        kind: 'query' as const,
        name: 'queries/contacts',
        source: 'access' as const,
      },
    ],
  };

  it('projects exact source only from a locally enrolled parser catalog', () => {
    const catalog = createKovoCheckDiagnosticSourceCatalog([
      {
        kind: 'query',
        name: 'queries/contacts',
        source: { end: 115, file: 'src/queries.ts', start: 53 },
      },
    ]);

    const result = kovoCheckWithDiagnosticSourceCatalog(graph, {}, catalog);
    expect(result.diagnostics).toEqual([
      expect.objectContaining({
        code: 'KV436',
        source: { end: 115, file: 'src/queries.ts', start: 53 },
      }),
    ]);
  });

  it('rejects a structural or cloned catalog before diagnostic projection', () => {
    const catalog = createKovoCheckDiagnosticSourceCatalog([]);
    const clone = { ...catalog } as KovoCheckDiagnosticSourceCatalog;

    expect(() => kovoCheckWithDiagnosticSourceCatalog(graph, {}, clone)).toThrow(
      /lacks parser-owned identity/u,
    );
  });
});
