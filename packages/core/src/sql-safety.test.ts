import { describe, expect, it } from 'vitest';

import {
  isDbAdapterLike,
  isPreparedStatementExecutionMethod,
  isSqlHandleLike,
  isSqlHandleProperty,
  stampParameterizedSql,
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
    expect(isSqlHandleLike({ exec() {}, query() {}, transaction() {} })).toBe(true);
    expect(isDbAdapterLike({ client: { execute() {} } })).toBe(true);
    expect(isDbAdapterLike({ pglite: { query() {} } })).toBe(true);
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
    const injection = "1; drop table products; --";
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

  it('accepts a genuinely separated { text, values } carrier', () => {
    expect(
      validateManagedSqlStatement({
        text: 'select * from products where status = $1',
        values: ['open'],
      }).ok,
    ).toBe(true);
  });

  it('accepts legitimately branded parameterized / static / trusted statements', () => {
    expect(validateManagedSqlStatement(stampParameterizedSql({})).ok).toBe(true);
    expect(validateManagedSqlStatement(stampStaticSql({})).ok).toBe(true);
    expect(validateManagedSqlStatement(stampTrustedSql({}, 'audited report clause')).ok).toBe(true);
  });

  it('accepts a branded parameterized carrier even when it also exposes a .text string', () => {
    // Legitimate Drizzle-shaped objects can carry both a brand and a `.text`; the brand check runs
    // first, so the assembled-text rejection never fires for a properly branded statement.
    expect(validateManagedSqlStatement(stampParameterizedSql({ text: 'select 1' })).ok).toBe(true);
  });

  it('still accepts unbranded object-shaped Drizzle builders (no .text/.sql string)', () => {
    expect(validateManagedSqlStatement({ queryChunks: [], getSQL() {} }).ok).toBe(true);
  });
});
