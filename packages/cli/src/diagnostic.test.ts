import { createRegisteredDiagnostic } from '@kovojs/core/internal/diagnostics';
import { describe, expect, it } from 'vitest';

import * as DiagnosticModule from './diagnostic.js';
import {
  assertKovoDiagnosticEnvelope,
  createKovoDiagnosticEnvelope,
  formatKovoDiagnostics,
  KOVO_DIAGNOSTIC_VERSION,
  projectKovoDiagnostic,
  usageDiagnostic,
  type KovoDiagnosticEnvelope,
} from './diagnostic.js';
import { formatCommandResultDiagnostics, normalizeCommandResultDiagnostics } from './shared.js';

describe('kovo-diagnostic/v1 authority and renderers', () => {
  const source = Object.freeze({ end: 27, file: 'src/queries.ts', start: 14 });
  const registered = createRegisteredDiagnostic(
    'KV436',
    { source },
    { includeHelp: true, message: 'Missing explicit access decision.' },
  );
  const diagnostic = projectKovoDiagnostic(registered, 'proof');

  it('projects one immutable transport-neutral record from core registry identity', () => {
    expect(diagnostic).toEqual({
      category: 'proof',
      code: 'KV436',
      help: registered.help,
      message: 'Missing explicit access decision.',
      severity: 'error',
      source,
      version: KOVO_DIAGNOSTIC_VERSION,
    });
    expect(Object.isFrozen(diagnostic)).toBe(true);
    expect(Object.isFrozen(diagnostic.source)).toBe(true);
    expect(Object.isFrozen(createKovoDiagnosticEnvelope([diagnostic]).diagnostics)).toBe(true);
  });

  it('renders every projected field without consulting the definition registry', () => {
    expect(formatKovoDiagnostics([diagnostic], 'human')).toBe(
      `ERROR KV436 src/queries.ts[14:27] Missing explicit access decision.\nHELP ${registered.help}\n`,
    );
    expect(JSON.parse(formatKovoDiagnostics([diagnostic], 'json'))).toEqual({
      diagnostics: [diagnostic],
      version: KOVO_DIAGNOSTIC_VERSION,
    });
    expect(formatKovoDiagnostics([diagnostic], 'github')).toBe(
      `::error file=src/queries.ts,title=KV436 proof [14%3A27]::Missing explicit access decision. ${registered.help!.replaceAll(
        '\n',
        '%0A',
      )}\n`,
    );
  });

  it('escapes hostile GitHub command bytes and preserves non-error severity', () => {
    const hostile = projectKovoDiagnostic(
      createRegisteredDiagnostic(
        'KV210',
        { source: Object.freeze({ end: 2, file: 'src/a,b:thing.ts', start: 1 }) },
        { message: 'line 1\n::error:: forged%0A' },
      ),
      'runtime',
    );
    expect(formatKovoDiagnostics([hostile], 'github')).toBe(
      '::notice file=src/a%2Cb%3Athing.ts,title=KV210 runtime [1%3A2]::line 1%0A::error:: forged%250A\n',
    );
  });

  it('rejects malformed source anchors even when the KV object itself is registered', () => {
    const reversed = createRegisteredDiagnostic('KV436', {
      source: { end: 1, file: 'src/app.ts', start: 2 },
    });
    const accessor = createRegisteredDiagnostic('KV436', {
      source: Object.defineProperty({ end: 2, file: 'src/app.ts' }, 'start', {
        enumerable: true,
        get: () => 1,
      }),
    });
    expect(() => projectKovoDiagnostic(reversed, 'proof')).toThrow(/source span/u);
    expect(() => projectKovoDiagnostic(accessor, 'proof')).toThrow(/own data field/u);
  });

  it('does not let a structural KV lookalike, clone, or copied symbol mint a record', () => {
    const clone = { ...registered };
    expect(() => projectKovoDiagnostic(clone as never, 'proof')).toThrow(/projection source/u);

    const symbols = Object.getOwnPropertySymbols(registered);
    const copiedSymbol = Object.defineProperty({ ...registered }, symbols[0]!, {
      value: true,
    });
    expect(() => projectKovoDiagnostic(copiedSymbol as never, 'proof')).toThrow(
      /projection source/u,
    );
    expect('createKovoDiagnostic' in DiagnosticModule).toBe(false);
  });

  it('does not transfer local renderer authority through copies or prototypes', () => {
    const copy = { ...diagnostic };
    expect(() => createKovoDiagnosticEnvelope([copy])).toThrow(/registry identity/u);
    expect(() => formatKovoDiagnostics([copy], 'human')).toThrow(/registry identity/u);

    const inherited = Object.create(diagnostic) as KovoDiagnosticEnvelope;
    expect(() => formatKovoDiagnostics([inherited as never], 'json')).toThrow(/registry identity/u);
    expect(() =>
      assertKovoDiagnosticEnvelope({
        diagnostics: [diagnostic],
        version: KOVO_DIAGNOSTIC_VERSION,
      }),
    ).toThrow(/envelope lacks local registry identity/u);
  });

  it('mints invocation errors only through the finite private CLI registry', () => {
    expect(usageDiagnostic('kovo: unknown option "--wat".')).toEqual({
      category: 'usage',
      code: 'KOVO_USAGE',
      help: 'Run `kovo --help` or `kovo help <command>` for generated usage.',
      message: 'kovo: unknown option "--wat".',
      severity: 'error',
      version: KOVO_DIAGNOSTIC_VERSION,
    });
  });

  it.each([
    ['proof', 'kovo-check/v1\nERROR KV436 missing access decision\n'],
    ['proof', 'kovo-explain/v1\nERROR stale graph\n'],
    ['build', 'kovo-build/v1\nERROR artifact rejected\n'],
  ] as const)(
    'does not relabel or collapse a %s command transcript into diagnostic authority',
    (category, output) => {
      const result = { exitCode: 1 as const, output };
      const normalized = normalizeCommandResultDiagnostics(result, category);
      expect(normalized.output).toBe(output);

      const json = JSON.parse(
        formatCommandResultDiagnostics(result, 'json', category),
      ) as KovoDiagnosticEnvelope;
      expect(json).toEqual({
        diagnostics: [
          expect.objectContaining({
            category: 'runtime',
            code: 'KOVO_DIAGNOSTIC_CONTRACT',
            message: `Kovo ${category} command returned a failing result without structured diagnostics.`,
            severity: 'error',
          }),
        ],
        version: KOVO_DIAGNOSTIC_VERSION,
      });
      expect(json.diagnostics[0]?.message).not.toContain(output);
      expect(normalized.exitCode).toBe(1);
    },
  );

  it('renders an explicitly attached core fact identically across command adapters', () => {
    const result = {
      diagnostics: [diagnostic],
      exitCode: 1 as const,
      output: 'legacy fact protocol remains independently versioned\n',
    };
    expect(formatCommandResultDiagnostics(result, 'human', 'proof')).toBe(
      formatKovoDiagnostics([diagnostic], 'human'),
    );
    expect(formatCommandResultDiagnostics(result, 'json', 'proof')).toBe(
      formatKovoDiagnostics([diagnostic], 'json'),
    );
    expect(formatCommandResultDiagnostics(result, 'github', 'proof')).toBe(
      formatKovoDiagnostics([diagnostic], 'github'),
    );
  });
});
