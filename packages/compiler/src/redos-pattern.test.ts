import { describe, expect, it } from 'vitest';

import {
  REDOS_ACCEPT_CORPUS,
  REDOS_REJECT_CORPUS,
} from '../../server/src/redos-regression-corpus.js';

import { compileComponentModule } from './index.js';

// SPEC §6.6/§9.5 + secure-framework Phase 6 (Tier 3): KV434 is the compile-time half of the ReDoS
// gate. A `s.string().pattern(<non-literal>)` is unanalyzable, so the build flags the call site and
// nudges to a blessed format or the audited `unsafeRegex(...)` escape. The runtime half (blessed
// linear matchers + literal nested/overlapping-quantifier reject + input-size cap) ships separately
// in `@kovojs/server` (packages/server/src/redos.ts). Honesty: `pattern(literal)` is
// by-construction-ISH, NOT fully by-construction.

function codes(source: string): string[] {
  return compileComponentModule({ fileName: 'profile.tsx', source }).diagnostics.map(
    (diagnostic) => diagnostic.code,
  );
}

function component(body: string): string {
  return `
import { component } from '@kovojs/core';
import { s } from '@kovojs/server';

${body}

export const Profile = component({ render: () => <div /> });
`;
}

describe('KV434 non-literal pattern() compile-time gate', () => {
  describe('POSITIVE: a non-literal pattern() argument is flagged at the call site', () => {
    // @kovo-security-classifier-corpus redos
    it('fires KV434 for every pinned unsafe runtime classifier regression', () => {
      for (const entry of REDOS_REJECT_CORPUS) {
        expect(
          codes(component(`const schema = s.string().pattern(${JSON.stringify(entry.source)});`)),
          entry.name,
        ).toContain('KV434');
      }
    });

    it('fires KV434 for a variable pattern at the pattern() call site', () => {
      const source = component(
        `const myDynamicRegex = '^x+$';
const schema = s.string().pattern(myDynamicRegex);`,
      );
      const kv434 = compileComponentModule({ fileName: 'profile.tsx', source }).diagnostics.find(
        (diagnostic) => diagnostic.code === 'KV434',
      );
      expect(kv434).toBeDefined();
      // The site is the `pattern` method name on the real authored call, not a lowered rewrite.
      expect(kv434?.start).toBeDefined();
      expect(source.split('\n')[(kv434?.start?.line ?? 0) - 1]).toContain('.pattern(');
    });

    it('fires KV434 for a call-result pattern', () => {
      const source = component(`const schema = s.string().pattern(buildPattern());`);
      expect(codes(source)).toContain('KV434');
    });

    it('fires KV434 for a template with substitutions', () => {
      const source = component(
        `const seg = '[a-z]+';
const schema = s.string().pattern(\`^\${seg}$\`);`,
      );
      expect(codes(source)).toContain('KV434');
    });

    it('fires KV434 even behind chained refinements before pattern()', () => {
      const source = component(
        `const re = /x/;
const schema = s.string().min(3).pattern(re);`,
      );
      expect(codes(source)).toContain('KV434');
    });

    it('fires KV434 for a nested-quantifier literal', () => {
      const source = component(`const schema = s.string().pattern(/(a+)+$/);`);
      expect(codes(source)).toContain('KV434');
    });

    // Regression: H7 — matchGroupClose must track classDepth so a literal ')' inside [...] does
    // not fool the group-close search into mis-locating the group boundary (SPEC §6.6 / KV434).
    // Before the fix, `([\w)]+)+` was accepted (no KV434) because the ')' inside [...] caused
    // an early depth decrement that hid the outer nested-quantifier structure.
    it('fires KV434 for nested-quantifier groups with ) inside character class (H7 regression)', () => {
      const src1 = component(`const schema = s.string().pattern('([)]+)+');`);
      expect(codes(src1)).toContain('KV434');

      const src2 = component(`const schema = s.string().pattern('([\\\\w)]+)+');`);
      expect(codes(src2)).toContain('KV434');

      const src3 = component(`const schema = s.string().pattern('^([\\\\w)]+)+$');`);
      expect(codes(src3)).toContain('KV434');
    });

    it('fires KV434 for quantified overlapping alternatives, including the documented case', () => {
      const source = component(`const schema = s.string().pattern('^(a|a)*$');`);
      expect(codes(source)).toContain('KV434');
    });

    it('fires KV434 for adjacent overlapping quantified atoms', () => {
      const source = component(`const schema = s.string().pattern('[a-z]+[a-z]*');`);
      expect(codes(source)).toContain('KV434');
    });

    // Regression: round-17 F1 (SPEC §6.6 / KV434). The compile-time twin must treat `?` as a
    // quantifier: a quantified group whose body is quantified only with `?` catastrophically
    // backtracks. Before the fix `containsQuantifier` recognized only `+ * {` and OMITTED `?`, so
    // these compile-visible literals passed the nested-quantifier reject and were built into a live
    // RegExp. Keep the compiler in sync with the runtime `assertLinearSafePattern`.
    it('fires KV434 for optional-quantifier (?) nesting inside a quantified group', () => {
      expect(codes(component(`const schema = s.string().pattern('(a?b?)+$');`))).toContain('KV434');
      expect(codes(component(`const schema = s.string().pattern('(a?){50}b');`))).toContain(
        'KV434',
      );
      expect(codes(component(`const schema = s.string().pattern('(a?)+');`))).toContain('KV434');
    });
  });

  describe('NEGATIVE: a compile-visible literal the runtime already validates is NOT flagged', () => {
    it('does not flag any pinned safe runtime classifier regression', () => {
      for (const entry of REDOS_ACCEPT_CORPUS) {
        expect(
          codes(component(`const schema = s.string().pattern(${JSON.stringify(entry.source)});`)),
          entry.name,
        ).not.toContain('KV434');
      }
    });

    it('does not flag a regex literal pattern', () => {
      const source = component(`const schema = s.string().pattern(/^[a-z]+$/);`);
      expect(codes(source)).not.toContain('KV434');
    });

    it('does not flag a string literal pattern', () => {
      const source = component(`const schema = s.string().pattern('^[a-z]+$');`);
      expect(codes(source)).not.toContain('KV434');
    });

    it('does not flag a no-substitution template pattern', () => {
      const source = component('const schema = s.string().pattern(`^[a-z]+$`);');
      expect(codes(source)).not.toContain('KV434');
    });

    it('does not flag a literal-only concatenation pattern', () => {
      const source = component(`const schema = s.string().pattern('^[a-z]' + '+$');`);
      expect(codes(source)).not.toContain('KV434');
    });

    // Do NOT over-block optional quantifiers: `?` is only a nesting risk under an outer-quantified
    // group. A benign group with no outer quantifier, a flat run of optional atoms, and a
    // non-capturing group (whose prefix `?` is not a quantifier) stay linear-safe (round-17 F1).
    it('does not flag benign optional quantifiers with no outer-quantified group', () => {
      expect(codes(component(`const schema = s.string().pattern('(a?b?)');`))).not.toContain(
        'KV434',
      );
      expect(codes(component(`const schema = s.string().pattern('^a?b?c?$');`))).not.toContain(
        'KV434',
      );
      expect(codes(component(`const schema = s.string().pattern('((?:ab))+');`))).not.toContain(
        'KV434',
      );
    });

    it('does not flag a blessed format', () => {
      const source = component(`const schema = s.string().email();`);
      expect(codes(source)).not.toContain('KV434');
    });

    it('does not flag the audited unsafeRegex escape via matches()', () => {
      const source = component(
        `const schema = s.string().matches(unsafeRegex(myDynamicRegex, 'audited'));`,
      );
      expect(codes(source)).not.toContain('KV434');
    });

    it('does not flag a .pattern() on an unrelated (non-s.string) receiver', () => {
      const source = component(`const x = router.pattern(dynamicValue);`);
      expect(codes(source)).not.toContain('KV434');
    });
  });

  it('keeps generated quantified-group nestings rejected or empirically non-superlinear at runtime', () => {
    const atoms = ['a', 'ab', '[a-z]', '\\d'];
    const innerQuantifiers = ['', '+', '*', '?', '{2,4}'];
    const wrappers = [
      (atom: string, quantifier: string) => `(${atom}${quantifier})+`,
      (atom: string, quantifier: string) => `((${atom}${quantifier}))+`,
      (atom: string, quantifier: string) => `(?:${atom}${quantifier})+`,
    ];

    for (const atom of atoms) {
      for (const quantifier of innerQuantifiers) {
        for (const wrap of wrappers) {
          const source = wrap(atom, quantifier);
          const diagnostics = codes(
            component(`const schema = s.string().pattern(${JSON.stringify(source)});`),
          );
          if (diagnostics.includes('KV434')) continue;
          expectNonSuperlinear(source);
        }
      }
    }
  });
});

function expectNonSuperlinear(source: string): void {
  const regex = new RegExp(`^(?:${source})$`, 'u');
  const elapsed = [16, 32, 64].map((units) => {
    const input = 'ab'.repeat(units) + '!';
    const start = performance.now();
    for (let i = 0; i < 25; i += 1) regex.test(input);
    return performance.now() - start;
  });
  const [small, medium, large] = elapsed;
  expect(large, source).toBeLessThan(50);
  expect(large / Math.max(medium, small, 0.01), source).toBeLessThan(20);
}
