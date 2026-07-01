import { describe, expect, it } from 'vitest';

import { checkSingleChoke } from './check-single-choke.mjs';

function runFixture(files) {
  const sourceFiles = Object.keys(files).sort();
  return checkSingleChoke({
    allowedDriverFiles: ['packages/server/src/sql-safe-handle.ts'],
    allowedRawTargetFiles: ['packages/server/src/sql-safe-handle.ts'],
    exists: (relativePath) => Object.hasOwn(files, relativePath),
    readText: (relativePath) => files[relativePath] ?? '',
    sourceFiles,
  });
}

describe('single managed DB choke gate', () => {
  it('accepts driver execution inside enforceManagedSql() choke plumbing', () => {
    const result = runFixture({
      'packages/server/src/sql-safe-handle.ts': `
export function enforceManagedSql(statement, mode, writePolicy) {
  return validate(statement, mode, writePolicy);
}
export function wrap(db) {
  db.execute(statement);
  db.query(statement);
  db.prepare(statement);
  db.$client.exec('BEGIN');
}
`,
      'packages/server/src/query.ts': `
export function load(cache) {
  return cache.get('not-a-db-driver');
}
`,
    });

    expect(result.findings).toEqual([]);
  });

  it('rejects canary driver execution outside the choke', () => {
    const result = runFixture({
      'packages/server/src/sql-safe-handle.ts': `
export function enforceManagedSql(statement, mode, writePolicy) {
  return validate(statement, mode, writePolicy);
}
`,
      'packages/server/src/app-bypass.ts': `
export async function bypass(db) {
  await db.execute('delete from users');
}
`,
    });

    expect(result.findings).toContain(
      'packages/server/src/app-bypass.ts:3: driver method/property .execute must route through enforceManagedSql() in sql-safe-handle.ts or an audited durable-task internal SQL executor',
    );
  });

  it('rejects managed raw-target bypasses outside audited framework internals', () => {
    const result = runFixture({
      'packages/server/src/sql-safe-handle.ts': `
export function enforceManagedSql(statement, mode, writePolicy) {
  return validate(statement, mode, writePolicy);
}
`,
      'packages/server/src/feature.ts': `
export function leak(handle) {
  return frameworkManagedDbRawTarget(handle);
}
`,
    });

    expect(result.findings).toContain(
      'packages/server/src/feature.ts:3: frameworkManagedDbRawTarget() is an internal bypass and must stay in audited framework files',
    );
  });

  it('requires exactly one named enforceManagedSql() choke declaration', () => {
    const result = runFixture({
      'packages/server/src/sql-safe-handle.ts': `
export function enforceManagedSql(statement) { return statement; }
export function enforceManagedSql(statement, mode) { return mode; }
`,
    });

    expect(result.findings).toContain(
      'packages/server/src/sql-safe-handle.ts: expected exactly one enforceManagedSql() declaration, found 2',
    );
  });
});
