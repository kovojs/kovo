import { describe, expect, it } from 'vitest';

import { extractQueryFactsFromProject } from '@kovojs/drizzle/internal/static';
import { pgDatabaseTypes } from './test-helpers.js';

describe('DEC7 off-wire prover fail-closed inversion', () => {
  it('keeps un-analyzable secret binding and accumulator shapes on the wire', () => {
    const variants = Array.from({ length: 200 }, (_, index) => secretLaunderVariant(index));
    const facts = extractQueryFactsFromProject({
      files: [
        pgDatabaseTypes(['select(value?: unknown): { from(table: unknown): Promise<unknown[]> };']),
        {
          fileName: 'src/offwire.generated.queries.ts',
          source: sourceForQueries(variants),
        },
      ],
    });

    const diagnostics = facts.flatMap((fact) =>
      fact.diagnostics.filter((diagnostic) => diagnostic.code === 'KV435'),
    );

    expect(diagnostics).toHaveLength(variants.length);
    expect(diagnostics.map((diagnostic) => diagnostic.message)).toEqual(
      expect.arrayContaining([
        expect.stringContaining('Query projection q0.token reads a secret-classified column'),
        expect.stringContaining('Query projection q1.token reads a secret-classified column'),
        expect.stringContaining('Query projection q2.token reads a secret-classified column'),
        expect.stringContaining('Query projection q3.token reads a secret-classified column'),
      ]),
    );
  }, 180_000);

  it('accepts non-secret literal/map returns and reviewed declareOffWire secret work', () => {
    const facts = extractQueryFactsFromProject({
      files: [
        pgDatabaseTypes(['select(value?: unknown): { from(table: unknown): Promise<unknown[]> };']),
        {
          fileName: 'src/offwire-safe.queries.ts',
          source: sourceForQueries([
            [
              'const rows = await db.select({ id: users.id, name: users.name }).from(users);',
              'return { rows: rows.map((row) => ({ id: row.id, label: row.name, literal: "ok" })) };',
            ].join('\n'),
            [
              'const rows = await db.select({ id: users.id, token: users.token }).from(users);',
              'declareOffWire(() => rows.map((row) => row.token));',
              'return { ok: true, literal: "reviewed" };',
            ].join('\n'),
          ]),
        },
      ],
    });

    expect(facts.flatMap((fact) => fact.diagnostics ?? [])).toEqual([]);
  });
});

function sourceForQueries(loadBodies: readonly string[]): string {
  return [
    'import { declareOffWire } from "@kovojs/core";',
    '',
    'export const users = pgTable("users", {',
    '  id: text("id").primaryKey(),',
    '  name: text("name").notNull(),',
    '  token: text("token").notNull(),',
    '}, kovo({ domain: "user", key: "id", secret: ["token"] }));',
    '',
    ...loadBodies.map((body, index) =>
      [
        `export const q${index} = query("q${index}", {`,
        '  async load(_input, db: PgAsyncDatabase<any, any>) {',
        indent(body, 4),
        '  },',
        '});',
        '',
      ].join('\n'),
    ),
  ].join('\n');
}

function secretLaunderVariant(index: number): string {
  const rows = 'const rows = await db.select({ id: users.id, token: users.token }).from(users);';
  switch (index % 10) {
    case 0:
      return [rows, 'const [first] = rows;', 'return { token: first.token };'].join('\n');
    case 1:
      return [rows, 'const [{ token }] = rows;', 'return { token };'].join('\n');
    case 2:
      return [
        rows,
        'const token = rows.reduce((acc, row) => row.token || acc, "");',
        'return { token };',
      ].join('\n');
    case 3:
      return [rows, 'const token = rows.flatMap((row) => [row.token]);', 'return { token };'].join(
        '\n',
      );
    case 4:
      return [
        rows,
        'const out: Record<string, unknown> = {};',
        'const key = "token";',
        'out[key] = rows[0].token;',
        'return out;',
      ].join('\n');
    case 5:
      return [rows, 'const read = () => rows[0].token;', 'return { token: read() };'].join('\n');
    case 6:
      return [rows, 'const first = rows[0];', 'return { ...first };'].join('\n');
    case 7:
      return [rows, 'const token = Object.values(rows[0])[1];', 'return { token };'].join('\n');
    case 8:
      return [rows, 'const token = rows.map((row) => row.token);', 'return { token };'].join('\n');
    default:
      return [
        rows,
        'const box = { current: "" };',
        'rows.forEach((row) => { box.current = row.token; });',
        'return { token: box.current };',
      ].join('\n');
  }
}

function indent(source: string, spaces: number): string {
  const prefix = ' '.repeat(spaces);
  return source
    .split('\n')
    .map((line) => `${prefix}${line}`)
    .join('\n');
}
