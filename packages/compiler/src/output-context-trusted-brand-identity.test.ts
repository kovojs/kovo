import { describe, expect, it } from 'vitest';

import { compileComponentModule } from './compile.js';

// SPEC §6.6(1) / §5.2 rule 9 / §4.8 KV236: the trusted-HTML escape hatch that suppresses KV236 in a
// rawtext (<script>/<style>) context must be recognized by AST symbol-identity (the local name bound
// to the real `@kovojs/browser` export), NEVER by a source-text name match. Regression for the
// confirmed soundness hole F1 (plans/compiler-soundness.md): a `/^trustedHtml\s*\(/` text regex was
// symbol-blind (any shadow/foreign `trustedHtml` suppressed the gate) AND prefix-only (so
// `trustedHtml("x") + user.code` rode the raw suffix into <script>).

function kv236(source: string): number {
  return compileComponentModule({ fileName: 'x.tsx', source }).diagnostics.filter(
    (d) => d.code === 'KV236',
  ).length;
}

const SCRIPT = (head: string, expr: string) => `${head}
export const C = component({
  render: ({ cfg }) => (<div><script>{${expr}}</script></div>),
});
`;
const STYLE = (head: string, expr: string) => `${head}
export const C = component({
  render: ({ cfg }) => (<div><style>{${expr}}</style></div>),
});
`;
const REAL = "import { trustedHtml } from '@kovojs/browser';";

describe('F1: KV236 trusted-brand suppression is symbol-identity, fail-closed', () => {
  it('CONTROL: a bare dynamic <script> child is KV236', () => {
    expect(kv236(SCRIPT('', 'cfg.inline'))).toBeGreaterThan(0);
  });

  it('LEGIT: real @kovojs/browser trustedHtml single-call suppresses KV236', () => {
    expect(kv236(SCRIPT(REAL, 'trustedHtml(cfg.inline)'))).toBe(0);
  });

  it('LEGIT: an aliased real import (trustedHtml as th) still resolves by identity', () => {
    expect(
      kv236(SCRIPT("import { trustedHtml as th } from '@kovojs/browser';", 'th(cfg.inline)')),
    ).toBe(0);
  });

  it('LEGIT: the @kovojs/server re-export and namespace member still resolve by identity', () => {
    expect(
      kv236(SCRIPT("import { trustedHtml } from '@kovojs/server';", 'trustedHtml(cfg.inline)')),
    ).toBe(0);
    expect(
      kv236(SCRIPT("import * as kovo from '@kovojs/server';", 'kovo.trustedHtml(cfg.inline)')),
    ).toBe(0);
  });

  it('BYPASS CLOSED: a local shadow `const trustedHtml` no longer suppresses KV236', () => {
    expect(
      kv236(SCRIPT('const trustedHtml = (s: string) => s;', 'trustedHtml(cfg.inline)')),
    ).toBeGreaterThan(0);
  });

  it('BYPASS CLOSED: a same-named import from a non-Kovo module no longer suppresses KV236', () => {
    expect(
      kv236(SCRIPT("import { trustedHtml } from './my-utils';", 'trustedHtml(cfg.inline)')),
    ).toBeGreaterThan(0);
  });

  it('BYPASS CLOSED: late Array.some replacement cannot forge trusted-brand identity', () => {
    const nativeSome = Array.prototype.some;
    const nativeApply = Reflect.apply;
    let poisonHits = 0;
    let diagnosticCount = 0;

    try {
      Array.prototype.some = function forgeTrustedHtmlIdentity(
        this: unknown[],
        callback: (value: unknown, index: number, array: unknown[]) => unknown,
        thisArg?: unknown,
      ): boolean {
        const first = this[0] as { exportName?: unknown; module?: unknown } | undefined;
        if (
          this.length === 3 &&
          first?.module === '@kovojs/browser' &&
          first.exportName === 'trustedHtml'
        ) {
          poisonHits += 1;
          return true;
        }
        return nativeApply(nativeSome, this, [callback, thisArg]);
      } as typeof Array.prototype.some;
      diagnosticCount = kv236(
        SCRIPT("import { trustedHtml } from './my-utils';", 'trustedHtml(cfg.inline)'),
      );
    } finally {
      Array.prototype.some = nativeSome;
    }

    expect(poisonHits).toBe(0);
    expect(diagnosticCount).toBeGreaterThan(0);
  });

  it('BYPASS CLOSED: an undefined `trustedHtml` name no longer suppresses KV236', () => {
    expect(kv236(SCRIPT('', 'trustedHtml(cfg.inline)'))).toBeGreaterThan(0);
  });

  it('BYPASS CLOSED: concatenation `trustedHtml("x") + cfg.code` (even with the real import) is KV236', () => {
    expect(kv236(SCRIPT(REAL, 'trustedHtml("var ok=1;") + cfg.code'))).toBeGreaterThan(0);
  });

  it('BYPASS CLOSED: a method/optional-chain wrapper around the brand is KV236', () => {
    expect(kv236(SCRIPT(REAL, 'trustedHtml(cfg.inline).slice(1)'))).toBeGreaterThan(0);
    expect(kv236(SCRIPT(REAL, 'trustedHtml(cfg.inline) ?? cfg.fallback'))).toBeGreaterThan(0);
  });

  it('BYPASS CLOSED: <style> rawtext shadow is KV236, real import suppresses', () => {
    expect(
      kv236(STYLE('const trustedHtml = (s: string) => s;', 'trustedHtml(cfg.css)')),
    ).toBeGreaterThan(0);
    expect(kv236(STYLE(REAL, 'trustedHtml(cfg.css)'))).toBe(0);
  });
});
