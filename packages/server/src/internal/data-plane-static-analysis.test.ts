import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

type DataPlaneStaticAnalysisModule = typeof import('./data-plane-static-analysis.js');

const RELEVANT_DRIZZLE_SOURCE = {
  fileName: 'src/schema.ts',
  source: [
    'import { sql } from "@kovojs/drizzle";',
    '',
    'export async function unsafe(db: any, input: { id: string }) {',
    '  await db.execute(sql.raw(input.id));',
    '}',
  ].join('\n'),
};

describe('data-plane static analysis aggregate ABI', () => {
  afterEach(() => {
    vi.doUnmock('@kovojs/drizzle/internal/static');
    vi.resetModules();
  });

  it('fails closed instead of recomposing old analyzer entrypoints when the aggregate ABI is missing', async () => {
    vi.doMock('@kovojs/drizzle/internal/static', () => ({
      analyzeSqlSafetyFromProject: () => [
        {
          code: 'KV422',
          message: 'legacy SQL diagnostic',
          severity: 'error',
          site: 'src/schema.ts:4',
        },
      ],
      deriveMutationTouchRegistry: () => ({}),
      diagnosticsForQueryFacts: () => [],
      extractQueryFactsFromProject: () => [],
      extractToctouFromProject: () => [],
      extractTouchGraphFromProject: () => ({}),
    }));
    const { staticDataPlaneBuildFacts } = await loadSubject();

    await expect(
      staticDataPlaneBuildFacts([RELEVANT_DRIZZLE_SOURCE], { cache: false }),
    ).rejects.toThrow(
      /KV245[\s\S]*aggregate @kovojs\/drizzle analyzer ABI is required[\s\S]*src\/schema\.ts[\s\S]*extractStaticBuildAnalysisFactsFromProject/,
    );
  });

  it('fails closed with KV context when the aggregate analyzer throws during parse or ts-morph analysis', async () => {
    vi.doMock('@kovojs/drizzle/internal/static', () => ({
      deriveMutationTouchRegistry: () => ({}),
      extractStaticBuildAnalysisFactsFromProject: () => {
        throw new Error('ts-morph parse exploded');
      },
    }));
    const { staticDataPlaneBuildFacts } = await loadSubject();

    await expect(
      staticDataPlaneBuildFacts([RELEVANT_DRIZZLE_SOURCE], { cache: false }),
    ).rejects.toThrow(
      /KV245[\s\S]*failed closed[\s\S]*src\/schema\.ts[\s\S]*ts-morph parse exploded/,
    );
  });

  it('keeps projects with no relevant Drizzle or DB source empty and safe', async () => {
    const { staticDataPlaneBuildFacts } = await loadSubject();

    await expect(
      staticDataPlaneBuildFacts(
        [
          {
            fileName: 'src/status-card.tsx',
            source: [
              'import { component } from "@kovojs/core";',
              '',
              'export const StatusCard = component({',
              '  render: () => <p>ready</p>,',
              '});',
            ].join('\n'),
          },
        ],
        { cache: false },
      ),
    ).resolves.toEqual({
      massAssignmentFacts: [],
      ownerDomains: [],
      queries: [],
      queryShapeFacts: [],
      queryWriteReachability: [],
      scopeAudits: [],
      sqlSafetyDiagnostics: [],
      toctouFacts: [],
      touchGraph: {},
    });
  });

  it('scopes build graph derivation to KovoBuildContext instead of process env', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kovo-data-plane-context-'));
    const srcDir = join(root, 'src');
    const previous = process.env.KOVO_BUILD_GRAPH_DERIVATION;
    process.env.KOVO_BUILD_GRAPH_DERIVATION = '1';
    vi.doMock('@kovojs/drizzle/internal/static', () => ({
      deriveMutationTouchRegistry: () => ({}),
      extractStaticBuildAnalysisFactsFromProject: () => ({
        queries: [
          {
            query: 'staticContact',
            shape: 'string',
            site: 'src/schema.ts:2',
          },
        ],
        sqlSafetyDiagnostics: [],
        toctouFacts: [],
        touchGraph: {},
      }),
    }));

    try {
      await mkdir(srcDir, { recursive: true });
      await writeFile(
        join(srcDir, 'schema.ts'),
        'import { sql } from "@kovojs/drizzle";\nexport const marker = sql`select 1`;\n',
        'utf8',
      );
      const [{ withKovoBuildContext }, { collectCompilerQueryShapeFacts }] = await Promise.all([
        import('./build-context.js'),
        loadSubject(),
      ]);

      await expect(collectCompilerQueryShapeFacts({ appSourceDir: srcDir, root })).resolves.toEqual(
        [
          {
            query: 'staticContact',
            shape: 'string',
            source: 'src/schema.ts:2',
          },
        ],
      );
      await expect(
        withKovoBuildContext({ graphDerivation: true }, () =>
          collectCompilerQueryShapeFacts({ appSourceDir: srcDir, root }),
        ),
      ).resolves.toEqual([]);
      await expect(collectCompilerQueryShapeFacts({ appSourceDir: srcDir, root })).resolves.toEqual(
        [
          {
            query: 'staticContact',
            shape: 'string',
            source: 'src/schema.ts:2',
          },
        ],
      );
    } finally {
      if (previous === undefined) delete process.env.KOVO_BUILD_GRAPH_DERIVATION;
      else process.env.KOVO_BUILD_GRAPH_DERIVATION = previous;
      await rm(root, { force: true, recursive: true });
    }
  });
});

async function loadSubject(): Promise<DataPlaneStaticAnalysisModule> {
  return import('./data-plane-static-analysis.js');
}
