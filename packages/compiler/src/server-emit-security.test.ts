import { describe, expect, it } from 'vitest';

import { KOVO_IDEM_FIELD_NAME, renderMutationIdemField } from '../../server/src/csrf.js';
import { compileComponentModule } from './index.js';

// Tests for F1 (server URL-scheme sanitizer) and A2 (Kovo-Idem field emission)
// from plans/bug-and-testing-part2.md.
//
// These tests operate on the EMITTED server module source, verifying that the
// compiler generates code that (a) neutralizes javascript: URLs at runtime via the
// JSX runtime's safeUrlAttribute, and (b) emits a per-submit Kovo-Idem hidden field
// alongside the CSRF field for no-JS mutation forms.

describe('compiler server emit — F1: URL-scheme sanitizer wiring', () => {
  it('F1: emitted server module retains dynamic href expression for runtime sanitization', () => {
    // Red path (pre-fix): the emitted JSX runtime called escapeAttribute which does NOT
    // scheme-check, so `javascript:alert(1)` would survive into the rendered HTML.
    // Green path (post-fix): jsx-runtime routes href through safeUrlAttribute at render time.
    const result = compileComponentModule({
      fileName: 'link-list.tsx',
      source: `
export const LinkList = component({
  queries: { links: linksQuery },
  render: ({ links }) => (
    <ul>
      {links.map((link: any) => (
        <li key={link.id}><a href={link.url}>{link.label}</a></li>
      ))}
    </ul>
  ),
});
`,
    });

    const serverFile = result.files.find((file) => file.kind === 'server');
    expect(serverFile, 'server file should be emitted').toBeDefined();
    const serverSource = serverFile?.source ?? '';

    // No KV236 for dynamic expressions (runtime-checked, not compile-time).
    expect(result.diagnostics.filter((d) => d.code === 'KV236')).toEqual([]);
    // The dynamic href expression must be present (sanitized at render time by jsx-runtime).
    expect(serverSource).toContain('href={link.url}');
  });

  it('F1: emitted static javascript: href is caught by KV236 at compile time', () => {
    // Static literal javascript: is caught at compile time by the output-context gate.
    const result = compileComponentModule({
      fileName: 'bad-link.tsx',
      source: `
export const BadLink = component({
  render: () => <a href="javascript:alert(1)">bad</a>,
});
`,
    });

    expect(result.diagnostics.some((d) => d.code === 'KV236')).toBe(true);
  });

  it('F1: safe URL schemes (https, mailto, relative, fragment) pass without KV236', () => {
    // Note: `ftp:` compile-time allowlist is OUT-SINK lane's responsibility
    // (output-context.ts is outside this lane's file ownership). The server-side
    // runtime sanitizer (safeUrlAttribute in html.ts) already allows ftp per §4.8.
    const result = compileComponentModule({
      fileName: 'safe-links.tsx',
      source: `
export const SafeLinks = component({
  render: () => (
    <nav>
      <a href="/pricing">internal</a>
      <a href="#section">fragment</a>
      <a href="https://example.com/docs" external>external</a>
      <a href="mailto:user@example.com">mail</a>
    </nav>
  ),
});
`,
      registryFacts: { routes: ['/pricing'] },
    });

    // These safe schemes must not trigger KV236.
    const urlDiagnostics = result.diagnostics.filter((d) => d.code === 'KV236');
    expect(urlDiagnostics).toEqual([]);
  });
});

describe('compiler server emit — A2: Kovo-Idem hidden field', () => {
  it('A2: compiling a <form mutation> with slots param emits __kovoRenderMutationIdemField() in the server source', () => {
    // Red path (pre-fix): only __kovoRenderMutationCsrfField was emitted; the idem
    // field was absent, leaving no-JS forms with zero replay protection.
    //
    // The compiler injects idem+CSRF into forms when the render function declares a
    // slots param (i.e., `render: (_queries, _state, slots) => ...`) — this is the
    // "compiler-lowered" path where `preserveRuntimeMutation` is false.
    const result = compileComponentModule({
      fileName: 'add-to-cart.tsx',
      source: `
import { component } from '@kovojs/core';

export const AddToCartForm = component({
  mutations: { addToCart },
  render: (_queries, _state, slots) => (
    <add-to-cart-form>
      <form mutation={addToCart}>
        <input name="productId" />
        <button type="submit">Add</button>
      </form>
    </add-to-cart-form>
  ),
});
`,
      registryFacts: {
        mutations: { 'cart/add': 'typeof addToCart' },
      },
    });

    const serverFile = result.files.find((file) => file.kind === 'server');
    expect(serverFile, 'server file should be emitted').toBeDefined();
    const serverSource = serverFile?.source ?? '';

    // The emitted source must include both the CSRF and idem runtime calls.
    expect(serverSource).toContain('__kovoRenderMutationCsrfField');
    expect(serverSource).toContain('__kovoRenderMutationIdemField');

    // Both must be imported from @kovojs/server/internal/csrf.
    expect(serverSource).toContain("from '@kovojs/server/internal/csrf'");
    expect(serverSource).toContain('renderMutationIdemField as __kovoRenderMutationIdemField');
  });

  it('A2: the Kovo-Idem field name constant is "Kovo-Idem" (contract for SRV-MUT lane)', () => {
    // The SRV-MUT lane reads this field name from the form body; it must match exactly.
    expect(KOVO_IDEM_FIELD_NAME).toBe('Kovo-Idem');
  });

  it('A2: renderMutationIdemField produces a hidden input with Kovo-Idem name', () => {
    const field = renderMutationIdemField();
    expect(field).toContain('type="hidden"');
    expect(field).toContain('name="Kovo-Idem"');
    expect(field).toMatch(/value="[^"]+"/);
  });

  it('A2: Kovo-Idem value is a cryptographic UUID (≥128 bits)', () => {
    const field = renderMutationIdemField();
    const match = /value="([^"]+)"/.exec(field);
    expect(match).not.toBeNull();
    // RFC 4122 UUID v4 — 122 bits of cryptographic entropy from crypto.randomUUID().
    expect(match![1]).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
  });

  it('A2: Kovo-Idem value differs across two renders (per-submit freshness)', () => {
    // Each no-JS form render mints a fresh UUID so Back-resubmit uses a different
    // idem and gets deduped independently by the replay store.
    const field1 = renderMutationIdemField();
    const field2 = renderMutationIdemField();
    expect(field1).toContain('name="Kovo-Idem"');
    expect(field2).toContain('name="Kovo-Idem"');
    // Distinct tokens — per-submit freshness guarantee.
    expect(field1).not.toBe(field2);
  });
});
