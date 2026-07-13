import { spawnSync } from 'node:child_process';

import { stampTrustedSql } from '@kovojs/core/internal/sql-safety';
import { describe, expect, it } from 'vitest';

import { managedSqlParserAuthorityInstallCapability } from './sql-parser-authority-install-capability.js';
import { managedSqlExecutionPolicy, wrapManagedDbForSqlSafety } from './sql-safe-handle.js';
import {
  classifyStatement,
  installManagedSqlParserAuthority,
  sealManagedSqlParserAuthorityRegistry,
} from './sql-write-allowlist.js';

describe('managed SQL parser authority registry', () => {
  it('defaults denied, rejects forged installation, and seals before managed execution', () => {
    expect(() => installManagedSqlParserAuthority(Symbol('forged'), () => [])).toThrow(
      /install capability is invalid/u,
    );

    expect(classifyStatement('SELECT 1', { dialect: 'postgres' })).toEqual({
      kind: 'unproven',
      reason: 'managed SQL parser authority is unavailable on this runtime',
    });

    const driverCalls: string[] = [];
    const handle = wrapManagedDbForSqlSafety(
      {
        run(statement: unknown) {
          driverCalls.push('run');
          return statement;
        },
      },
      undefined,
      managedSqlExecutionPolicy({
        capability: 'write',
        dialect: 'postgres',
        tables: ['allowed_accounts'],
        touches: ['allowedAccount'],
      }),
    ) as { run(statement: unknown): unknown };
    const statement = stampTrustedSql(
      { text: "UPDATE victim_accounts SET role = 'admin'", values: [] },
      'missing parser authority default-deny regression',
    );

    expect(() => handle.run(statement)).toThrow(
      /KV406[\s\S]*managed SQL parser authority is unavailable/u,
    );
    expect(driverCalls).toEqual([]);

    sealManagedSqlParserAuthorityRegistry();
    expect(() =>
      installManagedSqlParserAuthority(managedSqlParserAuthorityInstallCapability, () => []),
    ).toThrow(/authority registry is sealed/u);
  });

  it('keeps internal/execution neutral and routes managed DB through its readiness subpath', () => {
    const script = `
      const { existsSync } = await import('node:fs');
      const { registerHooks } = await import('node:module');
      registerHooks({
        resolve(specifier, context, nextResolve) {
          if (specifier.startsWith('.') && specifier.endsWith('.js') && context.parentURL) {
            const candidate = new URL(specifier.replace(/\\.js$/, '.ts'), context.parentURL);
            if (existsSync(candidate)) return nextResolve(candidate.href, context);
          }
          return nextResolve(specifier, context);
        },
      });
      const execution = await import('@kovojs/server/internal/execution');
      if ('managedDb' in execution || 'createFrameworkManagedSqlDispatchProxy' in execution) {
        process.exit(2);
      }
      await import('@kovojs/server/internal/managed-db');
      const classifier = await import(new URL('./src/sql-write-allowlist.ts', import.meta.url));
      const verdict = classifier.classifyStatement(
        "UPDATE allowed_accounts SET role = 'member'",
        { dialect: 'postgres' },
      );
      process.exit(
        verdict.kind === 'proven-unsafe' && verdict.detail[0] === 'allowed_accounts' ? 0 : 3,
      );
    `;
    const result = spawnSync(
      process.execPath,
      [
        '--disable-warning=ExperimentalWarning',
        '--experimental-transform-types',
        '--input-type=module',
        '--eval',
        script,
      ],
      { cwd: new URL('../', import.meta.url), encoding: 'utf8' },
    );

    expect(result.stderr).toBe('');
    expect(result.status).toBe(0);
  });
});
