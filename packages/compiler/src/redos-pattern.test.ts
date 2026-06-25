import { describe, expect, it } from 'vitest';

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

    it('fires KV434 for quantified overlapping alternatives, including the documented case', () => {
      const source = component(`const schema = s.string().pattern('^(a|a)*$');`);
      expect(codes(source)).toContain('KV434');
    });

    it('fires KV434 for adjacent overlapping quantified atoms', () => {
      const source = component(`const schema = s.string().pattern('[a-z]+[a-z]*');`);
      expect(codes(source)).toContain('KV434');
    });
  });

  describe('NEGATIVE: a compile-visible literal the runtime already validates is NOT flagged', () => {
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
});
