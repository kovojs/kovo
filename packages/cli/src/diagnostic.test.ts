import { describe, expect, it } from 'vitest';
import { diagnosticDefinitions } from '@kovojs/core/internal/diagnostics';

import {
  createKovoDiagnostic,
  createKovoDiagnosticEnvelope,
  formatKovoDiagnostics,
  KOVO_DIAGNOSTIC_VERSION,
  usageDiagnostic,
} from './diagnostic.js';

describe('kovo-diagnostic/v1', () => {
  const diagnostic = createKovoDiagnostic({
    category: 'proof',
    code: 'KV436',
    message: 'Missing explicit access decision.',
    source: { end: 27, file: 'src/queries.ts', start: 14 },
  });

  it('constructs one immutable transport-neutral record', () => {
    expect(diagnostic).toEqual({
      category: 'proof',
      code: 'KV436',
      help: diagnosticDefinitions.KV436.help,
      message: 'Missing explicit access decision.',
      severity: 'error',
      source: { end: 27, file: 'src/queries.ts', start: 14 },
      version: KOVO_DIAGNOSTIC_VERSION,
    });
    expect(Object.isFrozen(diagnostic)).toBe(true);
    expect(Object.isFrozen(diagnostic.source)).toBe(true);
    expect(Object.isFrozen(createKovoDiagnosticEnvelope([diagnostic]).diagnostics)).toBe(true);
  });

  it('renders human, JSON, and GitHub output without re-deriving record fields', () => {
    expect(formatKovoDiagnostics([diagnostic], 'human')).toBe(
      'Missing explicit access decision.\n',
    );
    expect(JSON.parse(formatKovoDiagnostics([diagnostic], 'json'))).toEqual({
      diagnostics: [diagnostic],
      version: KOVO_DIAGNOSTIC_VERSION,
    });
    const concise = createKovoDiagnostic({
      category: 'proof',
      code: 'KOVO_PROOF',
      help: 'Add an explicit access decision.',
      message: 'Missing explicit access decision.',
      severity: 'error',
      source: { end: 27, file: 'src/queries.ts', start: 14 },
    });
    expect(formatKovoDiagnostics([concise], 'github')).toBe(
      '::error file=src/queries.ts,title=KOVO_PROOF proof::Missing explicit access decision. Add an explicit access decision.\n',
    );
  });

  it('escapes hostile GitHub command bytes and preserves non-error severity', () => {
    const hostile = createKovoDiagnostic({
      category: 'runtime',
      code: 'KOVO_RUNTIME',
      message: 'line 1\n::error:: forged%0A',
      severity: 'warn',
      source: { end: 2, file: 'src/a,b:thing.ts', start: 1 },
    });
    expect(formatKovoDiagnostics([hostile], 'github')).toBe(
      '::warning file=src/a%2Cb%3Athing.ts,title=KOVO_RUNTIME runtime::line 1%0A::error:: forged%250A\n',
    );
  });

  it('rejects malformed codes and source spans', () => {
    expect(() =>
      createKovoDiagnostic({
        category: 'usage',
        code: 'usage',
        message: 'bad',
        severity: 'error',
      }),
    ).toThrow(/diagnostic code/u);
    expect(() =>
      createKovoDiagnostic({
        category: 'proof',
        code: 'KV436',
        message: 'bad span',
        severity: 'error',
        source: { end: 1, file: 'src/app.ts', start: 2 },
      }),
    ).toThrow(/source span/u);
    expect(() =>
      createKovoDiagnostic({
        category: 'proof',
        code: 'KV436',
        message: 'wrong registry severity',
        severity: 'warn',
      }),
    ).toThrow(/severity is registry-owned/u);
  });

  it('gives invocation errors a stable code, help, and category', () => {
    expect(usageDiagnostic('kovo: unknown option "--wat".')).toEqual({
      category: 'usage',
      code: 'KOVO_USAGE',
      help: 'Run `kovo --help` or `kovo help <command>` for generated usage.',
      message: 'kovo: unknown option "--wat".',
      severity: 'error',
      version: KOVO_DIAGNOSTIC_VERSION,
    });
  });
});
