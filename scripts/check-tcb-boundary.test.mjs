import { describe, expect, it } from 'vitest';

import { checkTcbBoundary } from './check-tcb-boundary.mjs';

const manifestPath = 'security/TCB.md';

function manifest(entries, budgets = { entryMaxLines: 20, totalTcbMaxLines: 50 }) {
  return `# Test TCB

\`\`\`json tcb-manifest
${JSON.stringify(
  {
    schema: 'kovo.security.tcb/v1',
    source: 'test',
    budgets,
    entries,
  },
  null,
  2,
)}
\`\`\`
`;
}

function entry(overrides = {}) {
  return {
    classification: 'tcb',
    file: 'packages/server/src/choke.ts',
    id: 'test.choke',
    kind: 'wire-emitter',
    lineBudget: 20,
    name: 'emitChoke',
    ...overrides,
  };
}

function run(files, entries, options = {}) {
  const all = {
    [manifestPath]: manifest(entries, options.budgets),
    ...files,
  };
  return checkTcbBoundary({
    exists: (file) => Object.hasOwn(all, file),
    manifestPath,
    readText: (file) => all[file] ?? '',
    repoRoot: '/repo',
    sourceFiles: Object.keys(all).filter((file) => file.endsWith('.ts')),
  });
}

describe('check-tcb-boundary', () => {
  it('accepts budgeted declarations and deliberately classified wrappers', () => {
    const files = {
      'packages/core/src/brand.ts': `
export function makeBrand(value) {
  return value;
}
`,
      'packages/server/src/choke.ts': `
import { wireEmitter } from '@kovojs/core/internal/security-markers';
export const emitChoke = wireEmitter('test.emit', function (value) {
  return new Response(value);
});
`,
      'packages/compiler/src/static.ts': `
import { securityClassifier } from '@kovojs/core/internal/security-markers';
export const classifyStatic = securityClassifier('test.static', function (value) {
  return value === true;
});
`,
    };

    const result = run(files, [
      entry({ decision: 'test.emit', wrapper: 'wireEmitter' }),
      entry({
        file: 'packages/core/src/brand.ts',
        id: 'test.brand',
        kind: 'brand-constructor',
        lineBudget: 5,
        name: 'makeBrand',
      }),
      entry({
        classification: 'advisory-static-classifier',
        decision: 'test.static',
        file: 'packages/compiler/src/static.ts',
        id: 'test.static',
        kind: 'classifier',
        name: 'classifyStatic',
        wrapper: 'securityClassifier',
      }),
    ]);

    expect(result.ok).toBe(true);
    expect(result.summary).toContain('OK TCB manifest declarations');
  });

  it('rejects a manifest entry whose file is missing', () => {
    const result = run({}, [entry()]);

    expect(result.ok).toBe(false);
    expect(result.findings).toContain(
      'packages/server/src/choke.ts: TCB manifest entry emitChoke file is missing',
    );
  });

  it('rejects a manifest entry whose declaration is missing', () => {
    const result = run({ 'packages/server/src/choke.ts': 'export const other = 1;' }, [entry()]);

    expect(result.ok).toBe(false);
    expect(result.findings).toContain(
      'packages/server/src/choke.ts: TCB manifest entry emitChoke declaration is missing',
    );
  });

  it('rejects an entry over its declaration line budget', () => {
    const result = run(
      {
        'packages/server/src/choke.ts': `
export function emitChoke(value) {
  if (value) {
    return value;
  }
  return null;
}
`,
      },
      [entry({ kind: 'function', lineBudget: 3 })],
    );

    expect(result.ok).toBe(false);
    expect(result.findings.join('\n')).toContain(
      'emitChoke spans 6 line(s), over manifest budget 3',
    );
  });

  it('rejects total TCB budget overflow', () => {
    const result = run(
      {
        'packages/server/src/choke.ts': 'export function emitChoke(value) {\n  return value;\n}\n',
        'packages/server/src/other.ts':
          'export class OtherChoke {\n  run() {\n    return true;\n  }\n}\n',
      },
      [
        entry({ kind: 'function', lineBudget: 5 }),
        entry({
          file: 'packages/server/src/other.ts',
          id: 'test.other',
          kind: 'class',
          lineBudget: 5,
          name: 'OtherChoke',
        }),
      ],
      { budgets: { entryMaxLines: 20, totalTcbMaxLines: 5 } },
    );

    expect(result.ok).toBe(false);
    expect(result.findings.join('\n')).toContain('over total budget 5');
  });

  it('rejects a planted wrapper that is not listed in the manifest', () => {
    const result = run(
      {
        'packages/server/src/choke.ts': 'export function emitChoke(value) { return value; }',
        'packages/server/src/canary.ts': `
import { wireEmitter } from '@kovojs/core/internal/security-markers';
export const leak = wireEmitter('test.leak', function (value) {
  return value;
});
`,
      },
      [entry({ kind: 'function' })],
    );

    expect(result.ok).toBe(false);
    expect(result.findings.join('\n')).toContain(
      'packages/server/src/canary.ts:3: leak uses wireEmitter() but is not listed',
    );
  });

  it('rejects wrapper and decision drift from the manifest', () => {
    const result = run(
      {
        'packages/server/src/choke.ts': `
import { wireEmitter } from '@kovojs/core/internal/security-markers';
export const emitChoke = wireEmitter('test.actual', function (value) {
  return value;
});
`,
      },
      [entry({ decision: 'test.expected', wrapper: 'securityClassifier' })],
    );

    expect(result.ok).toBe(false);
    expect(result.findings.join('\n')).toContain(
      'emitChoke manifest expects securityClassifier() but found wireEmitter',
    );
    expect(result.findings.join('\n')).toContain(
      'emitChoke manifest expects decision test.expected but found test.actual',
    );
  });

  it('requires TCB entries to carry a positive line budget', () => {
    const result = run(
      { 'packages/server/src/choke.ts': 'export function emitChoke(value) { return value; }' },
      [entry({ lineBudget: undefined })],
    );

    expect(result.ok).toBe(false);
    expect(result.findings).toContain(
      `${manifestPath}: test.choke is TCB but has no positive integer lineBudget`,
    );
  });
});
