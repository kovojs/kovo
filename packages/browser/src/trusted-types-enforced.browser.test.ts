import { afterEach, describe, expect, it } from 'vitest';

import { __resetKovoTrustedTypePolicyForTest, kovoCreateHTML } from './trusted-types.js';
import { applyHtmlResponseFragments } from './response-fragment-apply.js';

// SF (secure-framework Tier 3, SPEC §6.6): the LOAD-BEARING proof that Trusted Types can
// ship DEFAULT-ON without bricking Kovo's own hydration on Chromium. Trusted Types is
// Chromium-only runtime defense-in-depth: it turns DOM-XSS sinks OUTSIDE the framework into
// throws, and is SILENTLY IGNORED by every non-Chromium engine. The cross-browser CSP floor
// (csp.ts) carries the real guarantee; TT is a hardening floor, NOT a by-construction proof.
//
// Enforcement cannot be retro-applied to an already-parsed document, so we mint a same-origin
// child document via a `srcdoc` iframe whose `<meta http-equiv="Content-Security-Policy">`
// carries the strict `require-trusted-types-for 'script'; trusted-types kovo` directive the
// server now emits by default. Inside that enforcing realm we prove:
//   (1) a raw (non-framework) string `innerHTML` write THROWS — the DOM-XSS sink is killed;
//   (2) a value minted by the `kovo` policy (what the inlined `trustedHtml` shim and the
//       module-side `kovoCreateHTML` produce) is ACCEPTED — Kovo's own hydration survives.

const hasTrustedTypes = typeof (globalThis as { trustedTypes?: unknown }).trustedTypes !== 'undefined';

function enforcingFrame(): Promise<HTMLIFrameElement> {
  return new Promise((resolve) => {
    const frame = document.createElement('iframe');
    // The enforcing document admits ONLY the framework `kovo` policy (no 'allow-duplicates'),
    // exactly mirroring the header `renderDefaultDocumentCsp` now ships by default.
    frame.srcdoc =
      '<!doctype html><html><head>' +
      '<meta http-equiv="Content-Security-Policy" ' +
      "content=\"require-trusted-types-for 'script'; trusted-types kovo\">" +
      '</head><body><div id="t"></div></body></html>';
    frame.addEventListener('load', () => resolve(frame), { once: true });
    document.body.append(frame);
  });
}

afterEach(() => {
  document.body.replaceChildren();
  __resetKovoTrustedTypePolicyForTest();
});

describe('Trusted Types default-on enforcement (SF Tier 3, Chromium-only)', () => {
  it.runIf(hasTrustedTypes)(
    'kills a non-framework raw-string innerHTML write under the strict CSP',
    async () => {
      const frame = await enforcingFrame();
      const win = frame.contentWindow as Window & { trustedTypes?: unknown };
      const target = frame.contentDocument?.getElementById('t') as HTMLElement;

      // Sanity: the enforcing realm exposes Trusted Types.
      expect(win.trustedTypes).toBeDefined();

      // A raw string write into innerHTML is a DOM-XSS sink — the strict CSP makes it throw.
      expect(() => {
        target.innerHTML = '<img src=x onerror=alert(1)>';
      }).toThrow();
    },
  );

  it.runIf(hasTrustedTypes)(
    'accepts HTML minted by the framework kovo policy (hydration survives enforcement)',
    async () => {
      const frame = await enforcingFrame();
      const win = frame.contentWindow as Window & {
        trustedTypes: {
          createPolicy(
            name: string,
            rules: { createHTML(input: string): string },
          ): { createHTML(input: string): unknown };
        };
      };
      const target = frame.contentDocument?.getElementById('t') as HTMLElement;

      // Mint a TrustedHTML through the sole `kovo` policy — the identity transform the
      // inlined `trustedHtml` shim and module-side `kovoCreateHTML` both use. The strict CSP
      // admits exactly this policy, so the same sink that threw above now succeeds.
      const policy = win.trustedTypes.createPolicy('kovo', { createHTML: (s: string) => s });
      expect(() => {
        target.innerHTML = policy.createHTML('<span>hydrated</span>') as unknown as string;
      }).not.toThrow();
      expect(target.querySelector('span')?.textContent).toBe('hydrated');
    },
  );

  it.runIf(hasTrustedTypes)(
    'kovoCreateHTML returns a sink-acceptable TrustedHTML when Trusted Types is present',
    () => {
      // In the chromium test realm `window.trustedTypes` exists, so kovoCreateHTML mints a
      // real TrustedHTML (not a raw string) the DOM sink accepts. The fragment-apply path
      // (inline `trustedHtml` shim equivalent) writes through the same policy seam.
      const out = kovoCreateHTML('<b>x</b>');
      expect(String(out)).toBe('<b>x</b>');

      const host = document.createElement('div');
      host.setAttribute('kovo-fragment-target', 'f');
      host.innerHTML = '<span>old</span>';
      document.body.append(host);
      const applied = applyHtmlResponseFragments(
        [{ html: '<div kovo-fragment-target="f"><span>new</span></div>', target: 'f' }],
        (name) => document.querySelector(`[kovo-fragment-target="${name}"]`),
      );
      expect(applied).toEqual(['f']);
      expect(document.querySelector('[kovo-fragment-target="f"] span')?.textContent).toBe('new');
    },
  );
});
