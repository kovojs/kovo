import { describe, expect, it } from 'vitest';

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  snapshotManagedSqlStatement,
  validateManagedSqlStatement,
} from '@kovojs/core/internal/sql-safety';
import { sql as drizzleSql } from 'drizzle-orm';
import type { SQL } from 'drizzle-orm';
import { kovoAnalyzerSummary, sql, staticSql, trustedSql } from './runtime.js';

interface DrizzlePackageJson {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  exports?: Record<string, string>;
}

function drizzlePackageJson(): DrizzlePackageJson {
  return JSON.parse(
    readFileSync(fileURLToPath(new URL('../package.json', import.meta.url)), 'utf8'),
  ) as DrizzlePackageJson;
}

function drizzleRuntimeSource(): string {
  return readFileSync(fileURLToPath(new URL('./runtime.ts', import.meta.url)), 'utf8');
}

function drizzleStaticSource(): string {
  return readFileSync(fileURLToPath(new URL('./static.ts', import.meta.url)), 'utf8');
}

function drizzleProjectSetupSource(): string {
  return readFileSync(fileURLToPath(new URL('./static/project-setup.ts', import.meta.url)), 'utf8');
}

function drizzleDeriveSource(): string {
  return readFileSync(fileURLToPath(new URL('./derive.ts', import.meta.url)), 'utf8');
}

function drizzleCompatibilityBarrelSource(): string {
  return readFileSync(fileURLToPath(new URL('./index.ts', import.meta.url)), 'utf8');
}

// H5 strict-TypeScript control: these public Drizzle fields are genuinely mutable without casts.
// The static KV422 gate rejects the laundering pattern, while the runtime executes only the recipe
// that Kovo pinned before returning either object to app code.
function strictTypeValidCarrierMutation(executableText: string) {
  const replaced = sql`select ${'safe'}`;
  Object.assign(replaced, {
    queryChunks: [{ value: [executableText] }],
  });

  const nested = sql`select ${'safe'}`;
  const literal = nested.queryChunks[0];
  if (literal === null || typeof literal !== 'object') {
    throw new Error('expected Drizzle StringChunk');
  }
  Object.assign(literal, { value: [executableText] });
  nested.queryChunks.splice(1);
  return { nested, replaced };
}

describe('@kovojs/drizzle runtime surface', () => {
  it('keeps analyzer summaries as one-parameter candidates and preserves helper identity', () => {
    function requireSessionId(context: { request: { session: { id: string } } }) {
      return context.request.session.id;
    }

    const marked = kovoAnalyzerSummary(requireSessionId, {
      returns: { kind: 'session', path: 'id' },
    });
    const sameHelper: typeof requireSessionId = marked;
    expect(sameHelper).toBe(requireSessionId);

    function noParameter() {
      return 'session-id';
    }
    function extraParameter(context: { request: { session: { id: string } } }, suffix: string) {
      return context.request.session.id + suffix;
    }

    if (false) {
      // Type-level arity is defense-in-depth; SPEC §6.6's AST proof remains authoritative.
      // @ts-expect-error analyzer-summary candidates require exactly one parameter
      kovoAnalyzerSummary(noParameter, { returns: { kind: 'session', path: 'id' } });
      // @ts-expect-error analyzer-summary candidates require exactly one parameter
      kovoAnalyzerSummary(extraParameter, { returns: { kind: 'session', path: 'id' } });
      // @ts-expect-error general server provenance cannot be declared by app code
      kovoAnalyzerSummary(requireSessionId, { returns: { kind: 'server', path: '' } });
    }
  });

  it('types Kovo SQL constructors as Drizzle SQL values accepted by common sinks', () => {
    interface DrizzleSinks {
      execute(statement: SQL<unknown>): Promise<unknown>;
      select(): { where(condition: SQL<unknown>): Promise<unknown[]> };
    }

    const typedSql: SQL<number> = sql<number>`select count(*) from products`;
    const typedStaticSql: SQL<{ id: string }> = staticSql<{ id: string }>`select id from products`;
    const identifier: SQL<unknown> = sql.identifier('products', { allow: ['products'] });
    const direction: SQL<unknown> = sql.allow('asc', ['asc', 'desc']);

    function acceptsDrizzleSinks(db: DrizzleSinks) {
      return [
        db.execute(sql`select * from products`),
        db.select().where(sql<boolean>`archived = false`),
        typedSql,
        typedStaticSql,
        identifier,
        direction,
      ];
    }

    expect(acceptsDrizzleSinks).toBeTypeOf('function');
  });

  it('brands Kovo SQL values accepted by managed DB guards', () => {
    const productId = 'p1';
    const statement = sql`select * from products where id = ${productId}`;
    const staticStatement = staticSql`select * from products`;
    const identifier = sql.identifier('products', { allow: ['products'] });
    const direction = sql.allow('desc', ['asc', 'desc']);
    const joined = sql.join([identifier, direction], sql.raw(' '));

    expect(validateManagedSqlStatement(statement)).toEqual({ ok: true });
    expect(validateManagedSqlStatement(staticStatement)).toEqual({ ok: true });
    expect(validateManagedSqlStatement(identifier)).toEqual({ ok: true });
    expect(validateManagedSqlStatement(direction)).toEqual({ ok: true });
    expect(validateManagedSqlStatement(joined)).toMatchObject({ ok: false });
    expect(
      validateManagedSqlStatement(trustedSql(joined, { justification: 'audited order clause' })),
    ).toEqual({
      ok: true,
    });
    expect(validateManagedSqlStatement(drizzleSql.raw('select * from products'))).toMatchObject({
      ok: false,
      message: expect.stringContaining('unbranded object-shaped SQL'),
    });
  });

  it('pins genuine SQL carriers before strict-TypeScript-valid public mutation', () => {
    const { nested, replaced } = strictTypeValidCarrierMutation('delete from accounts');

    expect(snapshotManagedSqlStatement(replaced, 'postgres')).toMatchObject({
      ok: true,
      statement: { text: 'select $1', values: ['safe'] },
    });
    expect(snapshotManagedSqlStatement(nested, 'postgres')).toMatchObject({
      ok: true,
      statement: { text: 'select $1', values: ['safe'] },
    });
  });

  it('pins SQL constructors from one dense snapshot despite iterator and scalar poisoning', () => {
    const rawDelete = 'DELETE FROM accounts; --';
    const originalMap = Array.prototype.map;
    const originalJoin = Array.prototype.join;
    const originalReplaceAll = String.prototype.replaceAll;
    let identifierSnapshot: ReturnType<typeof snapshotManagedSqlStatement> | undefined;
    let staticSnapshot: ReturnType<typeof snapshotManagedSqlStatement> | undefined;
    try {
      Array.prototype.map = (() => [rawDelete]) as typeof Array.prototype.map;
      Array.prototype.join = () => rawDelete;
      String.prototype.replaceAll = () => rawDelete;
      identifierSnapshot = snapshotManagedSqlStatement(sql.identifier('accounts'), 'postgres');
      staticSnapshot = snapshotManagedSqlStatement(staticSql`select 1`, 'postgres');
    } finally {
      Array.prototype.map = originalMap;
      Array.prototype.join = originalJoin;
      String.prototype.replaceAll = originalReplaceAll;
    }

    const raw = sql.raw(rawDelete);
    const parts: unknown[] = [raw];
    Object.defineProperty(parts, Symbol.iterator, {
      configurable: true,
      value: function* () {},
    });
    const joined = sql.join(parts);

    expect(identifierSnapshot).toMatchObject({
      ok: true,
      statement: { text: '"accounts"', values: [] },
    });
    expect(staticSnapshot).toMatchObject({
      ok: true,
      statement: { text: 'select 1', values: [] },
    });
    expect(snapshotManagedSqlStatement(joined, 'postgres')).toMatchObject({
      message: expect.stringContaining('sql.raw'),
      ok: false,
    });
    expect(
      snapshotManagedSqlStatement(
        trustedSql(joined, { justification: 'audited raw maintenance statement' }),
        'postgres',
      ),
    ).toMatchObject({ ok: true, statement: { text: rawDelete } });
  });

  it('pins Drizzle constructor methods and trusted justification authority at module boot', () => {
    const mutableDrizzleSql = drizzleSql as unknown as {
      identifier: typeof drizzleSql.identifier;
      join: typeof drizzleSql.join;
      raw: typeof drizzleSql.raw;
    };
    const originalIdentifier = mutableDrizzleSql.identifier;
    const originalJoin = mutableDrizzleSql.join;
    const originalRaw = mutableDrizzleSql.raw;
    const attacker = originalRaw('delete from accounts');
    let raw: SQL | undefined;
    let identifier: SQL | undefined;
    let joined: SQL | undefined;
    let allowed: SQL | undefined;
    try {
      mutableDrizzleSql.raw = () => attacker;
      mutableDrizzleSql.identifier = () => attacker;
      mutableDrizzleSql.join = () => attacker;
      raw = sql.raw('select 1');
      identifier = sql.identifier('accounts');
      joined = sql.join([sql.identifier('accounts')]);
      allowed = sql.allow('asc', ['asc', 'desc']);
    } finally {
      mutableDrizzleSql.raw = originalRaw;
      mutableDrizzleSql.identifier = originalIdentifier;
      mutableDrizzleSql.join = originalJoin;
    }
    expect(raw).not.toBe(attacker);
    expect(identifier).not.toBe(attacker);
    expect(joined).not.toBe(attacker);
    expect(allowed).not.toBe(attacker);
    expect(
      snapshotManagedSqlStatement(
        trustedSql(raw!, { justification: 'constructor authority control' }),
        'postgres',
      ),
    ).toMatchObject({ ok: true, statement: { text: 'select 1' } });
    expect(snapshotManagedSqlStatement(identifier!, 'postgres')).toMatchObject({
      ok: true,
      statement: { text: '"accounts"' },
    });
    expect(snapshotManagedSqlStatement(allowed!, 'postgres')).toMatchObject({
      ok: true,
      statement: { text: 'asc' },
    });

    Object.defineProperty(Object.prototype, 'justification', {
      configurable: true,
      value: 'inherited trusted SQL audit bypass',
    });
    try {
      expect(() => trustedSql(sql.raw('select 1'), {} as { justification: string })).toThrow(
        /justification/u,
      );
    } finally {
      delete (Object.prototype as { justification?: unknown }).justification;
    }
  });

  it('cannot erase SQL constructor arguments through inherited numeric setters', () => {
    const nativeDefineProperty = Object.defineProperty;
    const originalDescriptor = Object.getOwnPropertyDescriptor(Array.prototype, '1');
    let poisonHits = 0;
    let snapshot: ReturnType<typeof snapshotManagedSqlStatement> | undefined;
    try {
      nativeDefineProperty(Array.prototype, '1', {
        configurable: true,
        set(value: unknown) {
          const first = (this as unknown[])[0] as { raw?: unknown } | undefined;
          if (value === 'reviewed-param' && Array.isArray(first?.raw)) {
            poisonHits += 1;
            return;
          }
          nativeDefineProperty(this, '1', {
            configurable: true,
            enumerable: true,
            value,
            writable: true,
          });
        },
      });
      snapshot = snapshotManagedSqlStatement(sql`select ${'reviewed-param'}`, 'postgres');
    } finally {
      if (originalDescriptor === undefined) {
        delete (Array.prototype as unknown as Record<string, unknown>)['1'];
      } else {
        nativeDefineProperty(Array.prototype, '1', originalDescriptor);
      }
    }

    expect(snapshot).toMatchObject({
      ok: true,
      statement: { text: 'select $1', values: ['reviewed-param'] },
    });
    expect(poisonHits).toBe(0);
  });

  it('validates dynamic SQL identifiers and allowlisted keyword fragments', () => {
    expect(() => sql.identifier('products; drop table users')).toThrow(/KV422/);
    expect(() => sql.identifier('users', { allow: ['products'] })).toThrow(/KV422/);
    expect(() => sql.allow('drop table users', ['asc', 'desc'])).toThrow(/KV422/);
    expect(() => staticSql`select ${'dynamic' as never}`).toThrow(/staticSql/);
  });

  it('keeps the runtime annotation entrypoint separate from static extraction', async () => {
    const runtime = await import('@kovojs/drizzle');
    const staticExtraction = await import('@kovojs/drizzle/internal/static');
    const compatibilityBarrel = await import('./index.js');
    const packageJson = drizzlePackageJson();
    const compatibilityBarrelSource = drizzleCompatibilityBarrelSource();
    const projectSetupSource = drizzleProjectSetupSource();
    const runtimeSource = drizzleRuntimeSource();
    const staticSource = drizzleStaticSource();

    expect(runtime.kovo({ domain: 'cart', key: 'id' }).domain).toBe('cart');
    expect(runtime.kovo({ domain: 'note', key: 'id', readOnly: true }).readOnly).toBe(true);
    expect(runtime.kovo({ domain: 'user', key: 'id', secret: ['passwordHash'] }).secret).toEqual([
      'passwordHash',
    ]);
    expect(
      runtime.kovo({ confidentialAtRest: ['ssn'], domain: 'profile', key: 'id' })
        .confidentialAtRest,
    ).toEqual(['ssn']);
    expect('extractTouchGraphFromSource' in runtime).toBe(false);
    expect(compatibilityBarrel.kovo({ domain: 'cart', key: 'id' }).domain).toBe('cart');
    expect('extractTouchGraphFromSource' in compatibilityBarrel).toBe(false);
    // SPEC §11.1 (v1 scope): source-mode extraction was removed in v1-cleanup item 4; only the
    // project-mode ts-morph entry points remain on the static surface.
    expect('extractTouchGraphFromSource' in staticExtraction).toBe(false);
    expect('extractQueryFactsFromSource' in staticExtraction).toBe(false);
    expect(staticExtraction.extractTouchGraphFromProject).toBeTypeOf('function');
    expect(staticExtraction.extractQueryFactsFromProject).toBeTypeOf('function');
    expect('kovo' in staticExtraction).toBe(false);
    expect(packageJson.exports).toEqual({
      '.': './src/runtime.ts',
      // SPEC.md §10.5: the source-agnostic derivation algebra is a ts-morph-free
      // entrypoint (it consumes the shared IR, not Drizzle source). api-cleanup:
      // moved behind ./internal/derive — its signature is built from
      // @kovojs/core/internal/derivation types, so it cannot be public.
      './internal/derive': './src/derive.ts',
      './internal/derive-codegen': './src/derive-codegen.ts',
      './internal/runtime-metadata': './src/runtime-metadata-internal.ts',
      './internal/static': './src/static.ts',
    });
    expect(drizzleDeriveSource()).not.toContain('ts-morph');
    // api-cleanup Phase 6: static extraction is now CLI/internal only, but it still
    // imports ts-morph at runtime through the internal subpath.
    expect(packageJson.dependencies?.['ts-morph']).toBe('^28.0.0');
    expect(packageJson.devDependencies?.['ts-morph']).toBeUndefined();
    expect(runtimeSource).not.toContain('ts-morph');
    expect(runtimeSource).not.toContain('./index.js');
    expect(runtimeSource).not.toContain('./static.js');
    expect(runtimeSource).not.toContain('./graph.js');
    expect(runtimeSource).not.toContain('./invalidation.js');
    expect(staticSource).toContain("from 'ts-morph'");
    expect(staticSource).not.toContain('SOURCE_EXTRACTION_FILE_NAME');
    expect(staticSource).not.toContain('__kovo_source.ts');
    expect(projectSetupSource).toContain(
      'createSourceFile(projectSourceFileName(file.fileName), file.source',
    );
    expect(projectSetupSource).toContain(
      'function projectSourceFileName(fileName: string): string',
    );
    expect(compatibilityBarrelSource).not.toContain('ts-morph');
    expect(compatibilityBarrelSource).not.toContain('./static.js');
    expect(compatibilityBarrelSource).not.toContain('./graph.js');
    expect(compatibilityBarrelSource).not.toContain('./invalidation.js');
    expect(compatibilityBarrelSource).toContain("from './runtime.js'");
  });

  it('fails closed on unknown security annotation fields', async () => {
    // SPEC §6.6: TypeScript/casts are not a security proof. Runtime metadata must
    // reject misspelled confidentiality and ownership posture instead of dropping it.
    const runtime = await import('@kovojs/drizzle');

    expect(() =>
      runtime.kovo({ domain: 'user', key: 'id', secrect: ['passwordHash'] } as never),
    ).toThrow(/Unknown Kovo Drizzle annotation field "secrect"/u);
    expect(() =>
      runtime.kovo({
        domain: 'order',
        key: 'id',
        ownerVia: { fk: 'accountId', parrent: {}, parentKey: 'id' },
      } as never),
    ).toThrow(/Unknown Kovo Drizzle nested annotation field "parrent"/u);
    expect(() =>
      runtime.kovo({
        domain: 'post',
        fans: [{ domain: 'comment', via: 'postId', whem: 'delete' }],
        key: 'id',
      } as never),
    ).toThrow(/Unknown Kovo Drizzle nested annotation field "whem"/u);

    const hidden = Object.defineProperty({ domain: 'user', key: 'id' }, 'secrect', {
      value: ['passwordHash'],
    });
    expect(() => runtime.kovo(hidden as never)).toThrow(
      /Unknown Kovo Drizzle annotation field "secrect"/u,
    );
    expect(() =>
      runtime.kovo({ domain: 'user', key: 'id', [Symbol('secrect')]: ['passwordHash'] } as never),
    ).toThrow(/must not contain symbol fields/u);

    const originalOwnKeys = Reflect.ownKeys;
    try {
      Reflect.ownKeys = () => ['domain', 'key'];
      expect(() =>
        runtime.kovo({ domain: 'user', key: 'id', secrect: ['passwordHash'] } as never),
      ).toThrow(/Unknown Kovo Drizzle annotation field "secrect"/u);
    } finally {
      Reflect.ownKeys = originalOwnKeys;
    }
  });
});
