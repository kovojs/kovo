import { describe, expect, it } from 'vitest';
import { diagnosticDefinitions } from '@kovojs/core/internal/diagnostics';

import {
  assertKovoDiagnosticEnvelope,
  createKovoDiagnostic,
  createKovoDiagnosticEnvelope,
  formatKovoDiagnostics,
  KOVO_DIAGNOSTIC_VERSION,
  usageDiagnostic,
  type KovoDiagnosticEnvelope,
} from './diagnostic.js';
import { formatCommandResultDiagnostics, normalizeCommandResultDiagnostics } from './shared.js';

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

  it('rejects unknown registry codes and forged registry-owned fields', () => {
    expect(() =>
      createKovoDiagnostic({
        category: 'proof',
        code: 'KV999',
        message: 'unknown registry code',
      }),
    ).toThrow(/not registered/u);
    expect(() =>
      createKovoDiagnostic({
        category: 'proof',
        code: 'KV436',
        help: 'forged help',
        message: 'wrong registry help',
      }),
    ).toThrow(/help is registry-owned/u);
    expect(() =>
      createKovoDiagnostic({
        category: 'proof',
        code: 'KV436',
        message: 'wrong registry severity',
        severity: 'notice',
      }),
    ).toThrow(/severity is registry-owned/u);
  });

  it('accepts only exact, typed own-data construction fields', () => {
    expect(() =>
      createKovoDiagnostic({
        category: 'proof',
        code: 'KV436',
        message: 'surplus data',
        secret: 'must not cross the boundary',
      } as never),
    ).toThrow(/surplus field "secret"/u);

    for (const input of [
      { category: 'bogus', code: 'KV436', message: 'bad category' },
      { category: 'proof', code: 'KV436', message: 42 },
      {
        category: 'runtime',
        code: 'KOVO_RUNTIME',
        message: 'bad severity',
        severity: 'fatal',
      },
      {
        category: 'runtime',
        code: 'KOVO_RUNTIME',
        help: 42,
        message: 'bad help',
        severity: 'error',
      },
      {
        category: 'proof',
        code: 'KV436',
        message: 'bad source',
        source: { end: '2', file: 'src/app.ts', start: 1 },
      },
    ]) {
      expect(() => createKovoDiagnostic(input as never)).toThrow(TypeError);
    }

    const inherited = Object.assign(Object.create({ category: 'proof' }) as object, {
      code: 'KV436',
      message: 'inherited category',
    });
    expect(() => createKovoDiagnostic(inherited as never)).toThrow(/custom prototype/u);

    let getterCalled = false;
    const accessor = {
      category: 'proof',
      code: 'KV436',
      get message() {
        getterCalled = true;
        return 'accessor';
      },
    };
    expect(() => createKovoDiagnostic(accessor as never)).toThrow(/own data field/u);
    expect(getterCalled).toBe(false);
  });

  it('does not transfer authority through copies, lookalikes, or prototypes', () => {
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

  it.each([
    ['proof', 'kovo-check/v1\nERROR KV436 missing access decision\n', 'KOVO_PROOF_FINDING'],
    ['proof', 'kovo-explain/v1\nERROR stale graph\n', 'KOVO_PROOF_FINDING'],
    ['build', 'kovo-build/v1\nERROR artifact rejected\n', 'KOVO_BUILD_FINDING'],
  ] as const)(
    'renders %s command findings as equivalent human, JSON, and GitHub records',
    (category, output, code) => {
      const result = { exitCode: 1 as const, output };
      const normalized = normalizeCommandResultDiagnostics(result, category);
      expect(formatCommandResultDiagnostics(result, 'human', category)).toBe(output);
      const json = JSON.parse(
        formatCommandResultDiagnostics(result, 'json', category),
      ) as KovoDiagnosticEnvelope;
      expect(json).toEqual({
        diagnostics: [
          expect.objectContaining({
            category,
            code,
            message: output,
            severity: 'error',
          }),
        ],
        version: KOVO_DIAGNOSTIC_VERSION,
      });
      expect(formatCommandResultDiagnostics(result, 'github', category)).toContain(
        output.trimEnd().replaceAll('\n', '%0A'),
      );
      expect(normalized.exitCode).toBe(1);
      expect(normalized.diagnostics).toEqual(json.diagnostics);
    },
  );
});
