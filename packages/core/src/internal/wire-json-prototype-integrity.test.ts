import { expect, it } from 'vitest';

import { parseWireJsonValue } from './wire-json.js';

it('ignores inherited wire tags when reviving ordinary server records', () => {
  const prior = Object.getOwnPropertyDescriptor(Object.prototype, '$kovo');
  let reads = 0;
  let parsed: ReturnType<typeof parseWireJsonValue> | undefined;
  try {
    Object.defineProperty(Object.prototype, '$kovo', {
      configurable: true,
      get() {
        reads += 1;
        return 'date';
      },
    });
    parsed = parseWireJsonValue('{"value":"2020-01-01T00:00:00.000Z","role":"member"}');
  } finally {
    if (prior === undefined) delete (Object.prototype as { $kovo?: unknown }).$kovo;
    else Object.defineProperty(Object.prototype, '$kovo', prior);
  }

  expect(reads).toBe(0);
  expect(parsed).toEqual({
    ok: true,
    value: { role: 'member', value: '2020-01-01T00:00:00.000Z' },
  });
});
