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
  it('F1: generated server artifact preserves dynamic href semantics for runtime sanitization', () => {
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
    expect(result.renderEquivalenceChecks).toHaveLength(1);
    expect(result.renderEquivalenceChecks[0]).toMatchObject({
      artifact: 'link-list.server.js',
      ok: true,
    });
    expect(result.renderEquivalenceChecks[0]?.actual).toContain('href={link.url}');
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
  it('emits one branded hidden-field helper child for a local mutation form', () => {
    const result = compileComponentModule({
      fileName: 'local-add-to-cart.tsx',
      source: `
export const addToCart = mutation({
  handler() {
    return null;
  },
});

export const AddToCartForm = component({
  mutations: { addToCart },
  render: (_queries, _state, slots) => (
    <form mutation={addToCart}>
      <button type="submit">Add</button>
    </form>
  ),
});
`,
    });

    expect(result.diagnostics).toEqual([]);
    const serverSource = result.files.find((file) => file.kind === 'server')?.source ?? '';
    expect(serverSource).toContain(
      'renderGeneratedMutationFormFields as __kovoRenderGeneratedMutationFormFields',
    );
    expect(serverSource).toContain('__kovoRenderGeneratedMutationFormFields(addToCart)');
    expect(serverSource).not.toContain('__kovoRenderMutationCsrfField');
    expect(serverSource).not.toContain('__kovoRenderMutationIdemField');
  });

  it('emits one branded hidden-field helper child for an imported mutation form', () => {
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

    // The internal helper returns one branded JSX child containing both framework fields.
    expect(serverSource).toContain('__kovoRenderGeneratedMutationFormFields(addToCart)');
    expect(serverSource).toContain("from '@kovojs/server/internal/csrf'");
    expect(serverSource).toContain(
      'renderGeneratedMutationFormFields as __kovoRenderGeneratedMutationFormFields',
    );
    expect(serverSource).not.toContain('__kovoRenderMutationCsrfField');
    expect(serverSource).not.toContain('__kovoRenderMutationIdemField');
  });

  it('keeps the branded hidden-field helper unavailable to app-authored source', () => {
    const result = compileComponentModule({
      fileName: 'forged-fields.tsx',
      source: `
import { renderGeneratedMutationFormFields } from '@kovojs/server/internal/csrf';

export const ForgedFields = component({
  render: () => <form>{renderGeneratedMutationFormFields({ key: 'admin/delete' })}</form>,
});
`,
    });

    expect(result.diagnostics).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'KV235' })]),
    );
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

  it('A2: Kovo-Idem value carries exactly 128 bits of cryptographic entropy', () => {
    const field = renderMutationIdemField();
    const match = /value="([^"]+)"/.exec(field);
    expect(match).not.toBeNull();
    // SPEC §10.3: the server stamp carries 13-digit issue time plus exactly 16 random bytes.
    const token = /^v1_([0-9]{13})_([0-9a-f]{32})$/u.exec(match![1]!);
    expect(token).not.toBeNull();
    expect(Buffer.from(token![2]!, 'hex')).toHaveLength(16);
  });

  it('A2: Kovo-Idem value differs across two renders (per-submit freshness)', () => {
    // Each no-JS form render mints a fresh nonce so Back-resubmit uses a different
    // logical token while preserving the server-time horizon.
    const field1 = renderMutationIdemField();
    const field2 = renderMutationIdemField();
    expect(field1).toContain('name="Kovo-Idem"');
    expect(field2).toContain('name="Kovo-Idem"');
    // Distinct tokens — per-submit freshness guarantee.
    expect(field1).not.toBe(field2);
  });
});
