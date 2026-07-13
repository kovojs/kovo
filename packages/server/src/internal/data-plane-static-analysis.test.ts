import { mkdtemp, mkdir, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { Stats } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  staticAnalysisDefineDataProperty,
  staticAnalysisNullRecord,
  staticAnalysisPromiseAll,
} from './data-plane-static-analysis-intrinsics.js';

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

  it('does not let late Promise/iterator controls replace analyzer joins', async () => {
    const first = Promise.resolve('first');
    const second = Promise.resolve('second');
    const values = [first, second];
    const nativeIterator = Array.prototype[Symbol.iterator];
    const nativeResolve = Promise.resolve;
    let pending: Promise<string[]>;
    try {
      Array.prototype[Symbol.iterator] = function poisonedAnalyzerPromiseIterator<T>() {
        if (this === values) return Reflect.apply(nativeIterator, [], []);
        return Reflect.apply(nativeIterator, this, []);
      };
      Promise.resolve = function poisonedAnalyzerPromiseResolve<T>(value: T | PromiseLike<T>) {
        if (value === first || value === second) {
          return Reflect.apply(nativeResolve, Promise, ['forged']) as Promise<Awaited<T>>;
        }
        return Reflect.apply(nativeResolve, Promise, [value]);
      };
      pending = staticAnalysisPromiseAll(values);
    } finally {
      Array.prototype[Symbol.iterator] = nativeIterator;
      Promise.resolve = nativeResolve;
    }
    await expect(pending!).resolves.toEqual(['first', 'second']);
  });

  it('C244 does not let inherited numeric setters replace analyzer inputs or results', async () => {
    const first = Promise.resolve('first');
    const values = [first, Promise.resolve('second')];
    const nativeDefineProperty = Object.defineProperty;
    const originalDescriptor = Object.getOwnPropertyDescriptor(Array.prototype, '0');
    let poisonHits = 0;
    let pending: Promise<string[]>;
    try {
      nativeDefineProperty(Array.prototype, '0', {
        configurable: true,
        set(value: unknown) {
          if (value === first || value === 'first') {
            poisonHits += 1;
            nativeDefineProperty(this, '0', {
              configurable: true,
              enumerable: true,
              value: value === first ? Promise.resolve('forged') : 'forged',
              writable: true,
            });
            return;
          }
          nativeDefineProperty(this, '0', {
            configurable: true,
            enumerable: true,
            value,
            writable: true,
          });
        },
      });
      pending = staticAnalysisPromiseAll(values);
      await expect(pending).resolves.toEqual(['first', 'second']);
    } finally {
      if (originalDescriptor === undefined) delete Array.prototype[0];
      else nativeDefineProperty(Array.prototype, '0', originalDescriptor);
    }
    expect(poisonHits).toBe(0);
  });

  it('C246 commits query-shape keys to null-prototype own data', () => {
    const record = staticAnalysisNullRecord<string>();
    const prototypeDescriptor = Object.getOwnPropertyDescriptor(Object.prototype, 'role');
    let setterHits = 0;
    try {
      Object.defineProperty(Object.prototype, 'role', {
        configurable: true,
        set() {
          setterHits += 1;
        },
      });
      staticAnalysisDefineDataProperty(record, 'role', 'member', 'test query shape');
      staticAnalysisDefineDataProperty(record, '__proto__', 'literal', 'test query shape');
    } finally {
      if (prototypeDescriptor === undefined) delete Object.prototype.role;
      else Object.defineProperty(Object.prototype, 'role', prototypeDescriptor);
    }

    expect(setterHits).toBe(0);
    expect(Object.getPrototypeOf(record)).toBeNull();
    expect(Object.getOwnPropertyDescriptor(record, 'role')?.value).toBe('member');
    expect(Object.getOwnPropertyDescriptor(record, '__proto__')?.value).toBe('literal');
  });

  it('keeps compiler query-shape facts exact after app-time source-array map replacement', async () => {
    const { buildCompilerQueryShapeFacts } = await loadSubject();
    const files = [
      {
        fileName: 'src/queries.ts',
        source: `
import { query, s } from '@kovojs/server';
export const status = query({
  output: s.object({ ready: s.boolean() }),
  load: () => ({ ready: true }),
});
`,
      },
    ];
    const staticFacts = {
      massAssignmentFacts: [],
      ownerDomains: [],
      queries: [],
      queryShapeFacts: [
        {
          query: 'account',
          shape: { token: { kind: 'secret' as const, shape: 'string' as const } },
          source: 'drizzle-analysis',
        },
      ],
      queryWriteReachability: [],
      scopeAudits: [],
      sqlSafetyDiagnostics: [],
      toctouFacts: [],
      touchGraph: {},
    };
    const nativeMap = Array.prototype.map;
    const nativeApply = Reflect.apply;
    let poisonHits = 0;
    let result!: ReturnType<typeof buildCompilerQueryShapeFacts>;
    try {
      Array.prototype.map = function poisonedBuildQuerySourceMap(this: any[], callback, thisArg) {
        if (this === files) {
          poisonHits += 1;
          return [];
        }
        return nativeApply(nativeMap, this, [callback, thisArg]);
      } as typeof Array.prototype.map;
      result = buildCompilerQueryShapeFacts(files, staticFacts);
    } finally {
      Array.prototype.map = nativeMap;
    }

    expect(poisonHits).toBe(0);
    expect(result).toEqual([
      expect.objectContaining({
        query: 'account',
        shape: { token: { kind: 'secret', shape: 'string' } },
      }),
      expect.objectContaining({ query: 'status', shape: { ready: 'boolean' } }),
    ]);
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

  it('does not let an author-forgeable UI-copy marker suppress aggregate security analysis', async () => {
    const extractStaticBuildAnalysisFactsFromProject = vi.fn(() => ({
      queries: [],
      sqlSafetyDiagnostics: [
        {
          code: 'KV422',
          message: 'wrapper SQL text reaches a managed sink',
          severity: 'error',
          site: 'src/search.js:5',
        },
      ],
      toctouFacts: [],
      touchGraph: {},
    }));
    vi.doMock('@kovojs/drizzle/internal/static', () => ({
      deriveMutationTouchRegistry: () => ({}),
      extractStaticBuildAnalysisFactsFromProject,
    }));
    const { staticDataPlaneBuildFacts } = await loadSubject();

    const facts = await staticDataPlaneBuildFacts(
      [
        {
          fileName: 'src/search.js',
          source: [
            '// @kovojs-ui-copy',
            'export function search(input, database) {',
            '  const runner = database;',
            '  const method = "execute";',
            '  return runner[method]("select * from products where id = " + input.id);',
            '}',
          ].join('\n'),
        },
      ],
      { cache: false },
    );

    expect(extractStaticBuildAnalysisFactsFromProject).toHaveBeenCalledWith({
      files: [
        expect.objectContaining({
          fileName: 'src/search.js',
        }),
      ],
    });
    expect(facts.sqlSafetyDiagnostics).toEqual([
      expect.objectContaining({ code: 'KV422', site: 'src/search.js:5' }),
    ]);
  });

  it('preserves core diagnostic severities from the aggregate analyzer', async () => {
    vi.doMock('@kovojs/drizzle/internal/static', () => ({
      deriveMutationTouchRegistry: () => ({}),
      extractStaticBuildAnalysisFactsFromProject: () => ({
        queries: [],
        sqlSafetyDiagnostics: [
          {
            code: 'KV447',
            message: 'SQLite owner annotations are advisory only.',
            severity: 'warn',
            site: 'src/schema.ts:5',
          },
        ],
        toctouFacts: [],
        touchGraph: {},
      }),
    }));
    const { staticDataPlaneBuildFacts } = await loadSubject();

    await expect(
      staticDataPlaneBuildFacts([RELEVANT_DRIZZLE_SOURCE], { cache: false }),
    ).resolves.toMatchObject({
      sqlSafetyDiagnostics: [
        {
          code: 'KV447',
          message: 'SQLite owner annotations are advisory only.',
          severity: 'warn',
          site: 'src/schema.ts:5',
        },
      ],
    });
  });

  it('cannot drop discovered unsafe sources through a selective late Array.filter replacement', async () => {
    // SPEC §2/§11.4: evaluated app code shares the build realm. The complete source census
    // must be snapshotted before relevance classification, not handed to a mutable Array filter.
    const extractStaticBuildAnalysisFactsFromProject = vi.fn(() => ({
      queries: [],
      sqlSafetyDiagnostics: [
        {
          code: 'KV422',
          message: 'raw SQL input reaches the managed sink',
          severity: 'error',
          site: 'src/schema.ts:4',
        },
      ],
      toctouFacts: [],
      touchGraph: {},
    }));
    vi.doMock('@kovojs/drizzle/internal/static', () => ({
      deriveMutationTouchRegistry: () => ({}),
      extractStaticBuildAnalysisFactsFromProject,
    }));
    const { staticDataPlaneBuildFacts } = await loadSubject();
    const nativeFilter = Array.prototype.filter;
    const nativeApply = Reflect.apply;
    Array.prototype.filter = function poisonedSourceFilter(
      callback: (value: unknown, index: number, array: unknown[]) => unknown,
      thisArg?: unknown,
    ): unknown[] {
      if (
        this.length === 1 &&
        typeof this[0] === 'object' &&
        this[0] !== null &&
        typeof (this[0] as { source?: unknown }).source === 'string' &&
        (this[0] as { source: string }).source.includes('sql.raw(input.id)')
      ) {
        return [];
      }
      return nativeApply(nativeFilter, this, [callback, thisArg]);
    };

    try {
      const facts = await staticDataPlaneBuildFacts([RELEVANT_DRIZZLE_SOURCE], { cache: false });
      expect(extractStaticBuildAnalysisFactsFromProject).toHaveBeenCalledTimes(1);
      expect(facts.sqlSafetyDiagnostics).toEqual([
        expect.objectContaining({ code: 'KV422', site: 'src/schema.ts:4' }),
      ]);
    } finally {
      Array.prototype.filter = nativeFilter;
    }
  });

  it('keys the process-local cache by exact source and never creates disk cache state', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kovo-data-plane-process-cache-'));
    const extractStaticBuildAnalysisFactsFromProject = vi.fn(
      ({ files }: { files: readonly { source: string }[] }) => ({
        queries: [],
        sqlSafetyDiagnostics: files[0]?.source.includes('sql.raw')
          ? [
              {
                code: 'KV422',
                message: 'raw SQL input reaches the managed sink',
                severity: 'error',
                site: 'src/schema.ts:4',
              },
            ]
          : [],
        toctouFacts: [],
        touchGraph: {},
      }),
    );
    vi.doMock('@kovojs/drizzle/internal/static', () => ({
      deriveMutationTouchRegistry: () => ({}),
      extractStaticBuildAnalysisFactsFromProject,
    }));
    const { staticDataPlaneBuildFacts } = await loadSubject();
    const safe = {
      fileName: 'src/schema.ts',
      source: 'export async function safe(db: any, id: string) { return db.execute(id); }',
    };
    const unsafe = RELEVANT_DRIZZLE_SOURCE;

    try {
      await expect(staticDataPlaneBuildFacts([safe], { cache: true })).resolves.toMatchObject({
        sqlSafetyDiagnostics: [],
      });
      const facts = await staticDataPlaneBuildFacts([unsafe], { cache: true });
      expect(extractStaticBuildAnalysisFactsFromProject).toHaveBeenCalledTimes(2);
      expect(facts.sqlSafetyDiagnostics).toEqual([
        expect.objectContaining({ code: 'KV422', site: 'src/schema.ts:4' }),
      ]);
      expect(await readdir(root)).toEqual([]);
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it('returns a fresh canonical snapshot for every process-cache hit', async () => {
    const extractStaticBuildAnalysisFactsFromProject = vi.fn(() => ({
      queries: [],
      sqlSafetyDiagnostics: [
        {
          code: 'KV422',
          message: 'raw SQL input reaches the managed sink',
          severity: 'error',
          site: 'src/schema.ts:4',
        },
      ],
      toctouFacts: [],
      touchGraph: {},
    }));
    vi.doMock('@kovojs/drizzle/internal/static', () => ({
      deriveMutationTouchRegistry: () => ({}),
      extractStaticBuildAnalysisFactsFromProject,
    }));
    const { staticDataPlaneBuildFacts } = await loadSubject();
    const first = await staticDataPlaneBuildFacts([RELEVANT_DRIZZLE_SOURCE], { cache: true });
    (first.sqlSafetyDiagnostics as unknown[]).length = 0;
    const second = await staticDataPlaneBuildFacts([RELEVANT_DRIZZLE_SOURCE], { cache: true });

    expect(second.sqlSafetyDiagnostics).toEqual([
      expect.objectContaining({ code: 'KV422', site: 'src/schema.ts:4' }),
    ]);
    expect(extractStaticBuildAnalysisFactsFromProject).toHaveBeenCalledTimes(1);
  });

  it('does not let a caller poison the shared Vite data-plane analysis snapshot', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kovo-data-plane-vite-cache-snapshot-'));
    const srcDir = join(root, 'src');
    await mkdir(srcDir, { recursive: true });
    await writeFile(join(srcDir, 'schema.ts'), RELEVANT_DRIZZLE_SOURCE.source, 'utf8');
    const extractStaticBuildAnalysisFactsFromProject = vi.fn(() => ({
      queries: [],
      sqlSafetyDiagnostics: [
        {
          code: 'KV422',
          message: 'raw SQL input reaches the managed sink',
          severity: 'error',
          site: 'src/schema.ts:4',
        },
      ],
      toctouFacts: [],
      touchGraph: {},
    }));
    vi.doMock('@kovojs/drizzle/internal/static', () => ({
      deriveMutationTouchRegistry: () => ({}),
      extractStaticBuildAnalysisFactsFromProject,
    }));
    const { collectDataPlaneAnalysis, collectDataPlaneErrorDiagnostics } = await loadSubject();

    try {
      const first = await collectDataPlaneAnalysis({ appSourceDir: srcDir, root });
      (first.staticFacts.sqlSafetyDiagnostics as unknown[]).length = 0;

      await expect(
        collectDataPlaneErrorDiagnostics({ appSourceDir: srcDir, root }),
      ).resolves.toEqual([expect.objectContaining({ code: 'KV422', site: 'src/schema.ts:4' })]);
      expect(extractStaticBuildAnalysisFactsFromProject).toHaveBeenCalledTimes(1);
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it('evicts a rejected process-cache entry before retrying the same source', async () => {
    const extractStaticBuildAnalysisFactsFromProject = vi
      .fn()
      .mockImplementationOnce(() => {
        throw new Error('transient analyzer failure');
      })
      .mockImplementationOnce(() => ({
        queries: [],
        sqlSafetyDiagnostics: [],
        toctouFacts: [],
        touchGraph: {},
      }));
    vi.doMock('@kovojs/drizzle/internal/static', () => ({
      deriveMutationTouchRegistry: () => ({}),
      extractStaticBuildAnalysisFactsFromProject,
    }));
    const { staticDataPlaneBuildFacts } = await loadSubject();

    await expect(
      staticDataPlaneBuildFacts([RELEVANT_DRIZZLE_SOURCE], { cache: true }),
    ).rejects.toThrow(/transient analyzer failure/);
    await expect(
      staticDataPlaneBuildFacts([RELEVANT_DRIZZLE_SOURCE], { cache: true }),
    ).resolves.toMatchObject({ sqlSafetyDiagnostics: [] });
    expect(extractStaticBuildAnalysisFactsFromProject).toHaveBeenCalledTimes(2);
  });

  it('does not let author-controlled filenames suppress app security analysis', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kovo-data-plane-source-'));
    const srcDir = join(root, 'src');
    try {
      await mkdir(join(srcDir, 'generated'), { recursive: true });
      await mkdir(join(srcDir, 'components'), { recursive: true });
      await Promise.all([
        writeFile(
          join(srcDir, 'query.js'),
          [
            "export { shared as querySource } from '../shared.js';",
            "export * from './hidden.test.js';",
            "export * from './app.setup.js';",
            "export * from './generated/query.js';",
            '',
          ].join('\n'),
          'utf8',
        ),
        writeFile(
          join(srcDir, 'components/card.jsx'),
          'export const Card = () => <p />;\n',
          'utf8',
        ),
        writeFile(join(srcDir, 'hidden.test.ts'), 'export const hidden = true;\n', 'utf8'),
        writeFile(join(srcDir, 'app.setup.js'), 'export const setup = true;\n', 'utf8'),
        writeFile(join(srcDir, 'generated/query.ts'), 'export const generated = true;\n', 'utf8'),
        writeFile(join(root, 'shared.ts'), 'export const shared = true;\n', 'utf8'),
      ]);
      const { buildCheckSourceFiles, dataPlaneSourceFiles, isDataPlaneSourceFile } =
        await loadSubject();

      expect(
        dataPlaneSourceFiles(srcDir, root)
          .map((file) => file.fileName)
          .sort(),
      ).toEqual([
        'shared.ts',
        'src/app.setup.js',
        'src/components/card.jsx',
        'src/generated/query.ts',
        'src/hidden.test.ts',
        'src/query.js',
      ]);
      expect(
        buildCheckSourceFiles(join(srcDir, 'app.tsx'), root)
          .map((file) => file.fileName)
          .sort(),
      ).toEqual([
        '../shared.ts',
        'app.setup.js',
        'components/card.jsx',
        'generated/query.ts',
        'hidden.test.ts',
        'query.js',
      ]);
      expect(isDataPlaneSourceFile(join(srcDir, 'query.js'), srcDir)).toBe(true);
      expect(isDataPlaneSourceFile(join(srcDir, 'components/card.jsx'), srcDir)).toBe(true);
      expect(isDataPlaneSourceFile(join(srcDir, 'app.setup.js'), srcDir)).toBe(true);
      expect(isDataPlaneSourceFile(join(srcDir, 'generated/query.ts'), srcDir)).toBe(true);
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it('derives compiler-owned table security from a test-named runtime schema module', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kovo-data-plane-test-name-'));
    const srcDir = join(root, 'src');
    try {
      await mkdir(srcDir, { recursive: true });
      await writeFile(
        join(srcDir, 'schema.test.ts'),
        [
          'import { kovo } from "@kovojs/drizzle";',
          'import { sqliteTable, text } from "drizzle-orm/sqlite-core";',
          'export const vault = sqliteTable("vault", {',
          '  id: text("id").primaryKey(),',
          '  secretValue: text("secret_value").notNull(),',
          '}, kovo({ domain: "vault", key: "id", owner: "id", secret: ["secretValue"] }));',
        ].join('\n'),
        'utf8',
      );
      await writeFile(join(srcDir, 'app.ts'), "export * from './schema.test.js';\n", 'utf8');
      const { collectRuntimeRegistryFacts } = await loadSubject();

      await expect(
        collectRuntimeRegistryFacts({ appSourceDir: srcDir, root }),
      ).resolves.toMatchObject({
        tableSecurity: {
          tables: [
            {
              name: 'vault',
              owner: { columnKey: 'id', columnName: 'id' },
              secretColumnKeys: ['secretValue'],
              secretDeclared: true,
            },
          ],
        },
      });
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it('does not classify regular source files as directories through a late Stats replacement', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kovo-data-plane-stat-poison-'));
    const srcDir = join(root, 'src');
    const nativeIsDirectory = Stats.prototype.isDirectory;
    try {
      await mkdir(srcDir, { recursive: true });
      await writeFile(join(srcDir, 'unsafe.ts'), RELEVANT_DRIZZLE_SOURCE.source, 'utf8');
      const { dataPlaneSourceFiles } = await loadSubject();
      Stats.prototype.isDirectory = () => true;

      expect(dataPlaneSourceFiles(srcDir, root)).toEqual([
        {
          fileName: 'src/unsafe.ts',
          source: RELEVANT_DRIZZLE_SOURCE.source,
        },
      ]);
    } finally {
      Stats.prototype.isDirectory = nativeIsDirectory;
      await rm(root, { force: true, recursive: true });
    }
  });

  it('fails closed instead of following data-plane source symlinks outside the app root', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kovo-data-plane-source-boundary-'));
    const outside = await mkdtemp(join(tmpdir(), 'kovo-data-plane-source-outside-'));
    const srcDir = join(root, 'src');
    try {
      await mkdir(srcDir, { recursive: true });
      await writeFile(join(srcDir, 'app.tsx'), 'export const app = true;\n', 'utf8');
      await writeFile(join(outside, 'host-secret.ts'), RELEVANT_DRIZZLE_SOURCE.source, 'utf8');
      await symlink(join(outside, 'host-secret.ts'), join(srcDir, 'linked-secret.ts'));
      const { buildCheckSourceFiles, dataPlaneSourceFiles } = await loadSubject();

      expect(() => dataPlaneSourceFiles(srcDir, root)).toThrow(/source.*symlink|source.*special/u);
      expect(() => buildCheckSourceFiles(join(srcDir, 'app.tsx'))).toThrow(
        /source.*symlink|source.*special/u,
      );
    } finally {
      await rm(root, { force: true, recursive: true });
      await rm(outside, { force: true, recursive: true });
    }
  });

  it('permits contained regular-file aliases but rejects directory symlinks', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kovo-data-plane-contained-alias-'));
    const srcDir = join(root, 'src');
    try {
      await mkdir(srcDir, { recursive: true });
      await writeFile(join(srcDir, 'app.tsx'), 'export const app = true;\n', 'utf8');
      await writeFile(join(root, 'AGENTS.md'), 'framework instructions\n', 'utf8');
      await symlink('AGENTS.md', join(root, 'CLAUDE.md'));
      const { dataPlaneSourceFiles } = await loadSubject();

      expect(dataPlaneSourceFiles(root, root)).toEqual([
        { fileName: 'src/app.tsx', source: 'export const app = true;\n' },
      ]);

      await symlink('src', join(root, 'linked-source'));
      expect(() => dataPlaneSourceFiles(root, root)).toThrow(/source.*symlink|source.*special/u);
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it('keeps large output-schema extraction independent of late global URL replacement', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kovo-data-plane-output-url-poison-'));
    const srcDir = join(root, 'src');
    const NativeURL = globalThis.URL;
    let poisonHits = 0;
    try {
      await mkdir(srcDir, { recursive: true });
      await writeFile(
        join(srcDir, 'status.ts'),
        [
          'import { query, s } from "@kovojs/server";',
          'export const status = query({',
          '  reads: [],',
          '  output: s.object({ ready: s.boolean() }),',
          '  load: () => ({ ready: true }),',
          '});',
          `// ${root}`,
        ].join('\n'),
        'utf8',
      );
      for (let index = 1; index < 8; index += 1) {
        await writeFile(
          join(srcDir, `query-${index}.ts`),
          `export const query${index} = ${index}; // ${root}\n`,
          'utf8',
        );
      }
      const { collectDataPlaneAnalysis } = await loadSubject();
      globalThis.URL = function PoisonedStaticAnalysisUrl(input, base) {
        if (`${input}`.includes('data-plane-static-analysis')) {
          poisonHits += 1;
          throw new Error('late URL authority reached');
        }
        return base === undefined ? new NativeURL(input) : new NativeURL(input, base);
      } as typeof URL;

      await expect(
        collectDataPlaneAnalysis({ appSourceDir: srcDir, root, skipStaticFacts: true }),
      ).resolves.toMatchObject({
        outputQueryShapeFacts: [
          expect.objectContaining({ query: 'status', shape: { ready: 'boolean' } }),
        ],
      });
      expect(poisonHits).toBe(0);
    } finally {
      globalThis.URL = NativeURL;
      await rm(root, { force: true, recursive: true });
    }
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

  it('does not accept compiler query-shape authority from an app-writable global symbol', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kovo-data-plane-global-seed-'));
    const srcDir = join(root, 'src');
    const buildFactsKey = Symbol.for('kovo.build.queryShapeFacts');
    const globalRecord = globalThis as unknown as Record<symbol, unknown>;
    const previousDescriptor = Object.getOwnPropertyDescriptor(globalThis, buildFactsKey);
    vi.doMock('@kovojs/drizzle/internal/static', () => ({
      deriveMutationTouchRegistry: () => ({}),
      extractStaticBuildAnalysisFactsFromProject: () => ({
        queries: [
          {
            query: 'account',
            shape: { secret: { kind: 'secret', shape: 'string' } },
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
      // App-authored Vite/config code runs in this realm before Kovo build hooks.
      globalRecord[buildFactsKey] = [];
      const { collectCompilerQueryShapeFacts } = await loadSubject();

      await expect(collectCompilerQueryShapeFacts({ appSourceDir: srcDir, root })).resolves.toEqual(
        [
          {
            query: 'account',
            shape: { secret: { kind: 'secret', shape: 'string' } },
            source: 'src/schema.ts:2',
          },
        ],
      );
    } finally {
      if (previousDescriptor === undefined) delete globalRecord[buildFactsKey];
      else Object.defineProperty(globalThis, buildFactsKey, previousDescriptor);
      await rm(root, { force: true, recursive: true });
    }
  });
});

async function loadSubject(): Promise<DataPlaneStaticAnalysisModule> {
  return import('./data-plane-static-analysis.js');
}
