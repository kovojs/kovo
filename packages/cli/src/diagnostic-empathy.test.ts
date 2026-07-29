import type { DiagnosticCode } from '@kovojs/core/diagnostics';
import { createRegisteredDiagnostic } from '@kovojs/core/internal/diagnostics';
import { describe, expect, it } from 'vitest';

import { devFailureResult, type KovoDevOptions } from './commands/dev.js';
import {
  doctorFindingDiagnostic,
  formatKovoDiagnostics,
  lifecyclePolicyDiagnostic,
  projectKovoDiagnostic,
  type KovoDiagnosticRecord,
  type KovoDiagnosticSourceAnchor,
} from './diagnostic.js';

type AuthoringFamily = 'access' | 'drizzle-data' | 'forms-csrf' | 'optimism' | 'trusted-output';

const TOP_AUTHORING_DIAGNOSTICS = [
  { code: 'KV236', family: 'trusted-output' },
  { code: 'KV242', family: 'forms-csrf' },
  { code: 'KV302', family: 'drizzle-data' },
  { code: 'KV310', family: 'optimism' },
  { code: 'KV311', family: 'optimism' },
  { code: 'KV313', family: 'optimism' },
  { code: 'KV314', family: 'optimism' },
  { code: 'KV402', family: 'drizzle-data' },
  { code: 'KV404', family: 'drizzle-data' },
  { code: 'KV406', family: 'drizzle-data' },
  { code: 'KV414', family: 'access' },
  { code: 'KV418', family: 'forms-csrf' },
  { code: 'KV422', family: 'drizzle-data' },
  { code: 'KV424', family: 'trusted-output' },
  { code: 'KV426', family: 'trusted-output' },
  { code: 'KV429', family: 'drizzle-data' },
  { code: 'KV435', family: 'trusted-output' },
  { code: 'KV436', family: 'access' },
  { code: 'KV438', family: 'drizzle-data' },
  { code: 'KV439', family: 'drizzle-data' },
] as const satisfies readonly { readonly code: DiagnosticCode; readonly family: AuthoringFamily }[];

const SOURCE = Object.freeze({
  end: 29,
  file: 'src/app.tsx',
  start: 17,
}) satisfies KovoDiagnosticSourceAnchor;

describe('G9 diagnostic empathy matrix', () => {
  it('gates the seven first-run classes on one safe cause, config anchor, and next step', () => {
    const sentinel = 'SECRET_SENTINEL_MUST_NOT_RENDER';
    const portError = Object.assign(new Error(`Port 4173 is already in use: ${sentinel}`), {
      code: 'EADDRINUSE',
    });
    const portResult = devFailureResult(portError, devOptions());
    const portDiagnostic = requireDiagnostic(portResult.diagnostics, 'port collision');
    const cases = [
      {
        class: 'missing/invalid origin',
        diagnostic: doctorFindingDiagnostic(
          'KOVO_DOCTOR_ORIGIN',
          'Configured application origin is not a valid URL.',
          envAnchor('KOVO_ORIGIN'),
        ),
      },
      {
        class: 'missing secret',
        diagnostic: doctorFindingDiagnostic(
          'KOVO_DOCTOR_SECRET',
          'Better Auth requires a framework signing secret, but no supported secret is configured.',
          envAnchor('KOVO_CSRF_SECRET'),
        ),
      },
      {
        class: 'missing DB',
        diagnostic: doctorFindingDiagnostic(
          'KOVO_DOCTOR_DATABASE',
          'Database role configuration is incomplete.',
          envAnchor('KOVO_RUNTIME_DATABASE_URL'),
        ),
      },
      {
        class: 'retention not configured',
        diagnostic: doctorFindingDiagnostic(
          'KOVO_DOCTOR_RETENTION',
          'Client-bearing source requires an explicit deploy-skew retention declaration.',
          configAnchor('kovo.config.ts'),
        ),
      },
      { class: 'port collision', diagnostic: portDiagnostic },
      {
        class: 'install refusal',
        diagnostic: lifecyclePolicyDiagnostic(
          'The generated dependency lifecycle allowlist was weakened.',
          packageAnchor('"onlyBuiltDependencies"'),
        ),
      },
      {
        class: 'migration not provisioned',
        diagnostic: doctorFindingDiagnostic(
          'KOVO_DOCTOR_MIGRATIONS',
          'No generated migration directory was found.',
          configAnchor('migrations'),
        ),
      },
    ] as const;

    expect(cases).toHaveLength(7);
    expect(new Set(cases.map((entry) => entry.class)).size).toBe(7);
    expect(new Set(cases.map((entry) => entry.diagnostic.code)).size).toBe(7);

    for (const entry of cases) {
      expectDiagnosticEmpathy(entry.diagnostic);
      expect(entry.diagnostic.help, entry.class).toMatch(/`(?:kovo|pnpm) /u);
      expect(entry.diagnostic.message, entry.class).not.toContain(sentinel);
      expect(entry.diagnostic.help, entry.class).not.toContain(sentinel);
      expect(formatKovoDiagnostics([entry.diagnostic], 'json'), entry.class).not.toContain(
        sentinel,
      );
    }
  });

  it('gates the top 20 authoring diagnostics across the five charter families', () => {
    expect(TOP_AUTHORING_DIAGNOSTICS).toHaveLength(20);
    expect(new Set(TOP_AUTHORING_DIAGNOSTICS.map((entry) => entry.code)).size).toBe(20);
    expect([...new Set(TOP_AUTHORING_DIAGNOSTICS.map((entry) => entry.family))].sort()).toEqual([
      'access',
      'drizzle-data',
      'forms-csrf',
      'optimism',
      'trusted-output',
    ]);

    for (const entry of TOP_AUTHORING_DIAGNOSTICS) {
      const registered = createRegisteredDiagnostic(
        entry.code,
        { source: SOURCE },
        { includeHelp: true },
      );
      const diagnostic = projectKovoDiagnostic(registered, 'proof');

      expectDiagnosticEmpathy(diagnostic);
      expect(diagnostic.help, entry.code).toContain('Blocked reason:');
      expect(diagnostic.help, entry.code).toContain('Fixes:');
    }
  });
});

function expectDiagnosticEmpathy(diagnostic: KovoDiagnosticRecord): void {
  const { help, source } = diagnostic;
  if (help === undefined || source === undefined) {
    throw new TypeError(`${diagnostic.code} lacks empathy fields.`);
  }
  expect(diagnostic.version, diagnostic.code).toBe('kovo-diagnostic/v1');
  expect(diagnostic.message, diagnostic.code).toMatch(/\S/u);
  expect(diagnostic.message, diagnostic.code).not.toContain('\n');
  expect(help, diagnostic.code).toMatch(/\S/u);
  expect(source, diagnostic.code).toEqual(
    expect.objectContaining({
      end: expect.any(Number),
      file: expect.stringMatching(/\S/u),
      start: expect.any(Number),
    }),
  );

  const json = JSON.parse(formatKovoDiagnostics([diagnostic], 'json')) as {
    readonly diagnostics: readonly KovoDiagnosticRecord[];
    readonly version: string;
  };
  expect(json).toEqual({
    diagnostics: [diagnostic],
    version: 'kovo-diagnostic/v1',
  });

  const human = formatKovoDiagnostics([diagnostic], 'human');
  expect(human, diagnostic.code).toContain(
    `${diagnostic.severity.toUpperCase()} ${diagnostic.code}`,
  );
  expect(human, diagnostic.code).toContain(diagnostic.message);
  expect(human, diagnostic.code).toContain(`HELP ${help}`);
  expect(human, diagnostic.code).toContain(source.file);

  const github = formatKovoDiagnostics([diagnostic], 'github');
  expect(github, diagnostic.code).toContain(`title=${diagnostic.code} ${diagnostic.category}`);
  expect(github, diagnostic.code).toContain(diagnostic.message);
}

function requireDiagnostic(
  diagnostics: readonly KovoDiagnosticRecord[] | undefined,
  label: string,
): KovoDiagnosticRecord {
  const diagnostic = diagnostics?.[0];
  if (diagnostic === undefined) throw new TypeError(`${label} did not produce a diagnostic.`);
  return diagnostic;
}

function envAnchor(name: string): KovoDiagnosticSourceAnchor {
  return Object.freeze({ end: name.length, file: '.env', start: 0 });
}

function configAnchor(file: string): KovoDiagnosticSourceAnchor {
  return Object.freeze({ end: 0, file, start: 0 });
}

function packageAnchor(key: string): KovoDiagnosticSourceAnchor {
  return Object.freeze({ end: key.length, file: 'package.json', start: 0 });
}

function devOptions(): KovoDevOptions {
  return {
    appModulePath: '/workspace/src/app.tsx',
    mode: 'development',
    port: 4173,
    root: '/workspace',
    strictPort: true,
  };
}
