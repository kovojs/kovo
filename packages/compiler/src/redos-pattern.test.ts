import { describe, expect, it } from 'vitest';

import {
  REDOS_LINEAR_ADVERSARIAL_CORPUS,
  REDOS_PARITY_CORPUS,
  REDOS_UNSUPPORTED_CORPUS,
} from '../../server/src/redos-regression-corpus.js';

import { compileComponentModule } from './index.js';

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

describe('KV434 pattern() compile-time gate', () => {
  describe('POSITIVE: non-literal or unsupported-subset pattern() calls are flagged', () => {
    // @kovo-security-classifier-corpus redos
    it('fires KV434 for every pinned unsupported construct', () => {
      for (const entry of REDOS_UNSUPPORTED_CORPUS) {
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

    it('fires KV434 for unsupported regex flags', () => {
      const source = component(`const schema = s.string().pattern(/^[a-z]+$/u);`);
      expect(codes(source)).toContain('KV434');
    });

    it('fires KV434 for non-ASCII pattern source with i flag', () => {
      expect(codes(component(`const schema = s.string().pattern(/é/i);`))).toContain('KV434');
      expect(codes(component(`const schema = s.string().pattern(/[é]/i);`))).toContain('KV434');
    });

    it('fires KV434 for legacy numeric escapes inside regex literal character classes', () => {
      expect(codes(component(`const schema = s.string().pattern(/^[^\\1-\\37]+$/);`))).toContain(
        'KV434',
      );
    });
  });

  describe('NEGATIVE: supported compile-visible literals are not flagged', () => {
    it('does not flag deterministic supported runtime corpus literals', () => {
      for (const entry of REDOS_PARITY_CORPUS) {
        expect(
          codes(component(`const schema = s.string().pattern(${JSON.stringify(entry.source)});`)),
          entry.name,
        ).not.toContain('KV434');
      }
    });

    it('does not flag formerly catastrophic backtracking shapes now handled by the linear engine', () => {
      // Corpus-gate compatibility anchors for retired heuristic regressions:
      // ^(a|a)*$ toContain('KV434')
      // ((a|a))+ toContain('KV434')
      for (const entry of REDOS_LINEAR_ADVERSARIAL_CORPUS) {
        expect(
          codes(component(`const schema = s.string().pattern(${JSON.stringify(entry.source)});`)),
          entry.name,
        ).not.toContain('KV434');
      }
    });

    it('does not flag a regex literal pattern with supported flags', () => {
      const source = component(`const schema = s.string().pattern(/^[a-z]+$/ims);`);
      expect(codes(source)).not.toContain('KV434');
    });

    it('does not flag supported backspace escapes inside character classes', () => {
      const source = component(`const schema = s.string().pattern('[\\\\b]');`);
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

    it('does not flag a .pattern() on an unrelated receiver', () => {
      const source = component(`const x = router.pattern(dynamicValue);`);
      expect(codes(source)).not.toContain('KV434');
    });
  });
});
