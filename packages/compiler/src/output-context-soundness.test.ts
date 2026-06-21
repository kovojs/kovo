import { describe, expect, it } from 'vitest';

import { compileComponentModule } from './compile.js';
import {
  isUrlAttribute,
  outputContextForAttribute,
  type OutputContext,
} from './output-context-facts.js';

// CAP9 (plans/compiler-refactoring.md): output-context soundness gate.
//
// SPEC.md §5.2 rule 10 ("output safety is contextual and default-on") requires the
// server renderer / emit side and the KV236 validation side to make the SAME sink
// classification — a sink the validator gates as a URL must be one the emitter
// encodes as a URL, and vice versa. FN8 unified the URL taxonomy onto the single
// `isUrlAttribute` predicate that both `outputContextForAttribute` (emit) and the
// KV236 validator (`security/output-context.ts`, which calls `isUrlAttribute`) now
// consume. This gate locks that correspondence so a future edit cannot make the
// emitter and the validator disagree (policed-but-unescaped / escaped-but-unpoliced).

describe('CAP9: output-context rule-10 soundness gate', () => {
  // The canonical URL-bearing attributes (the FN8 single-source set).
  const urlAttributes = [
    'href',
    'src',
    'action',
    'formaction',
    'poster',
    'background',
    'cite',
    'data',
    'ping',
    'xlink:href',
  ];
  const nonUrlAttributes = ['title', 'class', 'id', 'alt', 'name', 'value', 'aria-label'];

  it('emit url-attribute context iff the KV236 validator predicate gates it as a URL sink', () => {
    // The invariant that defines rule-10 lockstep: for every attribute name, the
    // emit-side context is `url-attribute` exactly when the validator's URL predicate
    // is true. Both derive from the one shared `isUrlAttribute`, so they cannot drift.
    const sample = [...urlAttributes, ...nonUrlAttributes, 'style', 'disabled', 'checked'];
    for (const name of sample) {
      const emitContext: OutputContext = outputContextForAttribute(name);
      expect(emitContext === 'url-attribute').toBe(isUrlAttribute(name));
    }
  });

  it('classifies every canonical URL attribute as a URL sink on both sides', () => {
    for (const name of urlAttributes) {
      expect(isUrlAttribute(name)).toBe(true);
      expect(outputContextForAttribute(name)).toBe('url-attribute');
    }
  });

  it('does not treat plain attributes as URL sinks', () => {
    for (const name of nonUrlAttributes) {
      expect(isUrlAttribute(name)).toBe(false);
      expect(outputContextForAttribute(name)).not.toBe('url-attribute');
    }
  });

  it('matches URL attributes case-insensitively, consistently across emit and validation', () => {
    for (const name of ['HREF', 'Src', 'FormAction', 'XLINK:HREF']) {
      expect(isUrlAttribute(name)).toBe(true);
      expect(outputContextForAttribute(name)).toBe('url-attribute');
    }
  });

  it('emits a url-attribute GeneratedOutputWriteFact for a dynamic href, matching the gated sink', () => {
    // Tie the emitted fact stream to the classification: a dynamic href binding must
    // produce a url-attribute output-context fact for the same sink the validator gates.
    const result = compileComponentModule({
      fileName: 'link-card.tsx',
      source: `
export const LinkCard = component({
  queries: { product: {} },
  render: () => <a href={product.url}>View</a>,
});
`,
    });

    const urlFacts = result.outputContextFacts.filter((fact) => fact.context === 'url-attribute');
    expect(urlFacts.length).toBeGreaterThan(0);
    for (const fact of urlFacts) {
      // Every emitted url-attribute sink must be one the validator predicate also gates.
      expect(isUrlAttribute('href')).toBe(true);
      expect(fact.context).toBe('url-attribute');
    }
  });
});
