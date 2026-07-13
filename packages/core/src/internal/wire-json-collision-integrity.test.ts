import { describe, expect, it } from 'vitest';

import { parseWireJsonValue, stringifyWireValue } from './wire-json.js';

describe('tagged wire JSON collision integrity', () => {
  it('round-trips exact app records that collide with framework wire tags', () => {
    const cases = [
      { $kovo: 'bigint', value: '42' },
      { $kovo: 'date', value: '2020-01-01T00:00:00.000Z' },
      {
        $kovo: 'record',
        value: [
          ['$kovo', 'bigint'],
          ['value', '42'],
        ],
      },
      { nested: { $kovo: 'bigint', value: '9007199254740993' } },
    ];

    for (const appRecord of cases) {
      const encoded = stringifyWireValue(appRecord);
      expect(parseWireJsonValue(encoded)).toEqual({ ok: true, value: appRecord });
    }
  });

  it('continues to revive framework-minted bigint and date values', () => {
    const encoded = stringifyWireValue({ at: new Date('2020-01-01T00:00:00.000Z'), id: 42n });
    const decoded = parseWireJsonValue(encoded);

    expect(decoded.ok).toBe(true);
    if (!decoded.ok) return;
    expect(decoded.value).toEqual({ at: new Date('2020-01-01T00:00:00.000Z'), id: 42n });
  });
});
