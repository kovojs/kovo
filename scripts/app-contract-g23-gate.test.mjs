import { describe, expect, it } from 'vitest';

import { analyzeAppContractCorpus, analyzeAppContractG23 } from './app-contract-g23-gate.mjs';

describe('app-contract G23 gate', () => {
  it('keeps each packed, advanced, and release CRM corpus on one inferred app contract', () => {
    const report = analyzeAppContractG23();

    expect(report).toMatchObject({
      ok: true,
      schema: 'kovo.app-contract-g23/v1',
    });
    expect(report.corpora.map((corpus) => corpus.name)).toEqual([
      'packed-starter',
      'crm-advanced-example',
      'crm-release-example',
    ]);
    for (const corpus of report.corpora) {
      expect(corpus.digest).toMatch(/^sha256:[a-f0-9]{64}$/u);
      expect(corpus.fileCount).toBeGreaterThan(0);
      expect(corpus.findings).toEqual([]);
      expect(corpus.calls).toMatchObject({
        assemble: 1,
        defineKovo: 1,
      });
      expect(corpus.calls.mutation).toBeGreaterThan(0);
      expect(corpus.calls.route).toBeGreaterThan(0);
      if (corpus.requiredFactories.includes('query')) {
        expect(corpus.calls.query).toBeGreaterThan(0);
      }
    }

    const advanced = report.corpora.find((corpus) => corpus.name === 'crm-advanced-example');
    const release = report.corpora.find((corpus) => corpus.name === 'crm-release-example');
    expect(advanced.sourcePaths).not.toEqual(
      expect.arrayContaining([
        'examples/crm/src/scaffold-app.tsx',
        'examples/crm/src/scaffold-kovo.ts',
        'examples/crm/src/scaffold-mutations.ts',
      ]),
    );
    expect(release.sourcePaths).toEqual([
      'examples/crm/src/scaffold-app.tsx',
      'examples/crm/src/scaffold-kovo.ts',
      'examples/crm/src/scaffold-mutations.ts',
    ]);
    expect(release.calls.query).toBe(0);
  });

  it('fails closed on repeated context, manual types, free factories, casts, and registries', () => {
    const report = analyzeAppContractCorpus('adversarial', [
      {
        path: 'src/kovo.ts',
        source: `
          import { defineKovo, query, type Reader } from '@kovojs/server';
          interface QueryRegistry { contacts: unknown }
          declare const db: Reader<unknown>;
          const app = defineKovo<unknown>({ db });
          const second = defineKovo({});
          const contacts = query({});
          const typed = contacts as unknown;
          app.assemble({});
          app.assemble({});
        `,
      },
    ]);

    expect(report.findings.map((finding) => finding.message)).toEqual(
      expect.arrayContaining([
        'app-authored registry QueryRegistry',
        'explicit defineKovo generic arguments',
        'expected at least one app.mutation() declaration',
        'expected at least one app.query() declaration',
        'expected at least one app.route() declaration',
        'expected exactly one app.assemble() call; found 2',
        'expected exactly one defineKovo() call; found 2',
        'free app factory import query; use the defineKovo receiver',
        'manual app-context type Reader',
        'type cast in app-contract consumer',
      ]),
    );
  });
});
