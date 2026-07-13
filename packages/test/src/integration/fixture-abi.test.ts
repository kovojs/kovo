import { describe, expect, it } from 'vitest';

import { staticSql } from './fixture-abi.js';

describe('@kovojs/test fixture static SQL authority', () => {
  it('keeps tagged SQL literal text exact after tested code replaces Array.join', () => {
    const originalJoin = Array.prototype.join;
    let statement: ReturnType<typeof staticSql> | undefined;

    try {
      Array.prototype.join = () => 'delete from protected_accounts';
      statement = staticSql`select account_id from protected_accounts where account_id = 'safe'`;
    } finally {
      Array.prototype.join = originalJoin;
    }

    expect(statement).toEqual({
      queryChunks: [
        { value: ["select account_id from protected_accounts where account_id = 'safe'"] },
      ],
    });
  });
});
