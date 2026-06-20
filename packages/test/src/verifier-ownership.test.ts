import { describe, expect, it } from 'vitest';

import { assertOwnerRowsScoped } from './verifier.js';

describe('assertOwnerRowsScoped (SPEC §11.2 runtime KV414 cross-check)', () => {
  it('passes when every returned owner row belongs to the session principal', () => {
    expect(() =>
      assertOwnerRowsScoped({
        domain: 'order',
        ownerColumn: 'userId',
        principal: 'u1',
        rows: [
          { id: 'o1', userId: 'u1' },
          { id: 'o2', userId: 'u1' },
        ],
      }),
    ).not.toThrow();
  });

  it('throws a runtime KV414 when a returned row is owned by another principal (IDOR)', () => {
    expect(() =>
      assertOwnerRowsScoped({
        domain: 'order',
        ownerColumn: 'userId',
        principal: 'u1',
        rows: [
          { id: 'o1', userId: 'u1' },
          // a branch-hidden / smuggled read leaked another principal's row:
          { id: 'o2', userId: 'u2' },
        ],
      }),
    ).toThrow(/KV414 \(runtime §11\.2\).*u2.*not the session principal u1/);
  });

  it('passes on an empty result set', () => {
    expect(() =>
      assertOwnerRowsScoped({ domain: 'order', ownerColumn: 'userId', principal: 'u1', rows: [] }),
    ).not.toThrow();
  });
});
