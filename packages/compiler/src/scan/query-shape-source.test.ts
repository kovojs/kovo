import { describe, expect, it } from 'vitest';

import {
  mergeQueryShapeFactSets,
  outputSchemaQueryShapeFactsFromProject,
  outputSchemaQueryShapeFactsFromSource,
} from './query-shape-source.js';

describe('non-Drizzle query output schema identity recognition', () => {
  it('does not redispatch query-shape authority through late exact Array.map receivers', () => {
    const primary = [
      {
        query: 'account',
        shape: { token: { kind: 'secret' as const, shape: 'string' as const } },
        source: 'drizzle-analysis',
      },
    ];
    const secondary = [
      {
        query: 'account',
        shape: { token: 'string' as const },
        source: 'output-schema',
      },
    ];
    const forged = [
      {
        query: 'account',
        shape: { token: 'string' as const },
        source: 'forged-public-shape',
      },
    ];
    const nativeMap = Array.prototype.map;
    const nativeApply = Reflect.apply;
    let poisonHits = 0;
    let merged!: ReturnType<typeof mergeQueryShapeFactSets>;
    try {
      Array.prototype.map = function poisonedQueryShapeMap(this: any[], callback, thisArg) {
        if (this === primary) {
          poisonHits += 1;
          return forged;
        }
        return nativeApply(nativeMap, this, [callback, thisArg]);
      } as typeof Array.prototype.map;
      merged = mergeQueryShapeFactSets(primary, secondary);
    } finally {
      Array.prototype.map = nativeMap;
    }

    expect(poisonHits).toBe(0);
    expect(merged).toEqual([
      expect.objectContaining({
        query: 'account',
        shape: { token: { kind: 'secret', shape: 'string' } },
      }),
    ]);
  });

  it('does not let a late source-array map omit output-schema facts', () => {
    const files = [
      {
        fileName: 'queries.ts',
        source: `
import { query, s } from '@kovojs/server';
export const account = query({
  output: s.object({ name: s.string() }),
  load: () => ({ name: 'Ada' }),
});
`,
      },
    ];
    const nativeMap = Array.prototype.map;
    const nativeApply = Reflect.apply;
    let poisonHits = 0;
    let facts!: ReturnType<typeof outputSchemaQueryShapeFactsFromProject>;
    try {
      Array.prototype.map = function poisonedQuerySourceMap(this: any[], callback, thisArg) {
        if (this === files) {
          poisonHits += 1;
          return [];
        }
        return nativeApply(nativeMap, this, [callback, thisArg]);
      } as typeof Array.prototype.map;
      facts = outputSchemaQueryShapeFactsFromProject(files);
    } finally {
      Array.prototype.map = nativeMap;
    }

    expect(poisonHits).toBe(0);
    expect(facts).toEqual([
      expect.objectContaining({ query: 'account', shape: { name: 'string' } }),
    ]);
  });

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

  it('extracts output schemas through root and data-subpath aliases from the shared catalog', () => {
    const facts = outputSchemaQueryShapeFactsFromSource(
      'queries.ts',
      `
import { query as rootQuery, s as rootSchema } from '@kovojs/server';
import { query as dataQuery, s as dataSchema } from '@kovojs/server/api/data';

const defineRoot = rootQuery;
const defineData = dataQuery;
const sr = rootSchema;
const sd = dataSchema;

export const fromRoot = defineRoot({
  output: sr.object({ name: sr.string() }),
  load: () => ({ name: 'Desk' }),
});

export const fromData = defineData({
  output: sd.object({ total: sd.number() }),
  load: () => ({ total: 1 }),
});
`,
    );

    expect(facts).toHaveLength(2);
    expect(facts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ query: 'fromData', shape: { total: 'number' } }),
        expect.objectContaining({ query: 'fromRoot', shape: { name: 'string' } }),
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
