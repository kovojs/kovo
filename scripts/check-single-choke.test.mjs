import { describe, expect, it } from 'vitest';

import { checkSingleChoke } from './check-single-choke.mjs';

function runFixture(files) {
  const sourceFiles = Object.keys(files).sort();
  return checkSingleChoke({
    allowedExternalEgressFiles: [
      'packages/server/src/response-posture.ts',
      'packages/server/src/mutation/streaming.ts',
    ],
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
export const enforceManagedSql = securityClassifier(
  'server.sql.enforce-managed-sql',
  function (statement, mode, writePolicy) {
    return validate(statement, mode, writePolicy);
  },
);
export function wrap(db) {
  db.execute(statement);
  db.query(statement);
  db.prepare(statement);
  db.batch([statement]);
  db.transaction((tx) => tx.execute(statement));
  db.with(cte).select().from(table);
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

  it('rejects canary transaction and CTE handle execution outside the choke', () => {
    const result = runFixture({
      'packages/server/src/sql-safe-handle.ts': `
export const enforceManagedSql = securityClassifier(
  'server.sql.enforce-managed-sql',
  function (statement, mode, writePolicy) {
    return validate(statement, mode, writePolicy);
  },
);
`,
      'packages/server/src/app-bypass.ts': `
export async function bypass(db) {
  await db.batch([]);
  await db.transaction((tx) => tx.execute('delete from users'));
  await db.with(active).update(users).set({ role: 'admin' });
}
`,
    });

    expect(result.findings).toEqual(
      expect.arrayContaining([
        'packages/server/src/app-bypass.ts:3: driver method/property .batch must route through enforceManagedSql() in sql-safe-handle.ts or an audited durable-task internal SQL executor',
        'packages/server/src/app-bypass.ts:4: driver method/property .transaction must route through enforceManagedSql() in sql-safe-handle.ts or an audited durable-task internal SQL executor',
        'packages/server/src/app-bypass.ts:5: driver method/property .with must route through enforceManagedSql() in sql-safe-handle.ts or an audited durable-task internal SQL executor',
      ]),
    );
  });

  it('accepts classified external egress sinks in inventoried sole-door files', () => {
    const result = runFixture({
      'packages/server/src/sql-safe-handle.ts': `
export const enforceManagedSql = securityClassifier(
  'server.sql.enforce-managed-sql',
  function (statement, mode, writePolicy) {
    return validate(statement, mode, writePolicy);
  },
);
`,
      'packages/server/src/response-posture.ts': `
export function emitToWire(value) {
  const headers = new Headers();
  return new Response(value, { headers });
}
`,
      'packages/server/src/mutation/streaming.ts': `
export function streamMutation() {
  return new ReadableStream({ start() {} });
}
`,
    });

    expect(result.findings).toEqual([]);
  });

  it('rejects canary external egress sinks outside the classified sole-door inventory', () => {
    const result = runFixture({
      'packages/server/src/sql-safe-handle.ts': `
export const enforceManagedSql = securityClassifier(
  'server.sql.enforce-managed-sql',
  function (statement, mode, writePolicy) {
    return validate(statement, mode, writePolicy);
  },
);
`,
      'packages/server/src/app-bypass.ts': `
export function bypass() {
  const response = new Response('secret');
  response.headers.set('x-secret', 'leak');
  return respond.stream(secretBytes, { contentType: 'text/plain' });
}
`,
    });

    expect(result.findings).toEqual(
      expect.arrayContaining([
        'packages/server/src/app-bypass.ts:3: Response constructor is an external egress sink and must be classified in the DEC-J sole-door inventory or route through emitToWire()',
        'packages/server/src/app-bypass.ts:4: response header mutation is an external egress sink and must be classified in the DEC-J sole-door inventory or route through emitToWire()',
        'packages/server/src/app-bypass.ts:5: route binary/stream response outcome is an external egress sink and must be classified in the DEC-J sole-door inventory or route through emitToWire()',
      ]),
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
export const enforceManagedSql = securityClassifier('server.sql.enforce-managed-sql', function (statement, mode) { return mode; });
`,
    });

    expect(result.findings).toContain(
      'packages/server/src/sql-safe-handle.ts: expected exactly one enforceManagedSql() declaration, found 2',
    );
  });
});
