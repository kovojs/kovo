import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import * as serverRoot from '@kovojs/server';
import { pgTable, text } from 'drizzle-orm/pg-core';
import { describe, expect, it } from 'vitest';

import {
  __testPostgresRuntimeInternals,
  postgresAppRuntimeOptions,
  type KovoPostgresAppRuntimeOptions,
} from './postgres-runtime.js';

const runtimeRows = pgTable('kovo_runtime_options_rows', {
  id: text('id').primaryKey(),
});
const replacementRows = pgTable('kovo_runtime_options_replacement_rows', {
  id: text('id').primaryKey(),
});

describe('postgresAppRuntimeOptions', () => {
  it('returns an immutable null-prototype carrier backed by the original private snapshot', () => {
    const schema: Record<string, unknown> = { runtimeRows };
    const seedSql = ["INSERT INTO kovo_runtime_options_rows (id) VALUES ('original')"];
    const source: KovoPostgresAppRuntimeOptions = {
      crossOwnerReadTables: ['kovo_runtime_options_rows'],
      dataDir: '.kovo/original-runtime-options',
      driver: 'pglite',
      schema,
      seedSql,
    };
    const carrier = postgresAppRuntimeOptions(source);

    expect(serverRoot.postgresAppRuntimeOptions).toBe(postgresAppRuntimeOptions);
    expect(Object.getPrototypeOf(carrier)).toBe(null);
    expect(Object.isFrozen(carrier)).toBe(true);
    expect(Object.getPrototypeOf(carrier.schema)).toBe(null);
    expect(Object.isFrozen(carrier.schema)).toBe(true);
    expect(Object.isFrozen(carrier.seedSql)).toBe(true);
    expect(Object.isFrozen(carrier.crossOwnerReadTables)).toBe(true);

    schema.runtimeRows = replacementRows;
    seedSql[0] = "INSERT INTO kovo_runtime_options_rows (id) VALUES ('attacker')";
    (source.crossOwnerReadTables as string[])[0] = 'attacker_table';
    source.dataDir = '.kovo/attacker-runtime-options';
    source.driver = 'pg';
    source.schema = { replacementRows };
    source.seedSql = ['attacker'];
    expect(Reflect.set(carrier, 'driver', 'pg')).toBe(false);
    expect(Reflect.set(carrier.schema, 'runtimeRows', replacementRows)).toBe(false);

    const consumed = __testPostgresRuntimeInternals.resolvePostgresRuntimeConfig(carrier);
    expect(consumed.dataDir).toBe('.kovo/original-runtime-options');
    expect(consumed.driver).toBe('pglite');
    expect(consumed.schema).toEqual({ runtimeRows });
    expect(consumed.seedSql).toEqual([
      "INSERT INTO kovo_runtime_options_rows (id) VALUES ('original')",
    ]);
    expect([...consumed.crossOwnerReadTables]).toEqual(['kovo_runtime_options_rows']);
  });

  it('rejects option/schema accessors and Proxies before hostile traps', () => {
    let optionProxyTraps = 0;
    const optionProxy = new Proxy(
      { schema: { runtimeRows } },
      {
        ownKeys() {
          optionProxyTraps += 1;
          return ['schema'];
        },
      },
    );
    expect(() => postgresAppRuntimeOptions(optionProxy)).toThrow(
      /Postgres app runtime options must not be a Proxy/u,
    );
    expect(optionProxyTraps).toBe(0);

    let optionAccessorHits = 0;
    const optionAccessor = Object.defineProperty({}, 'schema', {
      enumerable: true,
      get() {
        optionAccessorHits += 1;
        return { runtimeRows };
      },
    });
    expect(() =>
      postgresAppRuntimeOptions(optionAccessor as KovoPostgresAppRuntimeOptions),
    ).toThrow(/Postgres app runtime options properties must be own data/u);
    expect(optionAccessorHits).toBe(0);

    let schemaProxyTraps = 0;
    const schemaProxy = new Proxy(
      { runtimeRows },
      {
        ownKeys() {
          schemaProxyTraps += 1;
          return ['runtimeRows'];
        },
      },
    );
    expect(() => postgresAppRuntimeOptions({ schema: schemaProxy })).toThrow(
      /Postgres app runtime schema must not be a Proxy/u,
    );
    expect(schemaProxyTraps).toBe(0);

    let seedAccessorHits = 0;
    const accessorSeed = ['safe'];
    Object.defineProperty(accessorSeed, 0, {
      configurable: true,
      enumerable: true,
      get() {
        seedAccessorHits += 1;
        return 'attacker';
      },
    });
    expect(() =>
      postgresAppRuntimeOptions({ schema: { runtimeRows }, seedSql: accessorSeed }),
    ).toThrow(/Postgres app runtime seedSql must contain dense own data elements/u);
    expect(seedAccessorHits).toBe(0);
  });

  it('rejects every Proxy-backed option array before the first trap', () => {
    for (const key of ['crossOwnerReadTables', 'publicRelations', 'seedSql'] as const) {
      let trapHits = 0;
      const value = new Proxy(['safe'], {
        getOwnPropertyDescriptor(target, property) {
          trapHits += 1;
          return Reflect.getOwnPropertyDescriptor(target, property);
        },
      });
      expect(() =>
        postgresAppRuntimeOptions({
          schema: { runtimeRows },
          [key]: value,
        } as unknown as KovoPostgresAppRuntimeOptions),
      ).toThrow(new RegExp(`Postgres app runtime ${key} must not be a Proxy`, 'u'));
      expect(trapHits).toBe(0);
    }
  });

  it('rejects symbols and unknown own option keys', () => {
    expect(() =>
      postgresAppRuntimeOptions({
        schema: { runtimeRows },
        typoSeed: 'attacker',
      } as unknown as KovoPostgresAppRuntimeOptions),
    ).toThrow(/does not accept option typoSeed/u);

    const symbolOption = { schema: { runtimeRows } } as Record<PropertyKey, unknown>;
    symbolOption[Symbol('attacker')] = true;
    expect(() => postgresAppRuntimeOptions(symbolOption as KovoPostgresAppRuntimeOptions)).toThrow(
      /does not accept option Symbol\(attacker\)/u,
    );
  });

  it('uses the boot-pinned freeze after a same-file ambient replacement', () => {
    const originalFreeze = Object.freeze;
    let poisonHits = 0;
    let carrier: Readonly<KovoPostgresAppRuntimeOptions> | undefined;
    try {
      Object.freeze = ((value: object) => {
        poisonHits += 1;
        return value;
      }) as typeof Object.freeze;
      carrier = postgresAppRuntimeOptions({
        schema: { runtimeRows },
        seedSql: ['safe'],
      });
    } finally {
      Object.freeze = originalFreeze;
    }

    expect(poisonHits).toBe(0);
    expect(Object.isFrozen(carrier)).toBe(true);
    expect(Object.isFrozen(carrier?.schema)).toBe(true);
    expect(Object.isFrozen(carrier?.seedSql)).toBe(true);
  });

  it('survives an ordered app side effect that replaces Object.freeze after root bootstrap', () => {
    const result = runOrderedFreezePoisonChild();
    expect(result.status, result.stderr).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual({
      carrierFrozen: true,
      carrierPrototypeIsNull: true,
      freezePoisonHits: 0,
      schemaFrozen: true,
      schemaValueStayedPinned: true,
      seedFrozen: true,
      seedValueStayedPinned: true,
    });
  });
});

function runOrderedFreezePoisonChild() {
  const root = mkdtempSync(join(tmpdir(), 'kovo-postgres-options-freeze-poison-'));
  try {
    const hooksPath = join(root, 'hooks.mjs');
    const poisonPath = join(root, 'poison.mjs');
    const entryPath = join(root, 'entry.mjs');
    writeFileSync(
      hooksPath,
      `
import { existsSync } from 'node:fs';
import { registerHooks } from 'node:module';
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith('.') && specifier.endsWith('.js') && context.parentURL) {
      const candidate = new URL(specifier.replace(/\\.js$/, '.ts'), context.parentURL);
      if (existsSync(candidate)) return nextResolve(candidate.href, context);
    }
    return nextResolve(specifier, context);
  },
});
`,
    );
    writeFileSync(
      poisonPath,
      `
globalThis.__kovoOriginalFreeze = Object.freeze;
globalThis.__kovoFreezePoisonHits = 0;
Object.freeze = (value) => {
  globalThis.__kovoFreezePoisonHits += 1;
  return value;
};
`,
    );
    const indexUrl = pathToFileURL(fileURLToPath(new URL('./index.ts', import.meta.url))).href;
    writeFileSync(
      entryPath,
      `
import { postgresAppRuntimeOptions } from ${JSON.stringify(indexUrl)};
import './poison.mjs';

const schema = { proof: { pinned: true } };
const seedSql = ['pinned-seed'];
const carrier = postgresAppRuntimeOptions({ schema, seedSql });
schema.proof = { pinned: false };
seedSql[0] = 'attacker-seed';
const output = {
  carrierFrozen: Object.isFrozen(carrier),
  carrierPrototypeIsNull: Object.getPrototypeOf(carrier) === null,
  freezePoisonHits: globalThis.__kovoFreezePoisonHits,
  schemaFrozen: Object.isFrozen(carrier.schema),
  schemaValueStayedPinned: carrier.schema.proof.pinned === true,
  seedFrozen: Object.isFrozen(carrier.seedSql),
  seedValueStayedPinned: carrier.seedSql[0] === 'pinned-seed',
};
Object.freeze = globalThis.__kovoOriginalFreeze;
process.stdout.write(JSON.stringify(output));
`,
    );
    return spawnSync(
      process.execPath,
      [
        '--disable-warning=ExperimentalWarning',
        '--experimental-transform-types',
        '--import',
        hooksPath,
        entryPath,
      ],
      { cwd: root, encoding: 'utf8' },
    );
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
}
