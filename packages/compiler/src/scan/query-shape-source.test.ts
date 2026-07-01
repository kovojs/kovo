import { describe, expect, it } from 'vitest';

import {
  outputSchemaQueryShapeFactsFromProject,
  outputSchemaQueryShapeFactsFromSource,
} from './query-shape-source.js';

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

export const audit = data.query({
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

  it('extracts schemas through local re-export barrels and schema namespace aliases', () => {
    const facts = outputSchemaQueryShapeFactsFromProject([
      {
        fileName: 'barrel.ts',
        source: "export { query, s as schema } from '@kovojs/server';\n",
      },
      {
        fileName: 'queries.jsx',
        source: `
import { query, schema } from './barrel';
import * as framework from './barrel';

export const status = query({
  output: schema.object({ summary: schema.string() }),
  reads: [],
  load: () => ({ summary: 'ready' }),
});

export const audit = framework.query({
  output: framework.schema.object({ ok: framework.schema.boolean() }),
  reads: [],
  load: () => ({ ok: true }),
});
`,
      },
    ]);

    expect(facts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ query: 'audit', shape: { ok: 'boolean' } }),
        expect.objectContaining({ query: 'status', shape: { summary: 'string' } }),
      ]),
    );
  });

  it('keeps local shadows from inheriting barrel schema identity', () => {
    expect(
      outputSchemaQueryShapeFactsFromProject([
        {
          fileName: 'barrel.ts',
          source: "export { query, s } from '@kovojs/server';\n",
        },
        {
          fileName: 'queries.ts',
          source: `
import { query } from './barrel';
const s = { object: (value) => value, string: () => 'not-schema' };
export const status = query({
  output: s.object({ summary: s.string() }),
  reads: [],
  load: () => ({ summary: 'ready' }),
});
`,
        },
      ]),
    ).toEqual([]);
  });
});
