import { describe, expect, it } from 'vitest';

import {
  isDbAdapterLike,
  isPreparedStatementExecutionMethod,
  isSqlHandleLike,
  isSqlHandleProperty,
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
