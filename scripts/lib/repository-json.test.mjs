import { describe, expect, it, vi } from 'vitest';

import { formatRepositoryJson } from './repository-json.mjs';

describe('repository JSON formatter', () => {
  it('emits the exact formatter-clean JSON layout used by vp check', async () => {
    await expect(
      formatRepositoryJson('evidence.json', {
        nested: { values: ['first', 'second'] },
      }),
    ).resolves.toBe('{\n  "nested": {\n    "values": ["first", "second"]\n  }\n}\n');
  });

  it('fails closed on formatter errors or semantic drift', async () => {
    await expect(
      formatRepositoryJson(
        'evidence.json',
        {},
        {
          format: vi.fn(async () => ({ code: '{}\n', errors: [{ message: 'parse failed' }] })),
        },
      ),
    ).rejects.toThrow('parse failed');
    await expect(
      formatRepositoryJson(
        'evidence.json',
        { safe: true },
        {
          format: vi.fn(async () => ({ code: '{"safe":false}\n', errors: [] })),
        },
      ),
    ).rejects.toThrow('changed the value');
  });

  it('rejects formatter output that is not a byte-stable fixed point', async () => {
    let pass = 0;
    await expect(
      formatRepositoryJson(
        'evidence.json',
        {},
        {
          format: vi.fn(async () => ({
            code: pass++ === 0 ? '{}\n' : '{ }\n',
            errors: [],
          })),
        },
      ),
    ).rejects.toThrow('not a byte-stable fixed point');
  });
});
