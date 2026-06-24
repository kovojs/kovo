import { describe, expect, it } from 'vitest';

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { validateManagedSqlStatement } from '@kovojs/core/internal/sql-safety';
import { adminAssign, serverValue, sql, staticSql, trustedSql } from './runtime.js';

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

describe('@kovojs/drizzle runtime surface', () => {
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
  });

  it('validates dynamic SQL identifiers and allowlisted keyword fragments', () => {
    expect(() => sql.identifier('products; drop table users')).toThrow(/KV422/);
    expect(() => sql.identifier('users', { allow: ['products'] })).toThrow(/KV422/);
    expect(() => sql.allow('drop table users', ['asc', 'desc'])).toThrow(/KV422/);
    expect(() => staticSql`select ${'dynamic' as never}`).toThrow(/staticSql/);
  });

  it('exports governed-write escape helpers from the runtime surface', () => {
    expect(serverValue('u1', 'session owner')).toBe('u1');
    expect(adminAssign('admin', 'support role correction')).toBe('admin');
    expect(() => adminAssign('admin', '   ')).toThrow(/adminAssign requires/);
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
    expect(runtime.kovo({ domain: 'user', key: 'id', secret: ['passwordHash'] }).secret).toEqual([
      'passwordHash',
    ]);
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
});
