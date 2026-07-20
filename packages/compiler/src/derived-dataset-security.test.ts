// @kovo-security-classifier-corpus finite-security-operation-ir
import { describe, expect, it } from 'vitest';

import { compileComponentModule } from './index.js';

function diagnosticsFor(source: string, code: 'KV449' | 'KV452') {
  return compileComponentModule({
    fileName: 'src/derived-dataset-security.tsx',
    source,
  }).diagnostics.filter((diagnostic) => diagnostic.code === code);
}

const prelude = `
import {
  createFileSystemStorage,
  derived,
  endpoint,
  publicScopedKey,
  task,
} from '@kovojs/server';

const storage = createFileSystemStorage({ root: '/srv/kovo-derived-test' });
const vectorAdapter = {
  async query(_input) { return []; },
  async upsert(_input) {},
};
const vectors = derived(vectorAdapter, { key: 'support-documents', kind: 'vector' });
const background = task('derived/background', { async run() {} });
`;

describe('derived-dataset authorization inheritance (SPEC §6.6/§10.3 C9)', () => {
  // @kovo-security-certifies C13 derived-dataset-persistent-sink-provenance
  it.each([
    [
      'direct storage write',
      `
const rows = await ctx.db.select().from(documents);
await storage.put(publicScopedKey('unsafe-export'), JSON.stringify(rows));
`,
    ],
    [
      'object and JSON transform',
      `
const rows = await ctx.db.query.documents.findMany();
const payload = { records: rows };
await storage.put(publicScopedKey('unsafe-export'), JSON.stringify(payload));
`,
    ],
    [
      'mutable alias',
      `
let rows = await ctx.db.read.findMany(documents);
rows = rows;
await storage.put(publicScopedKey('unsafe-export'), rows);
`,
    ],
    [
      'conditional join',
      `
const rows = await ctx.db.select().from(documents);
const payload = input.include ? rows : [];
await storage.put(publicScopedKey('unsafe-export'), payload);
`,
    ],
    [
      'same-file helper',
      `
const rows = await ctx.db.select().from(documents);
const payload = encodeRows(rows);
await storage.put(publicScopedKey('unsafe-export'), payload);
`,
    ],
    [
      'outbound egress',
      `
const rows = await ctx.db.select().from(documents);
await ctx.fetch('https://vectors.example.test/upsert', {
  body: JSON.stringify(rows),
  method: 'POST',
});
`,
    ],
    [
      'durable task payload',
      `
const rows = await ctx.db.select().from(documents);
await ctx.schedule(background, { rows });
`,
    ],
    [
      'derived read re-persistence',
      `
const rows = await vectors.query(ctx.request, { vector: [1, 2, 3] });
await storage.put(publicScopedKey('unsafe-export'), rows);
`,
    ],
  ])('rejects %s outside the framework-owned derived door', (_label, body) => {
    const diagnostics = diagnosticsFor(
      `${prelude}
const documents = {};
function encodeRows(value) { return JSON.stringify(value); }
export const persist = endpoint('/persist', {
  access: { kind: 'public', reason: 'classifier fixture' },
  async handler(input, ctx) {
    ${body}
    return { ok: true };
  },
});
`,
      'KV452',
    );

    expect(diagnostics, _label).toHaveLength(1);
    expect(diagnostics[0]?.severity).toBe('error');
    expect(diagnostics[0]?.message).toContain(
      'owner-scoped or governed data reaches a persistent non-engine sink',
    );
  });

  it('admits writes only through an exact derived vector dataset and reuses the request scope', () => {
    const source = `${prelude}
const documents = {};
const upsertVectors = vectors.upsert;
export const persist = endpoint('/persist', {
  access: { kind: 'public', reason: 'classifier fixture' },
  async handler(_input, ctx) {
    const rows = await ctx.db.select().from(documents);
    await upsertVectors(ctx.request, rows);
    const matches = await vectors.query(ctx.request, { vector: [1, 2, 3] });
    return { count: matches.length };
  },
});
`;

    expect(diagnosticsFor(source, 'KV452')).toEqual([]);
    expect(diagnosticsFor(source, 'KV449')).toEqual([]);
  });

  it('rejects a forged derived lookalike and a non-request scope carrier', () => {
    const source = `import { forged } from 'foreign-vector-adapter';
${prelude}
const documents = {};
const detachedUpsert = vectors.upsert;
export const persist = endpoint('/persist', {
  access: { kind: 'public', reason: 'classifier fixture' },
  async handler(input, ctx) {
    const rows = await ctx.db.select().from(documents);
    await forged.upsert(ctx.request, rows);
    await vectors.upsert(input.request, rows);
    await detachedUpsert(input.request, rows);
    return { ok: true };
  },
});
`;

    expect(diagnosticsFor(source, 'KV449')).not.toEqual([]);
    expect(diagnosticsFor(source, 'KV452')).toEqual([
      expect.objectContaining({
        code: 'KV452',
        message: expect.stringContaining('exact framework request principal binding'),
      }),
      expect.objectContaining({
        code: 'KV452',
        message: expect.stringContaining('exact framework request principal binding'),
      }),
    ]);
  });

  it('keeps ordinary local data and database reads that are not persisted open', () => {
    const source = `${prelude}
const documents = {};
export const inspect = endpoint('/inspect', {
  access: { kind: 'public', reason: 'classifier fixture' },
  async handler(_input, ctx) {
    await storage.put(publicScopedKey('ordinary'), 'local data');
    const rows = await ctx.db.select().from(documents);
    return { count: rows.length };
  },
});
`;

    expect(diagnosticsFor(source, 'KV452')).toEqual([]);
  });
});
