import { describe, expect, it } from 'vitest';

import { outputSchemaQueryShapeFactsFromSource } from './query-shape-source.js';

describe('non-Drizzle query output schema identity recognition', () => {
  it('extracts output schemas through public data subpath aliases and namespace members', () => {
    const facts = outputSchemaQueryShapeFactsFromSource(
      'queries.ts',
      `
import { query as defineQuery, s as schema } from '@kovojs/server/api/data';
import * as data from '@kovojs/server/api/data';

const q = defineQuery;
const schemaAlias = schema;

export const product = q({
  output: schemaAlias.object({ name: schema.string() }),
  load: () => ({ name: 'Desk' }),
});

export const audit = data.query.elevated({
  output: data.s.object({ ok: data.s.boolean() }),
  reads: [],
  load: () => ({ ok: true }),
});
`,
    );

    expect(facts).toHaveLength(2);
    expect(facts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ query: 'audit', shape: { ok: 'boolean' } }),
        expect.objectContaining({ query: 'product', shape: { name: 'string' } }),
      ]),
    );
  });

  it('does not extract schemas from local query lookalikes', () => {
    expect(
      outputSchemaQueryShapeFactsFromSource(
        'queries.ts',
        `
const s = { object: (value) => value, string: () => 'string' };
function query(value) { return value; }
export const product = query({ output: s.object({ name: s.string() }) });
`,
      ),
    ).toEqual([]);
  });

  it('does not extract schemas from local s lookalikes', () => {
    expect(
      outputSchemaQueryShapeFactsFromSource(
        'queries.ts',
        `
import { query } from '@kovojs/server/api/data';

const s = { object: (value) => value, string: () => 'string' };
export const product = query({ output: s.object({ name: s.string() }) });
`,
      ),
    ).toEqual([]);
  });
});
