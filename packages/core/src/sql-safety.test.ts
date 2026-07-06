import { describe, expect, it } from 'vitest';

import {
  frameworkTrustedSqlCarrier,
  isDbAdapterLike,
  isManagedSqlStatement,
  isPreparedStatementExecutionMethod,
  isSqlHandleLike,
  isSqlHandleProperty,
  snapshotManagedSqlStatement,
  stampParameterizedSql,
  stampRawSqlChunk,
  stampSqlIdentifier,
  stampSqlKeyword,
  stampStaticSql,
  stampTrustedSql,
  validateManagedSqlStatement,
} from './internal/sql-safety.js';

describe('SQL safety shared seam predicates', () => {
  it('recognizes the DB and SQL handle surfaces shared by server guard and test verifier', () => {
    expect(['pglite', 'sqlite', 'client', '$client'].filter(isSqlHandleProperty)).toEqual([
      'pglite',
      'sqlite',
      'client',
      '$client',
    ]);
    expect(['all', 'get', 'run', 'iterate'].filter(isPreparedStatementExecutionMethod)).toEqual([
      'all',
      'get',
      'run',
      'iterate',
    ]);
    expect(isSqlHandleLike({ exec() {}, prepare() {} })).toBe(true);
    expect(isSqlHandleLike({ query() {} })).toBe(true);
    expect(isSqlHandleLike({ exec() {} })).toBe(true);
    expect(isSqlHandleLike({ prepare() {} })).toBe(true);
    expect(isSqlHandleLike({ all() {} })).toBe(true);
    expect(isSqlHandleLike({ get() {} })).toBe(true);
    expect(isSqlHandleLike({ run() {} })).toBe(true);
    expect(isSqlHandleLike({ values() {} })).toBe(true);
    expect(isSqlHandleLike({ exec() {}, query() {}, transaction() {} })).toBe(true);
    expect(isDbAdapterLike({ client: { execute() {} } })).toBe(true);
    expect(isDbAdapterLike({ pglite: { query() {} } })).toBe(true);
    expect(isDbAdapterLike({ sqlite: { all() {} } })).toBe(true);
    expect(isDbAdapterLike({ $client: { values() {} } })).toBe(true);
    expect(isDbAdapterLike({ read() {}, write() {} })).toBe(true);
  });
});

describe('validateManagedSqlStatement runtime floor (SPEC §10.2/§6.6)', () => {
  it('rejects raw string statements (KV422)', () => {
    const result = validateManagedSqlStatement('select * from products where id = ' + 'x');
    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/KV422/);
  });

  it('rejects a forged Symbol.for("kovo.sql.parameterized") brand (brands are not reconstructable)', () => {
    // An attacker/app cannot reach the module-private brand symbol; reconstructing it via the
    // global registry produces a *different* symbol that the guard does not honor.
    const forged: Record<PropertyKey, unknown> = {
      text: "select * from users where name = 'x' OR '1'='1'",
    };
    forged[Symbol.for('kovo.sql.parameterized')] = true;
    forged[Symbol.for('kovo.sql.static')] = true;
    forged[Symbol.for('kovo.sql.trusted')] = true;
    const result = validateManagedSqlStatement(forged);
    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/KV422/);
  });

  it('rejects a { text } carrier with no separated values array (assembled-text laundering)', () => {
    const injection = '1; drop table products; --';
    const result = validateManagedSqlStatement({
      text: `select * from products where id = ${injection}`,
    });
    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/KV422/);
  });

  it('rejects a { sql } carrier with no separated values array', () => {
    const result = validateManagedSqlStatement({ sql: 'select 1' });
    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/KV422/);
  });

  it('rejects an unbranded carrier with an empty values array', () => {
    const result = validateManagedSqlStatement({
      text: "select * from products where id = '1; drop table products; --'",
      values: [],
    });
    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/KV422/);
  });

  it('accepts a framework-owned reconstructed carrier with empty values', () => {
    const carrier = frameworkTrustedSqlCarrier(
      { text: 'select id from products', values: [] },
      'framework reconstructed rawRead carrier',
    );
    const snapshot = snapshotManagedSqlStatement(carrier, 'sqlite');
    expect(snapshot.ok).toBe(true);
    if (!snapshot.ok) return;
    expect(snapshot.statement).toMatchObject({
      dialect: 'sqlite',
      provenance: 'trusted-separated-carrier',
      text: 'select id from products',
      values: [],
    });
    expect(Object.isFrozen(carrier)).toBe(true);
  });

  it('rejects an unbranded carrier whose values array has no SQL bind marker', () => {
    const result = validateManagedSqlStatement({
      text: "select * from products where id = 'already assembled'",
      values: ['unused'],
    });
    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/KV422/);
  });

  it('accepts a genuinely separated { text, values } carrier', () => {
    const carrier = {
      text: 'select * from products where status = $1',
      values: ['open'],
    };
    expect(validateManagedSqlStatement(carrier).ok).toBe(true);
    const snapshot = snapshotManagedSqlStatement(carrier, 'postgres');
    expect(snapshot.ok).toBe(true);
    if (!snapshot.ok) return;
    expect(snapshot.statement).toMatchObject({
      dialect: 'postgres',
      provenance: 'plain-separated-carrier',
      text: carrier.text,
      values: carrier.values,
    });
    expect(isManagedSqlStatement(snapshot.statement)).toBe(true);
    expect(Object.isFrozen(snapshot.statement)).toBe(true);
    expect(Object.isFrozen(snapshot.statement.values)).toBe(true);
    expect(snapshot.statement).not.toBe(carrier);
  });

  it('accepts common separated carrier parameter spellings', () => {
    expect(
      validateManagedSqlStatement({ text: 'select * from t where id = ?', args: [1] }).ok,
    ).toBe(true);
    expect(
      validateManagedSqlStatement({ sql: 'select * from t where id = :id', params: ['p1'] }).ok,
    ).toBe(true);
    expect(
      validateManagedSqlStatement({ text: 'select * from t where id = @id', values: ['p1'] }).ok,
    ).toBe(true);
  });

  it('rejects submit-bearing and thenable carriers before snapshotting driver surface', () => {
    for (const carrier of [
      {
        submit() {
          throw new Error('out-of-band submit');
        },
        text: 'select * from products where id = $1',
        values: ['p1'],
      },
      {
        text: 'select * from products where id = $1',
        then() {
          throw new Error('out-of-band then');
        },
        values: ['p1'],
      },
      Object.assign(
        Object.create({
          then() {
            throw new Error('inherited then');
          },
        }),
        {
          text: 'select * from products where id = $1',
          values: ['p1'],
        },
      ),
    ]) {
      const result = validateManagedSqlStatement(carrier);
      expect(result.ok).toBe(false);
      expect(result.message).toMatch(/KV422/);
      expect(result.message).toMatch(/SPEC §10\.3/);
      expect(snapshotManagedSqlStatement(carrier).ok).toBe(false);
    }
  });

  it('does not accept bind-marker lookalikes inside SQL strings or comments', () => {
    expect(
      validateManagedSqlStatement({
        text: "select '$1' as literal -- ?\nfrom products",
        values: ['unused'],
      }).ok,
    ).toBe(false);
  });

  it('accepts legitimately branded parameterized / static / trusted / identifier / keyword statements', () => {
    expect(validateManagedSqlStatement(stampParameterizedSql({})).ok).toBe(true);
    expect(validateManagedSqlStatement(stampStaticSql({})).ok).toBe(true);
    expect(validateManagedSqlStatement(stampTrustedSql({}, 'audited report clause')).ok).toBe(true);
    expect(validateManagedSqlStatement(stampSqlIdentifier({})).ok).toBe(true);
    expect(validateManagedSqlStatement(stampSqlKeyword({})).ok).toBe(true);
  });

  it('preserves raw SQL chunk metadata across later SQL brands', () => {
    const raw = {};
    stampRawSqlChunk(raw);
    stampStaticSql(raw);

    expect(validateManagedSqlStatement(raw)).toMatchObject({ ok: false });
    expect(validateManagedSqlStatement(stampTrustedSql(raw, 'audited report clause'))).toEqual({
      ok: true,
    });
  });

  it('snapshots branded queryChunks into immutable executable statement text', () => {
    const statement = stampParameterizedSql({
      queryChunks: [{ value: ['select * from products where id = '] }, 'p1'],
      values: ['p1'],
    });
    const snapshot = snapshotManagedSqlStatement(statement, 'postgres');
    expect(snapshot.ok).toBe(true);
    if (!snapshot.ok) return;
    expect(snapshot.statement).toMatchObject({
      dialect: 'postgres',
      provenance: 'branded-query-chunks',
      text: 'select * from products where id = $1',
      values: ['p1'],
    });
  });

  it('does not treat structurally frozen objects as framework-owned ManagedSqlStatement values', () => {
    const forged = Object.freeze({
      dialect: 'postgres',
      provenance: 'plain-separated-carrier',
      text: 'select 1',
      values: Object.freeze([]),
    });
    expect(isManagedSqlStatement(forged)).toBe(false);
    expect(snapshotManagedSqlStatement(forged).ok).toBe(false);
  });

  it('rejects accessor-backed separated carrier properties before validation/execution identity can drift', () => {
    let textReads = 0;
    const result = validateManagedSqlStatement({
      get text() {
        textReads += 1;
        return textReads === 1
          ? 'select * from products where id = $1'
          : 'delete from products where id = $1';
      },
      values: ['p1'],
    });
    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/accessor\/proxy .*\.text/);
    expect(textReads).toBe(0);
  });

  it('snapshots proxy data descriptors exactly once before validation', () => {
    let descriptorReads = 0;
    const carrier = new Proxy(
      {},
      {
        getOwnPropertyDescriptor(_target, prop) {
          descriptorReads += 1;
          if (prop === 'text') {
            return {
              configurable: true,
              enumerable: true,
              value:
                descriptorReads === 1
                  ? 'select * from products where id = $1'
                  : 'delete from products where id = $1',
              writable: true,
            };
          }
          if (prop === 'values') {
            return {
              configurable: true,
              enumerable: true,
              value: ['p1'],
              writable: true,
            };
          }
          return undefined;
        },
      },
    );
    const snapshot = snapshotManagedSqlStatement(carrier, 'postgres');
    expect(snapshot.ok).toBe(true);
    if (!snapshot.ok) return;
    expect(snapshot.statement.text).toBe('select * from products where id = $1');
    expect(snapshot.statement.values).toEqual(['p1']);
  });

  it('accepts a branded parameterized carrier even when it also exposes a .text string', () => {
    // Legitimate Drizzle-shaped objects can carry both a brand and a `.text`; the brand check runs
    // first, so the assembled-text rejection never fires for a properly branded statement.
    expect(validateManagedSqlStatement(stampParameterizedSql({ text: 'select 1' })).ok).toBe(true);
  });

  it('rejects unbranded object-shaped Drizzle/native SQL values by default', () => {
    const result = validateManagedSqlStatement({ queryChunks: [], getSQL() {} });
    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/unbranded object-shaped SQL/);
  });
});
