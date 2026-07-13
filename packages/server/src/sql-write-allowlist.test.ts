import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { describe, expect, it } from 'vitest';

import './sql-parser-authority-bootstrap.js';
import { parseWithIsolatedSqlParser } from './sql-parser-authority.js';
import {
  classifyStatement,
  parseSqlWriteTables,
  UNTABLED_SQL_WRITE,
} from './sql-write-allowlist.js';

const sqlWriteAllowlistModuleUrl = pathToFileURL(
  join(import.meta.dirname, 'sql-write-allowlist.ts'),
).href;

describe('isolated managed SQL parser authority', () => {
  it('does not retain malformed SQL literals in classifier diagnostics', () => {
    const secret = 'kovo-secret-literal-do-not-retain';
    const verdict = classifyStatement(`SELECT '${secret}`);

    expect(verdict).toEqual({
      kind: 'unproven',
      reason: 'SQL parser could not prove statement safety: parser rejected the statement',
    });
    expect(JSON.stringify(verdict)).not.toContain(secret);
    expect(JSON.stringify(verdict)).not.toMatch(/[\r\n]/u);
  });

  it('rejects oversized SQL before private-realm parser work', () => {
    expect(() => parseWithIsolatedSqlParser(' '.repeat(262_145))).toThrow(/parser input limit/u);
  });

  it('bounds AST depth, list length, and string length', () => {
    expect(() => parseWithIsolatedSqlParser(`SELECT 1 WHERE ${'NOT '.repeat(100)}TRUE`)).toThrow(
      /AST exceeds the depth limit/u,
    );

    expect(() =>
      parseWithIsolatedSqlParser(`SELECT ${new Array<string>(16_385).fill('1').join(',')}`),
    ).toThrow(/AST list exceeds the length limit/u);

    expect(() => parseWithIsolatedSqlParser(`SELECT '${'x'.repeat(131_073)}'`)).toThrow(
      /AST string exceeds the length limit/u,
    );
  });

  it('bounds aggregate AST snapshot work', () => {
    const rows = new Array<string>(11_000).fill('(1,1)').join(',');
    expect(() => parseWithIsolatedSqlParser(`VALUES ${rows}`)).toThrow(
      /AST exceeds the (?:key budget|node limit|list-entry budget)/u,
    );
  });
});

describe('parseSqlWriteTables', () => {
  it('binds the SQL parser before late resolver hooks can replace classifier truth', () => {
    const root = mkdtempSync(join(tmpdir(), 'kovo-sql-parser-authority-'));
    const forgedParser = join(root, 'forged-parser.cjs');
    writeFileSync(forgedParser, 'module.exports = { parse() { return []; } };\n', 'utf8');
    const script = `
      const { existsSync } = await import('node:fs');
      const { registerHooks } = await import('node:module');
      const { pathToFileURL } = await import('node:url');
      registerHooks({
        resolve(specifier, context, nextResolve) {
          if (specifier.startsWith('.') && specifier.endsWith('.js') && context.parentURL) {
            const candidate = new URL(specifier.replace(/\\.js$/, '.ts'), context.parentURL);
            if (existsSync(candidate)) return nextResolve(candidate.href, context);
          }
          return nextResolve(specifier, context);
        },
      });
      await import(new URL('./sql-parser-authority-bootstrap.ts', ${JSON.stringify(
        sqlWriteAllowlistModuleUrl,
      )}));
      const classifier = await import(${JSON.stringify(sqlWriteAllowlistModuleUrl)});
      let poisonHits = 0;
      registerHooks({
        resolve(specifier, context, nextResolve) {
          if (specifier === 'pgsql-ast-parser') {
            poisonHits += 1;
            return nextResolve(pathToFileURL(${JSON.stringify(forgedParser)}).href, context);
          }
          return nextResolve(specifier, context);
        },
      });
      const targets = classifier.parseSqlWriteTables(
        "UPDATE victim_accounts SET role = 'admin'",
        { dialect: 'postgres' },
      );
      process.exit(
        poisonHits === 0 && targets.length === 1 && targets[0] === 'victim_accounts' ? 0 : 3,
      );
    `;
    try {
      const result = spawnSync(
        process.execPath,
        ['--experimental-transform-types', '--input-type=module', '--eval', script],
        { encoding: 'utf8' },
      );
      expect(result.stderr).toBe('');
      expect(result.status).toBe(0);
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  });

  it('keeps DML write table extraction precise', () => {
    expect(parseSqlWriteTables('DELETE FROM contacts', { dialect: 'sqlite' })).toEqual([
      'contacts',
    ]);
  });

  it.each([
    'DROP TABLE contacts',
    'ALTER TABLE contacts ADD COLUMN nickname text',
    'CREATE TABLE contacts (id text)',
    'CREATE INDEX contacts_id_idx ON contacts(id)',
    'REFRESH MATERIALIZED VIEW contacts_cache',
    'DROP INDEX contacts_id_idx',
    'CREATE VIEW contact_names AS SELECT name FROM contacts',
    "DO $$ BEGIN RAISE NOTICE 'x'; END $$;",
    'PRAGMA user_version = 1',
    'VACUUM',
    'REINDEX',
    "ATTACH DATABASE 'tenant.db' AS tenant",
  ])('classifies untableable statements as writes: %s', (sql) => {
    expect(parseSqlWriteTables(sql, { dialect: 'sqlite' })).toEqual([UNTABLED_SQL_WRITE]);
  });

  it('keeps positively proven reads empty', () => {
    expect(parseSqlWriteTables('SELECT id FROM contacts', { dialect: 'sqlite' })).toEqual([]);
  });

  it('fails closed for read-shaped statements with unproven SQL function calls', () => {
    expect(parseSqlWriteTables("SELECT setval('probe_seq', 1)", { dialect: 'postgres' })).toEqual([
      UNTABLED_SQL_WRITE,
    ]);
    expect(parseSqlWriteTables("SELECT nextval('probe_seq')", { dialect: 'postgres' })).toEqual([
      UNTABLED_SQL_WRITE,
    ]);
  });

  it('fails closed when a declared-table write masks an unproven SQL function call', () => {
    expect(
      classifyStatement("update contacts set name = user_mutate(name) where id = 'c1'", {
        dialect: 'postgres',
      }),
    ).toEqual({
      kind: 'unproven',
      reason: 'SQL write contains non-allowlisted function call(s): user_mutate',
    });

    expect(
      classifyStatement(
        "with bumped as (select setval('probe_seq', 1)) update contacts set name = 'Ada'",
        { dialect: 'postgres' },
      ),
    ).toEqual({
      kind: 'unproven',
      reason: 'SQL read contains non-allowlisted function call(s): setval',
    });
  });

  it('preserves schema-qualified table names for write enforcement', () => {
    expect(
      parseSqlWriteTables('UPDATE otherschema.contacts SET name = ? WHERE id = ?', {
        dialect: 'sqlite',
      }),
    ).toEqual(['otherschema.contacts']);
  });

  it('keeps every TRUNCATE target after selective Array.map replacement', () => {
    // SPEC §6.6 C13/§10.3: the parsed target list is a default-deny authority fact.
    // Index the exact parser-owned snapshot rather than delegating completeness to app code.
    const nativeMap = Array.prototype.map;
    try {
      Array.prototype.map = function <Value, Result>(
        callback: (value: Value, index: number, array: Value[]) => Result,
      ): Result[] {
        if (
          this.length === 2 &&
          (this[0] as { name?: unknown } | undefined)?.name === 'allowed' &&
          (this[1] as { name?: unknown } | undefined)?.name === 'victim_accounts'
        ) {
          return [callback(this[0] as Value, 0, this as Value[])];
        }
        return Reflect.apply(nativeMap, this, [callback]) as Result[];
      };
      expect(
        parseSqlWriteTables('TRUNCATE TABLE allowed, victim_accounts', {
          dialect: 'postgres',
        }),
      ).toEqual(['allowed', 'victim_accounts']);
    } finally {
      Array.prototype.map = nativeMap;
    }
  });

  it('keeps write classification inside the private parser realm after selective Nearley map poisoning', () => {
    const nativeMap = Array.prototype.map;
    let parserMapHits = 0;
    try {
      Array.prototype.map = function <Value, Result>(
        callback: (value: Value, index: number, array: Value[]) => Result,
        thisArg?: unknown,
      ): Result[] {
        const state = this[0] as
          | { data?: { type?: unknown }; rule?: { name?: unknown } }
          | undefined;
        if (this.length === 1 && state?.rule?.name === 'main' && state.data?.type === 'update') {
          parserMapHits += 1;
          return [
            {
              type: 'select',
              columns: [{ expr: { type: 'integer', value: 1 } }],
            } as Result,
          ];
        }
        return Reflect.apply(nativeMap, this, [callback, thisArg]) as Result[];
      };
      expect(
        parseSqlWriteTables("UPDATE victim_accounts SET role = 'admin'", {
          dialect: 'postgres',
        }),
      ).toEqual(['victim_accounts']);
      expect(parserMapHits).toBe(0);
    } finally {
      Array.prototype.map = nativeMap;
    }
  });

  it('keeps data-modifying CTE verdicts after selective Array.push replacement', () => {
    const nativePush = Array.prototype.push;
    try {
      Array.prototype.push = function <Value>(...values: Value[]): number {
        const verdict = values[0] as { kind?: unknown } | undefined;
        if (verdict?.kind === 'proven-unsafe') return this.length;
        return Reflect.apply(nativePush, this, values) as number;
      };
      expect(
        parseSqlWriteTables(
          'WITH deleted AS (DELETE FROM victim_accounts RETURNING id) SELECT id FROM deleted',
          { dialect: 'postgres' },
        ),
      ).toEqual(['victim_accounts']);
    } finally {
      Array.prototype.push = nativePush;
    }
  });

  it('keeps nested data-modifying CTE targets after selective iterator replacement', () => {
    const nativeIterator = Array.prototype[Symbol.iterator];
    let victimIterations = 0;
    try {
      Array.prototype[Symbol.iterator] = function (): ArrayIterator<unknown> {
        if (this.length === 1 && this[0] === 'victim_accounts') {
          victimIterations += 1;
          if (victimIterations === 4) {
            return Reflect.apply(nativeIterator, [], []) as ArrayIterator<unknown>;
          }
        }
        return Reflect.apply(nativeIterator, this, []) as ArrayIterator<unknown>;
      };
      expect(
        parseSqlWriteTables(
          'INSERT INTO allowed WITH deleted AS (DELETE FROM victim_accounts RETURNING id) SELECT id FROM deleted',
          { dialect: 'postgres' },
        ),
      ).toEqual(['allowed', 'victim_accounts']);
      // The parser now runs in a separate realm, so even the parser's own iterations are no longer
      // observable or mutable through the application realm.
      expect(victimIterations).toBe(0);
    } finally {
      Array.prototype[Symbol.iterator] = nativeIterator;
    }
  });
});

describe('classifyStatement', () => {
  it('separates proven reads, proven writes, and unproven function-bearing reads', () => {
    expect(classifyStatement('select now()', { dialect: 'postgres' })).toEqual({
      kind: 'proven-safe',
    });
    expect(classifyStatement('update contacts set name = $1 where id = $2')).toEqual({
      kind: 'proven-unsafe',
      detail: ['contacts'],
    });
    expect(classifyStatement("select setval('probe_seq', 1)", { dialect: 'postgres' })).toEqual({
      kind: 'unproven',
      reason: 'SQL read contains non-allowlisted function call(s): setval',
    });
  });

  it('keeps unqualified unknown and volatile wrappers unproven across generated shapes', () => {
    const cases = generatedFunctionCases(240);
    expect(cases).toHaveLength(240);

    for (const entry of cases) {
      const verdict = classifyStatement(entry.sql, { dialect: 'postgres' });
      expect(verdict.kind, entry.sql).toBe(entry.provenPure ? 'proven-safe' : 'unproven');
    }
  });
});

interface GeneratedFunctionCase {
  provenPure: boolean;
  sql: string;
}

const PURE_CALLS = [
  "lower('Ada')",
  "upper('Ada')",
  'abs(-7)',
  "coalesce(null, 'Ada')",
  "length('Ada')",
  'round(7.25)',
  'now()',
] as const;

const UNKNOWN_CALLS = [
  "setval('probe_seq', 1)",
  "nextval('probe_seq')",
  "user_mutate('Ada')",
  "audit.bump('Ada')",
] as const;

function generatedFunctionCases(count: number): GeneratedFunctionCase[] {
  return Array.from({ length: count }, (_, index) => {
    const provenPure = index % 2 === 0;
    const calls = provenPure ? PURE_CALLS : UNKNOWN_CALLS;
    const call = calls[(index * 17 + 5) % calls.length]!;
    return {
      provenPure,
      sql: wrapFunctionCall(call, index),
    };
  });
}

function wrapFunctionCall(call: string, index: number): string {
  switch (index % 6) {
    case 0:
      return `select ${call}`;
    case 1:
      return `select coalesce((${call})::text, 'fallback')`;
    case 2:
      return `values (${call})`;
    case 3:
      return `with probe as (select ${call} as value) select value from probe`;
    case 4:
      return `select 1 where ${call} is not null`;
    default:
      return `select lower((${call})::text)`;
  }
}
